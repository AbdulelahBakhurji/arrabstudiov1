import { lockE2ee } from "@/domains/encryption/e2ee";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  Coins,
  KeyRound,
  LayoutGrid,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import type {
  OrgDepartment,
  OrgEmployeePublic,
  OrgEmployeeRole,
  OrgWorkforceSnapshot,
  Team,
} from "@arrab/shared";
import { SUBSCRIPTION_PLANS, orgSeatLimitForPlan, type SubscriptionPlanId } from "@arrab/shared";
import { useNavigate } from "react-router-dom";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/core/api/api";
import { pushToast } from "@/shared/lib/notify";
import {
  countDeptEmployees,
  DEPT_SEAT_CAPACITY,
  setLocalSeatLimit,
} from "@/domains/organization/org-workforce-local";
import {
  ensureEmployeeTokenBudget,
  employeeTokenPool,
  employeeTokensRemaining,
  formatTokenCount,
  getEmployeeTokenBudget,
  grantEmployeeTokens,
  setEmployeeTokenAllowance,
  TOKEN_CREDIT_PACKS,
  type EmployeeTokenBudget,
} from "@/domains/organization/org-employee-tokens";
import {
  clearOrgEmployeeSession,
  readOrgEmployeeSession,
  subscribeOrgEmployeeSession,
  writeOrgEmployeeSession,
} from "@/domains/organization/org-employee-session";
import { cn } from "@/shared/lib/utils";
import { Avatar, Empty, Field, Stat } from "@/domains/organization/ui/workforce/primitives";

const ROLES: OrgEmployeeRole[] = ["manager", "member"];
const DEFAULT_FALLBACK_SEATS = 8;

type AdminTab = "overview" | "seats" | "departments" | "tokens" | "access";

