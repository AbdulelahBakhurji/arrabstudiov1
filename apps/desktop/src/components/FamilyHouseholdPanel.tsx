import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Coins,
  MessageSquareHeart,
  Pause,
  Play,
  Plus,
  ShoppingBag,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import type {
  FamilyAgeTier,
  FamilyHouseholdSnapshot,
  FamilyMemberPublic,
  FamilyMemberRole,
} from "@arrab/shared";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { pushToast } from "@/lib/notify";
import {
  addParentGuidanceFact,
  liveCompanions,
  updateCompanion,
  useCompanionState,
  type CompanionProfile,
} from "@/lib/companions";
import {
  refreshFamilyProfile,
  writeActiveFamilyMemberId,
} from "@/lib/family-session";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS: FamilyMemberRole[] = ["parent", "partner", "child"];
const AGE_TIERS: {
  id: FamilyAgeTier;
  labelKey: "familyAge69" | "familyAge1013" | "familyAge1417";
}[] = [
  { id: "tier_6_9", labelKey: "familyAge69" },
  { id: "tier_10_13", labelKey: "familyAge1013" },
  { id: "tier_14_17", labelKey: "familyAge1417" },
];

function roleLabel(
  role: FamilyMemberRole,
  t: (key: "familyRoleParent" | "familyRolePartner" | "familyRoleChild") => string,
): string {
  if (role === "parent") return t("familyRoleParent");
  if (role === "partner") return t("familyRolePartner");
  return t("familyRoleChild");
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

export function FamilyHouseholdPanel({
  className,
  variant = "full",
}: {
  className?: string;
  variant?: "full" | "compact";
}) {
  const { t } = useLanguage();
  const companionState = useCompanionState();
  const [snapshot, setSnapshot] = useState<FamilyHouseholdSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<FamilyMemberRole>("partner");
  const [ageTier, setAgeTier] = useState<FamilyAgeTier>("tier_10_13");
  const [pin, setPin] = useState("");
  const [switchPin, setSwitchPin] = useState("");
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [grantTarget, setGrantTarget] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState("50000");
  const [guideChildId, setGuideChildId] = useState<string | null>(null);
  const [guideCompanionId, setGuideCompanionId] = useState<string>("");
  const [guideText, setGuideText] = useState("");
  const [seatCode, setSeatCode] = useState("");
  const [assignTarget, setAssignTarget] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void arrabApi
      .familyHousehold()
      .then((next) => {
        setSnapshot(next);
        setError(null);
        void refreshFamilyProfile({ silent: true }).then((state) => {
          setActiveId(state.active?.id ?? next.activeMemberId);
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const children = useMemo(
    () => snapshot?.members.filter((m) => m.role === "child") ?? [],
    [snapshot?.members],
  );
  const managers = useMemo(
    () => snapshot?.members.filter((m) => m.isManager) ?? [],
    [snapshot?.members],
  );
  const activeManager = useMemo(
    () =>
      managers.find((m) => m.id === activeId) ??
      managers.find((m) => m.isOwner) ??
      managers[0] ??
      null,
    [managers, activeId],
  );

  const childCompanions = useMemo(() => {
    const all = liveCompanions(companionState);
    if (!guideChildId) return all;
    return all.filter(
      (c) => !c.familyMemberId || c.familyMemberId === guideChildId,
    );
  }, [companionState, guideChildId]);

  const usagePct = useMemo(() => {
    const usage = snapshot?.usage;
    if (!usage || usage.tokenLimit == null || usage.tokenLimit <= 0) return null;
    return Math.min(100, Math.round((usage.tokensUsed / usage.tokenLimit) * 100));
  }, [snapshot?.usage]);

  async function addMember() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await arrabApi.createFamilyMember({
        displayName: name.trim(),
        role,
        ageTier: role === "child" ? ageTier : null,
        pin: pin.trim() || null,
      });
      setName("");
      setPin("");
      setRole("partner");
      pushToast({ title: t("familyMemberAdded"), tone: "success" });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(member: FamilyMemberPublic) {
    if (member.isOwner) return;
    setBusy(true);
    try {
      await arrabApi.updateFamilyMember(member.id, { isPaused: !member.isPaused });
      pushToast({
        title: member.isPaused ? t("familyMemberResumed") : t("familyMemberPaused"),
        tone: "info",
      });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: FamilyMemberPublic) {
    if (member.isOwner) return;
    setBusy(true);
    try {
      await arrabApi.deleteFamilyMember(member.id);
      if (activeId === member.id) {
        writeActiveFamilyMemberId(null);
        setActiveId(null);
        void refreshFamilyProfile({ silent: true });
      }
      pushToast({ title: t("familyMemberRemoved"), tone: "info" });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(member: FamilyMemberPublic) {
    if (member.isPaused) {
      pushToast({ title: t("familyProfilePaused"), tone: "warn" });
      return;
    }
    if (member.hasPin && switchTarget !== member.id) {
      setSwitchTarget(member.id);
      setSwitchPin("");
      return;
    }
    setBusy(true);
    try {
      const result = await arrabApi.switchFamilyProfile({
        memberId: member.id,
        pin: member.hasPin ? switchPin || undefined : undefined,
      });
      writeActiveFamilyMemberId(result.member.id);
      setActiveId(result.member.id);
      setSwitchTarget(null);
      setSwitchPin("");
      pushToast({
        title: t("familySwitched"),
        body: result.member.displayName,
        tone: "success",
      });
      void refreshFamilyProfile({ silent: true });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function grantTokens(member: FamilyMemberPublic) {
    const tokens = Number.parseInt(grantAmount.replace(/\D/g, ""), 10);
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    setBusy(true);
    try {
      const next = await arrabApi.grantFamilyTokens({ memberId: member.id, tokens });
      setSnapshot(next);
      setGrantTarget(null);
      pushToast({ title: t("familyTokensGranted"), tone: "success" });
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function buySeats(seats: 1 | 2 | 5) {
    setBusy(true);
    try {
      const next = await arrabApi.purchaseFamilySeats({
        seats,
        code: seatCode.trim() || undefined,
      });
      setSnapshot(next);
      setSeatCode("");
      pushToast({ title: t("familySeatsPurchased"), tone: "success" });
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendGuidance() {
    if (!guideChildId || !guideCompanionId || !guideText.trim() || !activeManager) return;
    setBusy(true);
    try {
      const note = await arrabApi.addFamilyGuidance({
        companionId: guideCompanionId,
        childMemberId: guideChildId,
        authorMemberId: activeManager.id,
        content: guideText.trim(),
      });
      addParentGuidanceFact({
        companionId: guideCompanionId,
        text: guideText.trim(),
        authorName: activeManager.displayName,
      });
      setGuideText("");
      pushToast({
        title: t("familyGuidanceSaved"),
        body: note.authorName,
        tone: "success",
      });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !snapshot) {
    return (
      <section className={cn("rounded-2xl border border-black/10 bg-white p-5 shadow-sm", className)}>
        <p className="text-sm text-neutral-500">{t("loading")}</p>
      </section>
    );
  }

  if (!snapshot?.available) {
    return (
      <section className={cn("rounded-2xl border border-black/10 bg-white p-5 shadow-sm space-y-2", className)}>
        <h3 className="text-base font-semibold tracking-tight text-neutral-900">
          {t("familyHousehold")}
        </h3>
        <p className="text-sm text-neutral-600">{t("familyRequiresPlan")}</p>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "rounded-2xl border border-black/10 bg-white p-5 shadow-sm space-y-5 text-neutral-900",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            {t("familyManagement")}
          </p>
          <h3 className="text-lg font-semibold tracking-tight">
            {snapshot.planName} · {snapshot.seatsUsed}/{snapshot.seatLimit} {t("familySeats")}
          </h3>
          <p className="mt-1 text-sm text-neutral-600">{t("familyHouseholdBody")}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700">
          <UsersRound className="size-3.5" strokeWidth={1.8} />
          {snapshot.seatsUsed} / {snapshot.seatLimit}
          {snapshot.extraSeats > 0 ? ` (+${snapshot.extraSeats})` : ""}
        </div>
      </header>

      {snapshot.usage ? (
        <div className="rounded-xl bg-neutral-50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{t("familyUsageOverview")}</span>
            <strong className="tabular-nums">
              {formatTokens(snapshot.usage.tokensUsed)}
              {snapshot.usage.tokenLimit != null
                ? ` / ${formatTokens(snapshot.usage.tokenLimit)}`
                : ""}
            </strong>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-neutral-200">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                snapshot.usage.overLimit ? "bg-rose-500" : "bg-neutral-900",
              )}
              style={{
                width: `${usagePct == null ? 100 : Math.max(usagePct > 0 ? 4 : 0, usagePct)}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
            <span>
              {t("familyUnallocated")}:{" "}
              <strong className="text-neutral-800">
                {formatTokens(snapshot.usage.unallocatedTokens)}
              </strong>
            </span>
            <span>
              {t("familyUsagePeriod")}: {new Date(snapshot.usage.periodStart).toLocaleDateString()} →{" "}
              {new Date(snapshot.usage.periodEnd).toLocaleDateString()}
            </span>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <ul className="space-y-2.5">
        {snapshot.members.map((member) => {
          const isActive = activeId === member.id || snapshot.activeMemberId === member.id;
          const memberCompanions = liveCompanions(companionState).filter(
            (c) => c.familyMemberId === member.id,
          );
          return (
            <li
              key={member.id}
              className={cn(
                "rounded-xl border px-3 py-3 space-y-2",
                isActive ? "border-neutral-900 bg-neutral-950 text-white" : "border-black/8 bg-white",
                member.isPaused && !isActive && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="grid size-10 place-items-center rounded-full text-white shrink-0"
                  style={{ background: member.color }}
                >
                  <UserRound className="size-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {member.displayName}
                    {member.isOwner ? ` · ${t("familyOwner")}` : ""}
                    {member.isManager && !member.isOwner ? ` · ${t("familyManager")}` : ""}
                  </p>
                  <p className={cn("text-xs", isActive ? "text-white/70" : "text-neutral-500")}>
                    {roleLabel(member.role, t)}
                    {member.ageTier
                      ? ` · ${t(AGE_TIERS.find((a) => a.id === member.ageTier)?.labelKey ?? "familyAge1013")}`
                      : ""}
                    {member.isPaused ? ` · ${t("familyPaused")}` : ""}
                    {memberCompanions.length
                      ? ` · ${memberCompanions.length} ${t("familyCompanionsShort")}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {!isActive ? (
                    <button
                      type="button"
                      className="rounded-full border border-current/20 px-2.5 py-1 text-xs"
                      disabled={busy || member.isPaused}
                      onClick={() => void switchTo(member)}
                    >
                      {t("familySwitch")}
                    </button>
                  ) : (
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs">
                      {t("familyActive")}
                    </span>
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-current/20 px-2.5 py-1 text-xs"
                    disabled={busy}
                    onClick={() => {
                      setGrantTarget(grantTarget === member.id ? null : member.id);
                      setGrantAmount("50000");
                    }}
                  >
                    <Coins className="size-3" strokeWidth={1.8} />
                    {t("familyAssignTokens")}
                  </button>
                  {member.role === "child" ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-current/20 px-2.5 py-1 text-xs"
                      disabled={busy}
                      onClick={() => {
                        setGuideChildId(member.id);
                        const comps = liveCompanions(companionState).filter(
                          (c) => !c.familyMemberId || c.familyMemberId === member.id,
                        );
                        setGuideCompanionId(comps[0]?.id ?? "");
                      }}
                    >
                      <MessageSquareHeart className="size-3" strokeWidth={1.8} />
                      {t("familyGuideCompanion")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-full border border-current/20 px-2.5 py-1 text-xs"
                    disabled={busy}
                    onClick={() =>
                      setAssignTarget(assignTarget === member.id ? null : member.id)
                    }
                  >
                    {t("familyAssignCompanion")}
                  </button>
                  {!member.isOwner ? (
                    <>
                      <button
                        type="button"
                        className="rounded-full border border-current/20 p-1.5"
                        disabled={busy}
                        title={member.isPaused ? t("familyResume") : t("familyPause")}
                        onClick={() => void togglePause(member)}
                      >
                        {member.isPaused ? (
                          <Play className="size-3.5" strokeWidth={1.8} />
                        ) : (
                          <Pause className="size-3.5" strokeWidth={1.8} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-current/20 p-1.5"
                        disabled={busy}
                        title={t("familyRemove")}
                        onClick={() => void removeMember(member)}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.8} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className={cn("space-y-1", isActive ? "text-white/80" : "text-neutral-600")}>
                <div className="flex justify-between text-[11px] tabular-nums">
                  <span>{t("familyMemberUsage")}</span>
                  <span>
                    {formatTokens(member.tokensUsed)} / {formatTokens(member.tokenAllowance)}
                  </span>
                </div>
                <div
                  className={cn(
                    "h-1.5 overflow-hidden rounded-full",
                    isActive ? "bg-white/20" : "bg-neutral-200",
                  )}
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      isActive ? "bg-white" : "bg-neutral-800",
                    )}
                    style={{ width: `${Math.max(member.usagePercent > 0 ? 3 : 0, member.usagePercent)}%` }}
                  />
                </div>
              </div>

              {memberCompanions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {memberCompanions.slice(0, 4).map((c: CompanionProfile) => (
                    <span
                      key={c.id}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        isActive ? "bg-white/15" : "bg-neutral-100 text-neutral-700",
                      )}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {switchTarget === member.id ? (
                <div className="flex w-full items-center gap-2 pt-1">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder={t("familyPinPlaceholder")}
                    value={switchPin}
                    onChange={(e) => setSwitchPin(e.target.value.replace(/\D/g, ""))}
                    className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-neutral-900"
                  />
                  <button
                    type="button"
                    className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white"
                    disabled={busy || switchPin.length < 4}
                    onClick={() => void switchTo(member)}
                  >
                    {t("familyUnlock")}
                  </button>
                  <button type="button" className="text-xs opacity-70" onClick={() => setSwitchTarget(null)}>
                    {t("cancel")}
                  </button>
                </div>
              ) : null}

              {grantTarget === member.id ? (
                <div className="flex w-full flex-wrap items-center gap-2 pt-1">
                  <input
                    inputMode="numeric"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value.replace(/\D/g, ""))}
                    className="w-36 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-neutral-900"
                    placeholder={t("familyTokenAmount")}
                  />
                  <button
                    type="button"
                    className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white"
                    disabled={busy}
                    onClick={() => void grantTokens(member)}
                  >
                    {t("familyGiveTokens")}
                  </button>
                  <button type="button" className="text-xs opacity-70" onClick={() => setGrantTarget(null)}>
                    {t("cancel")}
                  </button>
                </div>
              ) : null}

              {assignTarget === member.id ? (
                <div className="space-y-1.5 pt-1">
                  <p className={cn("text-[11px]", isActive ? "text-white/70" : "text-neutral-500")}>
                    {t("familyAssignCompanionBody")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {liveCompanions(companionState).map((c) => {
                      const assignedHere = c.familyMemberId === member.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px]",
                            assignedHere
                              ? isActive
                                ? "bg-white text-neutral-900"
                                : "bg-neutral-900 text-white"
                              : isActive
                                ? "bg-white/15"
                                : "bg-neutral-100 text-neutral-700",
                          )}
                          onClick={() => {
                            updateCompanion(c.id, {
                              familyMemberId: assignedHere ? null : member.id,
                            });
                            pushToast({
                              title: assignedHere
                                ? t("familyCompanionUnassigned")
                                : t("familyCompanionAssigned"),
                              body: c.name,
                              tone: "success",
                            });
                          }}
                        >
                          {c.name}
                          {assignedHere ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {variant === "full" && guideChildId ? (
        <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{t("familyGuideTitle")}</p>
              <p className="text-xs text-neutral-600">{t("familyGuideBody")}</p>
            </div>
            <button type="button" className="text-xs text-neutral-500" onClick={() => setGuideChildId(null)}>
              {t("cancel")}
            </button>
          </div>
          <select
            value={guideCompanionId}
            onChange={(e) => setGuideCompanionId(e.target.value)}
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          >
            <option value="">{t("familyPickCompanion")}</option>
            {childCompanions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <textarea
            value={guideText}
            onChange={(e) => setGuideText(e.target.value)}
            rows={4}
            placeholder={t("familyGuidePlaceholder")}
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !guideCompanionId || !guideText.trim() || !activeManager}
            onClick={() => void sendGuidance()}
            className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            <MessageSquareHeart className="size-3.5" strokeWidth={1.9} />
            {t("familySendGuidance")}
          </button>
        </div>
      ) : null}

      {variant === "full" && snapshot.recentGuidance.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {t("familyRecentGuidance")}
          </p>
          <ul className="space-y-1.5">
            {snapshot.recentGuidance.slice(0, 5).map((g) => (
              <li key={g.id} className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                <strong>{g.authorName}</strong>
                <span className="text-neutral-400"> · </span>
                {g.content.slice(0, 160)}
                {g.content.length > 160 ? "…" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {variant === "full" ? (
        <div className="space-y-3 rounded-xl border border-dashed border-black/15 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShoppingBag className="size-4" strokeWidth={1.8} />
            {t("familyBuySeats")}
          </div>
          <p className="text-xs text-neutral-500">{t("familyBuySeatsBody")}</p>
          <div className="flex flex-wrap gap-2">
            {snapshot.seatPacks.map((pack) => (
              <button
                key={pack.seats}
                type="button"
                disabled={busy}
                onClick={() => void buySeats(pack.seats)}
                className="rounded-full border border-black/10 bg-neutral-50 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100"
              >
                {pack.label} · {(pack.priceHalalas / 100).toFixed(0)} {t("plansSar")}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={seatCode}
              onChange={(e) => setSeatCode(e.target.value.toUpperCase())}
              placeholder={t("familySeatCode")}
              className="min-w-[10rem] flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy || !seatCode.trim()}
              onClick={() => void buySeats(1)}
              className="rounded-full bg-neutral-900 px-4 py-2 text-xs text-white disabled:opacity-40"
            >
              {t("familyRedeemSeats")}
            </button>
          </div>
        </div>
      ) : null}

      {snapshot.seatsUsed < snapshot.seatLimit ? (
        <div className="space-y-3 rounded-xl border border-dashed border-black/15 p-4">
          <p className="text-sm font-medium">{t("familyAddMember")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("familyNamePlaceholder")}
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as FamilyMemberRole)}
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {roleLabel(option, t)}
                </option>
              ))}
            </select>
            {role === "child" ? (
              <select
                value={ageTier}
                onChange={(e) => setAgeTier(e.target.value as FamilyAgeTier)}
                className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
              >
                {AGE_TIERS.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {t(tier.labelKey)}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder={role === "child" ? t("familyPinRequired") : t("familyPinOptional")}
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={busy || !name.trim() || (role === "child" && pin.length < 4)}
            onClick={() => void addMember()}
            className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            <Plus className="size-3.5" strokeWidth={1.9} />
            {t("familyAddMember")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">{t("familySeatsFull")}</p>
      )}
    </section>
  );
}
