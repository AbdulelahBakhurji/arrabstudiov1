import type {
  CompanionToneName,
  StudioCatalogEntry,
  StudioPurposeDef,
} from "@/lib/companions";
import {
  claimStudioAdminAccount,
  getCompanionState,
  getStudioAdminAccountId,
  getStudioCatalogEntries,
  getStudioPurposeEntries,
} from "@/lib/companions";
import { resolveOrgSeatCapabilities } from "@/lib/org-seat";
import {
  purposeRegistryById,
  studioSelectablePurposes,
} from "@/lib/purpose-registry";
import { companionPortraitUrl, presetPortraitSeed, allocateStudioCatalogPortrait } from "@/lib/companion-portrait";

/**
 * Built-in Studio-selectable purposes — sourced from the Purpose Registry.
 */
export const STUDIO_PURPOSE_DEFAULTS: StudioPurposeDef[] = studioSelectablePurposes();

/** Built-in Studio companions — used until an admin publishes a shared catalog. */
export const STUDIO_DEFAULTS: StudioCatalogEntry[] = [
  {
    id: "arrab-assistant",
    domain: "arrab-assistant",
    name: "Arrab Assistant",
    nameAr: "مساعد عراب",
    blurb: "Your main agent — PC files, every connector, arrange anything",
    blurbAr: "وكيلك الرئيسي — ملفات الجهاز وكل الموصلات وترتيب أي شيء",
    brief: purposeRegistryById("arrab-assistant")!.brief,
    briefAr: purposeRegistryById("arrab-assistant")!.briefAr,
    toneName: "direct",
    workspace: "arrab-assistant",
    purposeId: "arrab-assistant",
    hue: 258,
    faceSeed: presetPortraitSeed("arrab-assistant"),
    avatarPhoto: companionPortraitUrl({
      seed: presetPortraitSeed("arrab-assistant"),
      name: "Arrab Assistant",
      domain: "arrab-assistant",
    }),
    archivedAt: null,
    createdBy: null,
  },
  {
    id: "web-designer",
    domain: "web-designer",
    name: "Web Designer",
    nameAr: "مصمم ويب",
    blurb: "Sites & pages — live web preview, code, and export",
    blurbAr: "مواقع وصفحات — معاينة ويب حية وكود وتصدير",
    brief: purposeRegistryById("web-design")!.brief,
    briefAr: purposeRegistryById("web-design")!.briefAr,
    toneName: "direct",
    workspace: "ui-designer",
    purposeId: "web-design",
    hue: 268,
    faceSeed: presetPortraitSeed("web-designer"),
    avatarPhoto: companionPortraitUrl({
      seed: presetPortraitSeed("web-designer"),
      name: "Web Designer",
      domain: "web-designer",
    }),
    archivedAt: null,
    createdBy: null,
  },
  {
    id: "phone-designer",
    domain: "phone-designer",
    name: "Phone Designer",
    nameAr: "مصمم جوال",
    blurb: "Mobile screens — phone frame preview and device QR",
    blurbAr: "شاشات جوال — معاينة إطار الهاتف ورمز للجهاز",
    brief: purposeRegistryById("phone-design")!.brief,
    briefAr: purposeRegistryById("phone-design")!.briefAr,
    toneName: "direct",
    workspace: "ui-designer",
    purposeId: "phone-design",
    hue: 336,
    faceSeed: presetPortraitSeed("phone-designer"),
    avatarPhoto: companionPortraitUrl({
      seed: presetPortraitSeed("phone-designer"),
      name: "Phone Designer",
      domain: "phone-designer",
    }),
    archivedAt: null,
    createdBy: null,
  },
  {
    id: "brand",
    domain: "brand",
    name: "Brand",
    nameAr: "الهوية",
    blurb: "Voice, palette, and visual direction",
    blurbAr: "الصوت والألوان والتوجيه البصري",
    brief: purposeRegistryById("brand-identity")!.brief,
    briefAr: purposeRegistryById("brand-identity")!.briefAr,
    toneName: "measured",
    workspace: "default",
    purposeId: "brand-identity",
    hue: 28,
    faceSeed: presetPortraitSeed("brand"),
    avatarPhoto: companionPortraitUrl({
      seed: presetPortraitSeed("brand"),
      name: "Brand",
      domain: "brand",
    }),
    archivedAt: null,
    createdBy: null,
  },
  {
    id: "copywriter",
    domain: "copywriter",
    name: "Copywriter",
    nameAr: "كاتب المحتوى",
    blurb: "Headlines, sections, and microcopy",
    blurbAr: "العناوين والأقسام والنصوص القصيرة",
    brief: purposeRegistryById("copy-ux")!.brief,
    briefAr: purposeRegistryById("copy-ux")!.briefAr,
    toneName: "direct",
    workspace: "default",
    purposeId: "copy-ux",
    hue: 188,
    faceSeed: presetPortraitSeed("copywriter"),
    avatarPhoto: companionPortraitUrl({
      seed: presetPortraitSeed("copywriter"),
      name: "Copywriter",
      domain: "copywriter",
    }),
    archivedAt: null,
    createdBy: null,
  },
];

