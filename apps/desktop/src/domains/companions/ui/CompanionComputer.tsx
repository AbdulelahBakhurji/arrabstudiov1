import { normalizeBrowserAddress } from "@/shared/lib/safe-url";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DeskJob, DeskPace } from "@arrab/shared";
import { ArrowUpRight, ChevronLeft, FileText, Folder, Maximize2, Minimize2, Users, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { arrabApi } from "@/core/api/api";
import { professionalPresets } from "@/domains/companions/model/professional";
import {
  closeCompanionPage,
  isTauriRuntime,
  openCompanionPage,
  placeCompanionPage,
  runSandboxCommand,
  sandboxDesktop,
  sandboxHandoff,
  sandboxImportFile,
  sandboxReadFile,
  sandboxStoreFiles,
  sandboxWriteFile,
} from "@/core/platform/terminal";

const copy = {
  en: {
    open: "Open",
    screen: "screen",
    files: "Files",
    notes: "Notes",
    terminal: "Terminal",
    browser: "Chrome",
    chrome: "Chrome",
    together: "Together",
    desktop: "Desktop",
    close: "Close",
    back: "Back to desktop",
    sealed: "Sandbox on this Mac",
    newNote: "New note",
    save: "Save",
    saved: "Saved on this desktop.",
    run: "Run",
    release: "Release this line",
    yes: "Yes",
    no: "No",
    empty: "No files yet. Import from the toolbar.",
    mac: "This sandbox runs in Arrab Studio on this Mac.",
    blocked: "ls, echo, pwd, or a file name",
    address: "Address",
    google: "Google",
    store: "Import",
    drop: "Drop files on the desktop",
    stored: "Stored on this desktop.",
    hand: "Share on the desk",
    handed: "Shared with the desk and teammates you picked.",
    handHint: "Notes land on the shared desk and the people you choose.",
    shared: "Shared desk",
    pick: "Who should see it",
    go: "Go",
    finder: "Finder",
    teachTask: "Teach a task",
    teachTitle: "Task name",
    teachSteps: "Steps and rules",
    teachDaily: "Repeat every day",
    teachSave: "Teach this task",
    teachCancel: "Cancel",
    teachSaved: "Task saved. Your companion is on it.",
    teachFailed: "Could not save that task.",
    watching: "is watching and learning",
    recordAgain: "Record again",
    nothingRecorded: "Nothing was recorded. Show the steps on this computer.",
    openedChrome: "Opened Chrome",
    openedFinder: "Opened Finder",
    openedTerminal: "Opened Terminal",
    openedNotes: "Opened Notes",
    openedFile: "Opened",
    savedNote: "Saved note",
    ran: "Ran",
    maximize: "Maximize computer",
    minimize: "Exit full screen",
    agentWait: "Your companion wants to use this computer.",
    agentUsing: "is using this computer",
    takeWheel: "Take control",
    releaseWheel: "Hand back",
    wheelTaken: "You are driving. Companion actions are paused.",
    wheelFailed: "Could not change control.",
    agentApprove: "Allow",
    agentDismiss: "Not now",
    powerOff: "Computer is off",
    powerOffBody: "Turn it on to let this companion use a sealed desktop — Chrome, Finder, Terminal, and Notes. It stays off until you power it or ask them to use it.",
    powerOn: "Turn computer on",
    powerDown: "Turn off",
    signInForComputer: "Sign in to use the companion computer",
    signInForComputerBody: "The sealed Mac sandbox is for signed-in accounts only. Guests stay on chat.",
    activity: "Activity",
    idleDesk: "Desktop ready",
  },
  ar: {
    open: "فتح",
    screen: "الشاشة",
    files: "الملفات",
    notes: "ملاحظات",
    terminal: "الطرفية",
    browser: "كروم",
    chrome: "كروم",
    together: "معاً",
    desktop: "سطح المكتب",
    close: "إغلاق",
    back: "عودة للسطح",
    sealed: "صندوق معزول على هذا الماك",
    newNote: "ملاحظة جديدة",
    save: "حفظ",
    saved: "انحفظ على هذا السطح.",
    run: "تشغيل",
    release: "اعتمد هذا السطر",
    yes: "نعم",
    no: "لا",
    empty: "لا ملفات بعد. استورد من شريط الأدوات.",
    mac: "هذا الصندوق يشتغل داخل أعراب على هذا الماك.",
    blocked: "ls أو echo أو pwd أو اسم ملف",
    address: "العنوان",
    google: "قوقل",
    store: "استورد",
    drop: "أفلت الملفات على السطح",
    stored: "انحفظ على هذا السطح.",
    hand: "شارك على المكتب",
    handed: "وصل للمكتب المشترك ومن اخترته.",
    handHint: "الملاحظات تنزل على المكتب المشترك ومن تختاره.",
    shared: "المكتب المشترك",
    pick: "من يراها",
    go: "اذهب",
    finder: "الملفات",
    teachTask: "علّمه مهمة",
    teachTitle: "اسم المهمة",
    teachSteps: "الخطوات والقواعد",
    teachDaily: "تكرار يومي",
    teachSave: "علّمه هذه المهمة",
    teachCancel: "إلغاء",
    teachSaved: "انحفظت المهمة. رفيقك يشتغل عليها.",
    teachFailed: "ما قدرنا نحفظ المهمة.",
    watching: "يشاهد ويتعلم",
    recordAgain: "سجّل مرة ثانية",
    nothingRecorded: "ما انسجل شيء. نفّذ الخطوات على هذا الكمبيوتر.",
    openedChrome: "فتح كروم",
    openedFinder: "فتح الملفات",
    openedTerminal: "فتح الطرفية",
    openedNotes: "فتح الملاحظات",
    openedFile: "فتح",
    savedNote: "حفظ ملاحظة",
    ran: "شغّل",
    maximize: "تكبير الحاسوب",
    minimize: "خروج من ملء الشاشة",
    agentWait: "رفيقك يبي يستخدم هذا الكمبيوتر.",
    agentUsing: "يستخدم هذا الكمبيوتر",
    takeWheel: "خذ المقود",
    releaseWheel: "أعد التحكم",
    wheelTaken: "أنت تقود. أعمال الرفيق متوقفة.",
    wheelFailed: "تعذر تغيير التحكم.",
    agentApprove: "اسمح",
    agentDismiss: "مو الآن",
    powerOff: "الحاسوب مطفأ",
    powerOffBody: "شغّله ليسمح لهذا الرفيق باستخدام سطح معزول — كروم والملفات والطرفية والملاحظات. يبقى مطفأ حتى تشغّله أو تطلب منه استخدامه.",
    powerOn: "شغّل الحاسوب",
    powerDown: "أطفئ",
    signInForComputer: "سجّل الدخول لاستخدام حاسوب الرفيق",
    signInForComputerBody: "الصندوق المعزول على الماك للحسابات المسجّلة فقط. الضيوف يبقون على المحادثة.",
    activity: "النشاط",
    idleDesk: "السطح جاهز",
  },
} as const;

type DeskCopy = (typeof copy)["en"] | (typeof copy)["ar"];
type DeskFile = { name: string; bytes: number };
type DeskApp = "files" | "notes" | "terminal" | "together" | "browser";

function formatLessonTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function windowTitle(app: DeskApp, text: DeskCopy): string {
  if (app === "browser") return text.browser;
  if (app === "files") return text.finder;
  if (app === "notes") return text.notes;
  if (app === "terminal") return text.terminal;
  return text.together;
}

function ChromeMark({ size = 48 }: { size?: number }) {
  return (
    <svg className="pro-os-chrome-mark" viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#fff" />
      <path fill="#EA4335" d="M24 8c6.2 0 11.7 3 15.1 7.6H24V8z" />
      <path fill="#34A853" d="M39.1 15.6C40.7 18.2 41.6 21 41.6 24s-.9 5.8-2.5 8.4L24 24V15.6h15.1z" />
      <path fill="#FBBC05" d="M24 40c-6.2 0-11.7-3-15.1-7.6L24 24v16z" />
      <path fill="#4285F4" d="M8.9 32.4C7.3 29.8 6.4 27 6.4 24s.9-5.8 2.5-8.4L24 24 8.9 32.4z" />
      <circle cx="24" cy="24" r="9" fill="#fff" />
      <circle cx="24" cy="24" r="6.5" fill="#4285F4" />
    </svg>
  );
}

type DesktopDrive =
  | { kind: "chrome"; url: string }
  | { kind: "files" }
  | { kind: "notes" }
  | { kind: "terminal"; command: string | null }
  | { kind: "shell" };

/** Companion instructions for this sealed desktop: open Chrome, Finder, Notes, or a sandbox command. */
function parseDesktopCommand(raw: string): DesktopDrive {
  const line = raw.trim();
  const lower = line.toLowerCase();
  const url = line.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") ?? null;
  if (
    /^(open\s+)?(chrome|browser)\b/.test(lower) ||
    /^browse\b/.test(lower) ||
    (url !== null && /\b(chrome|browser|google)\b/.test(lower))
  ) {
    return { kind: "chrome", url: url ?? "https://www.google.com" };
  }
  if (/^open\s+(finder|files)\b/.test(lower)) return { kind: "files" };
  if (/^open\s+notes?\b/.test(lower)) return { kind: "notes" };
  if (/^open\s+terminal\b/.test(lower)) {
    const rest = line.replace(/^open\s+terminal\s*/i, "").trim();
    return { kind: "terminal", command: rest || null };
  }
  return { kind: "shell" };
}

function TrafficLights({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <span className="pro-os-lights" role="group" aria-label={label}>
      <button type="button" className="pro-os-light is-red" onClick={onClose} aria-label={label} />
      <button type="button" className="pro-os-light is-yellow" onClick={onClose} aria-hidden tabIndex={-1} />
      <button type="button" className="pro-os-light is-green" aria-hidden tabIndex={-1} />
    </span>
  );
}

export function CompanionComputer({
  companionId,
  listenIds,
  name,
  arabic,
  embedded = false,
  powered = true,
  signedIn = false,
  onPowerOn,
  onPowerOff,
  sandboxJob = null,
  deskPace = "ask",
  onDeskChanged,
  sandboxMaximized = false,
  onToggleSandboxMaximize,
}: {
  companionId: string;
  /** Match chat events on profile id and/or domain. */
  listenIds?: string[];
  name: string;
  arabic: boolean;
  embedded?: boolean;
  /** Sealed OS stays dark until the user powers on or asks the companion. */
  powered?: boolean;
  /** Computer actions require a cloud-signed-in account. */
  signedIn?: boolean;
  onPowerOn?: () => void;
  onPowerOff?: () => void;
  sandboxJob?: DeskJob | null;
  deskPace?: DeskPace;
  onDeskChanged?: () => void;
  sandboxMaximized?: boolean;
  onToggleSandboxMaximize?: () => void;
}) {
  const text = arabic ? copy.ar : copy.en;
  const [open, setOpen] = useState(embedded && powered);
  const [files, setFiles] = useState<DeskFile[]>([]);
  const [shared, setShared] = useState<DeskFile[]>([]);
  const [app, setApp] = useState<DeskApp | null>(null);
  const [noteName, setNoteName] = useState("Notes.txt");
  const [note, setNote] = useState("");
  const [reading, setReading] = useState<{ name: string; text: string } | null>(null);
  const [line, setLine] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState("https://www.google.com");
  const [dropping, setDropping] = useState(false);
  const [pass, setPass] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [teachReview, setTeachReview] = useState(false);
  const [recordSteps, setRecordSteps] = useState<string[]>([]);
  const [recordStarted, setRecordStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [teachBusy, setTeachBusy] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [driving, setDriving] = useState(false);
  const recordingRef = useRef(false);
  const stepsRef = useRef<string[]>([]);
  const pendingDriveRef = useRef<string | null>(null);
  const [agentDismissed, setAgentDismissed] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const browserHostRef = useRef<HTMLDivElement | null>(null);
  const others = professionalPresets().filter((preset) => preset.domain !== companionId);
  const ids = listenIds?.length ? listenIds : [companionId];
  const canOperate = signedIn && powered;
  const visible = (embedded || open) && powered;
  const useTauriBrowser = embedded && isTauriRuntime() && canOperate;
  const agentCommand =
    canOperate &&
    sandboxJob &&
    sandboxJob.status === "needs_you" &&
    sandboxJob.result?.trim() &&
    (sandboxJob.channel === "sandbox" || sandboxJob.channel === "computer") &&
    agentDismissed !== sandboxJob.id
      ? sandboxJob.result.trim()
      : null;

  function pushActivity(entry: string) {
    const stamp = new Date().toLocaleTimeString(arabic ? "ar" : "en", {
      hour: "numeric",
      minute: "2-digit",
    });
    setActivity((current) => [`${stamp} · ${entry}`, ...current].slice(0, 8));
  }

  const syncBrowserFrame = useCallback(() => {
    if (!useTauriBrowser || app !== "browser") return;
    const node = browserHostRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return;
    void placeCompanionPage(companionId, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [app, companionId, useTauriBrowser]);

  useEffect(() => {
    if (embedded && powered) setOpen(true);
    if (!powered) {
      setOpen(false);
      setApp(null);
      setReading(null);
      if (isTauriRuntime()) void closeCompanionPage(companionId);
    }
  }, [embedded, powered, companionId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setReading(null);
    setApp(null);
    setAgentDismissed(null);
    setActivity([]);
    recordingRef.current = false;
    stepsRef.current = [];
    setRecording(false);
    setTeachReview(false);
    setRecordSteps([]);
    setRecordStarted(null);
    if (isTauriRuntime()) void closeCompanionPage(companionId);
  }, [companionId]);

  useEffect(() => {
    if (!recording || recordStarted === null) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - recordStarted), 250);
    return () => window.clearInterval(timer);
  }, [recording, recordStarted]);

  useEffect(() => {
    return () => {
      if (isTauriRuntime()) void closeCompanionPage(companionId);
    };
  }, [companionId]);

  useEffect(() => {
    if (!useTauriBrowser || app !== "browser") return;
    syncBrowserFrame();
    const node = browserHostRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => syncBrowserFrame());
    observer.observe(node);
    window.addEventListener("scroll", syncBrowserFrame, true);
    window.addEventListener("resize", syncBrowserFrame);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", syncBrowserFrame, true);
      window.removeEventListener("resize", syncBrowserFrame);
    };
  }, [app, useTauriBrowser, syncBrowserFrame, sandboxMaximized]);

  async function runApprovedCommand(command: string) {
    if (!canOperate) return;
    const line = command.trim();
    if (!line) return;
    try {
      const gate = await arrabApi.recordProfessionalAction({
        companionId,
        companionName: name,
        tool: "shell",
        action: line,
        initiator: "person",
      });
      if (!gate.allowed) {
        setLog((current) => [
          ...current,
          gate.verdict === "pending"
            ? `${text.release}: ${line}`
            : `refused: ${line}`,
        ]);
        if (gate.verdict === "pending") setPending(line);
        return;
      }
    } catch {
      /* Offline desk still runs locally. */
    }
    setApp("terminal");
    setLog((current) => [...current, `$ ${line}`]);
    pushActivity(`${text.ran}: ${line}`);
    try {
      const ran = await runSandboxCommand(line, companionId);
      const output = [ran.stdout.trim(), ran.stderr.trim()].filter(Boolean).join("\n");
      setLog((current) => [...current, output || `exit ${ran.code}`]);
      void arrabApi
        .appendProfessionalActivity({
          companionId,
          kind: "command",
          title: line,
          output: output || `exit ${ran.code}`,
        })
        .catch(() => undefined);
      await refresh();
    } catch (err) {
      setLog((current) => [...current, err instanceof Error ? err.message : text.mac]);
    }
  }

  useEffect(() => {
    if (!sandboxJob || sandboxJob.status !== "needs_you" || !sandboxJob.result?.trim()) return;
    if (!canOperate) return;
    if (deskPace !== "allow") return;
    if (sandboxJob.channel !== "sandbox" && sandboxJob.channel !== "computer") return;
    let alive = true;
    void (async () => {
      try {
        const released = await arrabApi.approveDeskJob(sandboxJob.id, {
          ...(sandboxJob.resultHash ? { draftHash: sandboxJob.resultHash } : {}),
        });
        if (!alive || released.status !== "done" || !released.result) return;
        if (released.result && (released.channel === "sandbox" || released.channel === "computer")) {
          await drive(released.result);
        }
        onDeskChanged?.();
      } catch {
        /* Person can approve manually. */
      }
    })();
    return () => {
      alive = false;
    };
  }, [sandboxJob?.id, sandboxJob?.status, sandboxJob?.result, sandboxJob?.resultHash, sandboxJob?.channel, deskPace, onDeskChanged, canOperate]);

  useEffect(() => {
    if (!visible || !canOperate || !isTauriRuntime()) return;
    let stop: (() => void) | undefined;
    let alive = true;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") setDropping(true);
        if (event.payload.type === "leave") setDropping(false);
        if (event.payload.type === "drop") {
          setDropping(false);
          void sandboxStoreFiles(companionId, event.payload.paths)
            .then(() => sandboxDesktop(companionId))
            .then((next) => {
              setFiles(next.files ?? []);
              setNotice(text.stored);
              setError(null);
            })
            .catch((err: unknown) => {
              setError(err instanceof Error && err.message ? err.message : text.mac);
            });
        }
      })
      .then((unlisten) => {
        if (!alive) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      stop?.();
      setDropping(false);
    };
  }, [visible, companionId, text.mac, text.stored]);

  async function refresh() {
    if (!canOperate) return;
    if (!isTauriRuntime()) {
      setError(text.mac);
      return;
    }
    try {
      const next = await sandboxDesktop(companionId);
      setFiles(next.files ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.mac);
    }
  }

  async function refreshShared() {
    if (!canOperate || !isTauriRuntime()) return;
    try {
      const next = await sandboxDesktop("shared");
      setShared(next.files ?? []);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.mac);
    }
  }

  useEffect(() => {
    if (!canOperate) return;
    void refresh();
  }, [companionId, canOperate]);

  function closeWindow() {
    if (app === "browser" && isTauriRuntime()) void closeCompanionPage(companionId);
    setApp(null);
    setReading(null);
  }

  async function approveAgentCommand() {
    if (!canOperate || !sandboxJob || !agentCommand) return;
    setError(null);
    try {
      const released = await arrabApi.approveDeskJob(sandboxJob.id, {
        ...(sandboxJob.resultHash ? { draftHash: sandboxJob.resultHash } : {}),
      });
      setAgentDismissed(sandboxJob.id);
      if (released.status === "done" && released.result && (released.channel === "sandbox" || released.channel === "computer")) {
        await drive(released.result);
      }
      onDeskChanged?.();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.teachFailed);
    }
  }

  function noteLesson(step: string) {
    if (!recordingRef.current) return;
    const line = step.trim();
    if (!line) return;
    const last = stepsRef.current[stepsRef.current.length - 1];
    if (last === line) return;
    stepsRef.current = [...stepsRef.current, line];
    setRecordSteps(stepsRef.current);
  }

  function startRecording(append = false) {
    if (!canOperate) {
      if (!signedIn) setError(text.signInForComputer);
      else onPowerOn?.();
      return;
    }
    if (!append) {
      stepsRef.current = [];
      setRecordSteps([]);
    }
    setTeachReview(false);
    setElapsed(0);
    setRecordStarted(Date.now());
    recordingRef.current = true;
    setRecording(true);
    setNotice(null);
    setError(null);
  }

  function stopRecording() {
    recordingRef.current = false;
    setRecording(false);
    setRecordStarted(null);
    if (stepsRef.current.length === 0) {
      setTeachReview(false);
      setNotice(text.nothingRecorded);
      return;
    }
    setTeachReview(true);
  }

  async function saveTeachTask(title: string, steps: string) {
    if (!canOperate) return;
    const nameLine = title.trim();
    const body = steps.trim();
    if (nameLine.length < 2 || body.length < 2) return;
    setTeachBusy(true);
    setError(null);
    try {
      if (isTauriRuntime()) {
        const fileName = `Task — ${nameLine.slice(0, 48)}.md`;
        await sandboxWriteFile(companionId, fileName, `# ${nameLine}\n\n${body}\n`);
      }
      await arrabApi.startDeskJob({
        companionId,
        companionName: name,
        title: nameLine.slice(0, 160),
        brief: body,
        channel: "sandbox",
      });
      stepsRef.current = [];
      setRecordSteps([]);
      setTeachReview(false);
      setNotice(text.teachSaved);
      pushActivity(text.teachSaved);
      onDeskChanged?.();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.teachFailed);
    } finally {
      setTeachBusy(false);
    }
  }

  async function teachFromRecording() {
    const steps = stepsRef.current;
    if (steps.length === 0) return;
    const title = (steps[0] ?? text.teachTask).slice(0, 80);
    const body = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
    await saveTeachTask(title, body);
  }

  async function openFile(owner: string, fileName: string) {
    if (!canOperate) return;
    noteLesson(`${text.openedFile} ${fileName}`);
    pushActivity(`${text.openedFile} ${fileName}`);
    setApp("files");
    if (!/\.(txt|md|csv|json)$/i.test(fileName)) {
      setReading({ name: fileName, text: text.stored });
      return;
    }
    try {
      const loaded = await sandboxReadFile(owner, fileName);
      setReading({ name: fileName, text: loaded.text });
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.mac);
    }
  }

  function normalizeUrl(raw: string): string {
    // Only http(s): `javascript:` / `file:` / `data:` addresses fall back to the start page.
    return normalizeBrowserAddress(raw) ?? "https://www.google.com";
  }

  async function openBrowser(nextUrl?: string) {
    if (!canOperate) return;
    const url = normalizeUrl(nextUrl ?? browserUrl);
    setBrowserUrl(url);
    setReading(null);
    setApp("browser");
    setError(null);
    noteLesson(`${text.openedChrome} — ${url}`);
    pushActivity(`${text.openedChrome} — ${url}`);
    try {
      await openCompanionPage(companionId, url, `${text.chrome} — ${name}`, useTauriBrowser);
      if (useTauriBrowser) {
        requestAnimationFrame(() => {
          syncBrowserFrame();
          window.setTimeout(() => syncBrowserFrame(), 200);
        });
      }
    } catch {
      /* The Chrome window on this desktop still shows the address. */
    }
  }

  async function drive(command: string) {
    if (!signedIn) {
      setError(text.signInForComputer);
      return;
    }
    if (!powered) {
      onPowerOn?.();
      return;
    }
    const action = parseDesktopCommand(command);
    if (action.kind === "chrome") {
      await openBrowser(action.url);
      return;
    }
    if (action.kind === "files") {
      openApp("files");
      return;
    }
    if (action.kind === "notes") {
      await openNotes();
      return;
    }
    if (action.kind === "terminal") {
      setApp("terminal");
      if (action.command) await runApprovedCommand(action.command);
      return;
    }
    await runApprovedCommand(command);
  }

  const driveRef = useRef(drive);
  driveRef.current = drive;
  const onPowerOnRef = useRef(onPowerOn);
  onPowerOnRef.current = onPowerOn;
  useEffect(() => {
    const onDrive = (event: Event) => {
      const detail = (event as CustomEvent<{ companionId?: string; command?: string }>).detail;
      if (!detail?.command) return;
      if (detail.companionId && !ids.includes(detail.companionId)) return;
      if (!signedIn) {
        setError(text.signInForComputer);
        return;
      }
      if (!powered) {
        pendingDriveRef.current = detail.command;
        onPowerOnRef.current?.();
        return;
      }
      void driveRef.current(detail.command);
    };
    window.addEventListener("arrab:companion-computer", onDrive);
    return () => window.removeEventListener("arrab:companion-computer", onDrive);
  }, [ids.join("|"), powered, signedIn, text.signInForComputer]);

  useEffect(() => {
    if (!powered || !signedIn || !pendingDriveRef.current) return;
    const command = pendingDriveRef.current;
    pendingDriveRef.current = null;
    void driveRef.current(command);
  }, [powered, signedIn]);

  async function importFile() {
    if (!canOperate) return;
    setError(null);
    try {
      const result = await sandboxImportFile(companionId);
      if (result.saved) {
        await refresh();
        setNotice(text.stored);
        if (!app) setApp("files");
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.mac);
    }
  }

  async function openNotes() {
    if (!canOperate) return;
    setApp("notes");
    setNotice(null);
    pushActivity(text.openedNotes);
    if (!isTauriRuntime()) return;
    try {
      const loaded = await sandboxReadFile(companionId, noteName);
      setNote(loaded.text);
    } catch {
      setNote("");
    }
  }

  async function saveNote() {
    if (!canOperate) return;
    try {
      await sandboxWriteFile(companionId, noteName, note);
      noteLesson(`${text.savedNote} ${noteName}`);
      pushActivity(`${text.savedNote} ${noteName}`);
      await refresh();
      setNotice(text.saved);
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.mac);
    }
  }

  async function release() {
    if (!canOperate || !pending) return;
    const command = pending;
    setPending(null);
    noteLesson(`${text.ran}: ${command}`);
    setLog((current) => [...current, `$ ${command}`]);
    try {
      const gate = await arrabApi.recordProfessionalAction({
        companionId,
        companionName: name,
        tool: "shell",
        action: command,
        initiator: "person",
      });
      if (!gate.allowed && gate.verdict === "refused") {
        setLog((current) => [...current, `refused: ${command}`]);
        return;
      }
      // Pending → person already approved this exact line by pressing release.
      if (!gate.allowed && gate.verdict === "pending") {
        // Continue — human release is the approval.
      }
      const ran = await runSandboxCommand(command, companionId);
      const output = [ran.stdout.trim(), ran.stderr.trim()].filter(Boolean).join("\n");
      setLog((current) => [...current, output || `exit ${ran.code}`]);
      void arrabApi
        .appendProfessionalActivity({
          companionId,
          kind: "command",
          title: command,
          output: output || `exit ${ran.code}`,
        })
        .catch(() => undefined);
      await refresh();
    } catch (err) {
      setLog((current) => [...current, err instanceof Error ? err.message : text.mac]);
    }
  }

  async function handOff() {
    if (!canOperate) return;
    const body = pass.trim();
    if (body.length < 2 || picked.length === 0) return;
    setError(null);
    try {
      for (const domain of picked) {
        await sandboxHandoff(companionId, domain, body);
      }
      setNotice(text.handed);
      setPass("");
      await refreshShared();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.mac);
    }
  }

  function openApp(next: DeskApp) {
    if (!canOperate) {
      if (!signedIn) setError(text.signInForComputer);
      else onPowerOn?.();
      return;
    }
    if (app === "browser" && next !== "browser" && isTauriRuntime()) void closeCompanionPage(companionId);
    if (next === "browser") {
      void openBrowser();
      return;
    }
    if (next === "files") {
      noteLesson(text.openedFinder);
      pushActivity(text.openedFinder);
    }
    if (next === "terminal") {
      noteLesson(text.openedTerminal);
      pushActivity(text.openedTerminal);
    }
    if (next === "notes") {
      noteLesson(text.openedNotes);
      void openNotes();
      return;
    }
    if (next === "together") {
      setApp("together");
      void refreshShared();
      return;
    }
    setReading(null);
    setApp(next);
  }

  const dock = (
    <div className="pro-os-dock-grok" role="toolbar" aria-label="Apps">
      <button
        type="button"
        className={app === "browser" ? "is-active" : undefined}
        aria-label={text.chrome}
        title={text.chrome}
        onClick={() => openApp("browser")}
      >
        <ChromeMark size={46} />
        <i className="pro-os-dock-dot" />
      </button>
      <button
        type="button"
        className={app === "files" ? "is-active" : undefined}
        aria-label={text.finder}
        title={text.finder}
        onClick={() => openApp("files")}
      >
        <span className="pro-os-folder-mark">
          <Folder size={26} strokeWidth={1.6} />
        </span>
        <i className="pro-os-dock-dot" />
      </button>
      <button
        type="button"
        className={app === "terminal" ? "is-active" : undefined}
        aria-label={text.terminal}
        title={text.terminal}
        onClick={() => openApp("terminal")}
      >
        <span className="pro-os-term-mark">&gt;_</span>
        <i className="pro-os-dock-dot" />
      </button>
      <button
        type="button"
        className={app === "notes" ? "is-active" : undefined}
        aria-label={text.notes}
        title={text.notes}
        onClick={() => openApp("notes")}
      >
        <span className="pro-os-notes-mark">
          <FileText size={24} strokeWidth={1.6} />
        </span>
        <i className="pro-os-dock-dot" />
      </button>
      <button
        type="button"
        className={app === "together" ? "is-active" : undefined}
        aria-label={text.together}
        title={text.together}
        onClick={() => openApp("together")}
      >
        <span className="pro-os-together-mark">
          <Users size={24} strokeWidth={1.6} />
        </span>
        <i className="pro-os-dock-dot" />
      </button>
    </div>
  );

  const appWindow =
    app && app !== "browser" ? (
      <section className="pro-os-window pro-os-window-grok" aria-label={windowTitle(app, text)}>
        <header className="pro-os-win-chrome">
          <TrafficLights label={text.close} onClose={closeWindow} />
          <strong>{windowTitle(app, text)}</strong>
          <span />
        </header>
        {app === "files" ? (
          <div className="pro-os-files pro-os-finder">
            <div className="pro-os-toolbar">
              <button type="button" className="pro-os-back" disabled={!reading} onClick={() => setReading(null)}>
                <ChevronLeft size={16} />
                {text.back}
              </button>
              <button type="button" onClick={() => void importFile()}>
                {text.store}
              </button>
            </div>
            <aside>
              <button type="button" className="is-on">
                <Folder size={14} />
                {text.desktop}
              </button>
              <button type="button" onClick={() => void refreshShared()}>
                <Users size={14} />
                {text.shared}
              </button>
            </aside>
            <div className="pro-os-finder-main">
              {reading ? (
                <>
                  <p className="pro-os-file-name">{reading.name}</p>
                  <pre>{reading.text}</pre>
                </>
              ) : (
                <>
                  {files.map((file) => (
                    <button key={file.name} type="button" onClick={() => void openFile(companionId, file.name)}>
                      <FileText size={16} />
                      {file.name}
                    </button>
                  ))}
                  {shared.map((file) => (
                    <button key={file.name} type="button" onClick={() => void openFile("shared", file.name)}>
                      <FileText size={16} />
                      {file.name}
                    </button>
                  ))}
                  {files.length === 0 && shared.length === 0 ? <p className="pro-os-empty">{text.empty}</p> : null}
                </>
              )}
            </div>
          </div>
        ) : null}
        {app === "notes" ? (
          <form
            className="pro-os-notes"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNote();
            }}
          >
            <input value={noteName} onChange={(event) => setNoteName(event.target.value)} aria-label={text.newNote} />
            <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            <button type="submit">{text.save}</button>
          </form>
        ) : null}
        {app === "terminal" ? (
          <div className="pro-os-term">
            <pre>{log.length ? log.join("\n") : `${name}@sandbox ~ %`}</pre>
            {pending ? (
              <div className="pro-os-release">
                <span>{text.release}</span>
                <code>{pending}</code>
                <button type="button" onClick={() => void release()}>
                  {text.yes}
                </button>
                <button type="button" onClick={() => setPending(null)}>
                  {text.no}
                </button>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = line.trim();
                  if (!next) return;
                  setPending(next);
                  setLine("");
                }}
              >
                <span className="pro-os-prompt">{name}@sandbox ~ %</span>
                <input
                  value={line}
                  onChange={(event) => setLine(event.target.value)}
                  aria-label={text.terminal}
                  placeholder={text.blocked}
                />
                <button type="submit">{text.run}</button>
              </form>
            )}
          </div>
        ) : null}
        {app === "together" ? (
          <form
            className="pro-os-together"
            onSubmit={(event) => {
              event.preventDefault();
              void handOff();
            }}
          >
            <p>{text.handHint}</p>
            <p>{text.pick}</p>
            <div className="pro-os-picks">
              {others.map((preset) => {
                const label = arabic ? preset.nameAr : preset.name;
                const on = picked.includes(preset.domain);
                return (
                  <label key={preset.domain}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setPicked((current) => (on ? current.filter((item) => item !== preset.domain) : [...current, preset.domain]))
                      }
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            <textarea value={pass} onChange={(event) => setPass(event.target.value)} aria-label={text.hand} />
            <button type="submit" disabled={picked.length === 0 || pass.trim().length < 2}>
              {text.hand}
            </button>
          </form>
        ) : null}
      </section>
    ) : null;

  const browserWindow =
    app === "browser" ? (
      <section className="pro-os-window pro-os-window-grok pro-os-window-browser" aria-label={text.browser}>
        <header className="pro-os-win-chrome">
          <TrafficLights label={text.close} onClose={closeWindow} />
          <strong>{text.chrome}</strong>
          <span />
        </header>
        <form
          className="pro-os-browser-bar"
          onSubmit={(event) => {
            event.preventDefault();
            const raw = browserUrl.trim();
            if (raw.length < 3) return;
            void openBrowser(raw);
          }}
        >
          <button type="button" className="pro-os-back" onClick={closeWindow}>
            <ChevronLeft size={16} />
          </button>
          <input value={browserUrl} onChange={(event) => setBrowserUrl(event.target.value)} aria-label={text.address} />
          <button type="submit">{text.go}</button>
        </form>
        <div
          ref={browserHostRef}
          className={useTauriBrowser ? "pro-os-browser-host is-tauri" : "pro-os-browser-host"}
        >
          {!useTauriBrowser ? (
            <iframe
              className="pro-os-browser-frame"
              title={text.browser}
              src={normalizeBrowserAddress(browserUrl) ?? "about:blank"}
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            />
          ) : null}
        </div>
      </section>
    ) : null;

  const shell = !powered || !signedIn ? (
    <div
      className={embedded ? "pro-os pro-os-embedded pro-os-grok is-powered-off" : "pro-os pro-os-grok is-powered-off"}
      role={embedded ? "region" : "dialog"}
      aria-label={`${name} ${text.screen}`}
    >
      <div className="pro-os-power-gate">
        <span className="pro-os-power-orb" aria-hidden />
        <h3>{signedIn ? text.powerOff : text.signInForComputer}</h3>
        <p>{signedIn ? text.powerOffBody : text.signInForComputerBody}</p>
        {signedIn ? (
          <button type="button" className="pro-os-power-btn" onClick={() => onPowerOn?.()}>
            {text.powerOn}
          </button>
        ) : null}
      </div>
    </div>
  ) : (
    <div
      className={embedded ? "pro-os pro-os-embedded pro-os-grok" : "pro-os pro-os-grok"}
      role={embedded ? "region" : "dialog"}
      aria-label={`${name} ${text.screen}`}
    >
      <header className={recording ? "pro-os-grok-bar is-recording" : "pro-os-grok-bar"}>
        {recording ? (
          <>
            <span className="pro-os-watch">
              {name} {text.watching}
            </span>
            <span className="pro-os-grok-spacer" />
            <span className="pro-os-rec-time" aria-live="polite">
              <i />
              {formatLessonTime(elapsed)}
            </span>
            <button type="button" className="pro-os-icon-btn" aria-label={text.close} onClick={stopRecording}>
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            <TrafficLights label={text.close} onClose={() => (embedded ? closeWindow() : setOpen(false))} />
            <span className="pro-os-grok-spacer" />
            <div className="pro-os-grok-actions">
              {embedded && onToggleSandboxMaximize ? (
                <button
                  type="button"
                  className="pro-os-icon-btn"
                  aria-label={sandboxMaximized ? text.minimize : text.maximize}
                  onClick={onToggleSandboxMaximize}
                >
                  {sandboxMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              ) : null}
              <button type="button" className="pro-os-teach" onClick={() => startRecording(false)}>
                {text.teachTask}
              </button>
              <button
                type="button"
                className={driving ? "pro-os-teach is-driving" : "pro-os-teach"}
                disabled={!signedIn}
                onClick={() => {
                  void (async () => {
                    const next = !driving;
                    try {
                      await arrabApi.takeProfessionalControl({
                        companionId,
                        taken: next,
                      });
                      setDriving(next);
                      setNotice(next ? text.wheelTaken : text.releaseWheel);
                    } catch {
                      setError(text.wheelFailed);
                    }
                  })();
                }}
              >
                {driving ? text.releaseWheel : text.takeWheel}
              </button>
              {onPowerOff ? (
                <button type="button" className="pro-os-power-down" onClick={onPowerOff}>
                  {text.powerDown}
                </button>
              ) : null}
            </div>
          </>
        )}
      </header>
      {teachReview && !recording ? (
        <div className="pro-os-teach-review" role="status">
          <span>{recordSteps.length}</span>
          <button type="button" onClick={() => startRecording(true)}>
            {text.recordAgain}
          </button>
          <button type="button" className="is-primary" disabled={teachBusy} onClick={() => void teachFromRecording()}>
            {text.teachSave}
          </button>
          <button type="button" className="is-ghost" aria-label={text.teachCancel} onClick={() => {
            stepsRef.current = [];
            setRecordSteps([]);
            setTeachReview(false);
          }}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      <div className={`pro-os-stage${app ? " has-window" : ""}${recording ? " is-recording" : ""}`}>
        {agentCommand && !app ? (
          <div className="pro-os-agent-bar" role="status">
            <p>
              {text.agentWait}
              <code>{agentCommand}</code>
            </p>
            <button type="button" onClick={() => void approveAgentCommand()}>
              {text.agentApprove}
            </button>
            <button
              type="button"
              className="is-muted"
              onClick={() => sandboxJob && setAgentDismissed(sandboxJob.id)}
            >
              {text.agentDismiss}
            </button>
          </div>
        ) : null}
        <div className="pro-os-menu" aria-hidden>
          <strong>{name}</strong>
          <span>{app === "browser" ? text.chrome : app ? windowTitle(app, text) : text.desktop}</span>
          <time>
            {clock.toLocaleTimeString(arabic ? "ar" : "en", { hour: "numeric", minute: "2-digit" })}
          </time>
        </div>
        <div className="pro-os-desk">
          {notice && !app ? <p className="pro-os-toast">{notice}</p> : null}
          {dropping ? <div className="pro-os-drop">{text.drop}</div> : null}
          {sandboxJob?.status === "running" ? (
            <p className="pro-os-toast">{`${name} ${text.agentUsing}`}</p>
          ) : null}
          {!app ? (
            <>
              <div className="pro-os-desk-icons">
                <button type="button" className="pro-os-desk-icon" onClick={() => openApp("browser")}>
                  <ChromeMark size={52} />
                  <span>{text.chrome}</span>
                </button>
                <button type="button" className="pro-os-desk-icon" onClick={() => openApp("files")}>
                  <span className="pro-os-folder-mark">
                    <Folder size={28} strokeWidth={1.6} />
                  </span>
                  <span>{text.finder}</span>
                </button>
                <button type="button" className="pro-os-desk-icon" onClick={() => openApp("terminal")}>
                  <span className="pro-os-term-mark">&gt;_</span>
                  <span>{text.terminal}</span>
                </button>
                <button type="button" className="pro-os-desk-icon" onClick={() => openApp("notes")}>
                  <span className="pro-os-notes-mark">
                    <FileText size={26} strokeWidth={1.6} />
                  </span>
                  <span>{text.notes}</span>
                </button>
                <button type="button" className="pro-os-desk-icon" onClick={() => openApp("together")}>
                  <span className="pro-os-together-mark">
                    <Users size={26} strokeWidth={1.6} />
                  </span>
                  <span>{text.together}</span>
                </button>
              </div>
              {activity.length > 0 ? (
                <aside className="pro-os-activity" aria-label={text.activity}>
                  <p className="pro-os-activity-title">{text.activity}</p>
                  <ul>
                    {activity.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </aside>
              ) : (
                <p className="pro-os-idle">{text.idleDesk}</p>
              )}
            </>
          ) : null}
        </div>
        {appWindow}
        {browserWindow}
        {dock}
      </div>
      {error ? <p className="pro-error pro-os-foot-error">{error}</p> : null}
    </div>
  );

  if (embedded) return shell;

  return (
    <>
      <button type="button" className="pro-os-preview pro-os-preview-grok" onClick={() => setOpen(true)} aria-label={text.open}>
        <span className="pro-os-wallpaper pro-os-wallpaper-grok" />
        <span className="pro-os-open">
          <ArrowUpRight size={14} />
          {text.open}
        </span>
      </button>
      {open ? createPortal(shell, document.body) : null}
    </>
  );
}
