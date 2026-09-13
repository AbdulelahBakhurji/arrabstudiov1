import { Outlet } from "react-router-dom";
import logoTall from "@/assets/logotall.png";
import { SignInPage } from "@/pages/SignInPage";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { useLanguage } from "@/i18n/LanguageProvider";

export function AuthGate() {
  const { signedIn, loading, refresh } = useSignedInAccount();
  const { t, dir } = useLanguage();

  if (loading) {
    return (
      <div
        dir={dir}
        className="flex h-full w-full items-center justify-center bg-[#040404] text-foreground"
      >
        <div className="arrab-fade flex flex-col items-center gap-3">
          <img src={logoTall} alt={t("brand")} className="brand-mark h-10 w-auto opacity-90" />
          <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            {t("authChecking")}
          </p>
        </div>
      </div>
    );
  }

  if (!signedIn) {
    return <SignInPage onSignedIn={refresh} />;
  }

  return <Outlet />;
}
