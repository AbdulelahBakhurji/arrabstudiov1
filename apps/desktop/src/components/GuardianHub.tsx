import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock,
  History,
  Pause,
  Play,
  Plus,
  Shield,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type { FamilyAgeTier, FamilyMemberPublic } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { pushToast } from "@/lib/notify";
import {
  addCompanion,
  liveCompanions,
  useCompanionState,
} from "@/lib/companions";
import { guardianDecisionsForMember, useSecondBrain } from "@/lib/second-brain";
import {
  addGuardianRule,
  allPendingApprovals,
  applyAgeTierPreset,
  auditForChild,
  getDowntime,
  logGuardianAudit,
  removeGuardianRule,
  resolveCompanionApproval,
  setDowntime,
  toggleGuardianRule,
  useGuardianStore,
  weeklyDigestForChild,
  weeklyDigestNarrative,
  type CompanionApprovalRequest,
} from "@/lib/guardian-store";
import { cn } from "@/lib/utils";

type HubTab = "feed" | "rules" | "downtime" | "approvals" | "audit";

const VERDICT_TONE: Record<string, string> = {
  allow: "is-soft",
  scaffold: "is-soft",
  model_boundary: "is-bound",
  coach_parent: "is-coach",
  pause_with_care: "is-pause",
};

const PRESET_LABEL: Record<FamilyAgeTier, "guardianPreset69" | "guardianPreset1013" | "guardianPreset1417"> = {
  tier_6_9: "guardianPreset69",
  tier_10_13: "guardianPreset1013",
  tier_14_17: "guardianPreset1417",
};

