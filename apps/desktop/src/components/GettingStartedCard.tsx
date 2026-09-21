import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ConnectorPublic } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { arrabApi } from "@/lib/api";
import {
  dismissGettingStarted,
  enableGettingStartedNotifications,
  markGettingStartedStep,
  OPEN_ADD_COMPANION_KEY,
  readGettingStarted,
  resolveGettingStartedDone,
  setGettingStartedCollapsed,
  subscribeGettingStarted,
  type GettingStartedAudience,
  type GettingStartedStepId,
} from "@/lib/getting-started";
import { cn } from "@/lib/utils";

type StepDef = {
  id: GettingStartedStepId;
  labelKey:
    | "gsNotifications"
    | "gsFirstCompanion"
    | "gsFirstEmployee"
    | "gsGmail"
    | "gsLinear"
    | "gsGithub"
    | "gsLocalModel"
    | "gsGoal"
    | "gsDaily";
  brand?: "gmail" | "linear" | "github";
};

const INDIVIDUAL_STEPS: StepDef[] = [
  { id: "notifications", labelKey: "gsNotifications" },
  { id: "first_person", labelKey: "gsFirstCompanion" },
  { id: "gmail", labelKey: "gsGmail", brand: "gmail" },
  { id: "linear", labelKey: "gsLinear", brand: "linear" },
  { id: "local_model", labelKey: "gsLocalModel" },
  { id: "goal", labelKey: "gsDaily" },
];

const ORGANIZATION_STEPS: StepDef[] = [
  { id: "notifications", labelKey: "gsNotifications" },
  { id: "first_person", labelKey: "gsFirstEmployee" },
  { id: "gmail", labelKey: "gsGmail", brand: "gmail" },
  { id: "linear", labelKey: "gsGithub", brand: "github" },
  { id: "local_model", labelKey: "gsLocalModel" },
  { id: "goal", labelKey: "gsGoal" },
];

export function GettingStartedCard({
  audience,
  agentCount = 0,
  companionCount = 0,
  className,
  variant = "companion",
  onCollapse,
}: {
  audience: GettingStartedAudience;
  agentCount?: number;
  /** Bumps progress when companions change on the individual board. */
  companionCount?: number;
  className?: string;
  variant?: "companion" | "home" | "dock";
  /** Dock mode: tuck the yellow box back into Help instead of hard-dismiss. */
  onCollapse?: () => void;
}) {
  const { t } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [hidden, setHidden] = useState(() => readGettingStarted().dismissed && variant !== "dock");

  useEffect(() => subscribeGettingStarted(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    let alive = true;
    void arrabApi
      .connectors()
      .then((response) => {
        if (alive) setConnectors(response.items);
      })
      .catch(() => {
        if (alive) setConnectors([]);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const steps = audience === "individual" ? INDIVIDUAL_STEPS : ORGANIZATION_STEPS;

  const progress = useMemo(() => {
    void tick;
    void companionCount;
    return steps.map((step) => ({
      ...step,
      done: resolveGettingStartedDone({
        stepId: step.id,
        audience,
        connectors,
        agentCount,
      }),
    }));
  }, [agentCount, audience, companionCount, connectors, steps, tick]);

  const doneCount = progress.filter((step) => step.done).length;
  const total = progress.length;
  const ratio = total === 0 ? 0 : doneCount / total;
  const allDone = doneCount === total;

  const onActivate = useCallback(
    async (step: (typeof progress)[number]) => {
      if (step.done) {
        markGettingStartedStep(step.id, false);
        setTick((n) => n + 1);
        return;
      }

      switch (step.id) {
        case "notifications":
          await enableGettingStartedNotifications();
          setTick((n) => n + 1);
          return;
        case "first_person":
          if (audience === "individual") {
            sessionStorage.setItem(OPEN_ADD_COMPANION_KEY, "1");
            navigate(href("/"));
          } else {
            navigate(href("/"));
            window.setTimeout(() => {
              window.dispatchEvent(new Event("arrab:open-hire"));
            }, 180);
          }
          return;
        case "gmail":
          navigate(href("/connectors"));
          return;
        case "linear":
          navigate(href("/connectors"));
          return;
        case "local_model":
          navigate(href("/settings?tab=models"));
          return;
        case "goal":
          if (audience === "organization") {
            navigate(href("/"));
            requestAnimationFrame(() => {
              document.querySelector<HTMLElement>("[data-studio-goal]")?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            });
          } else {
            navigate(href("/me"));
          }
          return;
        default:
          return;
      }
    },
    [audience, href, navigate],
  );

  if (variant !== "dock" && (hidden || allDone)) {
    return null;
  }

  return (
    <section
      className={cn(
        variant === "dock" ? "gs-dock-card" : variant === "companion" ? "cp-getting-started" : "gs-home-card",
        className,
      )}
      aria-label={t("gsTitle")}
    >
      <header className="gs-head">
        <h2>{t("gsTitle")}</h2>
        <div className="gs-head-actions">
          <span className="gs-count">
            {allDone
              ? t("gsAllDone")
              : t("gsProgress")
                  .replace("{done}", String(doneCount))
                  .replace("{total}", String(total))}
          </span>
          <button
            type="button"
            className="gs-dismiss"
            aria-label={variant === "dock" ? t("gsHide") : t("gsDismiss")}
            onClick={() => {
              if (onCollapse) {
                onCollapse();
                return;
              }
              dismissGettingStarted();
              setGettingStartedCollapsed(true);
              setHidden(true);
            }}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <div className="gs-track" aria-hidden>
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>

      <ul className="gs-list">
        {progress.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              className={cn("gs-row", step.done && "is-done")}
              onClick={() => void onActivate(step)}
            >
              <span className="gs-check" aria-hidden>
                {step.done ? <Check size={12} strokeWidth={2.4} /> : null}
              </span>
              <span className="gs-label">{t(step.labelKey)}</span>
              {step.brand ? <BrandMark brand={step.brand} /> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BrandMark({ brand }: { brand: "gmail" | "linear" | "github" }) {
  if (brand === "gmail") {
    return (
      <span className="gs-brand" title="Gmail" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="#EA4335" d="M3 6.75 12 13l9-6.25V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.75Z" />
          <path fill="#FBBC05" d="M3 6.75V18l6-4.5V9.3L3 6.75Z" opacity=".85" />
          <path fill="#34A853" d="M21 6.75V18l-6-4.5V9.3l6-2.55Z" opacity=".85" />
          <path fill="#4285F4" d="M3 6.75 12 13l9-6.25-1.7-1.2L12 10.2 4.7 5.55 3 6.75Z" />
        </svg>
      </span>
    );
  }
  if (brand === "linear") {
    return (
      <span className="gs-brand gs-brand-linear" title="Linear" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path
            fill="currentColor"
            d="M3.5 14.7 9.3 20.5A9 9 0 0 0 20.5 9.3L14.7 3.5A9 9 0 0 0 3.5 14.7Zm2.6-.7A6.5 6.5 0 0 1 14 6.1l3.9 3.9A6.5 6.5 0 0 1 6.1 14Z"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="gs-brand gs-brand-github" title="GitHub" aria-hidden>
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.2-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.8-4.6 5 .4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"
        />
      </svg>
    </span>
  );
}
