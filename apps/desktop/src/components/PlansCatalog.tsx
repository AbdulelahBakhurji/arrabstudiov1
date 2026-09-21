import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Check, Home, UserRound } from "lucide-react";
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_REDEEM_CODES,
  type AccountStatusResponse,
  type PlanAudience,
  type SubscriptionPlan,
  type SubscriptionPlanId,
} from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { pushToast } from "@/lib/notify";
import { useRole } from "@/roles/RoleProvider";
import { cn } from "@/lib/utils";

const PLAN_CODE: Record<SubscriptionPlanId, string> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_REDEEM_CODES).map(([code, planId]) => [planId, code]),
) as Record<SubscriptionPlanId, string>;

function priceLabel(plan: SubscriptionPlan, locale: string): string {
  if (plan.monthlyPriceHalalas === 0) {
    return "0";
  }
  return (plan.monthlyPriceHalalas / 100).toLocaleString(locale === "ar" ? "ar-SA" : "en-US");
}

/** Cursor-style usage multiplier vs Free — never show raw token counts on plans. */
function usageTierLabel(plan: SubscriptionPlan): string {
  const base = SUBSCRIPTION_PLANS.free.monthlyTokenLimit || 100_000;
  const mult = Math.max(1, Math.round(plan.monthlyTokenLimit / base));
  return `${mult}×`;
}

function badgeLabel(
  badge: string,
  t: (key: "plansMostChosen" | "plansScale" | "plansHousehold" | "plansFamilyPick" | "plansTrial") => string,
): string {
  if (badge === "Most chosen") return t("plansMostChosen");
  if (badge === "Scale") return t("plansScale");
  if (badge === "Household") return t("plansHousehold");
  if (badge === "Family pick") return t("plansFamilyPick");
  if (badge === "Trial") return t("plansTrial");
  return badge;
}

function audienceCopy(
  audience: PlanAudience,
  t: ReturnType<typeof useLanguage>["t"],
): { title: string; body: string; forLabel: string } {
  if (audience === "family") {
    return {
      title: t("plansFamilyTitle"),
      body: t("plansFamilyBody"),
      forLabel: t("plansForFamily"),
    };
  }
  if (audience === "organization") {
    return {
      title: t("plansOrganizationTitle"),
      body: t("plansOrganizationBody"),
      forLabel: t("plansForStudio"),
    };
  }
  return {
    title: t("plansIndividualTitle"),
    body: t("plansIndividualBody"),
    forLabel: t("plansForYou"),
  };
}

