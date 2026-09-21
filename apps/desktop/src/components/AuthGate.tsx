import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { FirstLaunchSetup } from "@/components/FirstLaunchSetup";
import { SignInPage } from "@/pages/SignInPage";
import {
  readFirstLaunchSetup,
  shouldShowFirstLaunchSetup,
  subscribeFirstLaunchSetup,
} from "@/lib/first-launch-setup";
import { consumePostAuthPlanSetup, peekPostAuthPlanSetup } from "@/lib/post-auth-setup";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";

export function AuthGate() {
  const { signedIn, refresh } = useSignedInAccount();
  const { dir } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const [needsStartup, setNeedsStartup] = useState(() =>
    shouldShowFirstLaunchSetup(false),
  );

  useEffect(() => {
    setNeedsStartup(shouldShowFirstLaunchSetup(false));
    return subscribeFirstLaunchSetup(() => {
      setNeedsStartup(shouldShowFirstLaunchSetup(false));
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    if (!peekPostAuthPlanSetup()) return;
    if (consumePostAuthPlanSetup()) {
      navigate(href("/account?section=plan"), { replace: true });
    }
  }, [signedIn, navigate, href]);

  // One-time startup wizard before sign-in (skipped after completed).
  if (needsStartup && !readFirstLaunchSetup().completed) {
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

  // Instant entry: token or verified account → studio. No session-check page.
  if (signedIn) {
    return <Outlet />;
  }

  return <SignInPage onSignedIn={refresh} />;
}