export function OrgAdministrationPanel({
  teams,
  onTeamsChanged,
}: {
  teams: Team[];
  onTeamsChanged?: () => void;
}) {
  const { t, locale } = useLanguage();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [snapshot, setSnapshot] = useState<OrgWorkforceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [usingLocal, setUsingLocal] = useState(false);
  const navigate = useNavigate();
  const { account, status } = useSignedInAccount();
  const planId = status?.entitlements?.planId ?? account?.planId ?? null;
  const plan =
    planId && Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, planId)
      ? SUBSCRIPTION_PLANS[planId as SubscriptionPlanId]
      : null;
  const [tokenTick, setTokenTick] = useState(0);
  const [selectedCreditId, setSelectedCreditId] = useState<string>("");
  const [customCredit, setCustomCredit] = useState("100000");
  const [deptName, setDeptName] = useState("");
  const [deptTeamId, setDeptTeamId] = useState("");
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empPassword, setEmpPassword] = useState("");
  const [empTitle, setEmpTitle] = useState("");
  const [empRole, setEmpRole] = useState<OrgEmployeeRole>("member");
  const [empDeptId, setEmpDeptId] = useState("");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sessionTick, setSessionTick] = useState(0);
  const [seatQuery, setSeatQuery] = useState("");

  const session = useMemo(() => readOrgEmployeeSession(), [sessionTick, snapshot]);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      try {
        const next = await arrabApi.orgWorkforce();
        const local = Boolean((next as OrgWorkforceSnapshot & { local?: boolean }).local);
        setSnapshot(next);
        setUsingLocal(local);
        for (const employee of next.employees) {
          ensureEmployeeTokenBudget(employee.id);
        }
        setTokenTick((n) => n + 1);
      } catch (error) {
        if (!silent) {
          pushToast({
            title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
            tone: "warn",
          });
        }
      }
    },
    [t],
  );

  useEffect(() => {
    void refresh();
    const unsub = subscribeOrgEmployeeSession(() => setSessionTick((n) => n + 1));
    const id = window.setInterval(() => void refresh({ silent: true }), 15_000);
    const onFocus = () => void refresh({ silent: true });
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const departments = snapshot?.departments ?? [];
  const employees = snapshot?.employees ?? [];
  const events = snapshot?.recentSecurityEvents ?? [];
  const seatsUsed = snapshot?.seatsUsed ?? employees.filter((e) => e.status === "active").length;
  const seatLimit = planId
    ? orgSeatLimitForPlan(planId)
    : snapshot?.seatLimit || DEFAULT_FALLBACK_SEATS;
  const seatsLeft = Math.max(0, seatLimit - seatsUsed);
  const seatPct = seatLimit > 0 ? Math.min(100, Math.round((seatsUsed / seatLimit) * 100)) : 0;
  const activeCount = employees.filter((e) => e.status === "active").length;

  useEffect(() => {
    if (usingLocal) setLocalSeatLimit(seatLimit);
  }, [usingLocal, seatLimit]);

  const deptNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const dept of departments) map.set(dept.id, dept.name);
    return map;
  }, [departments]);

  const deptCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const dept of departments) {
      const fromSnap = employees.filter(
        (e) => e.departmentId === dept.id && e.status === "active",
      ).length;
      map.set(dept.id, Math.max(fromSnap, countDeptEmployees(dept.id)));
    }
    return map;
  }, [departments, employees]);

  const tokenBudgets = useMemo(() => {
    void tokenTick;
    return employees.map((employee) => getEmployeeTokenBudget(employee.id));
  }, [employees, tokenTick]);

  const tokenPoolTotal = useMemo(
    () => tokenBudgets.reduce((sum, budget) => sum + employeeTokenPool(budget), 0),
    [tokenBudgets],
  );
  const tokenUsedTotal = useMemo(
    () => tokenBudgets.reduce((sum, budget) => sum + budget.used, 0),
    [tokenBudgets],
  );

  useEffect(() => {
    if (!selectedCreditId && employees[0]) {
      setSelectedCreditId(employees[0].id);
    }
  }, [employees, selectedCreditId]);

  const filteredSeats = useMemo(() => {
    const q = seatQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((employee) =>
      `${employee.displayName} ${employee.email} ${employee.title ?? ""} ${employee.role}`
        .toLowerCase()
        .includes(q),
    );
  }, [employees, seatQuery]);

  const nav: Array<{ id: AdminTab; label: string; icon: typeof Building2; count?: number }> = [
    { id: "overview", label: t("orgTabOverview"), icon: LayoutGrid },
    { id: "seats", label: t("orgTabEmployees"), icon: UserPlus, count: employees.length || undefined },
    { id: "departments", label: t("orgTabDepartments"), icon: Building2, count: departments.length || undefined },
    { id: "tokens", label: t("orgTabTokens"), icon: Coins },
    { id: "access", label: t("orgTabAccess"), icon: Shield },
  ];

  async function createDepartment(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      let teamId = deptTeamId || null;
      if (!teamId) {
        const team = await arrabApi.createTeam({
          name: deptName.trim(),
          purpose: "Department office on Live Map (max 8 seats)",
          projectId: null,
        });
        teamId = team.id;
        onTeamsChanged?.();
      }
      await arrabApi.createOrgDepartment({
        name: deptName.trim(),
        teamId,
      });
      setDeptName("");
      setDeptTeamId("");
      await refresh();
      pushToast({ title: t("orgDeptCreated"), tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function createEmployee(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (empDeptId) {
        const n = deptCounts.get(empDeptId) ?? 0;
        if (n >= DEPT_SEAT_CAPACITY) {
          throw new ApiRequestError(t("deptFull"), 400);
        }
      }
      if (seatsLeft <= 0) {
        throw new ApiRequestError(t("orgNoSeatsLeft"), 400);
      }
      const created = await arrabApi.createOrgEmployee({
        displayName: empName,
        email: empEmail,
        password: empPassword,
        title: empTitle || null,
        role: empRole,
        departmentId: empDeptId || null,
      });
      ensureEmployeeTokenBudget(created.id);
      setEmpName("");
      setEmpEmail("");
      setEmpPassword("");
      setEmpTitle("");
      setEmpRole("member");
      setEmpDeptId("");
      await refresh();
      pushToast({ title: t("orgEmployeeCreated"), tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeEmployee(id: string) {
    setBusy(true);
    try {
      await arrabApi.deleteOrgEmployee(id);
      await refresh();
    } catch (error) {
      pushToast({
        title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeDepartment(id: string) {
    setBusy(true);
    try {
      await arrabApi.deleteOrgDepartment(id);
      await refresh();
    } catch (error) {
      pushToast({
        title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function signInEmployee(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await arrabApi.orgEmployeeSignIn({
        email: signInEmail,
        password: signInPassword,
      });
      writeOrgEmployeeSession({
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt,
        employee: {
          id: result.employee.id,
          email: result.employee.email,
          displayName: result.employee.displayName,
          title: result.employee.title,
          role: result.employee.role,
          departmentId: result.employee.departmentId,
          mustChangePassword: result.employee.mustChangePassword,
        },
      });
      setSignInEmail("");
      setSignInPassword("");
      setSessionTick((n) => n + 1);
      await refresh();
      pushToast({ title: t("orgEmployeeSignedIn"), tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function signOutEmployee() {
    try {
      await arrabApi.orgEmployeeSignOut();
    } catch {
      // clear local anyway
    }
    // Forget this seat's chat key before its session (and key namespace) goes away.
    await lockE2ee().catch(() => undefined);
    clearOrgEmployeeSession();
    setSessionTick((n) => n + 1);
    await refresh();
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await arrabApi.orgEmployeeChangePassword({
        currentPassword,
        newPassword,
      });
      writeOrgEmployeeSession({
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt,
        employee: {
          id: result.employee.id,
          email: result.employee.email,
          displayName: result.employee.displayName,
          title: result.employee.title,
          role: result.employee.role,
          departmentId: result.employee.departmentId,
          mustChangePassword: result.employee.mustChangePassword,
        },
      });
      setCurrentPassword("");
      setNewPassword("");
      setSessionTick((n) => n + 1);
      await refresh();
      pushToast({ title: t("orgPasswordChanged"), tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  function grantCredits(employeeId: string, amount: number) {
    if (!employeeId || amount <= 0) return;
    const next = grantEmployeeTokens(employeeId, amount);
    setTokenTick((n) => n + 1);
    const person = employees.find((item) => item.id === employeeId);
    pushToast({
      title: t("orgCreditsGranted"),
      body: t("orgCreditsGrantedBody")
        .replace("{name}", person?.displayName ?? "Employee")
        .replace("{n}", formatTokenCount(amount, locale === "ar" ? "ar" : "en"))
        .replace("{total}", formatTokenCount(employeeTokenPool(next), locale === "ar" ? "ar" : "en")),
      tone: "success",
    });
  }

  const selectedBudget = selectedCreditId ? getEmployeeTokenBudget(selectedCreditId) : null;
  const loc = locale === "ar" ? "ar" : "en";
  const tokenPct =
    tokenPoolTotal > 0 ? Math.min(100, Math.round((tokenUsedTotal / tokenPoolTotal) * 100)) : 0;

  return (
    <div className="cc-seats cc-rise grid gap-[18px] lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="cc-card !p-2 content-start self-start">
        <div className="px-3 pb-2 pt-3">
          <p className="cc-kicker">{t("wxTabSeats")}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">{t("orgSeatsRailBody")}</p>
        </div>
        <nav className="cc-list" aria-label={t("wxTabSeats")}>
          {nav.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn("cc-row w-full !py-2.5", active && "is-active")}
                aria-current={active ? "page" : undefined}
              >
                <span className="cc-empty-icon !size-8 !rounded-[10px]">
                  <Icon className="size-3.5" strokeWidth={1.7} />
                </span>
                <span className="cc-row-main">
                  <span className="cc-row-title">{item.label}</span>
                </span>
                {item.count ? <span className="cc-tab-count">{item.count}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="mt-2 rounded-[14px] border border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] bg-[var(--overlay-1)] p-3">
          <p className="cc-kicker">{t("orgStatSeats")}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight">
            {seatsUsed}
            <span className="text-[13px] font-medium text-[var(--color-muted)]">/{seatLimit}</span>
          </p>
          <div className="cc-bar mt-2">
            <i style={{ width: `${seatPct}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">
            {plan?.name ?? SUBSCRIPTION_PLANS.business.name}
          </p>
        </div>
      </aside>

      <div className="grid min-w-0 content-start gap-[18px]">
        {tab === "overview" ? (
          <>
            <section className="cc-card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="cc-kicker">{t("hqAdmin")}</p>
                  <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.03em]">{t("orgAdminHeroTitle")}</h2>
                  <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                    {t("orgAdminHeroBody")}
                  </p>
                </div>
                <button type="button" className="cc-btn is-primary" onClick={() => setTab("seats")}>
                  <UserPlus className="size-3.5" strokeWidth={1.8} />
                  {t("orgCreateSeat")}
                </button>
              </div>
            </section>

            <div className="cc-stats">
              <Stat label={t("orgStatDepts")} value={departments.length} foot={t("orgPillOffice")} onClick={() => setTab("departments")} />
              <Stat label={t("orgStatSeats")} value={`${seatsUsed}/${seatLimit}`} foot={`${seatsLeft} ${t("orgSeatsRemaining")}`} onClick={() => setTab("seats")} alert={seatsLeft <= 0} />
              <Stat label={t("orgStatActive")} value={activeCount} foot={t("orgPillEmployeeView")} />
              <Stat label={t("orgStatTokenPool")} value={formatTokenCount(tokenPoolTotal, loc)} foot={t("orgPillTokens")} onClick={() => setTab("tokens")} />
            </div>

            <div className="grid gap-[18px] xl:grid-cols-2">
              <section className="cc-card">
                <header className="cc-card-head">
                  <div>
                    <h3 className="cc-card-title">{t("orgOverviewTitle")}</h3>
                    <p className="cc-card-sub">{t("orgOverviewBody")}</p>
                  </div>
                </header>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["seats", t("orgTabEmployees"), t("orgQuickAddEmployee"), UserPlus],
                      ["tokens", t("orgTabTokens"), t("orgQuickTokens"), Coins],
                      ["departments", t("orgTabDepartments"), t("orgQuickDepartments"), Building2],
                      ["access", t("orgTabAccess"), t("orgQuickAccess"), Shield],
                    ] as const
                  ).map(([id, title, body, Icon]) => (
                    <button key={id} type="button" className="cc-dept !gap-2" onClick={() => setTab(id)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
                          <Icon className="size-3.5 text-[var(--color-muted)]" strokeWidth={1.7} />
                          {title}
                        </span>
                        <ArrowUpRight className="size-3.5 text-[var(--color-muted)]" />
                      </div>
                      <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">{body}</p>
                    </button>
                  ))}
                </div>
              </section>

              <section className="cc-card">
                <header className="cc-card-head">
                  <div>
                    <h3 className="cc-card-title">{t("orgSeatPlans")}</h3>
                    <p className="cc-card-sub">{t("orgSeatPlansBody")}</p>
                  </div>
                  {seatsLeft <= 0 ? <span className="cc-chip is-high">{t("orgSeatFull")}</span> : null}
                </header>
                <div className="rounded-[16px] border border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] bg-[var(--overlay-1)] p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[28px] font-semibold tabular-nums tracking-tight">
                      {seatsUsed}
                      <span className="text-[15px] text-[var(--color-muted)]">/{seatLimit}</span>
                    </p>
                    <p className="text-[12px] text-[var(--color-muted)]">
                      {seatsLeft} {t("orgSeatsRemaining")}
                    </p>
                  </div>
                  <div className="cc-bar mt-3">
                    <i
                      className={seatsLeft <= 0 ? "!bg-[var(--color-warn)]" : undefined}
                      style={{ width: `${seatPct}%` }}
                    />
                  </div>
                  <p className="mt-3 text-[12px] text-[var(--color-muted)]">
                    {t("orgSeatPlanIncluded")
                      .replace("{n}", String(seatLimit))
                      .replace("{plan}", plan?.name ?? SUBSCRIPTION_PLANS.business.name)}
                  </p>
                </div>
                {tokenPoolTotal > 0 ? (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-[var(--color-muted)]">{t("orgTokenMeter")}</span>
                      <span className="tabular-nums">{tokenPct}%</span>
                    </div>
                    <div className="cc-bar is-accent mt-2">
                      <i style={{ width: `${tokenPct}%` }} />
                    </div>
                    <p className="mt-2 text-[11.5px] text-[var(--color-muted)]">
                      {formatTokenCount(tokenUsedTotal, loc)} / {formatTokenCount(tokenPoolTotal, loc)}
                    </p>
                  </div>
                ) : null}
                <button type="button" className="cc-btn mt-4 w-full" onClick={() => navigate("/organizations/account")}>
                  {t("orgSeatUpgrade")}
                </button>
              </section>
            </div>
          </>
        ) : null}

        {tab === "seats" ? (
          <div className="grid gap-[18px] xl:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.05fr)]">
            <section className="cc-card">
              <header className="cc-card-head">
                <div>
                  <h3 className="cc-card-title">{t("orgCreateSeat")}</h3>
                  <p className="cc-card-sub">{t("orgCreateSeatHint")}</p>
                </div>
              </header>
              <form onSubmit={(e) => void createEmployee(e)} className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("orgEmpNamePh")}>
                    <input className="cc-input" value={empName} onChange={(e) => setEmpName(e.target.value)} required autoComplete="name" />
                  </Field>
                  <Field label={t("orgEmpTitlePh")}>
                    <input className="cc-input" value={empTitle} onChange={(e) => setEmpTitle(e.target.value)} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("orgEmpEmailPh")}>
                    <input className="cc-input" type="email" value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} required autoComplete="off" />
                  </Field>
                  <Field label={t("orgEmpPasswordPh")}>
                    <input className="cc-input" type="password" value={empPassword} onChange={(e) => setEmpPassword(e.target.value)} minLength={12} required autoComplete="new-password" />
                  </Field>
                </div>
                <p className="text-[11.5px] text-[var(--color-muted)]">{t("orgPasswordRules")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("orgColRole")}>
                    <select className="cc-select" value={empRole} onChange={(e) => setEmpRole(e.target.value as OrgEmployeeRole)}>
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(`orgRole_${role}` as "orgRole_admin" | "orgRole_manager" | "orgRole_member")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("orgColDept")}>
                    <select className="cc-select" value={empDeptId} onChange={(e) => setEmpDeptId(e.target.value)}>
                      <option value="">{t("orgDeptOptional")}</option>
                      {departments.map((dept) => {
                        const n = deptCounts.get(dept.id) ?? 0;
                        const full = n >= DEPT_SEAT_CAPACITY;
                        return (
                          <option key={dept.id} value={dept.id} disabled={full}>
                            {dept.name} ({n}/{DEPT_SEAT_CAPACITY}
                            {full ? " · full" : ""})
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                </div>
                <button type="submit" className="cc-btn is-primary mt-1" disabled={busy || seatsLeft <= 0}>
                  <KeyRound className="size-3.5" strokeWidth={1.8} />
                  {busy ? t("wxSaving") : t("orgProvisionSeat")}
                </button>
                <p className={cn("text-[12px]", seatsLeft <= 0 ? "text-[var(--color-warn)]" : "text-[var(--color-muted)]")}>
                  {seatsLeft <= 0 ? t("orgNoSeatsLeft") : `${seatsLeft} ${t("orgSeatsRemaining")}`}
                </p>
              </form>
            </section>

            <section className="cc-card">
              <header className="cc-card-head !items-center">
                <div>
                  <h3 className="cc-card-title">
                    {t("orgDirectory")}{" "}
                    <span className="text-[var(--color-muted)]">· {employees.length}</span>
                  </h3>
                  <p className="cc-card-sub">{t("orgDirectoryHint")}</p>
                </div>
                <input
                  className="cc-input !h-8 !w-[180px]"
                  value={seatQuery}
                  onChange={(e) => setSeatQuery(e.target.value)}
                  placeholder={t("wxSearchCompanions")}
                />
              </header>
              {employees.length === 0 ? (
                <Empty icon={Users} title={t("orgNoEmployees")} body={t("orgCreateSeatHint")} />
              ) : filteredSeats.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-[var(--color-muted)]">{t("wxNoMatches")}</p>
              ) : (
                <div className="cc-list">
                  {filteredSeats.map((employee) => {
                    const budget = getEmployeeTokenBudget(employee.id);
                    const dept =
                      employee.departmentId
                        ? (deptNameById.get(employee.departmentId) ?? "—")
                        : t("mapUnassigned");
                    return (
                      <div key={employee.id} className="cc-row !items-start">
                        <Avatar name={employee.displayName} />
                        <div className="cc-row-main">
                          <p className="cc-row-title flex flex-wrap items-center gap-2">
                            <span className="truncate">{employee.displayName}</span>
                            <span
                              className={cn(
                                "cc-chip",
                                employee.role === "manager" && "is-high",
                                employee.role === "admin" && "is-accent",
                              )}
                            >
                              {employee.role}
                            </span>
                          </p>
                          <p className="cc-row-sub">
                            {employee.email} · {employee.title || "—"} · {dept}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="cc-chip tabular-nums"
                          onClick={() => {
                            setSelectedCreditId(employee.id);
                            setTab("tokens");
                          }}
                        >
                          {formatTokenCount(employeeTokensRemaining(budget), loc)}
                        </button>
                        <button
                          type="button"
                          className="cc-icon-btn hover:!text-[var(--color-danger)]"
                          onClick={() => void removeEmployee(employee.id)}
                          aria-label={t("wxDelete")}
                          title={t("wxDelete")}
                        >
                          <Trash2 className="size-[15px]" strokeWidth={1.7} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === "departments" ? (
          <section className="cc-card">
            <header className="cc-card-head">
              <div>
                <h3 className="cc-card-title">{t("orgDepartments")}</h3>
                <p className="cc-card-sub">{t("orgDeptOfficeHint")}</p>
              </div>
            </header>
            <form onSubmit={(e) => void createDepartment(e)} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_auto]">
              <input
                className="cc-input"
                value={deptName}
                onChange={(e) => setDeptName(e.target.value)}
                placeholder={t("orgDeptNamePh")}
                required
              />
              <select className="cc-select" value={deptTeamId} onChange={(e) => setDeptTeamId(e.target.value)}>
                <option value="">{t("orgAutoCreateOffice")}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="cc-btn is-primary" disabled={busy}>
                <Plus className="size-3.5" strokeWidth={2} />
                {t("orgAddDept")}
              </button>
            </form>
            <div className="mt-4 grid gap-2">
              {departments.length === 0 ? (
                <Empty icon={Building2} title={t("orgNoDepts")} body={t("orgDeptOfficeHint")} />
              ) : (
                departments.map((dept) => (
                  <DeptRow
                    key={dept.id}
                    dept={dept}
                    seated={deptCounts.get(dept.id) ?? 0}
                    capacity={DEPT_SEAT_CAPACITY}
                    teamName={teams.find((team) => team.id === dept.teamId)?.name ?? null}
                    onDelete={() => void removeDepartment(dept.id)}
                    deleteLabel={t("wxDelete")}
                  />
                ))
              )}
            </div>
          </section>
        ) : null}

        {tab === "tokens" ? (
          <div className="grid gap-[18px] xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.1fr)]">
            <section className="cc-card">
              <header className="cc-card-head">
                <div>
                  <h3 className="cc-card-title">{t("orgTokensTitle")}</h3>
                  <p className="cc-card-sub">{t("orgTokensBody")}</p>
                </div>
              </header>
              <div className="cc-stats !grid-cols-3">
                <Stat label={t("orgStatTokenPool")} value={formatTokenCount(tokenPoolTotal, loc)} />
                <Stat label={t("orgStatTokenUsed")} value={formatTokenCount(tokenUsedTotal, loc)} />
                <Stat
                  label={t("orgStatTokenLeft")}
                  value={formatTokenCount(Math.max(0, tokenPoolTotal - tokenUsedTotal), loc)}
                />
              </div>
              <Field label={t("orgSelectEmployee")}>
                <select
                  className="cc-select mt-3"
                  value={selectedCreditId}
                  onChange={(e) => setSelectedCreditId(e.target.value)}
                >
                  {employees.length === 0 ? (
                    <option value="">{t("orgNoEmployees")}</option>
                  ) : (
                    employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.displayName} · {employee.email}
                      </option>
                    ))
                  )}
                </select>
              </Field>
              {selectedBudget ? (
                <div className="mt-4 rounded-[16px] border border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] bg-[var(--overlay-1)] p-4">
                  <p className="text-[12px] text-[var(--color-muted)]">{t("orgEmployeePool")}</p>
                  <p className="mt-1 text-[28px] font-semibold tabular-nums tracking-tight">
                    {formatTokenCount(employeeTokensRemaining(selectedBudget), loc)}
                    <span className="ms-2 text-[13px] font-normal text-[var(--color-muted)]">
                      / {formatTokenCount(employeeTokenPool(selectedBudget), loc)}
                    </span>
                  </p>
                  <div className="cc-bar mt-3">
                    <i
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (selectedBudget.used / Math.max(1, employeeTokenPool(selectedBudget))) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--color-muted)]">
                    {t("orgAllowance")}: {formatTokenCount(selectedBudget.allowance, loc)} · {t("orgBonus")}:{" "}
                    {formatTokenCount(selectedBudget.bonus, loc)}
                  </p>
                </div>
              ) : null}
              <p className="cc-kicker mt-5">{t("orgGrantCredits")}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {TOKEN_CREDIT_PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    disabled={!selectedCreditId || busy}
                    onClick={() => grantCredits(selectedCreditId, pack.tokens)}
                    className="cc-dept !gap-1 !p-3 text-center"
                  >
                    <p className="text-[18px] font-semibold tabular-nums">{pack.label}</p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
                      {t("orgTokens")}
                    </p>
                  </button>
                ))}
              </div>
              <form
                className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  const amount = Number(customCredit.replace(/[,\s]/g, ""));
                  if (!Number.isFinite(amount) || amount <= 0) {
                    pushToast({ title: t("orgInvalidCredit"), tone: "warn" });
                    return;
                  }
                  grantCredits(selectedCreditId, amount);
                }}
              >
                <input
                  className="cc-input"
                  value={customCredit}
                  onChange={(e) => setCustomCredit(e.target.value)}
                  placeholder={t("orgCustomCreditPh")}
                  inputMode="numeric"
                />
                <button type="submit" className="cc-btn is-primary" disabled={!selectedCreditId || busy}>
                  <Plus className="size-3.5" strokeWidth={2} />
                  {t("orgGrant")}
                </button>
              </form>
              <button
                type="button"
                disabled={!selectedCreditId}
                className="cc-btn is-ghost mt-2 w-full"
                onClick={() => {
                  if (!selectedCreditId) return;
                  setEmployeeTokenAllowance(selectedCreditId, 500_000);
                  setTokenTick((n) => n + 1);
                  pushToast({ title: t("orgAllowanceReset"), tone: "success" });
                }}
              >
                {t("orgSetProAllowance")}
              </button>
            </section>

            <section className="cc-card">
              <header className="cc-card-head">
                <div>
                  <h3 className="cc-card-title">{t("orgTokenLedger")}</h3>
                  <p className="cc-card-sub">{t("orgTokenLedgerBody")}</p>
                </div>
              </header>
              {employees.length === 0 ? (
                <Empty icon={Coins} title={t("orgNoEmployees")} />
              ) : (
                <ul className="grid gap-2">
                  {employees.map((employee) => (
                    <TokenLedgerRow
                      key={employee.id}
                      employee={employee}
                      budget={getEmployeeTokenBudget(employee.id)}
                      locale={locale}
                      selected={selectedCreditId === employee.id}
                      onSelect={() => setSelectedCreditId(employee.id)}
                      onBoost={() => grantCredits(employee.id, 50_000)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {tab === "access" ? (
          <div className="grid gap-[18px]">
            <section className="cc-card">
              <header className="cc-card-head">
                <div>
                  <h3 className="cc-card-title">{t("orgEmployeeLogin")}</h3>
                  <p className="cc-card-sub">{t("orgLoginHint")}</p>
                </div>
              </header>
              {session ? (
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] bg-[var(--overlay-1)] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={session.employee.displayName} />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold">{session.employee.displayName}</p>
                        <p className="truncate text-[12px] text-[var(--color-muted)]">
                          {t("orgSignedInAs")} {session.employee.email}
                        </p>
                      </div>
                    </div>
                    <button type="button" className="cc-btn" onClick={() => void signOutEmployee()}>
                      {t("orgSignOutSeat")}
                    </button>
                  </div>
                  {(session.employee.mustChangePassword || snapshot?.me?.mustChangePassword) && (
                    <form
                      onSubmit={(e) => void changePassword(e)}
                      className="grid gap-2 rounded-[16px] border border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[var(--color-danger-soft)] p-4 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <p className="sm:col-span-3 text-[12px] text-[var(--color-danger)]">{t("orgMustChangePassword")}</p>
                      <input
                        className="cc-input"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder={t("orgCurrentPasswordPh")}
                        required
                      />
                      <input
                        className="cc-input"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder={t("orgNewPasswordPh")}
                        minLength={12}
                        required
                      />
                      <button type="submit" className="cc-btn is-primary" disabled={busy}>
                        {t("orgChangePassword")}
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <form onSubmit={(e) => void signInEmployee(e)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    className="cc-input"
                    type="email"
                    value={signInEmail}
                    onChange={(e) => setSignInEmail(e.target.value)}
                    placeholder={t("orgEmpEmailPh")}
                    required
                  />
                  <input
                    className="cc-input"
                    type="password"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    placeholder={t("orgEmpPasswordPh")}
                    required
                  />
                  <button type="submit" className="cc-btn is-primary" disabled={busy}>
                    {t("orgSignInSeat")}
                  </button>
                </form>
              )}
            </section>

            {snapshot?.permissions.canViewAudit ? (
              <section className="cc-card">
                <header className="cc-card-head">
                  <div>
                    <h3 className="cc-card-title">{t("orgAuditTitle")}</h3>
                    <p className="cc-card-sub">{t("orgAuditEmpty")}</p>
                  </div>
                </header>
                {events.length === 0 ? (
                  <Empty icon={Shield} title={t("orgAuditEmpty")} />
                ) : (
                  <div className="cc-list">
                    {events.slice(0, 16).map((event) => (
                      <div key={event.id} className="cc-row">
                        <span className="cc-empty-icon !size-8 !rounded-[10px]">
                          <Shield className="size-3.5" strokeWidth={1.7} />
                        </span>
                        <div className="cc-row-main">
                          <p className="cc-row-title">{event.kind}</p>
                          <p className="cc-row-sub">{event.detail}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-[var(--color-muted)]">
                          {new Date(event.createdAt).toLocaleString(locale === "ar" ? "ar" : "en", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeptRow({
  dept,
  seated,
  capacity,
  teamName,
  onDelete,
  deleteLabel,
}: {
  dept: OrgDepartment;
  seated: number;
  capacity: number;
  teamName: string | null;
  onDelete: () => void;
  deleteLabel: string;
}) {
  const pct = Math.min(100, Math.round((seated / capacity) * 100));
  return (
    <div className="cc-row !items-start">
      <span className="cc-empty-icon !size-9 !rounded-[12px]">
        <Building2 className="size-3.5" strokeWidth={1.7} />
      </span>
      <div className="cc-row-main">
        <p className="cc-row-title">{dept.name}</p>
        <p className="cc-row-sub">
          {teamName ? `Live Map · ${teamName}` : "Live Map office"} · {seated}/{capacity}
        </p>
        <div className="cc-bar mt-2 max-w-[240px]">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button type="button" className="cc-icon-btn hover:!text-[var(--color-danger)]" onClick={onDelete} aria-label={deleteLabel}>
        <Trash2 className="size-[15px]" strokeWidth={1.7} />
      </button>
    </div>
  );
}

function TokenLedgerRow({
  employee,
  budget,
  locale,
  selected,
  onSelect,
  onBoost,
}: {
  employee: OrgEmployeePublic;
  budget: EmployeeTokenBudget;
  locale: string;
  selected: boolean;
  onSelect: () => void;
  onBoost: () => void;
}) {
  const pool = employeeTokenPool(budget);
  const left = employeeTokensRemaining(budget);
  const pct = Math.min(100, Math.round((budget.used / Math.max(1, pool)) * 100));
  const loc = locale === "ar" ? "ar" : "en";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn("cc-dept w-full !gap-2", selected && "!border-[color-mix(in_srgb,var(--color-foreground)_28%,transparent)]")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={employee.displayName} size="sm" />
            <div className="min-w-0 text-start">
              <p className="truncate text-[13px] font-semibold">{employee.displayName}</p>
              <p className="truncate text-[11.5px] text-[var(--color-muted)]">{employee.email}</p>
            </div>
          </div>
          <div className="text-end">
            <p className="text-[14px] font-semibold tabular-nums">{formatTokenCount(left, loc)}</p>
            <p className="text-[10px] text-[var(--color-muted)]">/ {formatTokenCount(pool, loc)}</p>
          </div>
        </div>
        <div className="cc-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="cc-chip">{employee.role}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onBoost();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onBoost();
              }
            }}
            className="cc-btn is-sm"
          >
            +50k
          </span>
        </div>
      </button>
    </li>
  );
}
