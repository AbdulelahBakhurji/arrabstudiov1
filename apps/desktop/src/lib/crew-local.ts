import {
  CREW_WRITES_PER_DAY,
  SUBSCRIPTION_PLANS,
  clampCrewLevel,
  crewActionOf,
  crewPacks,
  normalizeCrewState,
  seedCrew,
  type CrewAction,
  type CrewEvent,
  type CrewEventKind,
  type CrewMember,
  type CrewNext,
  type CrewPass,
  type CrewPresence,
  type CrewRuleLevel,
  type CrewState,
  type CrewView,
  type CrewWatch,
  type DeskRepeat,
  type PlanAudience,
  type SubscriptionPlanId,
} from "@arrab/shared";
import { isFamilyChild } from "@/lib/family-session";

const KEY = "arrab.crew.local";

let remoteMissing = false;

export function crewRemoteMissing(): boolean {
  return remoteMissing;
}

export function markCrewRemoteMissing(): void {
  remoteMissing = true;
}

function audience(): PlanAudience {
  const here = `${window.location.pathname}${window.location.hash}`;
  if (here.includes("/organizations")) return "organization";
  try {
    const raw = localStorage.getItem("arrab.account.status.cache");
    const planId = raw
      ? (JSON.parse(raw) as { status?: { account?: { planId?: SubscriptionPlanId } } }).status?.account?.planId
      : undefined;
    if (planId && SUBSCRIPTION_PLANS[planId]) return SUBSCRIPTION_PLANS[planId].audience;
  } catch {
    /* Guest studios stay individual. */
  }
  return "individual";
}

function load(): CrewState {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeCrewState(raw ? (JSON.parse(raw) as Partial<CrewState>) : null);
  } catch {
    return normalizeCrewState(null);
  }
}

