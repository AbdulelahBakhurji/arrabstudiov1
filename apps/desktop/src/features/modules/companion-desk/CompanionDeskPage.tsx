import { useEffect, useState } from "react";
import type { CompanionDeskView, DeskJob, DeskPace } from "@arrab/shared";
import { arrabApi } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { professionalDuty, professionalPresets } from "@/lib/professional-companions";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { isTauriRuntime, openCompanionSandbox, runLocalCommand, runSandboxCommand } from "@/lib/terminal";

const copy = {
  en: {
    allow: "Allow",
    ask: "Ask",
    never: "Never",
    allowHint: "Ordinary work starts immediately. Paying, sending, and publishing still wait.",
    askHint: "Every job waits until you approve it.",
    neverHint: "The desk will not start new work.",
    title: "What should they finish?",
    details: "Details",
    start: "Leave it on the desk",
    working: "Working…",
    approve: "Approve",
    stop: "Stop",
    revise: "Save correction",
    correction: "What should change next time?",
    empty: "Nothing is on the desk yet.",
    activityWaiting: "Waiting",
    activityWorking: "Working",
    activityDone: "Finished",
    schedule: "On a schedule",
    scheduleHint: "It appears on the desk at the hour you set, Riyadh time. Nothing is sent or run until you say yes.",
    scheduleTitle: "What should it check?",
    scheduleHour: "Hour in Riyadh",
    daily: "Every day",
    weekdays: "Sunday to Thursday",
    friday: "Friday",
    professionals: "Professional companions",
    professionalsHint: "Each one keeps a duty on this desk. It waits for your yes before it sends, pays, or touches the computer.",
    putOnDesk: "Put on the desk",
    onDesk: "On the desk",
    followTomorrow: "Ask again tomorrow",
    lessons: "Corrections they keep",
    runsLeft: "Drafts left today",
    once: "Once",
    addSchedule: "Add to the schedule",
    pauseSchedule: "Pause",
    resumeSchedule: "Resume",
    removeSchedule: "Remove",
    paused: "Paused",
    needs: "Waiting for you",
    running: "Working",
    done: "Ready",
    stopped: "Stopped",
    sensitive: "Needs approval",
    failed: "The desk could not save that.",
    hijri: "Riyadh",
    spent: "Spent today",
    cap: "Daily cap (SAR)",
    quiet: "Evening hold, Riyadh time",
    quietHint: "Set this to your Maghrib if you want the desk quiet after sunset. It is the hour you choose, not a calculated prayer time.",
    from: "From",
    until: "Until",
    saveLimits: "Save limits",
    clearQuiet: "Clear hold",
    kill: "Stop the desk",
    killHint: "Turns work off and stops anything still waiting.",
    draft: "This yes is only for the draft above.",
    amount: "Amount in SAR",
    release: "Release",
    whatsapp: "WhatsApp",
    whatsappHint: "The message leaves only after you release this draft.",
    phone: "Number with country code",
    sent: "Sent",
    send: "Send",
    computer: "This computer",
    computerHint: "One command runs on this Mac after you release that exact line. Wiping the disk stays blocked.",
    computerMac: "This runs in Arrab Studio on this Mac.",
    computerSignedIn: "Sign in to use the companion computer and sandbox.",
    sandbox: "Sandbox",
    sandboxHint: "One command runs in a sealed folder on this Mac after you release that exact line. It cannot read the rest of your files, use the network, or wipe the disk.",
    sandboxMac: "This runs in the sandbox inside Arrab Studio on this Mac.",
    openSandbox: "Open the sandbox folder",
    ranSandbox: "Ran in the sandbox",
    run: "Run",
    ran: "Ran here",
    morning: "This morning",
    morningHint: "The opening note stays here until you approve it. Nothing is sent.",
    writeMorning: "Write the opening note",
    morningTitle: "Morning note",
    leftToday: "SAR left today",
    cameIn: "A message came in and is still unsent.",
    replyIn: "Reply",
    outsideList: "Outside the list",
    cameInLabel: "Came in · not sent",
    bill: "Read a bill",
    billHint: "The photo stays on this Mac. Type the amount you see. Arrab does not pay.",
    billWho: "Who is it for?",
    billAmount: "Amount you read (SAR)",
    billNote: "What you see",
    billPhoto: "Photo on this Mac",
    billKeep: "Keep the reading",
    billUnpaid: "Arrab does not pay this.",
    keep: "Keep",
    readAloud: "Read it",
    shopHours: "Shop hours",
    shopHoursHint: "Write the hours yourself. The desk will not invent them.",
    messageList: "Who may be messaged",
    messageListHint: "Numbers with country code, separated by commas. Empty means the list is not on yet.",
    neverSay: "Never say",
  },
  ar: {
    allow: "اسمح",
    ask: "اسأل",
    never: "لا",
    allowHint: "العمل العادي يبدأ فوراً. الدفع والإرسال والنشر ينتظرون.",
    askHint: "كل عمل ينتظر موافقتك.",
    neverHint: "المكتب لن يبدأ عملاً جديداً.",
    title: "ماذا ينهي؟",
    details: "التفاصيل",
    start: "اتركه على المكتب",
    working: "يعمل…",
    approve: "موافقة",
    stop: "إيقاف",
    revise: "احفظ التصحيح",
    correction: "ماذا يتغير المرة الجاية؟",
    empty: "المكتب فاضي.",
    activityWaiting: "بانتظارك",
    activityWorking: "يعمل",
    activityDone: "انتهى",
    schedule: "على جدول",
    scheduleHint: "يظهر على المكتب في الساعة اللي تحددها بتوقيت الرياض. ما ينرسل شيء ولا يشتغل شيء إلا بعد موافقتك.",
    scheduleTitle: "ماذا يراجع؟",
    scheduleHour: "الساعة بتوقيت الرياض",
    daily: "كل يوم",
    weekdays: "من الأحد إلى الخميس",
    friday: "الجمعة",
    professionals: "الرفاق المهنيون",
    professionalsHint: "كل واحد يحتفظ بواجب على هذا المكتب. ينتظر موافقتك قبل الإرسال أو الدفع أو لمس الجهاز.",
    putOnDesk: "ضعه على المكتب",
    onDesk: "على المكتب",
    followTomorrow: "اسأله بكرة",
    lessons: "تصحيحات يحفظها",
    runsLeft: "مسودات باقية اليوم",
    once: "مرة واحدة",
    addSchedule: "أضفه للجدول",
    pauseSchedule: "إيقاف مؤقت",
    resumeSchedule: "استئناف",
    removeSchedule: "حذف",
    paused: "متوقف مؤقتاً",
    needs: "بانتظارك",
    running: "يعمل",
    done: "جاهز",
    stopped: "متوقف",
    sensitive: "يحتاج موافقة",
    failed: "تعذّر حفظ ذلك على المكتب.",
    hijri: "الرياض",
    spent: "المصروف اليوم",
    cap: "سقف اليوم (ريال)",
    quiet: "إيقاف مسائي بتوقيت الرياض",
    quietHint: "حطه على المغرب إذا تبي المكتب يهدى بعد الغروب. الساعة اللي تختارها أنت، مو حساب وقت صلاة.",
    from: "من",
    until: "إلى",
    saveLimits: "احفظ الحدود",
    clearQuiet: "ألغِ الإيقاف",
    kill: "أوقف المكتب",
    killHint: "يوقف العمل ويوقف أي شيء لسه ينتظر.",
    draft: "هالموافقة لهذي المسودة فقط.",
    amount: "المبلغ بالريال",
    release: "أعتمد",
    whatsapp: "واتساب",
    whatsappHint: "الرسالة ما تطلع إلا بعد ما تعتمد هالمسودة.",
    phone: "الرقم مع مفتاح الدولة",
    sent: "انرسلت",
    send: "أرسل",
    computer: "هذا الجهاز",
    computerHint: "أمر واحد يشتغل على هذا الماك بعد ما تعتمد السطر نفسه. مسح القرص يبقى ممنوع.",
    computerMac: "يشتغل في أعراب على هذا الماك.",
    computerSignedIn: "سجّل الدخول لاستخدام حاسوب الرفيق والصندوق المعزول.",
    sandbox: "صندوق معزول",
    sandboxHint: "أمر واحد يشتغل في مجلد مغلق على هذا الماك بعد ما تعتمد السطر نفسه. ما يقدر يقرأ باقي ملفاتك، ولا يستخدم الشبكة، ولا يمسح القرص.",
    sandboxMac: "يشتغل في الصندوق المعزول داخل أعراب على هذا الماك.",
    openSandbox: "افتح مجلد الصندوق",
    ranSandbox: "اشتغل في الصندوق",
    run: "شغّل",
    ran: "اشتغل هنا",
    morning: "هذا الصباح",
    morningHint: "ملاحظة الافتتاح تبقى هنا لين توافق. ما ينرسل شيء.",
    writeMorning: "اكتب ملاحظة الافتتاح",
    morningTitle: "ملاحظة الصباح",
    leftToday: "ريال باقي اليوم",
    cameIn: "وصلت رسالة ولما تنرسل.",
    replyIn: "رد",
    outsideList: "خارج القائمة",
    cameInLabel: "وصلت · ما انرسلت",
    bill: "اقرأ فاتورة",
    billHint: "الصورة تبقى على هذا الماك. اكتب المبلغ اللي تشوفه. أعراب ما يدفع.",
    billWho: "لمن؟",
    billAmount: "المبلغ اللي قريته (ريال)",
    billNote: "اللي تشوفه",
    billPhoto: "صورة على هذا الماك",
    billKeep: "احفظ القراءة",
    billUnpaid: "أعراب ما يدفع هذي.",
    keep: "احفظ",
    readAloud: "اقرأها",
    shopHours: "ساعات المحل",
    shopHoursHint: "اكتب الساعات بنفسك. المكتب ما يخترعها.",
    messageList: "مين نقدر نراسل",
    messageListHint: "أرقام مع مفتاح الدولة، مفصولة بفاصلة. إذا فاضي، القائمة مو شغالة.",
    neverSay: "لا يقول",
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

function needsAmount(job: DeskJob): boolean {
  if (job.channel === "bill") return false;
  return /\b(pay|payment|invoice|transfer|wire)\b|ادفع|فاتورة|حوّل|حول/i.test(`${job.title}\n${job.brief}`);
}

function chosenProfessional(domain: string, arabic: boolean) {
  const presets = professionalPresets();
  const preset = presets.find((item) => item.domain === domain) ?? presets[0];
  return {
    id: preset?.domain ?? "work",
    name: arabic ? (preset?.nameAr ?? "تركي") : (preset?.name ?? "Turki"),
    blurb: arabic ? (preset?.blurbAr ?? "") : (preset?.blurb ?? ""),
    duty: professionalDuty(preset?.domain ?? "work"),
  };
}

function readAloud(value: string, arabic: boolean) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value.slice(0, 800));
  utterance.lang = arabic ? "ar-SA" : "en-US";
  window.speechSynthesis.speak(utterance);
}

