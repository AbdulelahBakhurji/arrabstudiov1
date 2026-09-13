import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  CreditCard,
  Gauge,
  KeyRound,
  LogOut,
  RefreshCw,
  Shield,
  UserRound,
} from "lucide-react";
import type { AccountStatusResponse, PlanAudience, SubscriptionPlanId } from "@arrab/shared";
import { PlansCatalog } from "@/components/PlansCatalog";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import {
  ACCOUNT_EVENT,
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

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntil(iso: string): number {
  const end = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
}

function statusLabel(status: string | null | undefined): string {
  if (!status) {
    return "—";
  }
  return status.replace(/_/g, " ");
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
  const overLimit = Boolean(entitlements?.overLimit);
  const profileDirty = Boolean(account && displayName.trim() && displayName.trim() !== account.displayName);
  const periodDaysLeft = entitlements ? daysUntil(entitlements.periodEnd) : null;

  const nav = useMemo(
    () =>
      [
        { id: "overview" as const, label: t("amOverview"), icon: Gauge },
        { id: "profile" as const, label: t("amProfile"), icon: UserRound },
        { id: "plan" as const, label: t("amPlanBilling"), icon: CreditCard },
        { id: "usage" as const, label: t("amUsage"), icon: ArrowUpRight },
        { id: "security" as const, label: t("amSecurity"), icon: Shield },
      ] as const,
    [t],
  );

  function broadcastAccount() {
    window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
  }

  async function saveProfile() {
    if (!displayName.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await arrabApi.updateAccountProfile({ displayName: displayName.trim() });
      setStatus(next);
      broadcastAccount();
      pushToast({ title: t("profileSaved"), tone: "success" });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  function discardProfile() {
    if (account) {
      setDisplayName(account.displayName);
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
      broadcastAccount();
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
        <aside className="arrab-rise shrink-0 lg:w-[248px]">
          <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-base font-semibold tracking-tight text-white">{t("amTitle")}</h1>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">{t("amBody")}</p>
              </div>
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="mt-0.5 rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
                aria-label={t("amRefresh")}
                title={t("amRefresh")}
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} strokeWidth={1.8} />
              </button>
            </div>

            {account ? (
              <div className="mt-4 flex items-center gap-3 border-t border-white/8 pt-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold tracking-wide text-white">
                  {initialsFromName(account.displayName, account.email)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{account.displayName}</p>
                  <p className="truncate text-[11px] text-neutral-500">{account.email}</p>
                </div>
              </div>
            ) : null}

            <nav className="mt-4 space-y-0.5" aria-label={t("amTitle")}>
              {nav.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] transition",
                      active
                        ? "bg-white text-black"
                        : "text-neutral-400 hover:bg-white/[0.04] hover:text-white",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="arrab-rise-delay-1 min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto pb-4">
          {error ? (
            <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          {section === "overview" ? (
            <section className="space-y-4">
              <Panel>
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold tracking-wide text-white">
                      {account
                        ? initialsFromName(account.displayName, account.email)
                        : "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xl font-semibold tracking-tight text-white">
                        {account?.displayName ?? t("accountNotConnected")}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-neutral-400">{account?.email}</p>
                      {account ? (
                        <p className="mt-1.5 text-xs text-neutral-500">
                          {t("amMemberSince")} {formatDate(account.connectedAt, locale)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSection("profile")}
                      className="h-9 rounded-lg border border-white/12 px-3.5 text-sm text-white transition hover:bg-white/5"
                    >
                      {t("amEditProfile")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSection("plan")}
                      className="h-9 rounded-lg bg-white px-3.5 text-sm font-medium text-black"
                    >
                      {t("amManagePlan")}
                    </button>
                  </div>
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-medium text-white">{t("amCurrentPlan")}</h2>
                      <p className="mt-0.5 text-xs text-neutral-500">{t("amPlanSummaryBody")}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-neutral-300">
                      <BadgeCheck className="size-3" strokeWidth={1.8} />
                      {statusLabel(entitlements?.subscriptionStatus ?? account?.subscriptionStatus)}
                    </span>
                  </div>

                  <p className="text-2xl font-semibold tracking-tight text-white">
                    {entitlements?.planName ?? "—"}
                  </p>
                  {entitlements ? (
                    <p className="mt-2 text-xs text-neutral-500">
                      {formatDate(entitlements.periodStart, locale)} →{" "}
                      {formatDate(entitlements.periodEnd, locale)}
                      {periodDaysLeft !== null
                        ? ` · ${periodDaysLeft} ${t("amDaysLeft")}`
                        : null}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setSection("plan")}
                    className="mt-5 inline-flex h-9 items-center gap-1.5 text-sm text-neutral-300 transition hover:text-white"
                  >
                    {t("amManagePlan")}
                    <ArrowUpRight className="size-3.5" strokeWidth={1.8} />
                  </button>
                </Panel>

                <Panel>
                  <div className="mb-4">
                    <h2 className="text-sm font-medium text-white">{t("amUsage")}</h2>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {overLimit ? t("amOverLimit") : t("amWithinQuota")}
                    </p>
                  </div>

                  <UsageMeter
                    pct={pct}
                    overLimit={overLimit}
                    unlimited={limit === null}
                    unlimitedLabel={t("unlimitedTokens")}
                  />

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] text-neutral-500">{t("periodTokens")}</p>
                      <p className="mt-1 text-sm tabular-nums text-white">
                        {formatTokens(used, t("unlimitedTokens"))}
                        <span className="text-neutral-500">
                          {" / "}
                          {formatTokens(limit, t("unlimitedTokens"))}
                        </span>
                      </p>
                    </div>
                    <p className="text-xs tabular-nums text-neutral-400">
                      {remaining === null
                        ? t("unlimitedTokens")
                        : `${formatTokens(remaining, t("unlimitedTokens"))} ${t("amRemaining")}`}
                    </p>
                  </div>

                  {overLimit || (planId === "free" && pct >= 80) ? (
                    <button
                      type="button"
                      onClick={() => setSection("plan")}
                      className="mt-4 h-9 w-full rounded-lg border border-amber-400/25 bg-amber-500/10 text-sm text-amber-100 transition hover:bg-amber-500/15"
                    >
                      {t("amUpgradeCta")}
                    </button>
                  ) : null}
                </Panel>
              </div>
            </section>
          ) : null}

          {section === "profile" ? (
            <Panel>
              <Header title={t("amProfile")} subtitle={t("amProfileBody")} />

              <div className="mb-6 flex items-center gap-4 border-b border-white/8 pb-6">
                <div className="flex size-16 items-center justify-center rounded-full bg-white/10 text-base font-semibold tracking-wide text-white">
                  {account
                    ? initialsFromName(displayName || account.displayName, account.email)
                    : "?"}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-white">
                    {displayName.trim() || account?.displayName || "—"}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-neutral-400">{account?.email}</p>
                </div>
              </div>

              <div className="grid max-w-xl gap-5">
                <label className="block space-y-1.5">
                  <span className="text-xs text-neutral-400">{t("profileName")}</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="field"
                    autoComplete="name"
                  />
                </label>

                <div className="space-y-1.5">
                  <span className="text-xs text-neutral-400">{t("amEmailLabel")}</span>
                  <input
                    value={account?.email ?? ""}
                    readOnly
                    className="field opacity-70"
                    aria-readonly="true"
                  />
                  <p className="text-[11px] text-neutral-500">{t("amEmailReadonly")}</p>
                </div>

                {account ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact label={t("amMemberSince")} value={formatDate(account.connectedAt, locale)} />
                    <Fact label={t("currentPlan")} value={account.planName} />
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap gap-2 border-t border-white/8 pt-5">
                <button
                  type="button"
                  disabled={busy || !profileDirty}
                  onClick={() => void saveProfile()}
                  className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
                >
                  {busy ? t("amSaving") : t("saveProfile")}
                </button>
                <button
                  type="button"
                  disabled={!profileDirty || busy}
                  onClick={discardProfile}
                  className="h-9 rounded-lg border border-white/12 px-4 text-sm text-neutral-300 transition hover:bg-white/5 disabled:opacity-40"
                >
                  {t("amDiscard")}
                </button>
              </div>
            </Panel>
          ) : null}

          {section === "plan" ? (
            <div className="space-y-4">
              <Panel>
                <Header title={t("amPlanBilling")} subtitle={t("amPlanBillingBody")} />

                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white">
                    <BadgeCheck className="size-3.5 text-emerald-300" strokeWidth={1.8} />
                    {entitlements?.planName ?? t("accountNotConnected")}
                  </span>
                  <span className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-neutral-400">
                    {t("amBilledViaMoyasar")}
                  </span>
                  <span className="rounded-md border border-white/10 px-2.5 py-1 text-xs capitalize text-neutral-400">
                    {statusLabel(entitlements?.subscriptionStatus ?? account?.subscriptionStatus)}
                  </span>
                </div>

                {entitlements ? (
                  <div className="mb-5 grid gap-3 sm:grid-cols-3">
                    <Fact
                      label={t("billingPeriod")}
                      value={`${formatDate(entitlements.periodStart, locale)} → ${formatDate(entitlements.periodEnd, locale)}`}
                    />
                    <Fact
                      label={t("amTokenLimit")}
                      value={formatTokens(entitlements.tokenLimit, t("unlimitedTokens"))}
                    />
                    <Fact
                      label={t("amDaysLeft")}
                      value={periodDaysLeft === null ? "—" : String(periodDaysLeft)}
                    />
                  </div>
                ) : null}

                <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <p className="text-sm font-medium text-white">{t("activateSubscription")}</p>
                  <p className="mt-1 text-xs text-neutral-500">{t("subscriptionCodesHint")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      value={subscribeCode}
                      onChange={(event) => setSubscribeCode(event.target.value)}
                      placeholder="PRO-ARRAB"
                      className="field max-w-xs font-mono text-xs"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void activateCode();
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !subscribeCode.trim()}
                      onClick={() => void activateCode()}
                      className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
                    >
                      {t("applySubscription")}
                    </button>
                  </div>
                </div>

                {planId && planId !== "free" ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      disabled={checkoutBusy !== null}
                      onClick={() => void startCheckout(planId)}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/12 px-4 text-sm text-white transition hover:bg-white/5 disabled:opacity-40"
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
                onAccountChanged={(next) => {
                  setStatus(next);
                  broadcastAccount();
                }}
                onNeedSignIn={() => undefined}
                variant="settings"
              />
            </div>
          ) : null}

          {section === "usage" ? (
            <Panel>
              <Header title={t("amUsage")} subtitle={t("amUsageBody")} />

              <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/40 p-5">
                  <UsageRing
                    pct={pct}
                    overLimit={overLimit}
                    unlimited={limit === null}
                    unlimitedLabel="∞"
                  />
                  <p className="mt-3 text-center text-xs text-neutral-500">
                    {overLimit ? t("amOverLimit") : t("amWithinQuota")}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
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
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Fact
                  label={t("billingPeriod")}
                  value={
                    entitlements
                      ? `${formatDate(entitlements.periodStart, locale)} → ${formatDate(entitlements.periodEnd, locale)}`
                      : "—"
                  }
                />
                <Fact
                  label={t("amSubscriptionStatus")}
                  value={statusLabel(entitlements?.subscriptionStatus)}
                />
              </div>

              {(overLimit || planId === "free") && (
                <button
                  type="button"
                  onClick={() => setSection("plan")}
                  className="mt-5 h-9 rounded-lg bg-white px-4 text-sm font-medium text-black"
                >
                  {t("amUpgradeCta")}
                </button>
              )}
            </Panel>
          ) : null}

          {section === "security" ? (
            <div className="space-y-4">
              <Panel>
                <Header title={t("amSecurity")} subtitle={t("amSecurityBody")} />

                <div className="space-y-3">
                  <SecurityRow
                    icon={KeyRound}
                    title={t("amSession")}
                    body={hasSession ? t("amSessionActiveBody") : t("amSessionLocalBody")}
                    meta={hasSession ? t("amSessionActive") : t("amSessionLocal")}
                  />
                  <SecurityRow
                    icon={Shield}
                    title={t("amPasswordPolicy")}
                    body={t("amPasswordPolicyBody")}
                  />
                </div>
              </Panel>

              <Panel>
                <h2 className="text-sm font-medium text-white">{t("amDangerZone")}</h2>
                <p className="mt-1 text-xs text-neutral-500">{t("amDangerZoneBody")}</p>

                <div className="mt-5 space-y-3">
                  <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-white">{t("logOut")}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">{t("amSignOutBody")}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void logout()}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
                    >
                      <LogOut className="size-3.5" strokeWidth={1.8} />
                      {t("logOut")}
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 rounded-xl border border-red-400/20 bg-red-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-red-100">{t("amDisconnect")}</p>
                      <p className="mt-0.5 text-xs text-red-200/60">{t("amDisconnectBody")}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void disconnect()}
                      className="h-9 shrink-0 rounded-lg border border-red-400/30 px-4 text-sm text-red-100 transition hover:bg-red-500/10 disabled:opacity-40"
                    >
                      {t("amDisconnect")}
                    </button>
                  </div>
                </div>
              </Panel>
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 lg:p-6">
      {children}
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold tracking-tight text-white">{title}</h2>
      <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4">
      <p className="text-[11px] text-neutral-500">{label}</p>
      <p className="mt-2 text-lg font-medium tabular-nums tracking-tight text-white">{value}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/25 px-3.5 py-3">
      <p className="text-[11px] text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-sm text-neutral-200">{value}</p>
    </div>
  );
}

function UsageMeter({
  pct,
  overLimit,
  unlimited,
  unlimitedLabel,
}: {
  pct: number;
  overLimit: boolean;
  unlimited: boolean;
  unlimitedLabel: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
        <span>{unlimited ? unlimitedLabel : `${pct}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            overLimit ? "bg-amber-400" : "bg-white",
          )}
          style={{ width: unlimited ? "12%" : `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}

function UsageRing({
  pct,
  overLimit,
  unlimited,
  unlimitedLabel,
}: {
  pct: number;
  overLimit: boolean;
  unlimited: boolean;
  unlimitedLabel: string;
}) {
  const size = 112;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fill = unlimited ? 0.12 : Math.min(pct, 100) / 100;
  const offset = circumference * (1 - fill);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={overLimit ? "#fbbf24" : "#ffffff"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-xl font-semibold tabular-nums text-white">
          {unlimited ? unlimitedLabel : `${pct}%`}
        </p>
      </div>
    </div>
  );
}

function SecurityRow({
  icon: Icon,
  title,
  body,
  meta,
}: {
  icon: typeof Shield;
  title: string;
  body: string;
  meta?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-4">
      <Icon className="mt-0.5 size-4 shrink-0 text-neutral-400" strokeWidth={1.7} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-white">{title}</p>
          {meta ? (
            <span className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-neutral-400">
              {meta}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">{body}</p>
      </div>
    </div>
  );
}
