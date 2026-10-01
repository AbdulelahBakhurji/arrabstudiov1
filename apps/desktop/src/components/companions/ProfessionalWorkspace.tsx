import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CompanionDeskView, DeskJob, DeskSchedule } from "@arrab/shared";
import { MessagesSquare, Plus, Search, Trash2, Users, X } from "lucide-react";
import { arrabApi } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { type CompanionPreset } from "@/lib/companion-catalog";
import { purposeLine, tasksForPurpose } from "@/lib/purpose-registry";
import { professionalDuty, professionalPresets, professionalSpec } from "@/lib/professional-companions";
import {
  archiveProfessionalGroup,
  createProfessionalGroup,
  useProfessionalGroups,
  type ProfessionalGroup,
} from "@/lib/professional-groups";
import { relativeTime, removeCompanion, updateCompanion, type CompanionProfile } from "@/lib/companions";
import { PersonAvatar } from "@/components/companions/CompanionUI";
import { CompanionComputer } from "@/components/companions/CompanionComputer";

const copy = {
  en: {
    search: "Search",
    screen: "screen",
    empty: "Nothing is on their screen yet.",
    emptyHint: "A draft waits here until you say yes. Nothing is sent, paid, or run before that.",
    ask: "Draft this",
    working: "Working…",
    routines: "Routines",
    paused: "Paused",
    live: "Live",
    turnOn: "Turn on",
    pause: "Pause",
    resume: "Resume",
    waiting: "Waiting for you",
    approve: "Approve",
    send: "Send",
    run: "Run",
    keep: "Keep",
    release: "Release",
    stop: "Stop",
    tomorrow: "Ask again tomorrow",
    draft: "This yes is only for the draft above.",
    failed: "The desk could not save that.",
    everyDay: "Every day",
    weekdays: "Sunday to Thursday",
    friday: "Friday",
    once: "Once",
    amount: "Amount in SAR",
    pin: "Pin",
    unpin: "Unpin",
    section: "Move to new section",
    sectionPh: "Section name",
    unread: "Mark as unread",
    read: "Mark as read",
    rename: "Rename",
    renamePh: "Name",
    copyId: "Copy conversation ID",
    copied: "Copied",
    hide: "Hide from sidebar",
    delete: "Delete",
    pinned: "Pinned",
    hidden: "Hidden",
    showHidden: "Show hidden",
    details: "Details",
    purpose: "Purpose",
    standing: "Standing duty",
    next: "Next",
    adjust: "Adjust",
    done: "Done",
    mandate: "How they should work",
    saveMandate: "Save",
    scope: "What they cover",
    limits: "Desk limits",
    pace: "Pace",
    paceOpen: "Open",
    paceWait: "Asks",
    paceOff: "Held",
    leftToday: "SAR left today",
    quiet: "Evening hold",
    none: "None",
    never: "Never say",
    lessons: "Corrections they keep",
    connectors: "Tools",
    memory: "Last memory",
    notes: "Added details",
    noteLabel: "Label",
    noteValue: "Detail",
    addNote: "Add",
    removeNote: "Remove",
    record: "Record",
    library: "Library",
    shelf: "On the desk",
    kept: "Kept",
    stoppedWork: "Stopped",
    computer: "Computer",
    addLabel: "Add a label",
    close: "Close",
    openComputer: "Open their folder",
    computerHint: "This is their sealed folder on this Mac. A command runs only after you release that exact line.",
    capabilities: "Capabilities",
    tools: "Tools",
    opsModel: "How they operate",
    quickActions: "Quick actions",
    computerOn: "Computer on",
    computerOff: "Computer off",
    wakeComputer: "Wake computer",
    newItem: "New",
    newCompanion: "New companion",
    newGroup: "New group chat",
    newGroupHint: "Pick at least two companions for a shared desk chat.",
    groupTitle: "Group name",
    groupTitlePh: "e.g. Launch desk",
    groupMembers: "Members",
    createGroup: "Create group",
    groups: "Groups",
    companions: "Companions",
    emptyDesk: "No companions yet",
    emptyDeskHint: "Add a companion or start a group chat from the + button.",
    needCompanionsForGroup: "Create at least two companions before a group chat.",
    deleteGroup: "Delete group",
  },
  ar: {
    search: "بحث",
    screen: "شاشتهم",
    empty: "ما في شيء على شاشتهم بعد.",
    emptyHint: "المسودة تنتظر هنا حتى تقول نعم. ما ينرسل شيء ولا يندفع ولا يشتغل قبلها.",
    ask: "اكتب المسودة",
    working: "يشتغل…",
    routines: "الروتين",
    paused: "متوقف",
    live: "يعمل",
    turnOn: "شغّله",
    pause: "إيقاف",
    resume: "استئناف",
    waiting: "ينتظرك",
    approve: "موافقة",
    send: "إرسال",
    run: "تشغيل",
    keep: "احتفظ",
    release: "اعتماد",
    stop: "إيقاف",
    tomorrow: "اسأل مرة ثانية بكرة",
    draft: "هذه الموافقة لهذه المسودة فقط.",
    failed: "المكتب ما قدر يحفظ ذلك.",
    everyDay: "كل يوم",
    weekdays: "الأحد إلى الخميس",
    friday: "الجمعة",
    once: "مرة",
    amount: "المبلغ بالريال",
    pin: "تثبيت",
    unpin: "إلغاء التثبيت",
    section: "انقل لقسم جديد",
    sectionPh: "اسم القسم",
    unread: "علّم كغير مقروء",
    read: "علّم كمقروء",
    rename: "إعادة تسمية",
    renamePh: "الاسم",
    copyId: "انسخ معرّف المحادثة",
    copied: "تم النسخ",
    hide: "إخفاء من الشريط",
    delete: "حذف",
    pinned: "مثبّت",
    hidden: "مخفي",
    showHidden: "أظهر المخفي",
    details: "التفاصيل",
    purpose: "الغرض",
    standing: "الواجب الثابت",
    next: "التالي",
    adjust: "عدّل",
    done: "تم",
    mandate: "كيف يعمل",
    saveMandate: "حفظ",
    scope: "ما يغطيه",
    limits: "حدود المكتب",
    pace: "الإيقاع",
    paceOpen: "مفتوح",
    paceWait: "يسأل",
    paceOff: "متوقف",
    leftToday: "ريال متبقٍ اليوم",
    quiet: "إيقاف المساء",
    none: "لا شيء",
    never: "لا تقل",
    lessons: "تصحيحات يبقيها",
    connectors: "الأدوات",
    memory: "آخر ذاكرة",
    notes: "تفاصيل مضافة",
    noteLabel: "التسمية",
    noteValue: "التفصيل",
    addNote: "أضف",
    removeNote: "حذف",
    record: "السجل",
    library: "المكتبة",
    shelf: "على المكتب",
    kept: "محفوظ",
    stoppedWork: "أُوقف",
    computer: "الكمبيوتر",
    addLabel: "أضف تسمية",
    close: "إغلاق",
    openComputer: "افتح مجلدهم",
    computerHint: "هذا مجلدهم المعزول على هذا الماك. الأمر يشتغل فقط بعد ما تعتمد نفس السطر.",
    capabilities: "القدرات",
    tools: "الأدوات",
    opsModel: "طريقة العمل",
    quickActions: "إجراءات سريعة",
    computerOn: "الحاسوب يعمل",
    computerOff: "الحاسوب مطفأ",
    wakeComputer: "أيقظ الحاسوب",
    newItem: "جديد",
    newCompanion: "رفيق جديد",
    newGroup: "محادثة جماعية",
    newGroupHint: "اختر رفيقين على الأقل لمحادثة مكتب مشتركة.",
    groupTitle: "اسم المجموعة",
    groupTitlePh: "مثل: مكتب الإطلاق",
    groupMembers: "الأعضاء",
    createGroup: "إنشاء المجموعة",
    groups: "المجموعات",
    companions: "الرفاق",
    emptyDesk: "لا رفاق بعد",
    emptyDeskHint: "أضف رفيقاً أو ابدأ محادثة جماعية من زر +.",
    needCompanionsForGroup: "أنشئ رفيقين على الأقل قبل المحادثة الجماعية.",
    deleteGroup: "حذف المجموعة",
  },
} as const;