export function PlansCatalog({
  audience,
  onAudienceChange,
  currentPlanId,
  signedIn,
  onAccountChanged,
  onNeedSignIn,
  variant = "page",
  /** When set, user cannot browse other audiences (locked by account plan). */
  lockAudience = false,
}: {
  audience: PlanAudience;
  onAudienceChange: (next: PlanAudience) => void;
  currentPlanId: SubscriptionPlanId | null;
  signedIn: boolean;
  onAccountChanged?: (status: AccountStatusResponse) => void;
  onNeedSignIn?: () => void;
  variant?: "page" | "settings";
  lockAudience?: boolean;
}) {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const { href } = useRole();
  const [busyId, setBusyId] = useState<SubscriptionPlanId | null>(null);

  const lockedAudience = useMemo(() => {
    if (!lockAudience || !currentPlanId) return null;
    return SUBSCRIPTION_PLANS[currentPlanId]?.audience ?? null;
  }, [lockAudience, currentPlanId]);

  const activeAudience = lockedAudience ?? audience;

  const plans = useMemo(
    () => Object.values(SUBSCRIPTION_PLANS).filter((plan) => plan.audience === activeAudience),
    [activeAudience],
  );

  const copy = audienceCopy(activeAudience, t);
  const accent =
    activeAudience === "family"
      ? "family"
      : activeAudience === "organization"
        ? "organization"
        : "individual";

  function goSignIn() {
    if (onNeedSignIn) {
      onNeedSignIn();
      return;
    }
    navigate(href("/account"));
  }

  async function choosePlan(plan: SubscriptionPlan) {
    if (plan.id === currentPlanId) {
      return;
    }
    if (lockedAudience && plan.audience !== lockedAudience) {
      pushToast({
        title: t("plansAudienceLocked"),
        body: t("plansAudienceLockedBody"),
        tone: "warn",
      });
      return;
    }
    if (!signedIn) {
      goSignIn();
      return;
    }
    const code = PLAN_CODE[plan.id];
    if (!code) {
      return;
    }
    setBusyId(plan.id);
    try {
      const status = await arrabApi.activateSubscription({ code });
      window.dispatchEvent(new CustomEvent("arrab:account"));
      onAccountChanged?.(status);
      pushToast({
        title: t("subscriptionActivated"),
        body: status.account?.planName ?? plan.name,
        tone: "success",
      });
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={cn("plans-catalog", `plans-${accent}`)}>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-4",
          variant === "page" ? "mb-8" : "mb-6",
        )}
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            {t("plansEyebrow")}
          </p>
          <h2
            className={cn(
              "mt-1 font-medium tracking-[-0.03em] text-white",
              variant === "page" ? "text-3xl sm:text-[2.15rem]" : "text-2xl",
            )}
          >
            {copy.title}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-400">{copy.body}</p>
          {lockedAudience ? (
            <p className="mt-2 text-xs text-neutral-500">{t("plansAudienceLockedHint")}</p>
          ) : null}
        </div>

        {!lockedAudience ? (
          <div
            className="inline-flex flex-wrap rounded-full border border-white/10 bg-black/40 p-1"
            role="tablist"
            aria-label={t("plans")}
          >
            <AudienceTab
              active={activeAudience === "individual"}
              icon={UserRound}
              label={t("plansIndividuals")}
              onClick={() => onAudienceChange("individual")}
            />
            <AudienceTab
              active={activeAudience === "family"}
              icon={Home}
              label={t("plansFamilies")}
              onClick={() => onAudienceChange("family")}
            />
            <AudienceTab
              active={activeAudience === "organization"}
              icon={Building2}
              label={t("plansOrganizations")}
              onClick={() => onAudienceChange("organization")}
            />
          </div>
        ) : (
          <div className="rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-neutral-300">
            {activeAudience === "family"
              ? t("plansFamilies")
              : activeAudience === "organization"
                ? t("plansOrganizations")
                : t("plansIndividuals")}
          </div>
        )}
      </div>

      {currentPlanId ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
          <p className="text-sm text-neutral-300">
            {t("plansCurrentMembership")}{" "}
            <span className="text-white">
              {SUBSCRIPTION_PLANS[currentPlanId]?.name ?? currentPlanId}
            </span>
          </p>
          <p className="text-xs text-neutral-500">{t("plansBilledMonthly")}</p>
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-4",
          activeAudience === "individual"
            ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]"
            : "lg:grid-cols-2",
        )}
      >
        {plans.map((plan) => {
          const current = plan.id === currentPlanId;
          const featured = Boolean(plan.highlight);
          return (
            <article
              key={plan.id}
              className={cn(
                "relative overflow-hidden rounded-[22px] border p-5 sm:p-6",
                featured
                  ? cn(
                      "plans-card-featured",
                      accent === "individual"
                        ? "border-[#7eb6ff]/50 bg-gradient-to-br from-[#121a28] via-[#0d1420] to-[#0a0e14]"
                        : accent === "family"
                          ? "border-rose-300/40 bg-gradient-to-br from-[#1a1216] via-[#140f12] to-[#0a0e14]"
                          : "border-amber-300/35 bg-gradient-to-br from-[#1a1610] via-[#12100c] to-[#0a0e14]",
                    )
                  : "border-white/10 bg-[var(--color-surface)]",
              )}
            >
              {plan.badge ? (
                <span
                  className={cn(
                    "absolute end-5 top-5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]",
                    accent === "individual"
                      ? "bg-[#7eb6ff] text-[#0a1220]"
                      : accent === "family"
                        ? "bg-rose-200 text-[#1a0e12]"
                        : "bg-amber-200 text-[#1a1408]",
                  )}
                >
                  {badgeLabel(plan.badge, t)}
                </span>
              ) : null}

              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                {copy.forLabel}
              </p>
              <div className="mt-2 flex items-end gap-2">
                <h3 className="text-2xl font-medium tracking-[-0.03em] text-white">{plan.name}</h3>
                {current ? (
                  <span className="mb-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-100">
                    {t("plansCurrent")}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-sm text-sm text-neutral-400">{plan.description}</p>

              <div className="mt-6 flex items-end gap-1.5">
                <span className="text-4xl font-medium tracking-[-0.04em] text-white tabular-nums">
                  {priceLabel(plan, locale)}
                </span>
                <span className="mb-1 text-sm text-neutral-500">
                  {t("plansSar")} {t("plansPerMonth")}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {t("plansUsageTier").replace("{n}", usageTierLabel(plan))}
                {plan.seatLimit
                  ? ` · ${t("plansSeats").replace("{n}", String(plan.seatLimit))}`
                  : null}
              </p>

              <ul className="mt-6 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-neutral-300">
                    <Check
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        featured
                          ? accent === "individual"
                            ? "text-[#7eb6ff]"
                            : accent === "family"
                              ? "text-rose-200"
                              : "text-amber-200"
                          : "text-neutral-500",
                      )}
                      strokeWidth={2.2}
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={current || busyId === plan.id}
                onClick={() => void choosePlan(plan)}
                className={cn(
                  "mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium disabled:opacity-50",
                  current
                    ? "border border-white/15 text-neutral-400"
                    : featured
                      ? accent === "individual"
                        ? "bg-[#7eb6ff] text-[#0a1220] hover:bg-[#9bc5ff]"
                        : accent === "family"
                          ? "bg-rose-200 text-[#1a0e12] hover:bg-rose-100"
                          : "bg-amber-200 text-[#1a1408] hover:bg-amber-100"
                      : "bg-white text-black hover:bg-neutral-200",
                )}
              >
                {current
                  ? t("plansCurrent")
                  : busyId === plan.id
                    ? t("loading")
                    : signedIn
                      ? t("plansChoose").replace("{plan}", plan.name)
                      : t("plansSignInToChoose")}
              </button>
            </article>
          );
        })}
      </div>

      {!lockedAudience ? (
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() =>
              onAudienceChange(
                activeAudience === "individual"
                  ? "family"
                  : activeAudience === "family"
                    ? "organization"
                    : "individual",
              )
            }
            className="h-11 rounded-full border border-white/15 px-5 text-sm text-neutral-300 hover:bg-white/5 hover:text-white"
          >
            {activeAudience === "individual"
              ? t("plansSwitchToFamily")
              : activeAudience === "family"
                ? t("plansSwitchToOrg")
                : t("plansSwitchToIndividual")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AudienceTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof UserRound;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors",
        active ? "bg-white text-black" : "text-neutral-400 hover:text-white",
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
      {label}
    </button>
  );
}
