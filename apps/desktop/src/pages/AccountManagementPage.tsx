import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  BadgeCheck,
  Cable,
  CreditCard,
  Gauge,
  KeyRound,
  LogOut,
  Shield,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { AccountStatusResponse, PlanAudience, SubscriptionPlanId } from "@arrab/shared";
import { SUBSCRIPTION_PLANS } from "@arrab/shared";
import { PlansCatalog } from "@/components/PlansCatalog";
import { FamilyHouseholdPanel } from "@/components/FamilyHouseholdPanel";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { arrabApi, ApiRequestError } from "@/lib/api";
import {
  ACCOUNT_EVENT,
  clearAccountSession,
  initialsFromName,
  readAccountSessionToken,
  subscribeAccountSession,
} from "@/lib/account-session";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { liveCompanions, useCompanionState } from "@/lib/companions";
import { openExternalUrl } from "@/lib/desktop";
import { pushToast } from "@/lib/notify";
import { useOrgSeatCapabilities } from "@/lib/org-seat";
import { audienceFromPlanId } from "@/roles/catalog";
import { useRole } from "@/roles/RoleProvider";
import { cn } from "@/lib/utils";

type AccountSection = "overview" | "profile" | "plan" | "usage" | "family" | "security";

function formatTokens(value: number | null | undefined, unlimited: string): string {
  if (value === null || value === undefined) {
    return unlimited;
  }
  return value.toLocaleString();
}

