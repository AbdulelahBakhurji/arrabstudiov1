import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { AccountStatusResponse, PlanAudience, SubscriptionPlanId } from "@arrab/shared";
import { PlansCatalog } from "@/components/PlansCatalog";
import { Surface } from "@/components/StudioFrame";
import { arrabApi } from "@/lib/api";
import { subscribeAccountSession } from "@/lib/account-session";

export const PLAN_PATH = {
  individual: "/plans/individuals",
  family: "/plans/families",
  organization: "/plans/organizations",
} as const;

function audienceFromParam(value: string | undefined): PlanAudience | null {
  if (value === "individuals" || value === "individual") return "individual";
  if (value === "families" || value === "family") return "family";
  if (value === "organizations" || value === "organization") return "organization";
  return null;
}

export function PlansPage() {
  const { audience: audienceParam } = useParams<{ audience?: string }>();
  const navigate = useNavigate();
  const audience = audienceFromParam(audienceParam);
  const [account, setAccount] = useState<AccountStatusResponse | null>(null);

  useEffect(() => {
    const load = () => {
      void arrabApi
        .account()
        .then(setAccount)
        .catch(() => setAccount(null));
    };
    load();
    return subscribeAccountSession(load);
  }, []);

  if (!audience) {
    return <Navigate to={PLAN_PATH.individual} replace />;
  }

  const currentPlanId = (account?.account?.planId ??
    account?.entitlements.planId ??
    null) as SubscriptionPlanId | null;

  return (
    <Surface className="settings-shell">
      <div className="settings-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1080px] px-6 py-8 sm:px-8 lg:px-10">
        <PlansCatalog
          audience={audience}
          onAudienceChange={(next) => {
            navigate(PLAN_PATH[next], { replace: true });
          }}
          currentPlanId={currentPlanId}
          signedIn={Boolean(account?.connected && account.account)}
          onAccountChanged={setAccount}
        />
      </div>
    </Surface>
  );
}
