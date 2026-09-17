import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Building2,
  KeyRound,
  Lock,
  MapPinned,
  Plus,
  Shield,
  Sparkles,
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
import { SUBSCRIPTION_PLANS } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { pushToast } from "@/lib/notify";
import {
  bumpLocalSeatLimit,
  countDeptEmployees,
  DEPT_SEAT_CAPACITY,
  getLocalSeatBudget,
} from "@/lib/org-workforce-local";
import {
  clearOrgEmployeeSession,
  readOrgEmployeeSession,
  subscribeOrgEmployeeSession,
  writeOrgEmployeeSession,
} from "@/lib/org-employee-session";
import { cn } from "@/lib/utils";

const ROLES: OrgEmployeeRole[] = ["admin", "manager", "member"];

type SeatPlanCard = {
  id: string;
  name: string;
  seats: number;
  blurb: string;
  highlight?: boolean;
};

const SEAT_PACKS: SeatPlanCard[] = [
  {
    id: "starter",
    name: "Starter seats",
    seats: 8,
    blurb: "One full office — 8 people on the Live Map.",
  },
  {
    id: "growth",
    name: "Growth seats",
    seats: 16,
    blurb: "Two offices online. Pricing arrives with billing.",
    highlight: true,
  },
  {
    id: "scale",
    name: "Scale seats",
    seats: 40,
    blurb: "Multi-department campus. Price TBD.",
  },
];