/** @deprecated use STUDIO_DEFAULTS / resolveStudioCatalog */
export const STUDIO_COMPANIONS = STUDIO_DEFAULTS;

export type StudioCompanionKind = StudioCatalogEntry;

const STUDIO_ACTIVE_KEY = "arrab.studioActive";

/**
 * Built-in + cloud-published purposes. New purposes can be added after publish
 * by writing to companion state.studioPurposes (no app update required).
 * Studio pickers use studioSelectable; full registry covers Chat companions too.
 */
export function resolveStudioPurposes(
  state = getCompanionState(),
): StudioPurposeDef[] {
  const extra = getStudioPurposeEntries(state);
  const map = new Map<string, StudioPurposeDef>();
  for (const purpose of STUDIO_PURPOSE_DEFAULTS) map.set(purpose.id, purpose);
  for (const purpose of extra) {
    const base = purposeRegistryById(purpose.id);
    map.set(purpose.id, {
      ...base,
      ...purpose,
      playbookKey: purpose.playbookKey ?? base?.playbookKey ?? "custom",
      taskTemplates: purpose.taskTemplates?.length
        ? purpose.taskTemplates
        : base?.taskTemplates ?? [],
      studioSelectable: purpose.studioSelectable ?? base?.studioSelectable ?? true,
    });
  }
  return [...map.values()].filter((item) => !item.archivedAt);
}

export function studioPurposeById(
  id: string,
  state = getCompanionState(),
): StudioPurposeDef | undefined {
  return resolveStudioPurposes(state).find((item) => item.id === id);
}

/**
 * Shared catalog: Arrab Assistant always leads. Admin-published entries merge in;
 * built-in defaults fill the rest when nothing is published. Missing built-ins
 * (web / phone designers) are always injected so Studios stays complete.
 */
