# Adding features

New pages plug in as a **feature module**. Do not edit `App.tsx` or `roles/catalog.ts` for a new surface.

```bash
pnpm new:feature weekly-digest --audience=individual,family --nav
pnpm new:feature seat-audit --audience=organization --api --flag
```

That creates `apps/desktop/src/features/modules/<name>/`. The registry glob-loads every `index.ts` that exports `feature`.

## What the module wires

| Slot | Where it lands |
| --- | --- |
| Route | `/individuals/<path>` and/or `/organizations/<path>` from `audiences` |
| Rail | Inserted before Settings when `nav: true` |
| Flag | Hidden until `arrab.feature.<id>=1` or `VITE_FEATURE_<ID>=1` |
| Copy | `en` + `ar` keys inserted in `messages.ts` |

## One-sprint slice

Skip layers you do not need.

| Step | Where | What |
| --- | --- | --- |
| 1. Module | `apps/desktop/src/features/modules/<id>/` | `feature` export + page |
| 2. Contract | `packages/shared/src/` | Types; export from `index.ts` |
| 3. Persist | `packages/database/` | Migration only if data must survive restart |
| 4. Service | `apps/api/src/modules/<domain>/` | Business rules (`*-service.ts`) |
| 5. HTTP | `apps/api/src/modules/<domain>/<domain>.routes.ts` | Route that calls the service; register in `http/v1.ts` |
| 6. Client | `apps/desktop/src/domains/<domain>/api.ts` | `arrabApi.*` only — no ad-hoc `fetch` |
| 7. Settings | `apps/desktop/src/features/settings-tabs.ts` | Settings tab (not a page module) |

## Rules

1. Thin PR — one outcome.
2. Shared is the contract — desktop never invents API shapes.
3. Bilingual from day one.
4. Gate family / org with `audiences` on the module, not ad-hoc storage.
5. Flags are for shipping dark. Delete the flag when the feature is default-on.
6. Do not reuse reserved paths: chat, studio, board, settings, workforce, …

## Enable a flagged module

```ts
localStorage.setItem("arrab.feature.weekly-digest", "1");
```

or `VITE_FEATURE_WEEKLY_DIGEST=1` in `apps/desktop/.env`.

## Definition of done

- [ ] Module exports `feature`
- [ ] `en` + `ar` strings
- [ ] `arrabApi` only (if API)
- [ ] Test for non-trivial behavior
- [ ] `pnpm typecheck` and focused `pnpm test`
- [ ] `NOTES.md` removed when it ships
