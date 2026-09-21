import { ArrowUpRight, Ellipsis, EyeOff, Maximize2, Minimize2, Plus } from "lucide-react";
import type { Agent } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { companionDisplayBlurb, companionDisplayName } from "@/lib/companion-catalog";
import { isCompanionAgent } from "@/lib/org-chat";
import { isIncognitoUnlocked } from "@/lib/incognito-vault";
import type { CompanionProfile } from "@/lib/companions";
import { PersonAvatar } from "@/components/companions/CompanionUI";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export type OrgChatLane = "companions" | "employees";
export type OrgChatPrivacy = "chat" | "private";

type Props = {
  lane: OrgChatLane;
  privacy: OrgChatPrivacy;
  /** Work-space companion profiles (with faces / connectors). */
  people: CompanionProfile[];
  employees: Agent[];
  activeAgentId: string | null;
  activePersonId: string | null;
  busy?: boolean;
  fullscreen?: boolean;
  onLaneChange: (lane: OrgChatLane) => void;
  onPrivacyChange: (privacy: OrgChatPrivacy) => void;
  onSelectPerson: (personId: string) => void;
  onSelectEmployee: (agentId: string) => void;
  onCreateCompanion: () => void;
  onAddPeople: () => void;
  onOpenAll: () => void;
  onToggleFullscreen: () => void;
};

export function OrgChatTopBar({
  lane,
  privacy,
  people,
  employees,
  activeAgentId,
  activePersonId,
  busy,
  fullscreen,
  onLaneChange,
  onPrivacyChange,
  onSelectPerson,
  onSelectEmployee,
  onCreateCompanion,
  onAddPeople,
  onOpenAll,
  onToggleFullscreen,
}: Props) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const faces = people.filter((person) => person.domain !== "general").slice(0, 5);
  const activePerson =
    people.find((person) => person.id === activePersonId) ??
    people.find((person) => person.agentId === activeAgentId) ??
    faces[0] ??
    null;
  const employeeFaces = employees.slice(0, 5);
  const activeEmployee =
    employees.find((agent) => agent.id === activeAgentId) ?? employeeFaces[0] ?? null;
  const privateOn = privacy === "private";

  if (fullscreen) {
    return null;
  }

  return (
    <div className="org-chat-top shrink-0">
      <header className="cp-chat-heading">
        <div>
          <p className="cp-eyebrow">
            {t("roleLivingOrganization")} / {t("chat")}
          </p>
          <h1>{t("chat")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="cp-segment" role="group" aria-label={t("chat")}>
            <button
              type="button"
              aria-pressed={lane === "companions"}
              disabled={busy}
              onClick={() => {
                onPrivacyChange("chat");
                onLaneChange("companions");
              }}
            >
              {t("chatCompanionsMode")}
            </button>
            <button
              type="button"
              aria-pressed={lane === "employees"}
              disabled={busy}
              onClick={() => {
                onPrivacyChange("chat");
                onLaneChange("employees");
              }}
            >
              {t("chatEmployeesMode")}
            </button>
          </div>
          <button
            type="button"
            className="cp-button"
            onClick={onToggleFullscreen}
            aria-label={t("chatEnterFullscreen")}
            title={t("chatEnterFullscreen")}
          >
            <Maximize2 size={15} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      <div className="cp-face-bar">
        <div
          className="cp-face-list"
          aria-label={lane === "companions" ? t("chatCompanionsMode") : t("chatEmployeesMode")}
        >
          {lane === "companions"
            ? faces.map((person) => {
                const selected = !privateOn && activePerson?.id === person.id;
                return (
                  <button
                    key={person.id}
                    type="button"
                    className="cp-face-choice"
                    disabled={busy}
                    aria-pressed={selected}
                    onClick={() => {
                      onPrivacyChange("chat");
                      onSelectPerson(person.id);
                    }}
                  >
                    <PersonAvatar person={person} active={selected} size="lg" />
                    <strong>{companionDisplayName(person, locale)}</strong>
                    <small>
                      {companionDisplayBlurb(person, locale, t("chatCompanionSolo"))}
                    </small>
                  </button>
                );
              })
            : employeeFaces.map((agent) => {
                const selected = !privateOn && activeEmployee?.id === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className="cp-face-choice"
                    disabled={busy}
                    aria-pressed={selected}
                    onClick={() => {
                      onPrivacyChange("chat");
                      onSelectEmployee(agent.id);
                    }}
                  >
                    <span
                      className={cn(
                        "home-avatar flex size-11 items-center justify-center text-[12px] font-medium",
                        selected && "ring-2 ring-white/35",
                      )}
                    >
                      {initials(agent.name)}
                    </span>
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </button>
                );
              })}

          <button
            type="button"
            className="cp-face-choice"
            disabled={busy}
            aria-pressed={privateOn}
            onClick={() => onPrivacyChange("private")}
            aria-label={t("chatIncognitoMode")}
          >
            <span className={cn("cp-incognito-face cp-incognito-face-lg", privateOn && "is-active")}>
              <EyeOff size={22} strokeWidth={1.5} />
            </span>
            <strong>{t("chatIncognitoMode")}</strong>
            <small>
              {isIncognitoUnlocked()
                ? t("chatIncognitoBadge")
                : ar
                  ? "محمي بكلمة مرور"
                  : "Password protected"}
            </small>
          </button>

          {lane === "companions" ? (
            <button
              type="button"
              className="cp-face-choice"
              disabled={busy}
              onClick={onCreateCompanion}
              aria-label={t("chatCreateCompanion")}
            >
              <span className="cp-add-face">
                <Plus size={21} strokeWidth={1.5} />
              </span>
              <strong>{t("compAdd")}</strong>
              <small>{ar ? "رفيق جديد" : "A new companion"}</small>
            </button>
          ) : null}

          {lane === "employees" && employeeFaces.length === 0 ? (
            <p className="self-center px-2 text-[13px] text-neutral-500">{t("chatNoEmployeesYet")}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {lane === "companions" && !privateOn && activePerson ? (
            <button type="button" className="cp-button" disabled={busy} onClick={onAddPeople}>
              {t("chatAddPeople")}
              <ArrowUpRight size={14} />
            </button>
          ) : null}
          <button type="button" className="cp-button cp-all" disabled={busy} onClick={onOpenAll}>
            <Ellipsis size={19} />
            {lane === "companions"
              ? ar
                ? "كل الرفاق"
                : "All companions"
              : t("chatAllPeople")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrgChatFullscreenExit({
  onExit,
  title,
}: {
  onExit: () => void;
  title: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 px-1 pb-2">
      <p className="truncate text-[14px] text-white">{title}</p>
      <button type="button" className="cp-button" onClick={onExit}>
        <Minimize2 size={15} strokeWidth={1.7} />
        {t("chatExitFullscreen")}
      </button>
    </div>
  );
}