export function GuardianHub({
  child,
  busy,
  onTogglePause,
  className,
}: {
  child: FamilyMemberPublic;
  busy?: boolean;
  onTogglePause?: (member: FamilyMemberPublic) => void;
  className?: string;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const brain = useSecondBrain();
  const store = useGuardianStore();
  const companionState = useCompanionState();
  const [tab, setTab] = useState<HubTab>("feed");
  const [ruleDraft, setRuleDraft] = useState("");
  const downtime = useMemo(() => getDowntime(child.id), [child.id, store.downtime]);
  const [start, setStart] = useState(downtime.start);
  const [end, setEnd] = useState(downtime.end);
  const [downtimeOn, setDowntimeOn] = useState(downtime.enabled);
  const [alwaysAllowed, setAlwaysAllowed] = useState<string[]>(
    () => [...downtime.alwaysAllowedCompanionIds],
  );

  useEffect(() => {
    const next = getDowntime(child.id);
    setStart(next.start);
    setEnd(next.end);
    setDowntimeOn(next.enabled);
    setAlwaysAllowed([...next.alwaysAllowedCompanionIds]);
  }, [child.id, store.downtime]);

  const feed = useMemo(() => {
    return guardianDecisionsForMember(child.id, 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.id, brain.nodes.length, brain.nodes[0]?.updatedAt, store.rules.length]);

  const rules = useMemo(
    () => store.rules.filter((r) => r.childMemberId === child.id),
    [store.rules, child.id],
  );

  const approvals = useMemo(
    () =>
      store.approvals.filter(
        (a) => a.childMemberId === child.id && a.status === "pending",
      ),
    [store.approvals, child.id],
  );

  const audit = useMemo(
    () => auditForChild(child.id, 24),
    [child.id, store.audit.length, store.audit[0]?.id],
  );

  const digest = useMemo(() => weeklyDigestForChild(child.id), [child.id, feed.length]);
  const narrative = useMemo(
    () => weeklyDigestNarrative(child.id, child.displayName, ar ? "ar" : "en"),
    [child.id, child.displayName, ar, digest.decisions, digest.boundaries, digest.coaching, digest.pauses],
  );

  const childCompanions = useMemo(
    () => liveCompanions(companionState).filter((c) => c.familyMemberId === child.id),
    [companionState, child.id],
  );

  function submitRule() {
    const created = addGuardianRule({ childMemberId: child.id, text: ruleDraft });
    if (!created) return;
    setRuleDraft("");
    pushToast({ title: t("guardianRuleAdded"), tone: "success" });
  }

  function applyPreset() {
    const tier = child.ageTier;
    if (!tier) {
      pushToast({ title: t("guardianPresetNeedAge"), tone: "warn" });
      return;
    }
    const added = applyAgeTierPreset(child.id, tier);
    pushToast({
      title: t("guardianPresetApplied"),
      body: t(PRESET_LABEL[tier]).replace("{n}", String(added)),
      tone: "success",
    });
  }

  function saveDowntime() {
    setDowntime({
      childMemberId: child.id,
      enabled: downtimeOn,
      start,
      end,
      alwaysAllowedCompanionIds: alwaysAllowed,
    });
    pushToast({ title: t("guardianDowntimeSaved"), tone: "success" });
  }

  function toggleAlwaysAllowed(companionId: string) {
    setAlwaysAllowed((prev) =>
      prev.includes(companionId)
        ? prev.filter((id) => id !== companionId)
        : [...prev, companionId],
    );
  }

  function approve(req: CompanionApprovalRequest) {
    const resolved = resolveCompanionApproval(req.id, "approved");
    if (!resolved) return;
    addCompanion({
      name: resolved.name,
      domain: resolved.domain,
      purposeId: resolved.purposeId,
      brief: resolved.brief || null,
      space: resolved.space,
      familyMemberId: resolved.childMemberId,
    });
    pushToast({
      title: t("guardianApprovalApproved"),
      body: resolved.name,
      tone: "success",
    });
  }

  function decline(req: CompanionApprovalRequest) {
    resolveCompanionApproval(req.id, "declined");
    pushToast({ title: t("guardianApprovalDeclined"), tone: "warn" });
  }

  function handlePause() {
    if (!onTogglePause) return;
    logGuardianAudit({
      childMemberId: child.id,
      kind: child.isPaused ? "resume" : "pause",
      title: child.isPaused ? "Access resumed" : "Access paused",
      detail: child.displayName,
    });
    onTogglePause(child);
  }

  const tabs: { id: HubTab; label: string; count?: number }[] = [
    { id: "feed", label: t("guardianTabFeed"), count: feed.length },
    { id: "rules", label: t("guardianTabRules"), count: rules.length },
    { id: "downtime", label: t("guardianTabDowntime") },
    { id: "approvals", label: t("guardianTabApprovals"), count: approvals.length },
    { id: "audit", label: t("guardianTabAudit"), count: audit.length },
  ];

  return (
    <section className={cn("gh-hub", className)} aria-label={t("guardianHubTitle")}>
      <header className="gh-hub-head">
        <div className="gh-hub-brand">
          <span className="gh-hub-mark">
            <Shield className="size-4" strokeWidth={1.8} />
          </span>
          <div>
            <p className="gh-eyebrow">{t("guardianHubEyebrow")}</p>
            <h3>{t("guardianHubTitle")}</h3>
            <p className="gh-muted">
              {t("guardianHubBody").replace("{name}", child.displayName)}
            </p>
          </div>
        </div>

        {onTogglePause && !child.isOwner ? (
          <div className="gh-remote-pause">
            <div>
              <p className="gh-label">{t("guardianRemotePauseTitle")}</p>
              <p className="gh-muted">
                {child.isPaused
                  ? t("guardianRemotePausedBody").replace("{name}", child.displayName)
                  : t("guardianRemotePauseBody").replace("{name}", child.displayName)}
              </p>
            </div>
            <button
              type="button"
              className={cn("gh-btn", child.isPaused ? "" : "is-pause")}
              disabled={busy}
              onClick={handlePause}
            >
              {child.isPaused ? (
                <Play className="size-3.5" strokeWidth={1.9} />
              ) : (
                <Pause className="size-3.5" strokeWidth={1.9} />
              )}
              {child.isPaused ? t("guardianRemoteResume") : t("guardianRemotePause")}
            </button>
          </div>
        ) : null}

        <div className="gh-digest" aria-label={t("guardianDigestTitle")}>
          <div>
            <strong>{digest.decisions}</strong>
            <span>{t("guardianDigestDecisions")}</span>
          </div>
          <div>
            <strong>{digest.boundaries}</strong>
            <span>{t("guardianDigestBoundaries")}</span>
          </div>
          <div>
            <strong>{digest.coaching}</strong>
            <span>{t("guardianDigestCoaching")}</span>
          </div>
          <div>
            <strong>{digest.pauses}</strong>
            <span>{t("guardianDigestPauses")}</span>
          </div>
        </div>
        <p className="gh-digest-narrative">{narrative}</p>
      </header>

      <div className="gh-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={cn("gh-tab", tab === item.id && "is-on")}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count != null && item.count > 0 ? <em>{item.count}</em> : null}
          </button>
        ))}
      </div>

      {tab === "feed" ? (
        <div className="gh-panel">
          {feed.length === 0 ? (
            <div className="gh-empty">
              <Sparkles className="size-5" strokeWidth={1.6} />
              <p>{t("guardianFeedEmpty")}</p>
            </div>
          ) : (
            <ul className="gh-feed-list">
              {feed.map((node) => (
                <li key={node.id} className="gh-feed-card">
                  <div className="gh-feed-top">
                    <span
                      className={cn(
                        "gh-verdict",
                        VERDICT_TONE[node.guardianVerdict ?? ""] ?? "is-soft",
                      )}
                    >
                      {(node.guardianVerdict ?? "decision").replace(/_/g, " ")}
                    </span>
                    <time dateTime={node.updatedAt}>
                      {new Date(node.updatedAt).toLocaleString(ar ? "ar" : "en", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="gh-feed-reason">{node.summary}</p>
                  {node.parentCoaching ? (
                    <div className="gh-coach-box">
                      <p className="gh-coach-label">{t("guardianCoachLabel")}</p>
                      <p>{node.parentCoaching}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "rules" ? (
        <div className="gh-panel">
          <div className="gh-preset-row">
            <div>
              <p className="gh-label">{t("guardianPresetTitle")}</p>
              <p className="gh-muted">{t("guardianPresetBody")}</p>
            </div>
            <button
              type="button"
              className="gh-btn is-ghost"
              disabled={!child.ageTier}
              onClick={applyPreset}
            >
              <Wand2 className="size-3.5" strokeWidth={1.8} />
              {t("guardianPresetApply")}
            </button>
          </div>
          <form
            className="gh-rule-compose"
            onSubmit={(e) => {
              e.preventDefault();
              submitRule();
            }}
          >
            <label className="gh-label" htmlFor={`gh-rule-${child.id}`}>
              {t("guardianRuleCompose")}
            </label>
            <textarea
              id={`gh-rule-${child.id}`}
              value={ruleDraft}
              onChange={(e) => setRuleDraft(e.target.value)}
              rows={3}
              placeholder={t("guardianRulePh")}
              className="gh-input"
            />
            <button type="submit" className="gh-btn" disabled={ruleDraft.trim().length < 4}>
              <Plus className="size-3.5" strokeWidth={1.9} />
              {t("guardianRuleAdd")}
            </button>
          </form>
          {rules.length === 0 ? (
            <p className="gh-muted">{t("guardianRulesEmpty")}</p>
          ) : (
            <ul className="gh-rule-list">
              {rules.map((rule) => (
                <li key={rule.id} className={cn("gh-rule-row", !rule.enabled && "is-off")}>
                  <div>
                    <span className="gh-rule-kind">{rule.kind}</span>
                    <p>{rule.text}</p>
                  </div>
                  <div className="gh-rule-actions">
                    <button
                      type="button"
                      className="gh-icon"
                      title={rule.enabled ? t("guardianRuleDisable") : t("guardianRuleEnable")}
                      onClick={() => toggleGuardianRule(rule.id, !rule.enabled)}
                    >
                      {rule.enabled ? (
                        <Check className="size-3.5" strokeWidth={1.9} />
                      ) : (
                        <X className="size-3.5" strokeWidth={1.9} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="gh-icon"
                      title={t("guardianRuleRemove")}
                      onClick={() => removeGuardianRule(rule.id)}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.8} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "downtime" ? (
        <div className="gh-panel gh-downtime">
          <div className="gh-downtime-head">
            <Clock className="size-4" strokeWidth={1.8} />
            <div>
              <p className="gh-label">{t("guardianDowntimeTitle")}</p>
              <p className="gh-muted">{t("guardianDowntimeBody")}</p>
            </div>
          </div>
          <label className="gh-toggle">
            <input
              type="checkbox"
              checked={downtimeOn}
              onChange={(e) => setDowntimeOn(e.target.checked)}
            />
            <span>{t("guardianDowntimeEnable")}</span>
          </label>
          <div className="gh-time-row">
            <label>
              {t("guardianDowntimeStart")}
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="gh-input gh-time"
              />
            </label>
            <label>
              {t("guardianDowntimeEnd")}
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="gh-input gh-time"
              />
            </label>
          </div>
          <div className="gh-always">
            <p className="gh-label">{t("guardianAlwaysAllowedTitle")}</p>
            <p className="gh-muted">{t("guardianAlwaysAllowedBody")}</p>
            {childCompanions.length === 0 ? (
              <p className="gh-muted">{t("guardianAlwaysAllowedEmpty")}</p>
            ) : (
              <ul className="gh-always-list">
                {childCompanions.map((c) => {
                  const on = alwaysAllowed.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label className={cn("gh-always-chip", on && "is-on")}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleAlwaysAllowed(c.id)}
                        />
                        <span>{c.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <button type="button" className="gh-btn" onClick={saveDowntime}>
            {t("guardianDowntimeSave")}
          </button>
        </div>
      ) : null}

      {tab === "approvals" ? (
        <div className="gh-panel">
          {approvals.length === 0 ? (
            <div className="gh-empty">
              <p>{t("guardianApprovalsEmpty")}</p>
            </div>
          ) : (
            <ul className="gh-approve-list">
              {approvals.map((req) => (
                <li key={req.id} className="gh-approve-card">
                  <div>
                    <strong>{req.name}</strong>
                    <p className="gh-muted">
                      {req.childName} · {req.domain}
                      {req.brief ? ` · ${req.brief.slice(0, 80)}` : ""}
                    </p>
                  </div>
                  <div className="gh-approve-actions">
                    <button type="button" className="gh-btn" onClick={() => approve(req)}>
                      {t("guardianApprove")}
                    </button>
                    <button
                      type="button"
                      className="gh-btn is-ghost"
                      onClick={() => decline(req)}
                    >
                      {t("guardianDecline")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {allPendingApprovals().length > approvals.length ? (
            <p className="gh-muted">{t("guardianApprovalsOtherKids")}</p>
          ) : null}
        </div>
      ) : null}

      {tab === "audit" ? (
        <div className="gh-panel">
          {audit.length === 0 ? (
            <div className="gh-empty">
              <History className="size-5" strokeWidth={1.6} />
              <p>{t("guardianAuditEmpty")}</p>
            </div>
          ) : (
            <ul className="gh-audit-list">
              {audit.map((event) => (
                <li key={event.id} className="gh-audit-row">
                  <div className="gh-audit-top">
                    <strong>{event.title}</strong>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString(ar ? "ar" : "en", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="gh-muted">{event.detail}</p>
                  <span className="gh-audit-kind">{event.kind.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
