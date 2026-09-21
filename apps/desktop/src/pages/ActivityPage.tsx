import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Building2,
  Filter,
  Search,
  Shield,
  UserRound,
} from "lucide-react";
import type {
  Activity,
  Agent,
  OrgDepartment,
  OrgEmployeePublic,
  TeamMembership,
} from "@arrab/shared";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { isDefaultSoloClone } from "@/lib/agents-bootstrap";
import { filterLiveWorkforceAgents } from "@/lib/agent-session-policy";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { isCompanionAgent } from "@/lib/org-chat";
import {
  readOrgEmployeeSession,
  subscribeOrgEmployeeSession,
} from "@/lib/org-employee-session";
import { cn } from "@/lib/utils";

type ActorFilter = "all" | "agent" | "user" | "system";

const PERSONAL_COMPANION_MARKERS = new Set([
  "sleep",
  "money",
  "inbox",
  "general",
  "incognito",
  "النوم",
  "البريد",
  "companion",
  "private companion",
]);

/** Drop Individuals companions / solo presets — Activity is org workforce only. */
function isOrgWorkforceAgent(agent: Agent): boolean {
  if (agent.status === "archived") return false;
  if (isCompanionAgent(agent)) return false;
  if (isDefaultSoloClone(agent)) return false;
  const role = agent.role.trim().toLowerCase();
  const specialty = (agent.specialty ?? "").trim().toLowerCase();
  const name = agent.name.trim().toLowerCase();
  if (PERSONAL_COMPANION_MARKERS.has(specialty) || PERSONAL_COMPANION_MARKERS.has(role)) {
    return false;
  }
  if (PERSONAL_COMPANION_MARKERS.has(name)) return false;
  if (/companion|incognito/.test(role) || /companion|incognito/.test(specialty)) return false;
  return true;
}

function formatWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return locale.startsWith("ar") ? "الآن" : "Just now";
  if (mins < 60) return locale.startsWith("ar") ? `منذ ${mins} د` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return locale.startsWith("ar") ? `منذ ${hours} س` : `${hours}h ago`;
  return date.toLocaleString(locale.startsWith("ar") ? "ar" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actorIcon(actorType: Activity["actorType"]) {
  if (actorType === "agent") return Bot;
  if (actorType === "user") return UserRound;
  return Shield;
}

export function ActivityPage() {
  const { t, locale } = useLanguage();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [employees, setEmployees] = useState<OrgEmployeePublic[]>([]);
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [sessionTick, setSessionTick] = useState(0);

  useEffect(() => subscribeOrgEmployeeSession(() => setSessionTick((n) => n + 1)), []);

  const orgEmployee = useMemo(() => {
    void sessionTick;
    return readOrgEmployeeSession()?.employee ?? null;
  }, [sessionTick]);

  /** Studio owner (no employee seat) or org admin → full audit. */
  const isOrgAdmin = orgEmployee == null || orgEmployee.role === "admin";

  const departmentAgentIds = useMemo(() => {
    if (!orgEmployee?.departmentId) return new Set<string>();
    const dept = departments.find((item) => item.id === orgEmployee.departmentId);
    if (!dept?.teamId) return new Set<string>();
    return new Set(
      memberships.filter((item) => item.teamId === dept.teamId).map((item) => item.agentId),
    );
  }, [departments, memberships, orgEmployee?.departmentId]);

  const departmentName = useMemo(() => {
    if (!orgEmployee?.departmentId) return null;
    return departments.find((item) => item.id === orgEmployee.departmentId)?.name ?? null;
  }, [departments, orgEmployee?.departmentId]);

  const load = useCallback((opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setError(null);
      setBusy(true);
    }
    void Promise.all([
      arrabApi.activity(),
      arrabApi.agents().catch(() => ({ items: [] as Agent[] })),
      arrabApi.orgWorkforce().catch(() => null),
      arrabApi.orgEmployees().catch(() => ({ items: [] as OrgEmployeePublic[] })),
      arrabApi.memberships().catch(() => ({ items: [] as TeamMembership[] })),
    ])
      .then(([activity, agentList, workforce, employeeList, memberList]) => {
        setItems(activity.items);
        setAgents(
          filterLiveWorkforceAgents(agentList.items).filter(isOrgWorkforceAgent),
        );
        setMemberships(memberList.items);

        const fromWorkforce = (workforce?.employees ?? []).filter(
          (item) => item.status === "active",
        );
        const fromDirectory = employeeList.items.filter((item) => item.status === "active");
        const byId = new Map<string, OrgEmployeePublic>();
        for (const person of [...fromWorkforce, ...fromDirectory]) {
          byId.set(person.id, person);
        }
        setEmployees(
          [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
        );
        setDepartments(workforce?.departments ?? []);
        if (!silent) setError(null);
      })
      .catch((err: unknown) => {
        if (!silent) {
          setItems(null);
          setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
        }
      })
      .finally(() => {
        if (!silent) setBusy(false);
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while the page is visible — no manual Refresh button.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      load({ silent: true });
    };
    const id = window.setInterval(tick, 12_000);
    const onFocus = () => tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!isOrgAdmin) {
      setActorFilter("agent");
      setSelectedEmployeeId("");
    }
  }, [isOrgAdmin]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees) map.set(employee.id, employee.displayName);
    return map;
  }, [employees]);

  const selectableAgents = useMemo(() => {
    const roster = agents;
    if (isOrgAdmin) return roster;
    if (departmentAgentIds.size === 0) return roster;
    return roster.filter((agent) => departmentAgentIds.has(agent.id));
  }, [agents, departmentAgentIds, isOrgAdmin]);

  useEffect(() => {
    if (selectedAgentId && !selectableAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId("");
    }
  }, [selectableAgents, selectedAgentId]);

  useEffect(() => {
    if (selectedEmployeeId && !employees.some((person) => person.id === selectedEmployeeId)) {
      setSelectedEmployeeId("");
    }
  }, [employees, selectedEmployeeId]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    const selectedEmployeeName = selectedEmployeeId
      ? employeeNameById.get(selectedEmployeeId)?.toLowerCase() ?? ""
      : "";

    return items.filter((entry) => {
      if (!isOrgAdmin) {
        if (entry.actorType !== "agent") return false;
        if (
          departmentAgentIds.size > 0 &&
          entry.actorId &&
          !departmentAgentIds.has(entry.actorId)
        ) {
          // Still allow if summary mentions a department agent name.
          const mentionsDeptAgent = [...departmentAgentIds].some((id) => {
            const name = agentNameById.get(id)?.toLowerCase();
            return name ? entry.summary.toLowerCase().includes(name) : false;
          });
          if (!mentionsDeptAgent) return false;
        }
      }

      if (actorFilter !== "all" && entry.actorType !== actorFilter) return false;

      if (selectedAgentId) {
        const name = agentNameById.get(selectedAgentId)?.toLowerCase() ?? "";
        const matchesId = entry.actorId === selectedAgentId;
        const matchesName = name ? entry.summary.toLowerCase().includes(name) : false;
        if (!matchesId && !matchesName) return false;
      }

      if (selectedEmployeeId && isOrgAdmin) {
        const matchesId = entry.actorId === selectedEmployeeId;
        const matchesName = selectedEmployeeName
          ? entry.summary.toLowerCase().includes(selectedEmployeeName)
          : false;
        if (!matchesId && !matchesName) return false;
      }

      if (!q) return true;
      const hay = [
        entry.summary,
        entry.verb,
        entry.objectType,
        entry.actorType,
        entry.actorId ? agentNameById.get(entry.actorId) : "",
        entry.actorId ? employeeNameById.get(entry.actorId) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    actorFilter,
    agentNameById,
    departmentAgentIds,
    employeeNameById,
    isOrgAdmin,
    items,
    query,
    selectedAgentId,
    selectedEmployeeId,
  ]);

  const stats = useMemo(() => {
    const source = filtered;
    return {
      total: source.length,
      agents: source.filter((item) => item.actorType === "agent").length,
      users: source.filter((item) => item.actorType === "user").length,
      system: source.filter((item) => item.actorType === "system").length,
    };
  }, [filtered]);

  return (
    <Surface className="activity-desk overflow-hidden">
      <div className="activity-desk-inner">
        <header className="activity-mast">
          <div className="min-w-0">
            <p className="chat-pro-kicker">{t("activity")}</p>
            <h1 className="activity-title">{t("activityTitle")}</h1>
            <p className="activity-lead">
              {isOrgAdmin ? t("activityBodyAdmin") : t("activityBodyMember")}
            </p>
          </div>
          <div className="activity-mast-actions">
            <span className={cn("activity-role-badge", isOrgAdmin ? "is-admin" : "is-member")}>
              {isOrgAdmin ? (
                <>
                  <Shield className="size-3.5" />
                  {t("activityRoleAdmin")}
                </>
              ) : (
                <>
                  <Building2 className="size-3.5" />
                  {departmentName
                    ? t("activityRoleDept").replace("{name}", departmentName)
                    : t("activityRoleMember")}
                </>
              )}
            </span>
            {isOrgAdmin ? (
              <Link to="/workforce" className="activity-link-btn">
                {t("ccReports")}
                <ArrowUpRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
        </header>

        <section className="activity-toolbar" aria-label={t("activityFilters")}>
          <div className="activity-search">
            <Search className="size-3.5 opacity-50" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("activitySearchPlaceholder")}
              aria-label={t("activitySearchPlaceholder")}
            />
          </div>

          <div className="activity-filter-row">
            <span className="activity-filter-label">
              <Filter className="size-3.5" />
              {t("activityFilterActor")}
            </span>
            {(isOrgAdmin
              ? (["all", "agent", "user", "system"] as ActorFilter[])
              : (["agent"] as ActorFilter[])
            ).map((value) => (
              <button
                key={value}
                type="button"
                className={cn("activity-chip", actorFilter === value && "is-on")}
                onClick={() => setActorFilter(value)}
              >
                {value === "all"
                  ? t("activityFilterAll")
                  : value === "agent"
                    ? t("activityFilterAgents")
                    : value === "user"
                      ? t("activityFilterPeople")
                      : t("activityFilterSystem")}
              </button>
            ))}
          </div>

          <div className="activity-selects">
            <label className="activity-select">
              <span>{t("activityPickAgent")}</span>
              <select
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
              >
                <option value="">{t("activityAllAgents")}</option>
                {selectableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.role ? ` · ${agent.role}` : ""}
                  </option>
                ))}
              </select>
              {selectableAgents.length === 0 ? (
                <p className="activity-select-hint">{t("activityNoAgents")}</p>
              ) : null}
            </label>

            {isOrgAdmin ? (
              <label className="activity-select">
                <span>{t("activityPickEmployee")}</span>
                <select
                  value={selectedEmployeeId}
                  onChange={(event) => setSelectedEmployeeId(event.target.value)}
                >
                  <option value="">{t("activityAllEmployees")}</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.displayName}
                      {employee.title ? ` · ${employee.title}` : ""}
                      {employee.email ? ` · ${employee.email}` : ""}
                    </option>
                  ))}
                </select>
                {employees.length === 0 ? (
                  <p className="activity-select-hint">{t("activityNoEmployees")}</p>
                ) : null}
              </label>
            ) : null}
          </div>
        </section>

        <div className="activity-stats" aria-live="polite">
          <span>
            {stats.total} {t("activityStatTotal")}
          </span>
          <span>
            {stats.agents} {t("activityFilterAgents")}
          </span>
          {isOrgAdmin ? (
            <>
              <span>
                {stats.users} {t("activityFilterPeople")}
              </span>
              <span>
                {stats.system} {t("activityFilterSystem")}
              </span>
            </>
          ) : null}
        </div>

        {error ? (
          <div className="activity-error">
            <p>{t("apiUnavailable")}</p>
            <p>{error}</p>
            <button type="button" onClick={() => load()}>
              {t("retry")}
            </button>
          </div>
        ) : null}

        <div className="activity-feed" role="feed" aria-busy={busy}>
          {!error && items && filtered.length === 0 ? (
            <p className="activity-empty">{t("activityEmptyFiltered")}</p>
          ) : null}
          {!error && items && items.length === 0 ? (
            <p className="activity-empty">{t("quiet")}</p>
          ) : null}
          {filtered.map((entry) => {
            const Icon = actorIcon(entry.actorType);
            const who =
              (entry.actorId && agentNameById.get(entry.actorId)) ||
              (entry.actorId && employeeNameById.get(entry.actorId)) ||
              entry.actorType;
            return (
              <article key={entry.id} className="activity-card">
                <span className={cn("activity-card-icon", `is-${entry.actorType}`)}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="activity-card-summary">{entry.summary}</p>
                  <p className="activity-card-meta">
                    <span>{who}</span>
                    <span aria-hidden>·</span>
                    <span>{entry.verb}</span>
                    <span aria-hidden>·</span>
                    <span>{entry.objectType}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={entry.createdAt}>{formatWhen(entry.createdAt, locale)}</time>
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </Surface>
  );
}