function save(state: CrewState): CrewState {
  const next = normalizeCrewState(state);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function riyadh(now = new Date()): { day: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = order.indexOf(read("weekday"));
  return {
    day: `${read("year")}-${read("month")}-${read("day")}`,
    hour: Number(read("hour")),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

function repeatMatches(repeat: DeskRepeat, weekday: number): boolean {
  if (repeat === "friday") return weekday === 5;
  if (repeat === "weekdays") return weekday <= 4;
  return true;
}

function ready(): CrewState {
  const plan = audience();
  let state = load();
  if (state.members.length === 0) {
    state = { ...seedCrew(plan), rules: state.rules };
  }
  const clock = riyadh();
  const watches = state.watches.map((watch) => {
    const due =
      !watch.paused &&
      watch.lastRunDay !== clock.day &&
      clock.hour >= watch.hour &&
      repeatMatches(watch.repeat, clock.weekday);
    return due === watch.due ? watch : { ...watch, due };
  });
  return save({ ...state, watches, writesDay: clock.day, writesToday: state.writesDay === clock.day ? state.writesToday : 0 });
}

function nextOf(state: CrewState): CrewNext | null {
  const clock = riyadh();
  const open = state.watches.filter((watch) => !watch.paused);
  const due = open.find((watch) => watch.due);
  const pick =
    due ??
    open
      .filter((watch) => watch.lastRunDay !== clock.day && watch.hour >= clock.hour && repeatMatches(watch.repeat, clock.weekday))
      .sort((a, b) => a.hour - b.hour)[0];
  if (!pick) return null;
  return {
    id: pick.id,
    memberId: pick.memberId,
    title: pick.title,
    titleAr: pick.titleAr,
    hour: pick.hour,
    when: "today",
  };
}

function view(state: CrewState): CrewView {
  const plan = audience();
  const presence = Object.fromEntries(
    state.members.map((member) => {
      const needs =
        state.passes.some((pass) => pass.status === "open" && pass.toId === member.id) ||
        state.watches.some((watch) => watch.memberId === member.id && watch.due && !watch.paused);
      const status: CrewPresence = member.paused ? "paused" : needs ? "needs_you" : "idle";
      return [member.id, status];
    }),
  );
  const full: CrewView = {
    ...state,
    presence,
    fitted: state.audience === plan,
    writesAllowance: CREW_WRITES_PER_DAY,
    next: nextOf(state),
  };
  if (!isFamilyChild()) return full;
  const members = state.members.filter((member) => member.lane === "study");
  const ids = new Set(members.map((member) => member.id));
  return {
    ...full,
    members,
    watches: state.watches.filter((watch) => ids.has(watch.memberId)),
    passes: state.passes.filter((pass) => ids.has(pass.fromId) || ids.has(pass.toId)),
    events: state.events.filter((event) => event.memberId !== null && ids.has(event.memberId)),
    briefing: null,
    presence: Object.fromEntries(members.map((member) => [member.id, presence[member.id] ?? "idle"])),
  };
}

function trail(state: CrewState, kind: CrewEventKind, text: string, textAr: string, memberId: string | null): CrewState {
  const event: CrewEvent = {
    id: id("evt"),
    kind,
    memberId,
    text,
    textAr: textAr || text,
    createdAt: new Date().toISOString(),
  };
  return { ...state, events: [event, ...state.events].slice(0, 40) };
}

function member(state: CrewState, memberId: string): CrewMember {
  const found = state.members.find((item) => item.id === memberId);
  if (!found) throw new Error("That teammate is not on this crew");
  return found;
}

export const localCrew = {
  get(): CrewView {
    return view(ready());
  },
  setRule(action: CrewAction, level: CrewRuleLevel): CrewView {
    const clamped = clampCrewLevel(action, level);
    if (clamped !== level) throw new Error("That kind of work cannot run on its own");
    const state = ready();
    return view(
      save(
        trail(
          { ...state, rules: state.rules.map((rule) => (rule.action === action ? { ...rule, level } : rule)) },
          "rule",
          `${action}: ${level}`,
          `${action}: ${level}`,
          null,
        ),
      ),
    );
  },
  updateMember(memberId: string, body: { paused?: boolean; customDuty?: string }): CrewView {
    const state = ready();
    member(state, memberId);
    return view(
      save({
        ...state,
        members: state.members.map((item) =>
          item.id === memberId
            ? {
                ...item,
                paused: body.paused ?? item.paused,
                customDuty: body.customDuty !== undefined ? body.customDuty.slice(0, 400) : item.customDuty,
              }
            : item,
        ),
      }),
    );
  },
  addWatch(body: { memberId: string; title: string; steps?: string; hour: number; repeat?: DeskRepeat }): CrewView {
    const state = ready();
    member(state, body.memberId);
    const watch: CrewWatch = {
      id: id("watch"),
      memberId: body.memberId,
      title: body.title.trim().slice(0, 160),
      titleAr: "",
      steps: (body.steps ?? "").trim().slice(0, 800),
      stepsAr: "",
      hour: body.hour,
      repeat: body.repeat ?? "daily",
      paused: false,
      lastRunDay: "",
      due: false,
      lastNote: "",
    };
    return view(save({ ...state, watches: [...state.watches, watch].slice(0, 12) }));
  },
  pauseWatch(watchId: string, paused: boolean): CrewView {
    const state = ready();
    return view(
      save({
        ...state,
        watches: state.watches.map((watch) => (watch.id === watchId ? { ...watch, paused, due: paused ? false : watch.due } : watch)),
      }),
    );
  },
  removeWatch(watchId: string): CrewView {
    const state = ready();
    return view(save({ ...state, watches: state.watches.filter((watch) => watch.id !== watchId) }));
  },
  writeWatch(watchId: string): CrewView {
    const state = ready();
    const watch = state.watches.find((item) => item.id === watchId);
    if (!watch) throw new Error("That routine is gone");
    const owner = member(state, watch.memberId);
    const note = [watch.title, watch.steps || watch.stepsAr, "Nothing was sent."].filter(Boolean).join("\n");
    const day = riyadh().day;
    const research = state.rules.find((rule) => rule.action === "research")?.level ?? "allow";
    const passes = [...state.passes];
    if (research === "handoff") {
      passes.unshift({
        id: id("pass"),
        fromId: owner.id,
        toId: "person",
        title: watch.title,
        note,
        action: "research",
        status: "open",
        createdAt: new Date().toISOString(),
      });
    }
    return view(
      save(
        trail(
          {
            ...state,
            passes: passes.slice(0, 40),
            watches: state.watches.map((item) =>
              item.id === watch.id ? { ...item, lastNote: note, lastRunDay: day, due: false } : item,
            ),
          },
          "note",
          `${owner.name}: ${watch.title}`,
          `${owner.nameAr}: ${watch.titleAr || watch.title}`,
          owner.id,
        ),
      ),
    );
  },
  pass(body: { fromId: string; toId: string; title: string; note?: string }): CrewView {
    const state = ready();
    const from = member(state, body.fromId);
    const toId = body.toId === "person" ? "person" : member(state, body.toId).id;
    const action = crewActionOf(`${body.title}\n${body.note ?? ""}`);
    if (action !== "draft" && action !== "research" && toId !== "person") {
      throw new Error("Money, messages, publishing, and the computer come back to a person");
    }
    const level = state.rules.find((rule) => rule.action === action)?.level ?? "handoff";
    if (level === "block") throw new Error("Your rule blocks this kind of work");
    if (level === "handoff" && toId !== "person") throw new Error("Your rule sends this kind of work back to you");
    const created: CrewPass = {
      id: id("pass"),
      fromId: from.id,
      toId,
      title: body.title.trim().slice(0, 160),
      note: (body.note ?? "").trim().slice(0, 800),
      action,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    return view(save(trail({ ...state, passes: [created, ...state.passes].slice(0, 40) }, "pass", body.title, body.title, from.id)));
  },
  closePass(passId: string): CrewView {
    const state = ready();
    return view(
      save({
        ...state,
        passes: state.passes.map((pass) => (pass.id === passId ? { ...pass, status: "done" } : pass)),
      }),
    );
  },
  briefing(): CrewView {
    const state = ready();
    const lines = state.watches.filter((watch) => watch.lastNote.trim()).map((watch) => `${watch.title}: ${watch.lastNote}`);
    const text = lines.length > 0 ? lines.join("\n") : "Nothing is waiting. Nothing was sent.";
    const day = riyadh().day;
    return view(
      save(
        trail(
          { ...state, briefing: { day, text, createdAt: new Date().toISOString() } },
          "brief",
          "Morning note written",
          "كُتبت ملاحظة الصباح",
          null,
        ),
      ),
    );
  },
  setFocus(body: { title: string; note?: string }): CrewView {
    const state = ready();
    const title = body.title.trim();
    if (title.length < 2) throw new Error("Give the focus a short title");
    return view(
      save(
        trail(
          { ...state, focus: { title, note: (body.note ?? "").trim(), updatedAt: new Date().toISOString() } },
          "focus",
          title,
          title,
          null,
        ),
      ),
    );
  },
  installPack(packId: string): CrewView {
    const state = ready();
    const pack = crewPacks(state.audience).find((item) => item.id === packId) ?? crewPacks(audience()).find((item) => item.id === packId);
    if (!pack) throw new Error("That pack is not for this studio");
    const titles = new Set(state.watches.map((watch) => watch.title));
    const added: CrewWatch[] = [];
    for (const item of pack.watches) {
      if (titles.has(item.title)) continue;
      if (!state.members.some((member) => member.id === item.memberId)) continue;
      added.push({
        id: id("watch"),
        memberId: item.memberId,
        title: item.title,
        titleAr: item.titleAr,
        steps: item.steps,
        stepsAr: item.stepsAr,
        hour: item.hour,
        repeat: item.repeat,
        paused: false,
        lastRunDay: "",
        due: false,
        lastNote: "",
      });
    }
    if (added.length === 0) throw new Error("Those routines are already on the crew");
    return view(save(trail({ ...state, watches: [...state.watches, ...added].slice(0, 12) }, "routine", pack.title, pack.titleAr, null)));
  },
  refit(): CrewView {
    const state = ready();
    const seeded = seedCrew(audience());
    return view(
      save({
        ...seeded,
        rules: state.rules,
        focus: state.focus,
        events: state.events,
      }),
    );
  },
};