export function OrgAdministrationPanel({
  teams,
  onTeamsChanged,
}: {
  teams: Team[];
  onTeamsChanged?: () => void;
}) {
  const { t } = useLanguage();
  const [snapshot, setSnapshot] = useState<OrgWorkforceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [usingLocal, setUsingLocal] = useState(false);
  const [seatBudget, setSeatBudget] = useState(getLocalSeatBudget());
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

  const session = useMemo(() => readOrgEmployeeSession(), [sessionTick, snapshot]);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    try {
      const next = await arrabApi.orgWorkforce();
      const local = Boolean((next as OrgWorkforceSnapshot & { local?: boolean }).local);
      setSnapshot(next);
      setUsingLocal(local);
      setSeatBudget({
        seatLimit: next.seatLimit || Math.max(DEFAULT_FALLBACK_SEATS, next.seatsUsed || 0),
        used: next.seatsUsed ?? next.employees.filter((item) => item.status === "active").length,
      });
    } catch (error) {
      if (!silent) {
        pushToast({
          title: error instanceof ApiRequestError ? error.message : t("apiUnavailable"),
          tone: "warn",
        });
      }
    }
  }, [t]);

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
  const seatLimit = seatBudget.seatLimit || snapshot?.seatLimit || Math.max(DEFAULT_FALLBACK_SEATS, seatsUsed);
  const seatsLeft = Math.max(0, seatLimit - seatsUsed);

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
      await arrabApi.createOrgEmployee({
        displayName: empName,
        email: empEmail,
        password: empPassword,
        title: empTitle || null,
        role: empRole,
        departmentId: empDeptId || null,
      });
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

  function addSeats(pack: SeatPlanCard) {
    if (!usingLocal) {
      pushToast({
        title: t("orgSeatsAdded").replace("{n}", String(pack.seats)),
        body: t("orgSeatsPriceLater"),
        tone: "success",
      });
      setSeatBudget((prev) => ({
        seatLimit: prev.seatLimit + pack.seats,
        used: prev.used,
      }));
      return;
    }
    bumpLocalSeatLimit(pack.seats);
    setSeatBudget(getLocalSeatBudget());
    pushToast({
      title: t("orgSeatsAdded").replace("{n}", String(pack.seats)),
      body: t("orgSeatsPriceLater"),
      tone: "success",
    });
  }

  const teamPlan = SUBSCRIPTION_PLANS.team;

  return (
    <div className="org-admin space-y-5">
      <section className="org-admin-hero workforce-rise overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="relative z-10 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-muted)]">
              {t("orgSeatsEyebrow")}
            </p>
            <h3 className="mt-2 text-[26px] font-medium tracking-[-0.04em] text-[var(--color-foreground)] sm:text-[30px]">
              {t("orgAdminHeroTitle")}
            </h3>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[var(--color-muted)]">
              {t("orgAdminHeroBody")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Pill icon={MapPinned} label={t("orgPillOffice")} />
              <Pill icon={Users} label={t("orgPillEight")} />
              <Pill icon={Lock} label={t("orgPillEmployeeView")} />
            </div>
            {usingLocal ? (
              <p className="mt-3 text-[11px] text-amber-700/90 dark:text-amber-200/80">
                {t("orgLocalModeHint")}
              </p>
            ) : (
              <p className="mt-3 text-[11px] text-emerald-700/90 dark:text-emerald-200/80">
                {t("orgCloudModeHint")}
              </p>
            )}
          </div>
          <div className="relative z-10 grid grid-cols-3 gap-2">
            <HeroStat label={t("orgStatDepts")} value={departments.length} />
            <HeroStat label={t("orgStatSeats")} value={`${seatsUsed}/${seatLimit}`} />
            <HeroStat
              label={t("orgStatActive")}
              value={employees.filter((e) => e.status === "active").length}
            />
          </div>
          <div className="pointer-events-none absolute -right-8 -top-10 size-48 rounded-full bg-[var(--color-primary)]/10 blur-3xl" />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="workforce-rise rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <Header
            icon={Building2}
            title={t("orgDepartments")}
            subtitle={t("orgDeptOfficeHint")}
          />
          <form
            onSubmit={(e) => void createDepartment(e)}
            className="mt-4 grid gap-2 sm:grid-cols-[1.2fr_1fr_auto]"
          >
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder={t("orgDeptNamePh")}
              className="field h-11"
              required
            />
            <select
              value={deptTeamId}
              onChange={(e) => setDeptTeamId(e.target.value)}
              className="field h-11"
            >
              <option value="">{t("orgAutoCreateOffice")}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy} className="chat-pro-cta !h-11 !px-4">
              <Plus className="size-3.5" />
              {t("orgAddDept")}
            </button>
          </form>
          <ul className="mt-4 space-y-2">
            {departments.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                {t("orgNoDepts")}
              </li>
            ) : (
              departments.map((dept) => (
                <DeptRow
                  key={dept.id}
                  dept={dept}
                  seated={deptCounts.get(dept.id) ?? 0}
                  capacity={DEPT_SEAT_CAPACITY}
                  teamName={teams.find((team) => team.id === dept.teamId)?.name ?? null}
                  onDelete={() => void removeDepartment(dept.id)}
                />
              ))
            )}
          </ul>
        </section>

        <section className="workforce-rise rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <Header
            icon={UserPlus}
            title={t("orgCreateSeat")}
            subtitle={t("orgCreateSeatHint")}
          />
          <form onSubmit={(e) => void createEmployee(e)} className="mt-4 grid gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                placeholder={t("orgEmpNamePh")}
                className="field h-11"
                required
              />
              <input
                value={empTitle}
                onChange={(e) => setEmpTitle(e.target.value)}
                placeholder={t("orgEmpTitlePh")}
                className="field h-11"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="email"
                value={empEmail}
                onChange={(e) => setEmpEmail(e.target.value)}
                placeholder={t("orgEmpEmailPh")}
                className="field h-11"
                required
              />
              <input
                type="password"
                value={empPassword}
                onChange={(e) => setEmpPassword(e.target.value)}
                placeholder={t("orgEmpPasswordPh")}
                className="field h-11"
                minLength={12}
                required
              />
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">{t("orgPasswordRules")}</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <select
                value={empRole}
                onChange={(e) => setEmpRole(e.target.value as OrgEmployeeRole)}
                className="field h-11"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`orgRole_${role}` as "orgRole_admin" | "orgRole_manager" | "orgRole_member")}
                  </option>
                ))}
              </select>
              <select
                value={empDeptId}
                onChange={(e) => setEmpDeptId(e.target.value)}
                className="field h-11"
              >
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
              <button
                type="submit"
                disabled={busy || seatsLeft <= 0}
                className="chat-pro-cta !h-11 !px-4 disabled:opacity-40"
              >
                <KeyRound className="size-3.5" />
                {t("orgProvisionSeat")}
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="workforce-rise rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Header icon={Sparkles} title={t("orgSeatPlans")} subtitle={t("orgSeatPlansBody")} />
          <p className="text-[12px] text-[var(--color-muted)]">
            {seatsUsed}/{seatLimit} {t("orgSeatsInUse")} · {teamPlan.name}
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {SEAT_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => addSeats(pack)}
              className={cn(
                "rounded-[22px] border p-4 text-start transition hover:border-[var(--color-foreground)]/30",
                pack.highlight
                  ? "border-[var(--color-foreground)]/25 bg-[var(--color-foreground)] text-[var(--color-background)]"
                  : "border-[var(--color-border)] bg-[var(--overlay-1)]",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium">{pack.name}</p>
                <ArrowUpRight className="size-3.5 opacity-60" />
              </div>
              <p className="mt-3 text-[28px] font-medium tracking-[-0.04em] tabular-nums">
                +{pack.seats}
              </p>
              <p
                className={cn(
                  "mt-1 text-[12px] leading-relaxed",
                  pack.highlight ? "opacity-80" : "text-[var(--color-muted)]",
                )}
              >
                {pack.blurb}
              </p>
              <p
                className={cn(
                  "mt-3 text-[10px] uppercase tracking-[0.14em]",
                  pack.highlight ? "opacity-70" : "text-[var(--color-muted)]",
                )}
              >
                {t("orgSeatsPriceLater")}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="workforce-rise rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <Header icon={Users} title={t("orgDirectory")} subtitle={t("orgDirectoryHint")} />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
              <tr>
                <th className="pb-2 font-medium">{t("orgColPerson")}</th>
                <th className="pb-2 font-medium">{t("orgColEmail")}</th>
                <th className="pb-2 font-medium">{t("orgColRole")}</th>
                <th className="pb-2 font-medium">{t("orgColDept")}</th>
                <th className="pb-2 font-medium">{t("orgColStatus")}</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-[var(--color-muted)]">
                    {t("orgNoEmployees")}
                  </td>
                </tr>
              ) : (
                employees.map((employee) => (
                  <EmployeeRow
                    key={employee.id}
                    employee={employee}
                    departmentName={
                      employee.departmentId
                        ? deptNameById.get(employee.departmentId) ?? "—"
                        : "—"
                    }
                    onDelete={() => void removeEmployee(employee.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workforce-rise rounded-[24px] border border-amber-500/20 bg-amber-500/[0.06] p-5">
        <Header icon={Shield} title={t("orgEmployeeLogin")} subtitle={t("orgLoginHint")} />
        {session ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-foreground)]">
                {t("orgSignedInAs")}{" "}
                <span className="font-medium">{session.employee.displayName}</span>{" "}
                <span className="text-[var(--color-muted)]">({session.employee.email})</span>
              </p>
              <button
                type="button"
                onClick={() => void signOutEmployee()}
                className="home-btn-secondary !h-9 !px-4 !text-[12px]"
              >
                {t("orgSignOutSeat")}
              </button>
            </div>
            {(session.employee.mustChangePassword || snapshot?.me?.mustChangePassword) && (
              <form
                onSubmit={(e) => void changePassword(e)}
                className="grid gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <p className="sm:col-span-3 text-xs text-rose-100/90">{t("orgMustChangePassword")}</p>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t("orgCurrentPasswordPh")}
                  className="field h-11"
                  required
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("orgNewPasswordPh")}
                  className="field h-11"
                  minLength={12}
                  required
                />
                <button type="submit" disabled={busy} className="chat-pro-cta !h-11">
                  {t("orgChangePassword")}
                </button>
              </form>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => void signInEmployee(e)}
            className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          >
            <input
              type="email"
              value={signInEmail}
              onChange={(e) => setSignInEmail(e.target.value)}
              placeholder={t("orgEmpEmailPh")}
              className="field h-11"
              required
            />
            <input
              type="password"
              value={signInPassword}
              onChange={(e) => setSignInPassword(e.target.value)}
              placeholder={t("orgEmpPasswordPh")}
              className="field h-11"
              required
            />
            <button type="submit" disabled={busy} className="chat-pro-cta !h-11 !px-5">
              {t("orgSignInSeat")}
            </button>
          </form>
        )}
      </section>

      {snapshot?.permissions.canViewAudit ? (
        <section className="workforce-rise rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <Header icon={Shield} title={t("orgAuditTitle")} subtitle={t("orgAuditEmpty")} />
          <ul className="mt-4 space-y-2">
            {events.length === 0 ? (
              <li className="text-sm text-[var(--color-muted)]">{t("orgAuditEmpty")}</li>
            ) : (
              events.slice(0, 12).map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--overlay-1)] px-3 py-2 text-xs"
                >
                  <span>
                    <span className="font-medium text-[var(--color-foreground)]">{event.kind}</span>
                    {" · "}
                    <span className="text-[var(--color-muted)]">{event.detail}</span>
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const DEFAULT_FALLBACK_SEATS = 8;

function Header({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Building2;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--overlay-1)]">
        <Icon className="size-4 text-[var(--color-foreground)]" strokeWidth={1.7} />
      </div>
      <div className="min-w-0">
        <h4 className="text-[15px] font-medium tracking-[-0.02em] text-[var(--color-foreground)]">
          {title}
        </h4>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-muted)]">{subtitle}</p>
      </div>
    </div>
  );
}

function Pill({ icon: Icon, label }: { icon: typeof Lock; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--overlay-1)] px-2.5 py-1 text-[11px] text-[var(--color-foreground)]">
      <Icon className="size-3" strokeWidth={1.8} />
      {label}
    </span>
  );
}

function HeroStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--overlay-1)] px-3 py-3 text-center">
      <p className="text-[22px] font-medium tabular-nums tracking-[-0.03em] text-[var(--color-foreground)]">
        {value}
      </p>
      <p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

function DeptRow({
  dept,
  seated,
  capacity,
  teamName,
  onDelete,
}: {
  dept: OrgDepartment;
  seated: number;
  capacity: number;
  teamName: string | null;
  onDelete: () => void;
}) {
  const pct = Math.min(100, Math.round((seated / capacity) * 100));
  return (
    <li className="rounded-2xl border border-[var(--color-border)] bg-[var(--overlay-1)] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{dept.name}</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            {teamName ? `Live Map · ${teamName}` : "Live Map office"} · {seated}/{capacity}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-full p-2 text-[var(--color-muted)] hover:bg-[var(--overlay-2)] hover:text-[var(--color-foreground)]"
          aria-label="Delete department"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className="h-full rounded-full bg-[var(--color-foreground)]/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

function EmployeeRow({
  employee,
  departmentName,
  onDelete,
}: {
  employee: OrgEmployeePublic;
  departmentName: string;
  onDelete: () => void;
}) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="py-3">
        <p className="font-medium text-[var(--color-foreground)]">{employee.displayName}</p>
        <p className="text-[11px] text-[var(--color-muted)]">{employee.title || "—"}</p>
      </td>
      <td className="py-3 text-[var(--color-muted)]">{employee.email}</td>
      <td className="py-3">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
            employee.role === "admin"
              ? "bg-[var(--color-foreground)]/10 text-[var(--color-foreground)]"
              : employee.role === "manager"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-100"
                : "bg-[var(--overlay-2)] text-[var(--color-muted)]",
          )}
        >
          {employee.role}
        </span>
      </td>
      <td className="py-3 text-[var(--color-muted)]">{departmentName}</td>
      <td className="py-3 text-[var(--color-muted)]">{employee.status}</td>
      <td className="py-3 text-end">
        <button
          type="button"
          onClick={onDelete}
          className="rounded-full p-2 text-[var(--color-muted)] hover:bg-[var(--overlay-2)] hover:text-[var(--color-foreground)]"
          aria-label="Delete employee"
        >
          <Trash2 className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}