export function resolveStudioCatalog(
  state = getCompanionState(),
): StudioCatalogEntry[] {
  const assistantDefault = STUDIO_DEFAULTS.find((item) => item.id === "arrab-assistant")!;
  const published = getStudioCatalogEntries(state);
  const base =
    published.length > 0
      ? published
      : STUDIO_DEFAULTS.filter((item) => item.id !== "arrab-assistant");
  const publishedAssistant = base.find(
    (item) =>
      item.id === "arrab-assistant" ||
      item.domain === "arrab-assistant" ||
      item.purposeId === "arrab-assistant",
  );
  const assistant = publishedAssistant
    ? {
        ...publishedAssistant,
        // Always keep the flagship face in sync with the built-in portrait.
        avatarPhoto: publishedAssistant.avatarPhoto?.trim() || assistantDefault.avatarPhoto,
        faceSeed: publishedAssistant.faceSeed || assistantDefault.faceSeed,
        hue: publishedAssistant.hue || assistantDefault.hue,
      }
    : assistantDefault;
  const rest = base.filter(
    (item) =>
      item.id !== "arrab-assistant" &&
      item.domain !== "arrab-assistant" &&
      item.purposeId !== "arrab-assistant",
  );
  const list = [assistant, ...rest];

  for (const builtin of STUDIO_DEFAULTS) {
    if (builtin.id === "arrab-assistant") continue;
    const exists = list.some(
      (item) =>
        item.id === builtin.id ||
        item.domain === builtin.domain ||
        (builtin.purposeId && item.purposeId === builtin.purposeId),
    );
    if (!exists) {
      list.push(builtin);
      continue;
    }
    // Keep built-in faces unique even when a published entry forgot avatarPhoto.
    const index = list.findIndex(
      (item) =>
        item.id === builtin.id ||
        item.domain === builtin.domain ||
        (builtin.purposeId && item.purposeId === builtin.purposeId),
    );
    if (index >= 0 && !list[index]!.avatarPhoto?.trim() && builtin.avatarPhoto) {
      list[index] = {
        ...list[index]!,
        avatarPhoto: builtin.avatarPhoto,
        faceSeed: list[index]!.faceSeed || builtin.faceSeed,
      };
    }
  }

  // Prefer web-designer id over legacy ui-designer when both exist.
  return list.filter((item, index, all) => {
    if (item.id === "ui-designer" || item.domain === "ui-designer") {
      return !all.some((other) => other.id === "web-designer" || other.domain === "web-designer");
    }
    return all.findIndex((other) => other.id === item.id) === index;
  });
}

export function studioKindById(
  id: string,
  state = getCompanionState(),
): StudioCatalogEntry | undefined {
  return resolveStudioCatalog(state).find((item) => item.id === id);
}

/**
 * Studio catalog admin — only the claimed account may add/edit/archive companions.
 * Org employee seats that are not admins never qualify.
 * Until someone claims, nobody is admin yet (call ensureStudioAdminClaim for owners).
 */
export function isStudioAdmin(
  accountId: string | null | undefined,
  state = getCompanionState(),
): boolean {
  if (!accountId) return false;
  const seat = resolveOrgSeatCapabilities();
  if (seat.employee && !seat.canAdminister) return false;
  const claimed = getStudioAdminAccountId(state);
  if (!claimed) return false;
  return claimed === accountId;
}

/**
 * First eligible signed-in owner claims Studio admin once.
 * Org members / non-admins never claim.
 */
export function ensureStudioAdminClaim(accountId: string | null | undefined): void {
  if (!accountId) return;
  const seat = resolveOrgSeatCapabilities();
  if (seat.employee && !seat.canAdminister) return;
  if (getStudioAdminAccountId()) return;
  claimStudioAdminAccount(accountId);
}

export function claimStudioAdmin(accountId: string): void {
  const seat = resolveOrgSeatCapabilities();
  if (seat.employee && !seat.canAdminister) return;
  claimStudioAdminAccount(accountId);
}

