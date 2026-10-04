import { useEffect, useState, useSyncExternalStore } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
  isLiveCatalogPlanId,
  normalizePlanId,
  resolvePlanAudience,
} from "@arrab/shared";
import { FirstLaunchSetup } from "@/domains/account/ui/FirstLaunchSetup";
import { SignInPage } from "@/domains/account/pages/SignInPage";
import {
  readFirstLaunchSetup,
  shouldShowFirstLaunchSetup,
  subscribeFirstLaunchSetup,
} from "@/domains/account/first-launch-setup";
import {
  clearGuestLocalMode,
  isGuestLocalMode,
  subscribeGuestMode,
} from "@/core/session/guest-mode";
import {
  clearPostAuthPlanHandoff,
  consumePostAuthPlanSetup,
  peekPostAuthPlanSetup,
  readPostAuthPlanHandoff,
} from "@/domains/account/post-auth-setup";
import {
  refreshAccountStatus,
  useSignedInAccount,
} from "@/domains/account/use-signed-in-account";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { homePathForAudience } from "@/domains/account/roles/catalog";
import { useRole } from "@/domains/account/roles/RoleProvider";
import { arrabApi } from "@/core/api/api";
import {
  readOrgEmployeeSession,
  subscribeOrgEmployeeSession,
} from "@/domains/organization/org-employee-session";

export function AuthGate() {
  const { signedIn, refresh } = useSignedInAccount();
  const orgSeat = useSyncExternalStore(
    subscribeOrgEmployeeSession,
    readOrgEmployeeSession,
    () => null,
  );
  const { dir } = useLanguage();
  const { setRole } = useRole();
  const navigate = useNavigate();
  const [needsStartup, setNeedsStartup] = useState(() => shouldShowFirstLaunchSetup());
  const [guestLocal, setGuestLocal] = useState(() => isGuestLocalMode());

  useEffect(() => {
    if (!shouldShowFirstLaunchSetup()) return;
    // Setup must run before guest or studio — drop leftover local-only sessions.
    clearGuestLocalMode();
    setGuestLocal(false);
  }, []);

  useEffect(() => {
    setNeedsStartup(shouldShowFirstLaunchSetup());
    return subscribeFirstLaunchSetup(() => {
      setNeedsStartup(shouldShowFirstLaunchSetup());
    });
  }, []);

  useEffect(() => subscribeGuestMode(() => setGuestLocal(isGuestLocalMode())), []);

  useEffect(() => {
    if (!signedIn) return;
    if (!peekPostAuthPlanSetup()) return;
    if (!consumePostAuthPlanSetup()) return;
    const handoff = readPostAuthPlanHandoff();
    clearPostAuthPlanHandoff();
    void (async () => {
      await refreshAccountStatus({ silent: true }).catch(() => undefined);
      refresh();

      const handoffPlan = normalizePlanId(handoff?.planId ?? null);
      let planId: string | null = handoffPlan;
      let planName = handoff?.planName ?? null;
      let planCategory: string | null = null;

      try {
        let status = await arrabApi.account();
        const apiPlan = normalizePlanId(
          status.entitlements?.planId ?? status.account?.planId ?? null,
        );

        // Selected live plan from website/code redeem wins over mistaken Scale (unlimited).
        if (
          handoffPlan &&
          isLiveCatalogPlanId(handoffPlan) &&
          apiPlan === "unlimited" &&
          (handoffPlan === "max" || handoffPlan === "pro" || handoffPlan === "starter")
        ) {
          status = await arrabApi.correctAccountPlan({ planId: handoffPlan }).catch(() => status);
          await refreshAccountStatus({ silent: true }).catch(() => undefined);
        }

        const nextApiPlan = normalizePlanId(
          status.entitlements?.planId ?? status.account?.planId ?? null,
        );
        planId =
          handoffPlan && isLiveCatalogPlanId(handoffPlan) && nextApiPlan === "unlimited"
            ? handoffPlan
            : (nextApiPlan ?? handoffPlan);
        planName =
          status.entitlements?.planName ?? status.account?.planName ?? planName;
        planCategory =
          status.entitlements?.planCategory ??
          status.account?.planCategory ??
          null;
      } catch {
        // Use handoff signals when status is not ready yet.
      }

      const audience = resolvePlanAudience({ planId, planCategory, planName });
      setRole(audience);
      const section = handoff?.section === "usage" ? "usage" : "plan";
      navigate(`${homePathForAudience(audience)}/account?section=${section}`, {
        replace: true,
      });
    })();
  }, [signedIn, navigate, setRole, refresh]);

  // First install only. After setup: sign-in, or studio when already signed in.
  if (shouldShowFirstLaunchSetup() || (needsStartup && !readFirstLaunchSetup().completed)) {
    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground"
        dir={dir}
      >
        <FirstLaunchSetup
          onFinished={() => {
            setNeedsStartup(false);
            refresh();
          }}
        />
      </div>
    );
  }

  // Account owner / family seat, org employee seat, or guest local-only.
  if (signedIn || guestLocal || orgSeat) {
    return <Outlet />;
  }

  return (
    <SignInPage
      onSignedIn={refresh}
      onContinueLocal={() => setGuestLocal(true)}
    />
  );
}
