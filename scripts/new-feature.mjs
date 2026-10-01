#!/usr/bin/env node
/**
 * Scaffold a plug-in Studio feature module.
 *
 * Usage:
 *   pnpm new:feature weekly-digest
 *   pnpm new:feature weekly-digest --audience=individual,family --nav
 *   pnpm new:feature weekly-digest --api --flag
 *
 * The module is picked up automatically — no App.tsx / catalog edits.
 * See docs/FEATURE.md
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE_MARKER = "    // --- feature modules (pnpm new:feature) ---";
const RESERVED = new Set([
  "studio",
  "board",
  "brain",
  "work",
  "me",
  "companions",
  "connectors",
  "account",
  "settings",
  "chat",
  "cowork",
  "workforce",
  "activity",
  "workplace",
  "desk",
  "plans",
]);

function usage() {
  console.log(`Usage: pnpm new:feature <kebab-name> [options]

Options:
  --audience=individual,family,organization
  --nav          Show on the side rail (before Settings)
  --flag         Hide until arrab.feature.<id>=1 or VITE_FEATURE_<ID>=1
  --api          Also stub apps/api/src/services/<name>-service.ts

Creates apps/desktop/src/features/modules/<name>/ and wires route + copy.
`);
}

function toPascal(kebab) {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

function toCamel(kebab) {
  const p = toPascal(kebab);
  return p[0].toLowerCase() + p.slice(1);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const name = args.find((a) => !a.startsWith("--"));
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("Name must be kebab-case, e.g. weekly-digest");
  process.exit(1);
}
if (RESERVED.has(name)) {
  console.error(`"${name}" is a reserved route. Pick another kebab-case id.`);
  process.exit(1);
}

const audienceArg = args.find((a) => a.startsWith("--audience="));
const audiences = (audienceArg?.split("=")[1] || "individual")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowed = new Set(["individual", "family", "organization"]);
if (audiences.some((a) => !allowed.has(a))) {
  console.error("Audience must be individual, family, and/or organization.");
  process.exit(1);
}

const withNav = args.includes("--nav");
const withFlag = args.includes("--flag");
const withApi = args.includes("--api");
const pascal = toPascal(name);
const camel = toCamel(name);
const titleKey = `${camel}Title`;
const bodyKey = `${camel}Body`;

const moduleDir = join(root, "apps/desktop/src/features/modules", name);
const pagePath = join(moduleDir, `${pascal}Page.tsx`);
const indexPath = join(moduleDir, "index.ts");
const notesPath = join(moduleDir, "NOTES.md");
const servicePath = join(root, "apps/api/src/services", `${name}-service.ts`);

if (existsSync(indexPath)) {
  console.error(`Feature already exists: ${moduleDir}`);
  process.exit(1);
}

mkdirSync(moduleDir, { recursive: true });

const audienceLiteral = audiences.map((a) => `"${a}"`).join(", ");

const pageStub = `import { useLanguage } from "@/shared/i18n/LanguageProvider";

/**
 * ${pascal} — scaffolded by \`pnpm new:feature ${name}\`.
 * Replace this stub. Route and nav are registered from ./index.ts.
 */
export function ${pascal}Page() {
  const { t } = useLanguage();
  return (
    <div className="cp-ui cp-page flex h-full flex-col gap-4 p-6">
      <header>
        <p className="cp-eyebrow">ARRAB</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("${titleKey}")}</h1>
        <p className="mt-1 text-sm text-[var(--cp-muted)]">{t("${bodyKey}")}</p>
      </header>
    </div>
  );
}
`;

const indexStub = `import { Sparkles } from "lucide-react";
import type { StudioFeature } from "@/features/types";
import { ${pascal}Page } from "./${pascal}Page";

