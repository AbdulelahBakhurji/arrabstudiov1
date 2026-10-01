# Feature modules

New product surfaces plug in here. Do not edit `App.tsx` or `roles/catalog.ts` for a new page.

```bash
pnpm new:feature weekly-digest --audience=individual,family --nav
```

That creates `modules/weekly-digest/` and wires:

1. Route on the matching shell (`/individuals/weekly-digest` or `/organizations/…`)
2. Optional rail item (before Settings)
3. Optional flag (`arrab.feature.<id>` or `VITE_FEATURE_<ID>=1`)
4. `en` + `ar` title/body keys

## Add by hand

`modules/<kebab>/index.ts` must export `feature: StudioFeature`. See `docs/FEATURE.md`.
