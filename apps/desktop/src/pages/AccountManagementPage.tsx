import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  CreditCard,
  Gauge,
  KeyRound,
  LogOut,
  Shield,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { AccountStatusResponse, PlanAudience, SubscriptionPlanId } from "@arrab/shared";
import { PlansCatalog } from "@/components/PlansCatalog";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import {
  clearAccountSession,
  initialsFromName,
  readAccountSessionToken,
} from "@/lib/account-session";
import { openExternalUrl } from "@/lib/desktop";
import { pushToast } from "@/lib/notify";
import { useRole } from "@/roles/RoleProvider";
import { cn } from "@/lib/utils";

type AccountSection = "overview" | "profile" | "plan" | "usage" | "security";

function formatTokens(value: number | null | undefined, unlimited: string): string {
  if (value === null || value === undefined) {
    return unlimited;
  }
  return value.toLocaleString();
}

function usagePercent(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((used / limit) * 100));
}

export function AccountManagementPage() {
  const { t, locale, dir } = useLanguage();
  const { role } = useRole();
  const [section, setSection] = useState<AccountSection>("overview");
  const [status, setStatus] = useState<AccountStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [subscribeCode, setSubscribeCode] = useState("");
  const [planAudience, setPlanAudience] = useState<PlanAudience>(
    role === "organization" ? "organization" : "individual",
  );
  const [checkoutBusy, setCheckoutBusy] = useState<SubscriptionPlanId | null>(null);
  const hasSession = Boolean(readAccountSessionToken());

  const refresh = useCallback(() => {
    setLoading(true);
    void arrabApi
      .account()
      .then((next) => {
        setStatus(next);
        if (next.account) {
          setDisplayName(next.account.displayName);
        }
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const account = status?.account ?? null;
  const entitlements = status?.entitlements ?? null;
  const planId = account?.planId ?? entitlements?.planId ?? null;
  const used = entitlements?.tokensUsed ?? 0;
  const limit = entitlements?.tokenLimit ?? null;
  const remaining = entitlements?.tokensRemaining ?? null;
  const pct = usagePercent(used, limit);

  const nav = useMemo(
    () =>
      [
        { id: "overview" as const, label: t("amOverview"), icon: Sparkles },
        { id: "profile" as const, label: t("amProfile"), icon: UserRound },
        { id: "plan" as const, label: t("amPlanBilling"), icon: CreditCard },
        { id: "usage" as const, label: t("amUsage"), icon: Gauge },
        { id: "security" as const, label: t("amSecurity"), icon: Shield },
      ] as const,
    [t],
  );

  async function saveProfile() {
    if (!displayName.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await arrabApi.updateAccountProfile({ displayName: displayName.trim() });
      setStatus(next);
      pushToast({ title: t("profileSaved"), tone: "success" });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function activateCode() {
    if (!subscribeCode.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await arrabApi.activateSubscription({ code: subscribeCode.trim() });
      setStatus(next);
      setSubscribeCode("");
      pushToast({
        title: t("subscriptionActivated"),
        body: next.account?.planName,
        tone: "success",
      });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout(plan: SubscriptionPlanId) {
    setCheckoutBusy(plan);
    setError(null);
    try {
      const checkout = await arrabApi.billingCheckout({ planId: plan });
      await openExternalUrl(checkout.checkoutUrl);
      pushToast({
        title: t("amCheckoutOpened"),
        body: checkout.amountLabel,
        tone: "info",
      });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setCheckoutBusy(null);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await arrabApi.logoutAccount();
      clearAccountSession();
      pushToast({ title: t("accountLoggedOut"), tone: "info" });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("amDisconnectConfirm"))) {
      return;
    }
    setBusy(true);
    try {
      await arrabApi.disconnectAccount();
      clearAccountSession();
      pushToast({ title: t("accountDisconnected"), tone: "info" });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !status) {
    return (
      <Surface className="flex items-center justify-center p-8">
        <p className="text-sm text-neutral-500">{t("authChecking")}</p>
      </Surface>
    );
  }

  return (
    <Surface className="account-mgmt p-3 sm:p-4 lg:p-5">
      <div
        dir={dir}
        className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 lg:flex-row"
      >
        <aside className="arrab-rise shrink-0 lg:w-64">
          <div className="rounded-[28px] border border-white/10 bg-[#080808] p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              {t("amEyebrow")}
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">
              {t("amTitle")}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">{t("amBody")}</p>

            {account ? (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10 text-xs font-semibold text-emerald-50">
                  {initialsFromName(account.displayName, account.email)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{account.displayName}</p>
                  <p className="truncate text-[11px] text-neutral-500">{account.email}</p>
                </div>
              </div>
            ) : null}

            <nav className="mt-4 space-y-1" aria-label={t("amTitle")}>
              {nav.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-sm transition",
                      active
                        ? "bg-white text-black"
                        : "text-neutral-400 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.7} />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="arrab-rise-delay-1 min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto pb-4">
          {error ? (
            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          {section === "overview" ? (
            <section className="space-y-4">
              <Panel title={t("amIdentity")} subtitle={t("amIdentityBody")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Metric
                    label={t("accountStatus")}
                    value={t("accountSignedInStatus")}
                    hint={account?.email}
                  />
                  <Metric
                    label={t("currentPlan")}
                    value={entitlements?.planName ?? "—"}
                    hint={
                      account
                        ? `${t("amMemberSince")} ${new Date(account.connectedAt).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US")}`
                        : undefined
                    }
                  />
                  <Metric
                    label={t("periodTokens")}
                    value={`${formatTokens(used, t("unlimitedTokens"))} / ${formatTokens(limit, t("unlimitedTokens"))}`}
                    hint={
                      remaining === null
                        ? t("unlimitedTokens")
                        : `${formatTokens(remaining, t("unlimitedTokens"))} ${t("amRemaining")}`
                    }
                  />
                  <Metric
                    label={t("billingPeriod")}
                    value={
                      entitlements
                        ? `${new Date(entitlements.periodStart).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US")} → ${new Date(entitlements.periodEnd).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US")}`
                        : "—"
                    }
                    hint={
                      entitlements?.subscriptionStatus
                        ? entitlements.subscriptionStatus.replace("_", " ")
                        : undefined
                    }
                  />
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
                    <span>{t("amTokenUtilization")}</span>
                    <span>{limit === null ? t("unlimitedTokens") : `${pct}%`}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-700",
                        entitlements?.overLimit ? "bg-amber-400" : "bg-emerald-400/80",
                      )}
                      style={{ width: limit === null ? "8%" : `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSection("plan")}
                    className="h-10 rounded-full bg-white px-4 text-sm font-medium text-black"
                  >
                    {t("amManagePlan")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection("profile")}
                    className="h-10 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                  >
                    {t("amEditProfile")}
                  </button>
                </div>
              </Panel>

              <Panel title={t("amWorkspace")} subtitle={t("amWorkspaceBody")}>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Row label={t("amApiEndpoint")} value={t("amConnectionManaged")} />
                  <Row
                    label={t("amSession")}
                    value={hasSession ? t("amSessionActive") : t("amSessionLocal")}
                  />
                  <Row
                    label={t("amSubscriptionStatus")}
                    value={account?.subscriptionStatus?.replace("_", " ") ?? "—"}
                  />
                  <Row label={t("amAccountId")} value={account?.id ?? "—"} mono />
                </dl>
              </Panel>
            </section>
          ) : null}

          {section === "profile" ? (
            <Panel title={t("amProfile")} subtitle={t("userAccountSettingsBody")}>
              <div className="mb-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex size-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-sm font-semibold">
                  {account
                    ? initialsFromName(account.displayName, account.email)
                    : "?"}
                </div>
                <div>
                  <p className="text-base text-white">{account?.displayName}</p>
                  <p className="text-sm text-neutral-400">{account?.email}</p>
                </div>
              </div>

              <label className="block max-w-md space-y-1.5">
                <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                  {t("profileName")}
                </span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="field"
                />
              </label>
              <p className="mt-3 text-sm text-neutral-500">{t("amEmailReadonly")}</p>
              <p className="mt-1 text-sm text-neutral-300">{account?.email}</p>

              <button
                type="button"
                disabled={busy || !displayName.trim() || displayName.trim() === account?.displayName}
                onClick={() => void saveProfile()}
                className="mt-5 h-10 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-50"
              >
                {t("saveProfile")}
              </button>
            </Panel>
          ) : null}

          {section === "plan" ? (
            <div className="space-y-4">
              <Panel title={t("amPlanBilling")} subtitle={t("amPlanBillingBody")}>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-100">
                    <BadgeCheck className="size-3.5" strokeWidth={1.8} />
                    {entitlements?.planName ?? t("accountNotConnected")}
                  </span>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-neutral-400">
                    {t("amBilledViaMoyasar")}
                  </span>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {t("activateSubscription")}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">{t("subscriptionCodesHint")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      value={subscribeCode}
                      onChange={(event) => setSubscribeCode(event.target.value)}
                      placeholder="PRO-ARRAB"
                      className="field max-w-xs font-mono text-xs"
                    />
                    <button
                      type="button"
                      disabled={busy || !subscribeCode.trim()}
                      onClick={() => void activateCode()}
                      className="h-10 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                    >
                      {t("applySubscription")}
                    </button>
                  </div>
                </div>

                {planId && planId !== "free" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={checkoutBusy !== null}
                      onClick={() => void startCheckout(planId)}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5 disabled:opacity-50"
                    >
                      <CreditCard className="size-3.5" strokeWidth={1.8} />
                      {checkoutBusy ? t("amCheckoutOpening") : t("amOpenCheckout")}
                    </button>
                  </div>
                ) : null}
              </Panel>

              <PlansCatalog
                audience={planAudience}
                onAudienceChange={setPlanAudience}
                currentPlanId={planId}
                signedIn={Boolean(account)}
                onAccountChanged={setStatus}
                onNeedSignIn={() => undefined}
                variant="settings"
              />
            </div>
          ) : null}

          {section === "usage" ? (
            <Panel title={t("amUsage")} subtitle={t("amUsageBody")}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Metric
                  label={t("usageInputTokens")}
                  value={formatTokens(used, t("unlimitedTokens"))}
                />
                <Metric
                  label={t("amTokenLimit")}
                  value={formatTokens(limit, t("unlimitedTokens"))}
                />
                <Metric
                  label={t("amRemaining")}
                  value={formatTokens(remaining, t("unlimitedTokens"))}
                />
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <p className="text-sm text-white">{t("amTokenUtilization")}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {entitlements?.overLimit ? t("amOverLimit") : t("amWithinQuota")}
                    </p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-white">
                    {limit === null ? "∞" : `${pct}%`}
                  </p>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      entitlements?.overLimit ? "bg-amber-400" : "bg-white",
                    )}
                    style={{ width: limit === null ? "12%" : `${Math.max(pct, 3)}%` }}
                  />
                </div>
              </div>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <Row
                  label={t("billingPeriod")}
                  value={
                    entitlements
                      ? `${new Date(entitlements.periodStart).toLocaleDateString()} → ${new Date(entitlements.periodEnd).toLocaleDateString()}`
                      : "—"
                  }
                />
                <Row
                  label={t("amSubscriptionStatus")}
                  value={entitlements?.subscriptionStatus?.replace("_", " ") ?? "—"}
                />
              </dl>
            </Panel>
          ) : null}

          {section === "security" ? (
            <div className="space-y-4">
              <Panel title={t("amSecurity")} subtitle={t("amSecurityBody")}>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-neutral-400" strokeWidth={1.7} />
                    <div>
                      <p className="text-sm text-white">{t("amSession")}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {hasSession ? t("amSessionActiveBody") : t("amSessionLocalBody")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <Shield className="mt-0.5 size-4 shrink-0 text-neutral-400" strokeWidth={1.7} />
                    <div>
                      <p className="text-sm text-white">{t("amPasswordPolicy")}</p>
                      <p className="mt-1 text-xs text-neutral-500">{t("amPasswordPolicyBody")}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void logout()}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                  >
                    <LogOut className="size-3.5" strokeWidth={1.8} />
                    {t("logOut")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void disconnect()}
                    className="h-10 rounded-full border border-red-400/30 px-4 text-sm text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {t("amDisconnect")}
                  </button>
                </div>
              </Panel>
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{label}</p>
      <p className="mt-2 text-base font-medium text-white">{value}</p>
      {hint ? <p className="mt-1 truncate text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-neutral-500">{label}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-sm text-neutral-200",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