export function CompanionDeskPage({ embedded = false }: { embedded?: boolean }) {
  const { locale, t } = useLanguage();
  const text = copy[locale];
  const { signedIn } = useSignedInAccount();
  const [desk, setDesk] = useState<CompanionDeskView | null>(null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [whatsapp, setWhatsapp] = useState(false);
  const [computer, setComputer] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [phone, setPhone] = useState("");
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [cap, setCap] = useState("500");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [shopHours, setShopHours] = useState("");
  const [messageList, setMessageList] = useState("");
  const [neverSay, setNeverSay] = useState("");
  const [billWho, setBillWho] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billNote, setBillNote] = useState("");
  const [billPhoto, setBillPhoto] = useState<string | null>(null);
  const [schedTitle, setSchedTitle] = useState("");
  const [schedHour, setSchedHour] = useState("8");
  const [schedRepeat, setSchedRepeat] = useState<"daily" | "weekdays" | "friday" | "once">("weekdays");
  const [proDomain, setProDomain] = useState("work");
  const pro = chosenProfessional(proDomain, locale === "ar");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const next = readyDesk(await arrabApi.companionDesk());
    setDesk(next);
    setCap(String(next.spendCapSar));
    setQuietStart(next.quietStartHour == null ? "" : String(next.quietStartHour));
    setQuietEnd(next.quietEndHour == null ? "" : String(next.quietEndHour));
    setShopHours(next.shopHours);
    setMessageList(next.messageList.join(", "));
    setNeverSay(next.neverSay);
  }

  useEffect(() => {
    void reload().catch(() => setError(text.failed));
  }, [locale]);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await run();
      await reload();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : text.failed);
    } finally {
      setBusy(null);
    }
  }

  const paceHint = desk?.pace === "allow" ? text.allowHint : desk?.pace === "never" ? text.neverHint : text.askHint;

  return (
    <div className={embedded ? "min-h-0 flex-1 overflow-auto flex flex-col gap-4" : "cp-ui cp-page flex h-full flex-col gap-4 overflow-auto p-6"}>
      {embedded ? null : (
      <header>
        <p className="cp-eyebrow">ARRAB</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("companionDeskTitle")}</h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--cp-muted)]">{t("companionDeskBody")}</p>
      </header>
      )}

      <div className="flex flex-wrap gap-2">
        {(["allow", "ask", "never"] as DeskPace[]).map((pace) => (
          <button
            key={pace}
            type="button"
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{
              background: desk?.pace === pace ? "var(--cp-text)" : "transparent",
              color: desk?.pace === pace ? "var(--cp-bg)" : "var(--cp-text)",
              border: "1px solid var(--cp-line)",
            }}
            onClick={() => void act("pace", async () => arrabApi.setDeskPace(pace))}
          >
            {text[pace]}
          </button>
        ))}
      </div>
      <p className="text-sm text-[var(--cp-muted)]">{paceHint}</p>
      <section className="grid max-w-xl gap-2 rounded-3xl border border-[var(--cp-line)] p-4">
        <h2 className="font-semibold">{text.morning}</h2>
        <p className="text-sm">
          {text.hijri}
          {desk?.hijriToday ? ` · ${desk.hijriToday}` : ""}
        </p>
        <p className="text-sm">
          {text.shopHours}: {desk?.shopHours || "—"}
        </p>
        <p className="text-sm text-[var(--cp-muted)]">
          {text.spent}: {desk?.spentSarToday ?? 0} / {desk?.spendCapSar ?? 500} · {text.leftToday}:{" "}
          {Math.max(0, (desk?.spendCapSar ?? 0) - (desk?.spentSarToday ?? 0))}
          {" · "}
          {text.runsLeft}: {Math.max(0, (desk?.runsAllowance ?? 20) - (desk?.runsToday ?? 0))}
        </p>
        {(desk?.lessons ?? []).length > 0 ? (
          <div className="grid gap-1 text-sm">
            <p className="font-semibold">{text.lessons}</p>
            {(desk?.lessons ?? []).map((lesson) => (
              <p key={lesson} className="text-[var(--cp-muted)]">
                {lesson}
              </p>
            ))}
          </div>
        ) : null}
        {(desk?.jobs ?? []).some((job) => arrived(job) && job.status === "needs_you") ? (
          <p className="text-sm">{text.cameIn}</p>
        ) : null}
        <p className="text-sm text-[var(--cp-muted)]">{text.morningHint}</p>
        <button
          type="button"
          disabled={busy !== null || desk?.pace === "never"}
          className="w-fit rounded-full bg-[var(--cp-text)] px-4 py-2 text-sm font-semibold text-[var(--cp-bg)] disabled:opacity-40"
          onClick={() =>
            void act("morning", () =>
              arrabApi.startDeskJob({
                title: text.morningTitle,
                brief: desk?.shopHours ? `${text.shopHours}: ${desk.shopHours}` : "",
                companionId: pro.id,
                companionName: pro.name,
              }),
            )
          }
        >
          {busy === "morning" ? text.working : text.writeMorning}
        </button>
      </section>

      <section className="grid max-w-2xl gap-3 rounded-3xl border border-[var(--cp-line)] p-4">
        <h2 className="font-semibold">{text.professionals}</h2>
        <p className="text-sm text-[var(--cp-muted)]">{text.professionalsHint}</p>
        <div className="grid gap-2">
          {professionalPresets().map((preset) => {
            const duty = professionalDuty(preset.domain);
            const name = locale === "ar" ? preset.nameAr : preset.name;
            const onDesk = (desk?.schedules ?? []).some((item) => item.companionId === preset.domain && !item.paused);
            return (
              <div key={preset.domain} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--cp-line)] px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">{name}</p>
                  <p className="text-xs text-[var(--cp-muted)]">{locale === "ar" ? duty?.titleAr : duty?.title}</p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null || onDesk || !duty}
                  className="rounded-full bg-[var(--cp-text)] px-3 py-1.5 text-xs font-semibold text-[var(--cp-bg)] disabled:opacity-40"
                  onClick={() => {
                    if (!duty) return;
                    setProDomain(preset.domain);
                    void act(preset.domain, () =>
                      arrabApi.addDeskSchedule({
                        companionId: preset.domain,
                        companionName: name,
                        title: locale === "ar" ? duty.titleAr : duty.title,
                        brief: locale === "ar" ? duty.briefAr : duty.brief,
                        hour: duty.hour,
                        repeat: duty.repeat,
                      }),
                    );
                  }}
                >
                  {onDesk ? text.onDesk : text.putOnDesk}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <form
        className="grid max-w-xl gap-3 rounded-3xl border border-[var(--cp-line)] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void act("bill", async () => {
            await arrabApi.startDeskJob({
              title: `${text.bill} · ${billWho.trim()}`,
              brief: billNote.trim(),
              companionId: pro.id,
              companionName: pro.name,
              channel: "bill",
              amountSar: Number(billAmount),
            });
            setBillWho("");
            setBillAmount("");
            setBillNote("");
          });
        }}
      >
        <h2 className="font-semibold">{text.bill}</h2>
        <p className="text-sm text-[var(--cp-muted)]">{text.billHint}</p>
        <label className="grid gap-1 text-sm">
          {text.billPhoto}
          <input
            type="file"
            accept="image/*"
            aria-label={text.billPhoto}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setBillPhoto((current) => {
                if (current) URL.revokeObjectURL(current);
                return file ? URL.createObjectURL(file) : null;
              });
            }}
          />
        </label>
        {billPhoto ? <img src={billPhoto} alt="" className="max-h-40 w-fit rounded-2xl" /> : null}
        <input
          className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
          placeholder={text.billWho}
          aria-label={text.billWho}
          value={billWho}
          onChange={(event) => setBillWho(event.target.value)}
        />
        <input
          className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
          inputMode="numeric"
          placeholder={text.billAmount}
          aria-label={text.billAmount}
          value={billAmount}
          onChange={(event) => setBillAmount(event.target.value)}
        />
        <textarea
          className="min-h-20 rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
          placeholder={text.billNote}
          aria-label={text.billNote}
          value={billNote}
          onChange={(event) => setBillNote(event.target.value)}
        />
        <button
          type="submit"
          disabled={busy !== null || billWho.trim().length < 2 || !(Number(billAmount) > 0)}
          className="w-fit rounded-full bg-[var(--cp-text)] px-4 py-2 text-sm font-semibold text-[var(--cp-bg)] disabled:opacity-40"
        >
          {busy === "bill" ? text.working : text.billKeep}
        </button>
      </form>

      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const startHour = quietStart.trim() === "" ? null : Number(quietStart);
          const endHour = quietEnd.trim() === "" ? null : Number(quietEnd);
          void act("limits", () =>
            arrabApi.updateDesk({
              spendCapSar: Number(cap),
              quietStartHour: startHour,
              quietEndHour: endHour,
              shopHours,
              neverSay,
              messageList: messageList
                .split(/[,،\n]/)
                .map((item) => item.trim())
                .filter(Boolean),
            }),
          );
        }}
      >
        <label className="grid gap-1 text-sm">
          {text.cap}
          <input
            className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
            inputMode="numeric"
            value={cap}
            onChange={(event) => setCap(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {text.shopHours}
          <p className="text-[var(--cp-muted)]">{text.shopHoursHint}</p>
          <input
            className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
            value={shopHours}
            onChange={(event) => setShopHours(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {text.messageList}
          <p className="text-[var(--cp-muted)]">{text.messageListHint}</p>
          <input
            className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
            value={messageList}
            onChange={(event) => setMessageList(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {text.neverSay}
          <input
            className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
            value={neverSay}
            onChange={(event) => setNeverSay(event.target.value)}
          />
        </label>
        <div className="grid gap-1 text-sm">
          <span>{text.quiet}</span>
          <p className="text-[var(--cp-muted)]">{text.quietHint}</p>
          <div className="flex gap-2">
            <input
              className="w-24 rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
              inputMode="numeric"
              placeholder={text.from}
              aria-label={text.from}
              value={quietStart}
              onChange={(event) => setQuietStart(event.target.value)}
            />
            <input
              className="w-24 rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
              inputMode="numeric"
              placeholder={text.until}
              aria-label={text.until}
              value={quietEnd}
              onChange={(event) => setQuietEnd(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy !== null}
            className="w-fit rounded-full bg-[var(--cp-text)] px-4 py-2 text-sm font-semibold text-[var(--cp-bg)] disabled:opacity-40"
          >
            {text.saveLimits}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            className="w-fit rounded-full border border-[var(--cp-line)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
            onClick={() => {
              setQuietStart("");
              setQuietEnd("");
              void act("limits", () => arrabApi.updateDesk({ quietStartHour: null, quietEndHour: null }));
            }}
          >
            {text.clearQuiet}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            className="w-fit rounded-full border border-[var(--cp-line)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
            onClick={() => void act("kill", () => arrabApi.killDesk())}
          >
            {text.kill}
          </button>
        </div>
        <p className="text-sm text-[var(--cp-muted)]">{text.killHint}</p>
      </form>

      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void act("start", async () => {
            await arrabApi.startDeskJob({
              title,
              brief,
              companionId: pro.id,
              companionName: pro.name,
              ...(whatsapp ? { channel: "whatsapp" as const, recipient: phone } : {}),
              ...(computer ? { channel: "computer" as const } : {}),
              ...(sandbox ? { channel: "sandbox" as const } : {}),
            });
            setTitle("");
            setBrief("");
            setPhone("");
            setWhatsapp(false);
            setComputer(false);
            setSandbox(false);
          });
        }}
      >
        <input
          className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
          placeholder={text.title}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="min-h-24 rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
          placeholder={text.details}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
        />
        <button
          type="button"
          className="w-fit rounded-full px-4 py-2 text-sm font-semibold"
          style={{
            background: whatsapp ? "var(--cp-text)" : "transparent",
            color: whatsapp ? "var(--cp-bg)" : "var(--cp-text)",
            border: "1px solid var(--cp-line)",
          }}
          onClick={() => {
            setWhatsapp((on) => !on);
            setComputer(false);
            setSandbox(false);
          }}
        >
          {text.whatsapp}
        </button>
        <button
          type="button"
          className="w-fit rounded-full px-4 py-2 text-sm font-semibold"
          style={{
            background: computer ? "var(--cp-text)" : "transparent",
            color: computer ? "var(--cp-bg)" : "var(--cp-text)",
            border: "1px solid var(--cp-line)",
            opacity: signedIn ? 1 : 0.45,
          }}
          disabled={!signedIn}
          title={signedIn ? undefined : text.computerSignedIn}
          onClick={() => {
            if (!signedIn) return;
            setComputer((on) => !on);
            setWhatsapp(false);
            setSandbox(false);
          }}
        >
          {text.computer}
        </button>
        <button
          type="button"
          className="w-fit rounded-full px-4 py-2 text-sm font-semibold"
          style={{
            background: sandbox ? "var(--cp-text)" : "transparent",
            color: sandbox ? "var(--cp-bg)" : "var(--cp-text)",
            border: "1px solid var(--cp-line)",
            opacity: signedIn ? 1 : 0.45,
          }}
          disabled={!signedIn}
          title={signedIn ? undefined : text.computerSignedIn}
          onClick={() => {
            if (!signedIn) return;
            setSandbox((on) => !on);
            setWhatsapp(false);
            setComputer(false);
          }}
        >
          {text.sandbox}
        </button>
        {!signedIn ? <p className="text-sm text-[var(--cp-muted)]">{text.computerSignedIn}</p> : null}
        {computer && signedIn ? <p className="text-sm text-[var(--cp-muted)]">{isTauriRuntime() ? text.computerHint : text.computerMac}</p> : null}
        {sandbox ? (
          <div className="grid gap-2">
            <p className="text-sm text-[var(--cp-muted)]">{isTauriRuntime() ? text.sandboxHint : text.sandboxMac}</p>
            {isTauriRuntime() ? (
              <button
                type="button"
                className="w-fit rounded-full border border-[var(--cp-line)] px-4 py-2 text-sm font-semibold"
                onClick={() => void openCompanionSandbox().catch(() => setError(text.failed))}
              >
                {text.openSandbox}
              </button>
            ) : null}
          </div>
        ) : null}
        {whatsapp ? (
          <>
            <p className="text-sm text-[var(--cp-muted)]">{text.whatsappHint}</p>
            <input
              className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
              inputMode="tel"
              placeholder={text.phone}
              aria-label={text.phone}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </>
        ) : null}
        <button
          type="submit"
          disabled={busy !== null || title.trim().length < 2 || (whatsapp && phone.replace(/\D/g, "").length < 8)}
          className="w-fit rounded-full bg-[var(--cp-text)] px-4 py-2 text-sm font-semibold text-[var(--cp-bg)] disabled:opacity-40"
        >
          {busy === "start" ? text.working : text.start}
        </button>
      </form>

      {error ? <p className="text-sm text-[var(--cp-danger, #b42318)]">{error}</p> : null}

      <form
        className="grid max-w-xl gap-3 rounded-3xl border border-[var(--cp-line)] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void act("schedule", async () => {
            await arrabApi.addDeskSchedule({
              title: schedTitle,
              hour: Number(schedHour),
              repeat: schedRepeat,
              companionId: pro.id,
              companionName: pro.name,
            });
            setSchedTitle("");
          });
        }}
      >
        <h2 className="font-semibold">{text.schedule}</h2>
        <p className="text-sm text-[var(--cp-muted)]">{text.scheduleHint}</p>
        <input
          className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
          placeholder={text.scheduleTitle}
          aria-label={text.scheduleTitle}
          value={schedTitle}
          onChange={(event) => setSchedTitle(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <input
            className="w-24 rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
            inputMode="numeric"
            aria-label={text.scheduleHour}
            value={schedHour}
            onChange={(event) => setSchedHour(event.target.value)}
          />
          <select
            className="rounded-2xl border border-[var(--cp-line)] bg-transparent px-4 py-3"
            aria-label={text.schedule}
            value={schedRepeat}
            onChange={(event) => setSchedRepeat(event.target.value as "daily" | "weekdays" | "friday" | "once")}
          >
            <option value="daily">{text.daily}</option>
            <option value="weekdays">{text.weekdays}</option>
            <option value="friday">{text.friday}</option>
            <option value="once">{text.once}</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={busy !== null || schedTitle.trim().length < 2}
          className="w-fit rounded-full bg-[var(--cp-text)] px-4 py-2 text-sm font-semibold text-[var(--cp-bg)] disabled:opacity-40"
        >
          {busy === "schedule" ? text.working : text.addSchedule}
        </button>
        {(desk?.schedules ?? []).length === 0 ? <p className="text-sm text-[var(--cp-muted)]">{text.empty}</p> : null}
        {(desk?.schedules ?? []).map((duty) => (
          <div key={duty.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {duty.companionName} · {duty.title} · {duty.hour}:00 · {text[duty.repeat]}
              {duty.paused ? ` · ${text.paused}` : ""}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className="rounded-full border border-[var(--cp-line)] px-3 py-1.5 text-xs font-semibold"
                disabled={busy !== null}
                onClick={() => void act(duty.id, () => arrabApi.pauseDeskSchedule(duty.id, !duty.paused))}
              >
                {duty.paused ? text.resumeSchedule : text.pauseSchedule}
              </button>
              <button
                type="button"
                className="rounded-full border border-[var(--cp-line)] px-3 py-1.5 text-xs font-semibold"
                disabled={busy !== null}
                onClick={() => void act(duty.id, () => arrabApi.removeDeskSchedule(duty.id))}
              >
                {text.removeSchedule}
              </button>
            </span>
          </div>
        ))}
      </form>

      <div className="grid max-w-2xl gap-3">
        {(desk?.jobs ?? []).length === 0 ? <p className="text-sm text-[var(--cp-muted)]">{text.empty}</p> : null}
        {(["needs_you", "running", "done", "stopped"] as const).map((status) => {
          const items = (desk?.jobs ?? []).filter((job) => job.status === status);
          if (items.length === 0) return null;
          const heading =
            status === "needs_you" ? text.activityWaiting : status === "running" ? text.activityWorking : status === "done" ? text.activityDone : text.stopped;
          return (
            <section key={status} className="grid gap-3">
              <h2 className="text-sm font-semibold text-[var(--cp-muted)]">{heading}</h2>
              {items.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            arabic={locale === "ar"}
            text={text}
            note={note[job.id] ?? ""}
            amount={amounts[job.id] ?? ""}
            busy={busy === job.id}
            onNote={(value) => setNote((current) => ({ ...current, [job.id]: value }))}
            onAmount={(value) => setAmounts((current) => ({ ...current, [job.id]: value }))}
            output={runs[job.id] ?? ""}
            onApprove={() =>
              void act(job.id, async () => {
                const released = await arrabApi.approveDeskJob(job.id, {
                  ...(job.resultHash ? { draftHash: job.resultHash } : {}),
                  ...(needsAmount(job) && job.resultHash ? { amountSar: Number(amounts[job.id]) } : {}),
                });
                if (released.status === "done" && released.result && isTauriRuntime()) {
                  if (released.channel === "computer") {
                    const ran = await runLocalCommand(released.result);
                    const output = [ran.stdout.trim(), ran.stderr.trim()].filter(Boolean).join("\n").slice(0, 4000);
                    setRuns((current) => ({ ...current, [job.id]: output || `exit ${ran.code}` }));
                  }
                  if (released.channel === "sandbox") {
                    const ran = await runSandboxCommand(released.result);
                    const output = [ran.stdout.trim(), ran.stderr.trim()].filter(Boolean).join("\n").slice(0, 4000);
                    setRuns((current) => ({ ...current, [job.id]: output || `exit ${ran.code}` }));
                  }
                }
              })
            }
            onFollow={() => void act(job.id, () => arrabApi.followUpDeskJob(job.id))}
            onStop={() => void act(job.id, () => arrabApi.stopDeskJob(job.id))}
            onRevise={() =>
              void act(job.id, async () => {
                await arrabApi.reviseDeskJob(job.id, note[job.id] ?? "");
                setNote((current) => ({ ...current, [job.id]: "" }));
              })
            }
          />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function arrived(job: DeskJob): boolean {
  return Boolean(job.sourceId) && !job.sourceId?.startsWith("sched:");
}

function jobTitle(job: DeskJob, text: { [K in keyof (typeof copy)["en"]]: string }): string {
  if (!arrived(job)) return job.title;
  if (job.channel === "whatsapp") return text.replyIn;
  return text.outsideList;
}

function JobCard({
  job,
  arabic,
  text,
  note,
  amount,
  output,
  busy,
  onNote,
  onAmount,
  onApprove,
  onFollow,
  onStop,
  onRevise,
}: {
  job: DeskJob;
  arabic: boolean;
  text: { [K in keyof (typeof copy)["en"]]: string };
  note: string;
  amount: string;
  output: string;
  busy: boolean;
  onNote: (value: string) => void;
  onAmount: (value: string) => void;
  onApprove: () => void;
  onFollow: () => void;
  onStop: () => void;
  onRevise: () => void;
}) {
  const status =
    job.status === "needs_you" ? text.needs : job.status === "running" ? text.running : job.status === "done" ? text.done : text.stopped;
  return (
    <article className="grid gap-2 rounded-3xl border border-[var(--cp-line)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{jobTitle(job, text)}</h2>
          <p className="text-xs text-[var(--cp-muted)]">
            {job.companionName} · {status}
            {arrived(job) ? ` · ${text.cameInLabel}` : ""}
            {job.channel === "whatsapp" && job.recipient ? ` · ${text.whatsapp} ${job.recipient}` : ""}
            {job.channel === "computer" ? ` · ${text.computer}` : ""}
            {job.channel === "sandbox" ? ` · ${text.sandbox}` : ""}
            {job.channel === "bill" ? ` · ${text.billUnpaid}` : ""}
            {job.sentMessageId ? ` · ${text.sent}` : ""}
            {job.sensitive ? ` · ${text.sensitive}` : ""}
          </p>
        </div>
      </div>
      {job.brief ? <p className="text-sm text-[var(--cp-muted)]">{job.brief}</p> : null}
      {job.result ? (
        <p className="whitespace-pre-wrap text-sm">{job.channel === "computer" || job.channel === "sandbox" ? `$ ${job.result}` : job.result}</p>
      ) : null}
      {output ? (
        <p className="whitespace-pre-wrap text-sm text-[var(--cp-muted)]">
          {job.channel === "sandbox" ? text.ranSandbox : text.ran}: {output}
        </p>
      ) : null}
      {job.resultHash && job.status === "needs_you" ? (
        <p className="text-xs text-[var(--cp-muted)]">{job.channel === "bill" ? text.billUnpaid : text.draft}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {job.status === "needs_you" && job.resultHash && needsAmount(job) ? (
          <input
            className="w-32 rounded-full border border-[var(--cp-line)] bg-transparent px-3 py-1.5 text-sm"
            inputMode="numeric"
            placeholder={text.amount}
            aria-label={text.amount}
            value={amount}
            onChange={(event) => onAmount(event.target.value)}
          />
        ) : null}
        {job.status === "needs_you" ? (
          <button
            type="button"
            className="rounded-full bg-[var(--cp-text)] px-3 py-1.5 text-xs font-semibold text-[var(--cp-bg)]"
            disabled={
              busy ||
              (Boolean(job.resultHash) && needsAmount(job) && !(Number(amount) > 0)) ||
              ((job.channel === "computer" || job.channel === "sandbox") && Boolean(job.resultHash) && !isTauriRuntime())
            }
            onClick={onApprove}
          >
            {busy
              ? text.working
              : job.resultHash && job.channel === "whatsapp"
                ? text.send
                : job.resultHash && (job.channel === "computer" || job.channel === "sandbox")
                  ? text.run
                  : job.resultHash && job.channel === "bill"
                    ? text.keep
                    : job.resultHash
                      ? text.release
                      : text.approve}
          </button>
        ) : null}
        {job.result && job.channel !== "computer" && job.channel !== "sandbox" ? (
          <button
            type="button"
            className="rounded-full border border-[var(--cp-line)] px-3 py-1.5 text-xs font-semibold"
            onClick={() => readAloud(job.result ?? "", arabic)}
          >
            {text.readAloud}
          </button>
        ) : null}
        {job.status !== "stopped" ? (
          <button type="button" className="rounded-full border border-[var(--cp-line)] px-3 py-1.5 text-xs font-semibold" disabled={busy} onClick={onFollow}>
            {text.followTomorrow}
          </button>
        ) : null}
        {job.status !== "stopped" && job.status !== "done" ? (
          <button type="button" className="rounded-full border border-[var(--cp-line)] px-3 py-1.5 text-xs font-semibold" disabled={busy} onClick={onStop}>
            {text.stop}
          </button>
        ) : null}
      </div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-full border border-[var(--cp-line)] bg-transparent px-3 py-1.5 text-sm"
          placeholder={text.correction}
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
        <button type="button" className="rounded-full border border-[var(--cp-line)] px-3 py-1.5 text-xs font-semibold" disabled={busy || note.trim().length < 2} onClick={onRevise}>
          {text.revise}
        </button>
      </div>
    </article>
  );
}
