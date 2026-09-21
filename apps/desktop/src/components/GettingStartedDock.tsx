import { useEffect, useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import { GettingStartedCard } from "@/components/GettingStartedCard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { arrabApi } from "@/lib/api";
import { liveCompanions, useCompanionState } from "@/lib/companions";
import {
  isGettingStartedCollapsed,
  openGettingStarted,
  setGettingStartedCollapsed,
  subscribeGettingStarted,
} from "@/lib/getting-started";
import { cn } from "@/lib/utils";

/** Small Help icon for the left studio rail — Getting Started pops out beside it. */
export function GettingStartedRailHelp({
  tooltipSide = "right",
}: {
  tooltipSide?: "left" | "right";
}) {
  const { t } = useLanguage();
  const { isIndividual } = useRole();
  const audience = isIndividual ? "individual" : "organization";
  const companionState = useCompanionState();
  const [collapsed, setCollapsed] = useState(() => isGettingStartedCollapsed());
  const [agentCount, setAgentCount] = useState(0);

  const companionCount = useMemo(() => {
    return (
      liveCompanions(companionState, "personal").filter((person) => person.domain !== "general")
        .length +
      liveCompanions(companionState, "work").filter((person) => person.domain !== "general").length
    );
  }, [companionState]);

  useEffect(() => subscribeGettingStarted(() => setCollapsed(isGettingStartedCollapsed())), []);

  useEffect(() => {
    if (audience !== "organization") {
      setAgentCount(0);
      return;
    }
    let alive = true;
    void arrabApi
      .agents()
      .then((response) => {
        if (alive) setAgentCount(response.items?.length ?? 0);
      })
      .catch(() => {
        if (alive) setAgentCount(0);
      });
    return () => {
      alive = false;
    };
  }, [audience, collapsed, companionCount]);

  const open = !collapsed;
  const helpLabel = t("gsHelp");

  return (
    <>
      {open ? (
        <div className="gs-dock-panel" aria-live="polite">
          <GettingStartedCard
            audience={audience}
            companionCount={companionCount}
            agentCount={agentCount}
            variant="dock"
            onCollapse={() => {
              setGettingStartedCollapsed(true);
              setCollapsed(true);
            }}
          />
        </div>
      ) : null}

      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn("gs-rail-help", open && "is-active")}
            aria-expanded={open}
            aria-label={helpLabel}
            onClick={() => {
              if (open) {
                setGettingStartedCollapsed(true);
                setCollapsed(true);
              } else {
                openGettingStarted();
                setCollapsed(false);
              }
            }}
          >
            <CircleHelp className="size-3.5" strokeWidth={1.8} />
          </button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} sideOffset={12}>
          {helpLabel}
        </TooltipContent>
      </Tooltip>
    </>
  );
}