export function readStudioActive(): string | null {
  try {
    return localStorage.getItem(STUDIO_ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function writeStudioActive(id: string | null): void {
  if (!id) {
    localStorage.removeItem(STUDIO_ACTIVE_KEY);
    return;
  }
  localStorage.setItem(STUDIO_ACTIVE_KEY, id);
}

/** Match a Chat companion to their Studio catalog entry (by domain). */
export function studioKindForCompanion(
  person: { domain: string } | null | undefined,
  state = getCompanionState(),
): StudioCatalogEntry | null {
  if (!person?.domain || person.domain === "general") return null;
  return resolveStudioCatalog(state).find((entry) => entry.domain === person.domain) ?? null;
}

function studioProjectKey(companionId: string) {
  return `arrab.studioUiProject.${companionId}`;
}

export function readStudioProject(companionId: string): StudioFile[] {
  try {
    const raw = localStorage.getItem(studioProjectKey(companionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StudioFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStudioProject(companionId: string, files: StudioFile[]): void {
  localStorage.setItem(studioProjectKey(companionId), JSON.stringify(files));
}

/** Merge harvested design files into a companion's Studio project. */
export function mergeStudioProject(companionId: string, next: StudioFile[]): StudioFile[] {
  if (!next.length) return readStudioProject(companionId);
  const map = new Map(readStudioProject(companionId).map((file) => [file.path, file]));
  for (const file of next) map.set(file.path, file);
  const merged = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  writeStudioProject(companionId, merged);
  return merged;
}

export function newStudioEntryId(): string {
  return `studio-${crypto.randomUUID().slice(0, 8)}`;
}

export function entryFromPurpose(
  purpose: StudioPurposeDef,
  input: {
    name: string;
    nameAr?: string;
    blurb?: string;
    avatarPhoto?: string | null;
    createdBy?: string | null;
  },
): StudioCatalogEntry {
  const name = input.name.trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-").replace(/^-|-$/g, "") || purpose.id;
  const id = newStudioEntryId();
  const domain = `${purpose.id}-${slug}`.slice(0, 48);
  const state = getCompanionState();
  const taken = [
    ...STUDIO_DEFAULTS.map((entry) => entry.avatarPhoto).filter(Boolean) as string[],
    ...getStudioCatalogEntries(state).map((entry) => entry.avatarPhoto).filter(Boolean) as string[],
    ...state.companions
      .filter((person) => !person.archivedAt)
      .map((person) => person.avatarPhoto)
      .filter(Boolean) as string[],
  ];
  const portrait =
    input.avatarPhoto?.trim()
      ? null
      : allocateStudioCatalogPortrait({
          id,
          domain,
          name: name || purpose.name,
          purposeId: purpose.id,
          taken,
        });
  return {
    id,
    domain,
    name,
    nameAr: (input.nameAr ?? name).trim() || name,
    blurb: (input.blurb ?? purpose.blurb).trim() || purpose.blurb,
    blurbAr: purpose.blurbAr,
    brief: purpose.brief,
    briefAr: purpose.briefAr,
    toneName: purpose.toneName as CompanionToneName,
    workspace: purpose.workspace,
    purposeId: purpose.id,
    hue: purpose.hue,
    faceSeed: portrait?.faceSeed ?? Math.floor(Math.random() * 4096),
    avatarPhoto: input.avatarPhoto ?? portrait?.avatarPhoto ?? null,
    archivedAt: null,
    createdBy: input.createdBy ?? null,
  };
}

export function blankStudioEntry(purposeId = "web-design"): StudioCatalogEntry {
  const purpose = studioPurposeById(purposeId) ?? STUDIO_PURPOSE_DEFAULTS[0]!;
  return entryFromPurpose(purpose, { name: "" });
}

export type StudioFile = {
  path: string;
  content: string;
};

/** Fresh Studio session — no files until the companion (or user) creates them. */
export function emptyUiProject(): StudioFile[] {
  return [];
}

/**
 * Hide fenced code from Studio chat — files still parse via filesFromDesignerReply.
 * Also drops trailing incomplete fences while a reply is streaming.
 */
export function stripCodeForChat(text: string): string {
  let cleaned = text.replace(/```[\s\S]*?```/g, "");
  const open = cleaned.indexOf("```");
  if (open >= 0) cleaned = cleaned.slice(0, open);
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Pull filename-labeled fences from a designer reply into Studio files.
 */
export function filesFromDesignerReply(text: string): StudioFile[] {
  const out: StudioFile[] = [];
  const fence = /```([a-zA-Z0-9_+.-]*)(?:\s+([^\n`]+))?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const lang = (match[1] || "").trim().toLowerCase();
    const label = (match[2] || "").trim();
    let body = (match[3] || "").replace(/\n$/, "");
    let path = label.replace(/^["']|["']$/g, "").trim();

    const fileHint = body.match(
      /^\/\*\s*file:\s*(.+?)\s*\*\/\s*\n|^\/\/\s*file:\s*(.+)\s*\n|^<!--\s*file:\s*(.+?)\s*-->\s*\n/i,
    );
    if (fileHint) {
      path = (fileHint[1] || fileHint[2] || fileHint[3] || path).trim();
      body = body.slice(fileHint[0].length);
    }

    if (!path) {
      if (lang === "html" || lang === "htm") path = "index.html";
      else if (lang === "css") path = "styles.css";
      else if (lang === "js" || lang === "javascript") path = "app.js";
      else if (lang === "ts" || lang === "typescript") path = "app.ts";
      else continue;
    }

    if (!/\.[a-z0-9]+$/i.test(path)) {
      if (lang === "html") path = `${path}.html`;
      else if (lang === "css") path = `${path}.css`;
      else if (lang === "js" || lang === "javascript") path = `${path}.js`;
    }

    out.push({ path: path.replace(/^\.?\/+/, ""), content: body });
  }
  return out;
}

/** Build a single HTML document for iframe preview (inlines css/js when linked). */
export function buildPreviewHtml(files: StudioFile[]): string {
  const byPath = new Map(files.map((file) => [file.path.replace(/^\.?\/+/, ""), file.content]));
  let html =
    byPath.get("index.html") ||
    [...byPath.entries()].find(([path]) => path.endsWith(".html"))?.[1] ||
    "<!DOCTYPE html><html><body><p>No index.html yet.</p></body></html>";

  const css = byPath.get("styles.css") || byPath.get("style.css") || "";
  const js = byPath.get("app.js") || byPath.get("main.js") || "";

  if (css) {
    if (/<link[^>]+href=["']styles\.css["']/i.test(html)) {
      html = html.replace(
        /<link[^>]+href=["']styles\.css["'][^>]*>/i,
        `<style>\n${css}\n</style>`,
      );
    } else if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
    } else {
      html = `<style>${css}</style>${html}`;
    }
  }

  if (js) {
    if (/<script[^>]+src=["']app\.js["'][^>]*><\/script>/i.test(html)) {
      html = html.replace(
        /<script[^>]+src=["']app\.js["'][^>]*><\/script>/i,
        `<script>\n${js}\n</script>`,
      );
    } else if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `<script>\n${js}\n</script>\n</body>`);
    } else {
      html = `${html}<script>${js}</script>`;
    }
  }

  // Inline uploaded assets stored as data URLs (images, fonts, etc.).
  for (const [path, content] of byPath) {
    if (!content.startsWith("data:")) continue;
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`((?:src|href)=["'])(?:\\.\\/)?${escaped}(["'])`, "gi");
    html = html.replace(re, `$1${content}$2`);
    // Also handle url(...) in inlined CSS
    html = html.replace(
      new RegExp(`url\\((['"]?)(?:\\.\\/)?${escaped}\\1\\)`, "gi"),
      `url("${content}")`,
    );
  }

  return html;
}

export type StudioTreeNode = {
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: StudioTreeNode[];
};

export function buildFileTree(files: StudioFile[]): StudioTreeNode[] {
  type Mutable = {
    name: string;
    path: string;
    kind: "file" | "folder";
    children?: Map<string, Mutable>;
  };
  const root = new Map<string, Mutable>();

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let cursor = root;
    let prefix = "";
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = cursor.get(part);
      if (!node) {
        node = {
          name: part,
          path: prefix,
          kind: isFile ? "file" : "folder",
          children: isFile ? undefined : new Map(),
        };
        cursor.set(part, node);
      }
      if (!isFile) {
        node.kind = "folder";
        node.children ??= new Map();
        cursor = node.children;
      }
    });
  }

  const toNodes = (map: Map<string, Mutable>): StudioTreeNode[] =>
    [...map.values()]
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((node) => ({
        name: node.name,
        path: node.path,
        kind: node.kind,
        children: node.children ? toNodes(node.children) : undefined,
      }));

  return toNodes(root);
}

/** Local fallback design when the API is offline. */
export function localDesignFromPrompt(prompt: string): StudioFile[] {
  const title =
    prompt
      .replace(/^(design|build|make|create)\s+(me\s+)?(a\s+|an\s+)?/i, "")
      .replace(/^(like\s+this\s+)?(web|website|site|page)\s*/i, "")
      .trim()
      .slice(0, 48) || "New site";

  return [
    {
      path: "index.html",
      content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="top">
      <strong>${escapeHtml(title)}</strong>
      <nav>
        <a href="#work">Work</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>
    <section class="hero">
      <p class="eyebrow">Designed in Studio</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(prompt.slice(0, 160))}</p>
      <a class="cta" href="#work">Explore</a>
    </section>
    <section id="work" class="grid">
      <article><h2>One</h2><p>Lead with a strong first impression.</p></article>
      <article><h2>Two</h2><p>Keep sections purposeful and light.</p></article>
      <article><h2>Three</h2><p>End with a clear next step.</p></article>
    </section>
    <footer id="contact">Ready when you are.</footer>
    <script src="app.js"></script>
  </body>
</html>
`,
    },
    {
      path: "styles.css",
      content: `:root {
  --bg: #101218;
  --ink: #f6f5f1;
  --muted: #a8a4b8;
  --line: rgba(255,255,255,0.1);
  --accent: #e8dcc8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
  background: var(--bg);
  color: var(--ink);
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 8vw;
  border-bottom: 1px solid var(--line);
}
.top nav { display: flex; gap: 18px; }
.top a { color: var(--muted); text-decoration: none; font-size: 14px; }
.hero {
  min-height: 72vh;
  display: grid;
  align-content: center;
  gap: 16px;
  padding: 10vh 8vw;
  background:
    linear-gradient(120deg, rgba(232,220,200,0.08), transparent 40%),
    radial-gradient(circle at 80% 10%, #2b3348, transparent 45%),
    var(--bg);
}
.eyebrow { letter-spacing: 0.2em; text-transform: uppercase; font-size: 11px; color: var(--muted); margin: 0; }
h1 { margin: 0; font-size: clamp(2.6rem, 7vw, 5rem); line-height: 0.95; max-width: 10ch; }
.hero p { max-width: 36rem; color: var(--muted); font-size: 1.05rem; }
.cta {
  width: fit-content;
  padding: 12px 18px;
  border-radius: 999px;
  background: var(--accent);
  color: #17140f;
  text-decoration: none;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 18px;
  padding: 48px 8vw 72px;
}
.grid article {
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 22px;
  background: rgba(255,255,255,0.02);
}
.grid h2 { margin: 0 0 8px; font-size: 1.2rem; }
.grid p { margin: 0; color: var(--muted); }
footer {
  padding: 28px 8vw 48px;
  border-top: 1px solid var(--line);
  color: var(--muted);
}
`,
    },
    {
      path: "app.js",
      content: `document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href")?.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth" });
  });
});
`,
    },
    {
      path: "assets/.gitkeep",
      content: "",
    },
  ];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* —— ZIP (store method, no compression — no extra dependency) —— */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function u32(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Build an uncompressed ZIP blob from Studio project files. */
export function buildProjectZip(files: StudioFile[], folder = "arrab-studio-site"): Blob {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    if (file.path.endsWith(".gitkeep") && !file.content) continue;
    const name = `${folder}/${file.path}`.replace(/\\/g, "/");
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(centrals.length),
    u16(centrals.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  const zipBytes = concat([...locals, centralDir, end]);
  const copy = new Uint8Array(zipBytes.byteLength);
  copy.set(zipBytes);
  return new Blob([copy], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** Legacy roster helpers — roster is no longer required; catalog is shared. */
export function readStudioRoster(): string[] {
  return resolveStudioCatalog().map((entry) => entry.id);
}

export function writeStudioRoster(_ids: string[]): void {
  // no-op — catalog is admin-managed for all users
}