function readyDesk(next: CompanionDeskView): CompanionDeskView {
  return {
    ...next,
    lessons: Array.isArray(next.lessons) ? next.lessons : [],
    jobs: Array.isArray(next.jobs) ? next.jobs : [],
    schedules: Array.isArray(next.schedules) ? next.schedules : [],
    messageList: Array.isArray(next.messageList) ? next.messageList : [],
    shopHours: next.shopHours ?? "",
    neverSay: next.neverSay ?? "",
    runsToday: next.runsToday ?? 0,
    runsAllowance: next.runsAllowance ?? 20,
    spentSarToday: next.spentSarToday ?? 0,
    spendCapSar: next.spendCapSar ?? 500,
  };
}

export function useProfessionalDesk(enabled: boolean) {
  const [desk, setDesk] = useState<CompanionDeskView | null>(null);
  async function reload() {
    try {
      setDesk(readyDesk(await arrabApi.companionDesk()));
    } catch {
      /* The chat stays usable when the desk is offline. */
    }
  }
  useEffect(() => {
    if (!enabled) return;
    void reload();
    const id = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return { desk, reload };
}

function latestJob(desk: CompanionDeskView | null, domain: string): DeskJob | null {
  const jobs = (desk?.jobs ?? []).filter((job) => job.companionId === domain);
  return [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function hourLabel(hour: number, arabic: boolean) {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? (arabic ? "ص" : "AM") : arabic ? "م" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${suffix}`;
}

function arrangedLead(title: string, purpose: string): string {
  const colon = purpose.indexOf(":");
  if (colon > 0 && purpose.slice(0, colon).trim().toLowerCase() === title.trim().toLowerCase()) {
    return purpose.slice(colon + 1).trim();
  }
  if (purpose.trim().toLowerCase() === title.trim().toLowerCase()) return "";
  return purpose.trim();
}

function libraryMark(status: DeskJob["status"], text: (typeof copy)[keyof typeof copy]) {
  if (status === "needs_you") return text.waiting;
  if (status === "running") return text.working;
  if (status === "done") return text.kept;
  return text.stoppedWork;
}

function repeatLabel(repeat: DeskSchedule["repeat"], text: (typeof copy)[keyof typeof copy]) {
  if (repeat === "daily") return text.everyDay;
  if (repeat === "friday") return text.friday;
  if (repeat === "once") return text.once;
  return text.weekdays;
}

function needsAmount(job: DeskJob) {
  if (job.channel === "bill") return false;
  return /\b(pay|payment|invoice|transfer|wire)\b|ادفع|فاتورة|حوّل|حول/i.test(`${job.title}\n${job.brief}`);
}

type SideMeta = {
  pinned?: boolean;
  section?: string;
  unread?: boolean;
  hidden?: boolean;
  name?: string;
  label?: string;
};

const SIDE_KEY = "arrab.pro.sidebar";
let sideMap: Record<string, SideMeta> = {};
const sideListeners = new Set<() => void>();

function loadSide() {
  try {
    const raw = localStorage.getItem(SIDE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, SideMeta>) : {};
    sideMap = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    sideMap = {};
  }
}

function emitSide() {
  try {
    localStorage.setItem(SIDE_KEY, JSON.stringify(sideMap));
  } catch {
    /* The menu still works for this session. */
  }
  for (const listener of sideListeners) listener();
}

function patchSide(domain: string, next: Partial<SideMeta>) {
  sideMap = { ...sideMap, [domain]: { ...sideMap[domain], ...next } };
  emitSide();
}

function useSideMap() {
  return useSyncExternalStore(
    (listener) => {
      sideListeners.add(listener);
      return () => sideListeners.delete(listener);
    },
    () => sideMap,
    () => sideMap,
  );
}

export function professionalLabel(domain: string): string {
  return sideMap[domain]?.name?.trim() ?? "";
}

loadSide();

type DetailNote = { id: string; label: string; value: string };
type DossierFile = { mandate: string; notes: DetailNote[] };

const DOSSIER_KEY = "arrab.pro.dossier";
let dossierMap: Record<string, DossierFile> = {};
const dossierListeners = new Set<() => void>();

function emptyDossier(): DossierFile {
  return { mandate: "", notes: [] };
}

function loadDossier() {
  try {
    const raw = localStorage.getItem(DOSSIER_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, DossierFile>) : {};
    dossierMap = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    dossierMap = {};
  }
}

function emitDossier() {
  try {
    localStorage.setItem(DOSSIER_KEY, JSON.stringify(dossierMap));
  } catch {
    /* The drawer still keeps this session. */
  }
  for (const listener of dossierListeners) listener();
}

function dossierFor(id: string): DossierFile {
  const file = dossierMap[id];
  if (!file || typeof file !== "object") return emptyDossier();
  return {
    mandate: typeof file.mandate === "string" ? file.mandate : "",
    notes: Array.isArray(file.notes)
      ? file.notes.filter((note) => note && typeof note.label === "string" && typeof note.value === "string").slice(0, 24)
      : [],
  };
}

function writeDossier(id: string, next: DossierFile) {
  dossierMap = { ...dossierMap, [id]: { mandate: next.mandate.slice(0, 800), notes: next.notes.slice(0, 24) } };
  emitDossier();
}

function useDossier(id: string): DossierFile {
  const map = useSyncExternalStore(
    (listener) => {
      dossierListeners.add(listener);
      return () => dossierListeners.delete(listener);
    },
    () => dossierMap,
    () => dossierMap,
  );
  const file = map[id];
  if (!file) return emptyDossier();
  return dossierFor(id);
}

loadDossier();

export function ProfessionalRoster({
  activeId,
  activeGroupId,
  people,
  desk,
  onOpenCompanion,
  onOpenGroup,
  onCreateCompanion,
  onInspect,
}: {
  activeId: string | null;
  activeGroupId: string | null;
  people: CompanionProfile[];
  desk: CompanionDeskView | null;
  onOpenCompanion: (person: CompanionProfile) => void;
  onOpenGroup: (group: ProfessionalGroup) => void;
  onCreateCompanion: () => void;
  onInspect?: () => void;
}) {
  const { locale } = useLanguage();
  const text = copy[locale];
  const groups = useProfessionalGroups();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ kind: "person" | "group"; id: string; x: number; y: number } | null>(
    null,
  );
  const needle = query.trim().toLowerCase();

  const companions = people.filter((person) => {
    if (!needle) return true;
    return `${person.name} ${person.domain}`.toLowerCase().includes(needle);
  });
  const visibleGroups = groups.filter((group) => {
    if (!needle) return true;
    return group.title.toLowerCase().includes(needle);
  });

  useEffect(() => {
    if (!menu && !createOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setCreateOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, createOpen]);

  function openGroupDialog() {
    setCreateOpen(false);
    if (people.length < 2) {
      onCreateCompanion();
      return;
    }
    setGroupTitle("");
    setPicked(people.slice(0, 2).map((person) => person.id));
    setGroupOpen(true);
  }

  function submitGroup(event: { preventDefault: () => void }) {
    event.preventDefault();
    try {
      const group = createProfessionalGroup({ title: groupTitle, memberIds: picked });
      setGroupOpen(false);
      onOpenGroup(group);
      onInspect?.();
    } catch {
      // need ≥2 members
    }
  }

  return (
    <aside className="pro-roster" aria-label={text.companions}>
      <div className="pro-roster-top">
        <label className="pro-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text.search}
            aria-label={text.search}
          />
        </label>
        <div className="pro-create-wrap">
          <button
            type="button"
            className="pro-create-btn"
            aria-label={text.newItem}
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((open) => !open)}
          >
            <Plus size={18} strokeWidth={2} />
          </button>
          {createOpen ? (
            <div className="pro-create-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setCreateOpen(false);
                  onCreateCompanion();
                }}
              >
                <Plus size={15} />
                {text.newCompanion}
              </button>
              <button type="button" role="menuitem" onClick={openGroupDialog}>
                <Users size={15} />
                {text.newGroup}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pro-roster-list">
        {companions.length === 0 && visibleGroups.length === 0 ? (
          <div className="pro-empty">
            <p className="pro-empty-title">{text.emptyDesk}</p>
            <p className="pro-empty-hint">{text.emptyDeskHint}</p>
            <button type="button" className="pro-empty-add" onClick={() => setCreateOpen(true)}>
              <Plus size={15} />
              {text.newItem}
            </button>
          </div>
        ) : null}

        {companions.length > 0 ? (
          <div className="pro-group">
            <p className="pro-group-title">{text.companions}</p>
            {companions.map((person) => {
              const job = latestJob(desk, person.domain);
              const active = !activeGroupId && activeId === person.id;
              const when = relativeTime(job?.updatedAt ?? person.lastAt ?? null, locale);
              return (
                <button
                  key={person.id}
                  type="button"
                  className={active ? "pro-row is-active" : "pro-row"}
                  aria-pressed={active}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ kind: "person", id: person.id, x: event.clientX, y: event.clientY });
                  }}
                  onClick={() => {
                    onOpenCompanion(person);
                    onInspect?.();
                  }}
                >
                  <PersonAvatar person={person} active={active} size="sm" />
                  <span className="pro-row-copy">
                    <strong>{person.name}</strong>
                  </span>
                  <span className="pro-row-meta">
                    {job?.status === "needs_you" ? <i className="pro-dot" /> : null}
                    {when ? <time>{when}</time> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {visibleGroups.length > 0 ? (
          <div className="pro-group">
            <p className="pro-group-title">{text.groups}</p>
            {visibleGroups.map((group) => {
              const members = group.memberIds
                .map((id) => people.find((person) => person.id === id))
                .filter((person): person is CompanionProfile => Boolean(person));
              const active = activeGroupId === group.id;
              const when = relativeTime(group.lastAt, locale);
              return (
                <button
                  key={group.id}
                  type="button"
                  className={active ? "pro-row is-active is-group" : "pro-row is-group"}
                  aria-pressed={active}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ kind: "group", id: group.id, x: event.clientX, y: event.clientY });
                  }}
                  onClick={() => {
                    onOpenGroup(group);
                    onInspect?.();
                  }}
                >
                  <span className="pro-group-face" aria-hidden>
                    <MessagesSquare size={16} strokeWidth={1.7} />
                  </span>
                  <span className="pro-row-copy">
                    <strong>{group.title}</strong>
                    <small>
                      {members.map((person) => person.name).join(" · ") || `${group.memberIds.length}`}
                    </small>
                  </span>
                  <span className="pro-row-meta">{when ? <time>{when}</time> : null}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {menu
        ? createPortal(
            <>
              <button type="button" className="pro-menu-scrim" aria-label={text.close} onClick={() => setMenu(null)} />
              <div
                className="pro-menu"
                style={{
                  left: Math.min(menu.x, window.innerWidth - 240),
                  top: Math.min(menu.y, window.innerHeight - 160),
                }}
                role="menu"
              >
                {menu.kind === "person" ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      removeCompanion(menu.id);
                      setMenu(null);
                    }}
                  >
                    <Trash2 size={15} />
                    {text.delete}
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      archiveProfessionalGroup(menu.id);
                      setMenu(null);
                    }}
                  >
                    <Trash2 size={15} />
                    {text.deleteGroup}
                  </button>
                )}
              </div>
            </>,
            document.body,
          )
        : null}

      {groupOpen
        ? createPortal(
            <div className="pro-group-modal" role="dialog" aria-modal="true" aria-label={text.newGroup}>
              <button type="button" className="pro-menu-scrim" aria-label={text.close} onClick={() => setGroupOpen(false)} />
              <form className="pro-group-sheet" onSubmit={submitGroup}>
                <header>
                  <h2>{text.newGroup}</h2>
                  <button type="button" aria-label={text.close} onClick={() => setGroupOpen(false)}>
                    <X size={16} />
                  </button>
                </header>
                <p className="pro-group-hint">{text.newGroupHint}</p>
                {people.length < 2 ? <p className="pro-group-hint">{text.needCompanionsForGroup}</p> : null}
                <label className="pro-setting">
                  <span>{text.groupTitle}</span>
                  <input
                    className="pro-dossier-field"
                    value={groupTitle}
                    placeholder={text.groupTitlePh}
                    maxLength={80}
                    onChange={(event) => setGroupTitle(event.target.value)}
                    autoFocus
                  />
                </label>
                <p className="pro-kicker">{text.groupMembers}</p>
                <div className="pro-group-picks">
                  {people.map((person) => {
                    const on = picked.includes(person.id);
                    return (
                      <label key={person.id} className={on ? "is-on" : undefined}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setPicked((current) =>
                              on ? current.filter((id) => id !== person.id) : [...current, person.id],
                            )
                          }
                        />
                        <PersonAvatar person={person} size="sm" />
                        <span>{person.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="pro-edit-row">
                  <button type="button" className="pro-ghost" onClick={() => setGroupOpen(false)}>
                    {text.close}
                  </button>
                  <button type="submit" disabled={picked.length < 2 || groupTitle.trim().length < 1}>
                    {text.createGroup}
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}

export function ProfessionalScreen({
  person,
  desk,
  liveText,
  speaking,
  onChanged,
  onClose,
  sandboxMaximized = false,
  onToggleSandboxMaximize,
  computerPowered = false,
  signedIn = false,
  onPowerComputer,
  onPowerOffComputer,
  onQuickAction,
}: {
  person: CompanionProfile;
  desk: CompanionDeskView | null;
  liveText: string | null;
  speaking: boolean;
  onChanged: () => void;
  onClose: () => void;
  sandboxMaximized?: boolean;
  onToggleSandboxMaximize?: () => void;
  computerPowered?: boolean;
  signedIn?: boolean;
  onPowerComputer?: () => void;
  onPowerOffComputer?: () => void;
  onQuickAction?: (prompt: string, needsComputer?: boolean) => void;
}) {
  const { locale } = useLanguage();
  const text = copy[locale];
  const arabic = locale === "ar";
  const side = useSideMap();
  const preset = professionalPresets().find((item) => item.domain === person.domain) ?? null;
  const duty = preset ? professionalDuty(preset.domain) : null;
  const spec = professionalSpec(person.domain);
  const custom = preset ? side[preset.domain]?.name?.trim() : "";
  const name = custom || (preset ? (arabic ? preset.nameAr : preset.name) : person.name);
  const job = preset ? latestJob(desk, preset.domain) : null;
  const routines = (desk?.schedules ?? []).filter((item) => item.companionId === person.domain);
  const dutyOn = routines.some((item) => !item.paused);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
  }, [person.id]);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.failed);
    } finally {
      setBusy(null);
    }
  }

  async function turnOn(item: CompanionPreset) {
    const itemDuty = professionalDuty(item.domain);
    if (!itemDuty) return;
    await arrabApi.addDeskSchedule({
      companionId: item.domain,
      companionName: arabic ? item.nameAr : item.name,
      title: arabic ? itemDuty.titleAr : itemDuty.title,
      brief: arabic ? itemDuty.briefAr : itemDuty.brief,
      hour: itemDuty.hour,
      repeat: itemDuty.repeat,
    });
  }

  const [tab, setTab] = useState<"details" | "library" | "computer">("details");
  useEffect(() => {
    setTab("details");
  }, [person.id]);
  useEffect(() => {
    if (computerPowered && signedIn) setTab("computer");
  }, [computerPowered, signedIn, person.id]);
  const dossier = useDossier(person.id);
  const [mandate, setMandate] = useState("");
  const [noteLabel, setNoteLabel] = useState("");
  const [noteValue, setNoteValue] = useState("");
  const [adjust, setAdjust] = useState(false);
  const [neverDraft, setNeverDraft] = useState("");
  useEffect(() => {
    setMandate(dossierFor(person.id).mandate);
    setNoteLabel("");
    setNoteValue("");
    setAdjust(false);
    setNeverDraft("");
  }, [person.id]);
  useEffect(() => {
    setNeverDraft(desk?.neverSay ?? "");
  }, [desk?.neverSay]);
  const tasks = tasksForPurpose(person.purposeId || person.domain);
  const purpose = purposeLine(person.purposeId || person.domain, arabic);
  const standing = (arabic ? duty?.briefAr : duty?.brief) || "";
  const dutyTitle = (duty ? (arabic ? duty.titleAr : duty.title) : job?.title) || name;
  const lede = arrangedLead(dutyTitle, purpose);
  const instruction = standing && standing !== lede && standing !== purpose ? standing : "";
  const quiet =
    desk?.quietStartHour != null && desk.quietEndHour != null
      ? `${hourLabel(desk.quietStartHour, arabic)} – ${hourLabel(desk.quietEndHour, arabic)}`
      : "—";
  const paceWord = !desk ? "—" : desk.pace === "allow" ? text.paceOpen : desk.pace === "never" ? text.paceOff : text.paceWait;
  const libraryJobs = [...(desk?.jobs ?? [])]
    .filter((item) => item.companionId === person.domain)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sandboxJob =
    libraryJobs.find(
      (item) =>
        item.status === "needs_you" && (item.channel === "sandbox" || item.channel === "computer"),
    ) ??
    libraryJobs.find(
      (item) =>
        item.status === "running" && (item.channel === "sandbox" || item.channel === "computer"),
    ) ??
    null;
  return (
    <aside
      className={tab === "computer" ? "pro-drawer is-sandbox" : "pro-drawer"}
      aria-label={arabic ? `شاشة ${name}` : `${name}'s ${text.screen}`}
    >
      {tab !== "computer" ? (
        <div className="pro-drawer-bar">
          <button type="button" className="pro-drawer-close" onClick={onClose} aria-label={text.close}>
            <X size={16} />
          </button>
        </div>
      ) : null}
      {tab !== "computer" ? (
        <div className="pro-drawer-id">
          <PersonAvatar person={person} size="lg" state={speaking ? "speaking" : undefined} />
          <h2>{name}</h2>
          <p className="pro-presence">
            <i data-state={speaking ? "live" : dutyOn ? "live" : "paused"} />
            <span>{dutyTitle}</span>
            <span aria-hidden>·</span>
            <span className={dutyOn || speaking ? "is-on" : "is-paused"}>
              {speaking ? text.working : dutyOn ? text.live : text.paused}
            </span>
          </p>
        </div>
      ) : null}
      {tab !== "computer" ? (
        <div className="pro-tabs" role="tablist">
          {(["details", "library", "computer"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              className={tab === item ? "is-on" : ""}
              onClick={() => setTab(item)}
            >
              {text[item]}
            </button>
          ))}
        </div>
      ) : (
        <div className="pro-tabs pro-tabs-minimal" role="tablist">
          <button type="button" role="tab" aria-selected={false} className="pro-tab-ghost" onClick={() => setTab("details")}>
            {text.details}
          </button>
          <button type="button" role="tab" aria-selected={false} className="pro-tab-ghost" onClick={() => setTab("library")}>
            {text.library}
          </button>
          <button type="button" role="tab" aria-selected className="is-on">
            {text.computer}
          </button>
        </div>
      )}

      {tab === "details" ? (
        <div className="pro-tab-body pro-dossier">
          {spec ? (
            <article className="pro-spec-card">
              <p className="pro-kicker">{text.opsModel}</p>
              <strong>{arabic ? spec.taglineAr : spec.tagline}</strong>
              <p>{arabic ? spec.operatingModelAr : spec.operatingModel}</p>
              <div className="pro-chip-row" aria-label={text.capabilities}>
                {spec.capabilities.map((cap) => (
                  <span key={cap.id} className="pro-chip">
                    {arabic ? cap.labelAr : cap.label}
                  </span>
                ))}
              </div>
              <div className="pro-chip-row is-tools" aria-label={text.tools}>
                {spec.tools.map((tool) => (
                  <span key={tool.id} className="pro-chip is-tool">
                    {arabic ? tool.labelAr : tool.label}
                  </span>
                ))}
              </div>
              {spec.quickActions.length > 0 && onQuickAction ? (
                <div className="pro-quick-actions" aria-label={text.quickActions}>
                  <p className="pro-kicker">{text.quickActions}</p>
                  <div className="pro-quick-row">
                    {spec.quickActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="pro-quick-chip"
                        onClick={() =>
                          onQuickAction(
                            arabic ? action.promptAr : action.prompt,
                            Boolean(action.needsComputer),
                          )
                        }
                      >
                        {arabic ? action.labelAr : action.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="pro-computer-status">
                <i data-on={computerPowered && signedIn ? "1" : "0"} />
                <span>
                  {computerPowered && signedIn ? text.computerOn : text.computerOff}
                </span>
                {signedIn && !computerPowered ? (
                  <button
                    type="button"
                    className="pro-ghost"
                    onClick={() => {
                      onPowerComputer?.();
                      setTab("computer");
                    }}
                  >
                    {text.wakeComputer}
                  </button>
                ) : null}
              </div>
            </article>
          ) : null}
          <article className="pro-next">
            <p className="pro-kicker">{text.next}</p>
            <strong>{job?.title || dutyTitle}</strong>
            <p>{job?.brief || instruction || standing || lede}</p>
            {duty ? (
              <p className="pro-when">
                {repeatLabel(duty.repeat, text)} · {hourLabel(duty.hour, arabic)}
              </p>
            ) : null}
          </article>
          <dl className="pro-stats">
            <div className="pro-stat">
              <dt>{text.pace}</dt>
              <dd>{paceWord}</dd>
            </div>
            {desk?.quietStartHour != null && desk.quietEndHour != null ? (
              <div className="pro-stat">
                <dt>{text.quiet}</dt>
                <dd>{quiet}</dd>
              </div>
            ) : null}
            {desk?.neverSay?.trim() ? (
              <div className="pro-stat">
                <dt>{text.never}</dt>
                <dd>{desk.neverSay.trim()}</dd>
              </div>
            ) : null}
          </dl>
          {tasks.length > 0 ? (
            <section className="pro-cover">
              <p className="pro-kicker">{text.scope}</p>
              <ol>
                {tasks.map((task, index) => (
                  <li key={task.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {arabic ? task.titleAr : task.title}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {desk && desk.lessons.length > 0 ? (
            <section className="pro-cover">
              <p className="pro-kicker">{text.lessons}</p>
              <ol>
                {desk.lessons.slice(-4).map((lesson, index) => (
                  <li key={lesson}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {lesson}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {person.lastMemory ? <p className="pro-instruction">{person.lastMemory}</p> : null}
          {!adjust && dossier.notes.length > 0 ? (
            <dl className="pro-stats">
              {dossier.notes.map((note) => (
                <div key={note.id} className="pro-stat pro-stat-note">
                  <dt>{note.label}</dt>
                  <dd>{note.value}</dd>
                  <button
                    type="button"
                    aria-label={text.removeNote}
                    onClick={() =>
                      writeDossier(person.id, {
                        ...dossierFor(person.id),
                        notes: dossierFor(person.id).notes.filter((item) => item.id !== note.id),
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </dl>
          ) : null}
          {!adjust && dossier.mandate.trim() ? <p className="pro-instruction">{dossier.mandate.trim()}</p> : null}
          {adjust ? (
            <section className="pro-settings">
              <header className="pro-settings-bar">
                <p className="pro-kicker">{text.adjust}</p>
                <button type="button" className="pro-ghost" onClick={() => setAdjust(false)}>
                  {text.done}
                </button>
              </header>
              <label className="pro-setting">
                <span>{text.mandate}</span>
                <textarea
                  className="pro-dossier-field"
                  rows={3}
                  value={mandate}
                  maxLength={800}
                  onChange={(event) => setMandate(event.target.value)}
                />
              </label>
              <div className="pro-setting">
                <span>{text.pace}</span>
                <div className="pro-segments" role="group" aria-label={text.pace}>
                  {(
                    [
                      ["ask", text.paceWait],
                      ["allow", text.paceOpen],
                      ["never", text.paceOff],
                    ] as const
                  ).map(([pace, label]) => (
                    <button
                      key={pace}
                      type="button"
                      aria-pressed={(desk?.pace ?? "ask") === pace}
                      disabled={busy !== null}
                      onClick={() => void act("pace", () => arrabApi.setDeskPace(pace).then(() => undefined))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="pro-setting">
                <span>{text.never}</span>
                <input
                  className="pro-dossier-field"
                  value={neverDraft}
                  maxLength={400}
                  onChange={(event) => setNeverDraft(event.target.value)}
                />
              </label>
              {dossier.notes.length > 0 ? (
                <ul className="pro-setting-notes">
                  {dossier.notes.map((note) => (
                    <li key={note.id}>
                      <div>
                        <strong>{note.label}</strong>
                        <span>{note.value}</span>
                      </div>
                      <button
                        type="button"
                        aria-label={text.removeNote}
                        onClick={() =>
                          writeDossier(person.id, {
                            ...dossierFor(person.id),
                            notes: dossierFor(person.id).notes.filter((item) => item.id !== note.id),
                          })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <form
                className="pro-note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const label = noteLabel.trim();
                  const value = noteValue.trim();
                  if (label.length < 1 || value.length < 1) return;
                  const current = dossierFor(person.id);
                  writeDossier(person.id, {
                    ...current,
                    notes: [
                      ...current.notes,
                      { id: `note_${Date.now().toString(36)}`, label: label.slice(0, 80), value: value.slice(0, 400) },
                    ],
                  });
                  setNoteLabel("");
                  setNoteValue("");
                }}
              >
                <input
                  className="pro-dossier-field"
                  value={noteLabel}
                  placeholder={text.noteLabel}
                  aria-label={text.noteLabel}
                  maxLength={80}
                  onChange={(event) => setNoteLabel(event.target.value)}
                />
                <input
                  className="pro-dossier-field"
                  value={noteValue}
                  placeholder={text.noteValue}
                  aria-label={text.noteValue}
                  maxLength={400}
                  onChange={(event) => setNoteValue(event.target.value)}
                />
                <button type="submit" aria-label={text.addNote} disabled={noteLabel.trim().length < 1 || noteValue.trim().length < 1}>
                  <Plus size={14} />
                </button>
              </form>
              <div className="pro-edit-row">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void act("save-settings", async () => {
                      writeDossier(person.id, { ...dossierFor(person.id), mandate: mandate.trim() });
                      await arrabApi.updateDesk({ neverSay: neverDraft.trim() });
                    })
                  }
                >
                  {text.saveMandate}
                </button>
              </div>
            </section>
          ) : (
            <div className="pro-edit-row">
              <button type="button" className="pro-ghost" onClick={() => setAdjust(true)}>
                {text.adjust}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {tab === "library" ? (
        <div className="pro-tab-body pro-library">
          <section className="pro-library-block">
            <p className="pro-kicker">{text.routines}</p>
            {routines.map((item) => (
              <article key={item.id} className="pro-lib-card">
                <div className="pro-lib-top">
                  <strong>{item.title}</strong>
                  <span className={item.paused ? "is-paused" : "is-on"}>{item.paused ? text.paused : text.live}</span>
                </div>
                <p className="pro-when">
                  {repeatLabel(item.repeat, text)} · {hourLabel(item.hour, arabic)}
                </p>
                <div className="pro-edit-row">
                  <button
                    type="button"
                    className="pro-ghost"
                    disabled={busy !== null}
                    onClick={() => void act(item.id, () => arrabApi.pauseDeskSchedule(item.id, !item.paused).then(() => undefined))}
                  >
                    {item.paused ? text.resume : text.pause}
                  </button>
                </div>
              </article>
            ))}
            {preset && duty && !dutyOn ? (
              <article className="pro-next">
                <p className="pro-kicker">{text.next}</p>
                <strong>{arabic ? duty.titleAr : duty.title}</strong>
                <p>{arabic ? duty.briefAr : duty.brief}</p>
                <p className="pro-when">
                  {repeatLabel(duty.repeat, text)} · {hourLabel(duty.hour, arabic)}
                </p>
                <div className="pro-edit-row">
                  <button type="button" disabled={busy !== null} onClick={() => void act("routine", () => turnOn(preset))}>
                    {text.turnOn}
                  </button>
                </div>
              </article>
            ) : null}
          </section>
          <section className="pro-library-block">
            <p className="pro-kicker">
              {text.shelf}
              {libraryJobs.length > 0 ? ` · ${libraryJobs.length}` : ""}
            </p>
            {libraryJobs.length === 0 ? <p className="pro-instruction">{text.emptyHint}</p> : null}
            {libraryJobs.map((item) => (
              <article key={item.id} className="pro-lib-card">
                <div className="pro-lib-top">
                  <strong>{item.title}</strong>
                  <span className={item.status === "needs_you" ? "is-paused" : item.status === "done" ? "is-on" : ""}>
                    {libraryMark(item.status, text)}
                  </span>
                </div>
                <p>{item.result?.split("\n")[0] || item.brief}</p>
                {item.updatedAt ? <p className="pro-when">{relativeTime(item.updatedAt, locale)}</p> : null}
              </article>
            ))}
          </section>
        </div>
      ) : null}

      {tab === "computer" ? (
        <div className="pro-tab-body pro-tab-sandbox">
          <CompanionComputer
            companionId={person.domain}
            listenIds={[person.domain, person.id]}
            name={name}
            arabic={arabic}
            embedded
            powered={computerPowered}
            signedIn={signedIn}
            onPowerOn={onPowerComputer}
            onPowerOff={onPowerOffComputer}
            sandboxJob={sandboxJob}
            deskPace={desk?.pace ?? "ask"}
            onDeskChanged={onChanged}
            sandboxMaximized={sandboxMaximized}
            onToggleSandboxMaximize={onToggleSandboxMaximize}
          />
        </div>
      ) : null}
    </aside>
  );
}