/** Plan allowance as Cursor-style multiplier (never raw token counts on plan UI). */
function planUsageTier(planId: SubscriptionPlanId | null | undefined): string {
  if (!planId || !SUBSCRIPTION_PLANS[planId]) return "1×";
  const base = SUBSCRIPTION_PLANS.free.monthlyTokenLimit || 100_000;
  const mult = Math.max(1, Math.round(SUBSCRIPTION_PLANS[planId].monthlyTokenLimit / base));
  return `${mult}×`;
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
  const { href } = useRole();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const companionState = useCompanionState();
  const { canViewOrgBilling, canViewOwnUsageOnly } = useOrgSeatCapabilities();
  const { account: signedInAccount } = useSignedInAccount();
  const accountId = signedInAccount?.id ?? null;
  const initialSection = ((): AccountSection => {
    const raw = searchParams.get("section");
    if (
      raw === "profile" ||
      raw === "plan" ||
      raw === "usage" ||
      raw === "family" ||
      raw === "security" ||
      raw === "overview"
    ) {
      return raw;
    }
    return "overview";
  })();
  const [section, setSection] = useState<AccountSection>(initialSection);
  const [status, setStatus] = useState<AccountStatusResponse | null>(null);
  const [ownUsage, setOwnUsage] = useState({ inputTokens: 0, outputTokens: 0, events: 0 });
  const [connectorCount, setConnectorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [subscribeCode, setSubscribeCode] = useState("");
  const [planAudience, setPlanAudience] = useState<PlanAudience>("individual");
  const [checkoutBusy, setCheckoutBusy] = useState<SubscriptionPlanId | null>(null);
  const hasSession = Boolean(readAccountSessionToken());
  const statusRef = useRef<AccountStatusResponse | null>(null);
  statusRef.current = status;

  const companionCount = useMemo(
    () => liveCompanions(companionState).length,
    [companionState],
  );

  const refresh = useCallback((opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? Boolean(statusRef.current);
    if (!silent) setLoading(true);
    void Promise.all([
      arrabApi.account(),
      canViewOwnUsageOnly
        ? arrabApi.usage().catch(() => null)
        : Promise.resolve(null),
      arrabApi.connectors().catch(() => null),
    ])
      .then(([next, usage, connectors]) => {
        setStatus(next);
        if (next.account) {
          setDisplayName(next.account.displayName);
        }
        if (usage) {
          setOwnUsage({
            inputTokens: usage.totals.inputTokens,
            outputTokens: usage.totals.outputTokens,
            events: usage.totals.events,
          });
        }
        if (connectors) {
          setConnectorCount(
            (connectors.items ?? []).filter((item) => item.status === "connected").length,
          );
        }
        setError(null);
      })
      .catch((err: unknown) => {
        if (!silent) {
          setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
        }
      })
      .finally(() => setLoading(false));
  }, [t, canViewOwnUsageOnly]);

  useEffect(() => {
    refresh({ silent: false });
    const tick = () => refresh({ silent: true });
    const interval = window.setInterval(tick, 30_000);
    const onFocus = () => refresh({ silent: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Clear previous user's token breakdown when the signed-in account changes.
  useEffect(() => {
    setOwnUsage({ inputTokens: 0, outputTokens: 0, events: 0 });
    refresh({ silent: true });
  }, [accountId, refresh]);

  useEffect(() => {
    return subscribeAccountSession(() => {
      setOwnUsage({ inputTokens: 0, outputTokens: 0, events: 0 });
      refresh({ silent: false });
    });
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
  const planFeatures = useMemo(() => {
    if (!planId || !SUBSCRIPTION_PLANS[planId]) return [];
    return SUBSCRIPTION_PLANS[planId].features.slice(0, 6);
  }, [planId]);

  useEffect(() => {
    if (!planId) return;
    const audience = SUBSCRIPTION_PLANS[planId]?.audience;
    if (audience) setPlanAudience(audience);
  }, [planId]);

  const isFamilyPlan = audienceFromPlanId(planId) === "family";
  const { isChild: isFamilyChild } = useFamilyProfile();

  const nav = useMemo(() => {
    const items: { id: AccountSection; label: string; icon: typeof Gauge }[] = [
      { id: "overview", label: t("amOverview"), icon: Gauge },
      { id: "profile", label: t("amProfile"), icon: UserRound },
      { id: "plan", label: t("amPlanBilling"), icon: CreditCard },
      { id: "usage", label: t("amUsage"), icon: ArrowUpRight },
    ];
    if (isFamilyPlan && !isFamilyChild) {
      items.push({ id: "family", label: t("amFamily"), icon: UsersRound });
    }
    items.push({ id: "security", label: t("amSecurity"), icon: Shield });
    return canViewOrgBilling ? items : items.filter((item) => item.id !== "plan");
  }, [t, canViewOrgBilling, isFamilyPlan, isFamilyChild]);

  useEffect(() => {
    const raw = searchParams.get("section");
    if (
      raw === "profile" ||
      raw === "plan" ||
      raw === "usage" ||
      raw === "family" ||
      raw === "security" ||
      raw === "overview"
    ) {
      setSection(raw);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!canViewOrgBilling && section === "plan") {
      setSection("usage");
    }
    if ((!isFamilyPlan || isFamilyChild) && section === "family") {
      setSection("overview");
    }
  }, [canViewOrgBilling, isFamilyPlan, isFamilyChild, section]);

  function selectSection(next: AccountSection) {
    setSection(next);
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("section");
    else params.set("section", next);
    setSearchParams(params, { replace: true });
  }

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
    return <Surface className="flex min-h-[40vh] items-center justify-center p-8">{null}</Surface>;
  }

  return (
    <Surface className="account-mgmt p-3 sm:p-4 lg:p-5">
      <div
        dir={dir}
        className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 lg:flex-row"
      >
        <aside className="arrab-rise flex shrink-0 flex-col gap-3 lg:w-[248px]">
          <div className="rounded-2xl border border-white/10 bg-[var(--color-surface)] p-4">
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white">{t("amTitle")}</h1>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">{t("amBody")}</p>
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
                    onClick={() => selectSection(item.id)}
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

          <button
            type="button"
            disabled={busy}
            onClick={() => void logout()}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/12 bg-[var(--color-surface)] px-4 text-sm font-medium text-white transition hover:bg-white/[0.04] disabled:opacity-40"
          >
            <LogOut className="size-3.5" strokeWidth={1.8} />
            {t("amSignOut")}
          </button>
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
                      onClick={() => selectSection("profile")}
                      className="h-9 rounded-lg border border-white/12 px-3.5 text-sm text-white transition hover:bg-white/5"
                    >
                      {t("amEditProfile")}
                    </button>
                    {canViewOrgBilling ? (
                      <button
                        type="button"
                        onClick={() => selectSection("plan")}
                        className="h-9 rounded-lg bg-white px-3.5 text-sm font-medium text-black"
                      >
                        {t("amManagePlan")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void logout()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 px-3.5 text-sm text-neutral-200 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
                    >
                      <LogOut className="size-3.5" strokeWidth={1.8} />
                      {t("amSignOut")}
                    </button>
                  </div>
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                {canViewOrgBilling ? (
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
                    onClick={() => selectSection("plan")}
                    className="mt-5 inline-flex h-9 items-center gap-1.5 text-sm text-neutral-300 transition hover:text-white"
                  >
                    {t("amManagePlan")}
                    <ArrowUpRight className="size-3.5" strokeWidth={1.8} />
                  </button>
                </Panel>
                ) : null}

                <Panel>
                  <div className="mb-4">
                    <h2 className="text-sm font-medium text-white">
                      {canViewOwnUsageOnly ? t("usageOwnTokens") : t("amUsage")}
                    </h2>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {canViewOwnUsageOnly
                        ? t("usageOwnTokensHint")
                        : overLimit
                          ? t("amOverLimit")
                          : t("amWithinQuota")}
                    </p>
                  </div>

                  {canViewOwnUsageOnly ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Metric
                        label={t("usageInputTokens")}
                        value={formatTokens(ownUsage.inputTokens, t("unlimitedTokens"))}
                      />
                      <Metric
                        label={t("usageOutputTokens")}
                        value={formatTokens(ownUsage.outputTokens, t("unlimitedTokens"))}
                      />
                      <Metric
                        label={t("usageCompletions")}
                        value={formatTokens(ownUsage.events, t("unlimitedTokens"))}
                      />
                    </div>
                  ) : (
                    <>
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
                        {limit === null
                          ? t("unlimitedTokens")
                          : `${pct}% ${t("usageTokensUsed").toLowerCase()}`}
                      </p>
                    </div>
                    <p className="text-xs text-neutral-500">
                      {limit === null
                        ? t("unlimitedTokens")
                        : `${Math.max(0, 100 - pct)}% ${t("amRemaining")}`}
                    </p>
                  </div>

                  {overLimit || ((planId === "free" || planId === "family_free") && pct >= 80) ? (
                    <button
                      type="button"
                      onClick={() => selectSection("plan")}
                      className="mt-4 h-9 w-full rounded-lg border border-amber-400/25 bg-amber-500/10 text-sm text-amber-100 transition hover:bg-amber-500/15"
                    >
                      {t("amUpgradeCta")}
                    </button>
                  ) : null}
                    </>
                  )}
                </Panel>
              </div>

              <Panel>
                <Header title={t("amStudioSnapshot")} subtitle={t("amStudioSnapshotBody")} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label={t("amCompanionsCount")} value={String(companionCount)} />
                  <Metric label={t("amConnectorsCount")} value={String(connectorCount)} />
                  <Metric label={t("amPlanTier")} value={planUsageTier(planId)} />
                  <Metric
                    label={t("amSession")}
                    value={hasSession ? t("amSessionActive") : t("amSessionLocal")}
                  />
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-3">
                <ActionTile
                  icon={Cable}
                  title={t("amOpenConnectors")}
                  body={t("amOpenConnectorsBody")}
                  onClick={() => navigate(href("/connectors"))}
                />
                <ActionTile
                  icon={Shield}
                  title={t("amOpenSecurity")}
                  body={t("amOpenSecurityBody")}
                  onClick={() => selectSection("security")}
                />
                <ActionTile
                  icon={Gauge}
                  title={t("amGoToUsage")}
                  body={t("amUsageBody")}
                  onClick={() => selectSection("usage")}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <Header title={t("amIncluded")} subtitle={t("amIncludedBody")} />
                  {planFeatures.length > 0 ? (
                    <ul className="space-y-2.5">
                      {planFeatures.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-start gap-2.5 text-sm text-neutral-300"
                        >
                          <BadgeCheck
                            className="mt-0.5 size-3.5 shrink-0 text-neutral-400"
                            strokeWidth={1.8}
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-neutral-500">{t("amNoFeatures")}</p>
                  )}
                  {canViewOrgBilling ? (
                    <button
                      type="button"
                      onClick={() => selectSection("plan")}
                      className="mt-5 inline-flex h-9 items-center gap-1.5 text-sm text-neutral-300 transition hover:text-white"
                    >
                      {t("amManagePlan")}
                      <ArrowUpRight className="size-3.5" strokeWidth={1.8} />
                    </button>
                  ) : null}
                </Panel>

                <Panel>
                  <Header title={t("amAccountDetails")} subtitle={t("amAccountDetailsBody")} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact label={t("amEmailLabel")} value={account?.email ?? "—"} />
                    <Fact
                      label={t("amSubscriptionStatus")}
                      value={statusLabel(
                        entitlements?.subscriptionStatus ?? account?.subscriptionStatus,
                      )}
                    />
                    <Fact
                      label={t("amAccountId")}
                      value={account?.id ? account.id.slice(0, 12) + "…" : "—"}
                    />
                    <Fact
                      label={t("amWorkspaceDevice")}
                      value={hasSession ? t("amSessionActive") : t("amSessionLocal")}
                    />
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-neutral-500">
                    {t("amWorkspaceDeviceBody")}
                  </p>
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

          {section === "plan" && canViewOrgBilling ? (
            <div className="space-y-4">
              <Panel>
                <Header title={t("amPlanBilling")} subtitle={t("amPlanBillingBody")} />

                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white">
                    <BadgeCheck className="size-3.5 text-emerald-300" strokeWidth={1.8} />
                    {entitlements?.planName ?? t("accountNotConnected")}
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
                      value={
                        entitlements.tokenLimit === null
                          ? t("unlimitedTokens")
                          : t("plansUsageTier").replace(
                              "{n}",
                              planUsageTier(account?.planId ?? entitlements.planId),
                            )
                      }
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

                {planId && planId !== "free" && planId !== "family_free" ? (
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
                lockAudience={Boolean(planId)}
                onAccountChanged={(next) => {
                  setStatus(next);
                  broadcastAccount();
                }}
                onNeedSignIn={() => undefined}
                variant="settings"
              />
            </div>
          ) : null}

          {section === "family" && isFamilyPlan ? (
            <Panel>
              <FamilyHouseholdPanel />
            </Panel>
          ) : null}

          {section === "usage" ? (
            <Panel>
              <Header
                title={canViewOwnUsageOnly ? t("usageOwnTokens") : t("amUsage")}
                subtitle={canViewOwnUsageOnly ? t("usageOwnTokensHint") : t("amUsageBody")}
              />

              {canViewOwnUsageOnly ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric
                    label={t("usageInputTokens")}
                    value={formatTokens(ownUsage.inputTokens, t("unlimitedTokens"))}
                  />
                  <Metric
                    label={t("usageOutputTokens")}
                    value={formatTokens(ownUsage.outputTokens, t("unlimitedTokens"))}
                  />
                  <Metric
                    label={t("usageCompletions")}
                    value={formatTokens(ownUsage.events, t("unlimitedTokens"))}
                  />
                </div>
              ) : (
                <>
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
                    label={t("usageTokensUsed")}
                    value={limit === null ? t("unlimitedTokens") : `${pct}%`}
                  />
                  <Metric
                    label={t("amTokenLimit")}
                    value={
                      limit === null
                        ? t("unlimitedTokens")
                        : t("plansUsageTier").replace("{n}", planUsageTier(planId))
                    }
                  />
                  <Metric
                    label={t("amRemaining")}
                    value={
                      limit === null
                        ? t("unlimitedTokens")
                        : `${Math.max(0, 100 - pct)}%`
                    }
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

              {(overLimit || planId === "free" || planId === "family_free") && (
                <button
                  type="button"
                  onClick={() => selectSection("plan")}
                  className="mt-5 h-9 rounded-lg bg-white px-4 text-sm font-medium text-black"
                >
                  {t("amUpgradeCta")}
                </button>
              )}
                </>
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
    <section className="rounded-2xl border border-white/10 bg-[var(--color-surface)] p-5 lg:p-6">
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

function ActionTile({
  icon: Icon,
  title,
  body,
  onClick,
}: {
  icon: typeof Cable;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-white/10 bg-[var(--color-surface)] p-5 text-start transition hover:border-white/20 hover:bg-white/[0.03]"
    >
      <div className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white">
        <Icon className="size-4" strokeWidth={1.8} />
      </div>
      <p className="mt-4 text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{body}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs text-neutral-400">
        <ArrowUpRight className="size-3.5" strokeWidth={1.8} />
      </span>
    </button>
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
          stroke="var(--overlay-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={overLimit ? "var(--color-warn)" : "var(--color-accent)"}
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