export const feature: StudioFeature = {
  id: "${name}",
  kind: "page",
  path: "${name}",
  audiences: [${audienceLiteral}],
  titleKey: "${titleKey}",
  icon: Sparkles,
  Page: ${pascal}Page,
  nav: ${withNav},
  hideForFamilyChild: ${audiences.includes("family") && !audiences.includes("individual") ? "true" : "false"},${
    withFlag ? `\n  flag: "${name}",` : ""
  }
};
`;

const notes = `# ${pascal}

Scaffolded: \`${new Date().toISOString().slice(0, 10)}\`
Audiences: ${audiences.join(", ")}
Route: \`/${name}\`
Rail: ${withNav ? "yes" : "no"}
Flag: ${withFlag ? `\`${name}\` (off until localStorage/env)` : "none — live immediately"}

## Build the slice

- [ ] Replace \`${pascal}Page.tsx\`
- [ ] Keep \`en\` + \`ar\` keys \`${titleKey}\` / \`${bodyKey}\`
${withApi ? `- [ ] Shared types in \`packages/shared\`
- [ ] Finish \`apps/api/src/services/${name}-service.ts\`
- [ ] Register HTTP in \`apps/api/src/routes/v1.ts\`
- [ ] Add \`arrabApi.${camel}\` in \`apps/desktop/src/lib/api.ts\`
` : ""}${withFlag ? `- [ ] Enable locally: localStorage \`arrab.feature.${name}=1\`
` : ""}- [ ] Focused test if behavior is non-trivial
- [ ] Delete this NOTES.md when the feature ships

Do **not** edit App.tsx or roles/catalog.ts — the registry mounts this module.

See [docs/FEATURE.md](../../../../../docs/FEATURE.md).
`;

writeFileSync(pagePath, pageStub);
writeFileSync(indexPath, indexStub);
writeFileSync(notesPath, notes);

function insertMessages(enTitle, enBody, arTitle, arBody) {
  const file = join(root, "apps/desktop/src/i18n/messages.ts");
  let text = readFileSync(file, "utf8");
  if (text.includes(`${titleKey}:`)) {
    console.warn("i18n keys already present, skipping messages.ts");
    return;
  }
  const blockEn = `    ${titleKey}: ${JSON.stringify(enTitle)},\n    ${bodyKey}: ${JSON.stringify(enBody)},\n`;
  const blockAr = `    ${titleKey}: ${JSON.stringify(arTitle)},\n    ${bodyKey}: ${JSON.stringify(arBody)},\n`;
  const parts = text.split(FEATURE_MARKER);
  if (parts.length !== 3) {
    console.warn("Could not find both feature-module markers in messages.ts — add keys by hand.");
    return;
  }
  text = [parts[0], FEATURE_MARKER, "\n", blockEn, parts[1], FEATURE_MARKER, "\n", blockAr, parts[2]].join("");
  writeFileSync(file, text);
}

insertMessages(
  pascal.replace(/([A-Z])/g, " $1").trim(),
  `${pascal} is ready to implement.`,
  pascal.replace(/([A-Z])/g, " $1").trim(),
  `${pascal} جاهز للتنفيذ.`,
);

if (withApi) {
  if (existsSync(servicePath)) {
    console.warn(`Service already exists, skipping: ${servicePath}`);
  } else {
    writeFileSync(
      servicePath,
      `/**
 * ${pascal} service — scaffolded by \`pnpm new:feature ${name} --api\`.
 * Wire into createApiContext / registerV1Routes when ready.
 */
export class ${pascal}Service {
  // async list(): Promise<unknown[]> { … }
}
`,
    );
  }
}

console.log(`Created feature module:
  apps/desktop/src/features/modules/${name}/
${withApi ? `  apps/api/src/services/${name}-service.ts\n` : ""}`);
console.log(`Live at:  #/${audiences.includes("organization") && !audiences.includes("individual") ? "organizations" : "individuals"}/${name}
${withFlag ? `Enable:   localStorage.setItem("arrab.feature.${name}", "1")\n` : ""}See docs/FEATURE.md
`);
