#!/usr/bin/env node
/**
 * Scaffold a new Studio feature slice (agile).
 *
 * Usage:
 *   pnpm new:feature my-thing
 *   pnpm new:feature my-thing --audience=individual,family
 *   pnpm new:feature my-thing --api
 *
 * See docs/FEATURE.md
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log(`Usage: pnpm new:feature <kebab-name> [--audience=individual,family,organization] [--api]

Creates:
  apps/desktop/src/pages/<Pascal>Page.tsx
  apps/desktop/src/features/<kebab>/NOTES.md
  (optional) apps/api/src/services/<kebab>-service.ts stub

Then prints the wiring checklist. Does not auto-edit App.tsx / catalog / messages.
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

const audienceArg = args.find((a) => a.startsWith("--audience="));
const audiences = (audienceArg?.split("=")[1] || "individual")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const withApi = args.includes("--api");

const pascal = toPascal(name);
const camel = toCamel(name);
const pagePath = join(root, "apps/desktop/src/pages", `${pascal}Page.tsx`);
const notesDir = join(root, "apps/desktop/src/features", name);
const notesPath = join(notesDir, "NOTES.md");
const servicePath = join(root, "apps/api/src/services", `${name}-service.ts`);

if (existsSync(pagePath)) {
  console.error(`Page already exists: ${pagePath}`);
  process.exit(1);
}

mkdirSync(dirname(pagePath), { recursive: true });
mkdirSync(notesDir, { recursive: true });

const pageStub = `import { useLanguage } from "@/i18n/LanguageProvider";

/**
 * ${pascal} — scaffolded by \`pnpm new:feature ${name}\`.
 * Wire route + nav + i18n before shipping. See docs/FEATURE.md.
 */
export function ${pascal}Page() {
  const { t } = useLanguage();
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("${camel}Title" as never)}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("${camel}Body" as never)}</p>
      </header>
      <section className="rounded-2xl border border-black/8 bg-white/80 p-4 text-sm text-neutral-600">
        Replace this stub. Audiences: ${audiences.join(", ")}.
      </section>
    </div>
  );
}
`;

const notes = `# ${pascal}

Scaffolded: \`${new Date().toISOString().slice(0, 10)}\`
Audiences: ${audiences.join(", ")}

## Checklist

- [ ] Add \`en\` + \`ar\` keys \`${camel}Title\`, \`${camel}Body\` in \`apps/desktop/src/i18n/messages.ts\`
- [ ] Add route in \`apps/desktop/src/App.tsx\` (${audiences.includes("organization") ? "organization" : "individual"} child routes)
- [ ] Add nav item in \`apps/desktop/src/roles/catalog.ts\` if it needs a rail destination
${withApi ? `- [ ] Shared types in \`packages/shared\`
- [ ] Finish \`apps/api/src/services/${name}-service.ts\`
- [ ] Register route in \`apps/api/src/routes/v1.ts\`
- [ ] Add \`arrabApi.${camel}\` in \`apps/desktop/src/lib/api.ts\`
` : `- [ ] API only if needed (\`pnpm new:feature ${name} --api\` to re-scaffold service stub)
`}- [ ] Optional flag in \`apps/desktop/src/features/flags.ts\`
- [ ] \`pnpm typecheck\` + focused tests
- [ ] Remove this NOTES.md when the feature ships

See [docs/FEATURE.md](../../../../docs/FEATURE.md).
`;

writeFileSync(pagePath, pageStub);
writeFileSync(notesPath, notes);

if (withApi) {
  if (existsSync(servicePath)) {
    console.warn(`Service already exists, skipping: ${servicePath}`);
  } else {
    const serviceStub = `/**
 * ${pascal} service — scaffolded by \`pnpm new:feature ${name} --api\`.
 * Wire into createApiContext / registerV1Routes when ready.
 */
export class ${pascal}Service {
  // async list(): Promise<unknown[]> { … }
}
`;
    writeFileSync(servicePath, serviceStub);
  }
}

console.log(`Created:
  ${pagePath.replace(root + "/", "")}
  ${notesPath.replace(root + "/", "")}${withApi ? `\n  ${servicePath.replace(root + "/", "")}` : ""}
`);

console.log(`Next (agile slice):
  1. messages.ts  →  ${camel}Title / ${camel}Body (en + ar)
  2. App.tsx      →  <Route path="${name}" element={<${pascal}Page />} />
  3. catalog.ts   →  nav entry if needed (${audiences.join(", ")})
${withApi ? `  4. shared → v1 route → arrabApi.${camel}
` : ""}  See docs/FEATURE.md
`);
