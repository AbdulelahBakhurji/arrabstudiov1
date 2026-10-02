import { useEffect, useState, useSyncExternalStore } from "react";
import { Outlet, useNavigate } from "react-router-dom";
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
import { consumePostAuthPlanSetup, peekPostAuthPlanSetup } from "@/domains/account/post-auth-setup";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { useRole } from "@/domains/account/roles/RoleProvider";
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
  const { href } = useRole();
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
    if (consumePostAuthPlanSetup()) {
      navigate(href("/account?section=plan"), { replace: true });
    }
  }, [signedIn, navigate, href]);

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
