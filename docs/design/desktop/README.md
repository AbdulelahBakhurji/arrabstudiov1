# Desktop design package

Standalone design preview and verification for the Arrab Studio desktop UI.

- Open `Arrab-Design.html` in a browser for an offline preview
- Production UI lives in `apps/desktop` — this folder is design reference only
- `preview/` and `preview-tools/` rebuild the standalone preview
- `VERIFICATION.md` records the design QA pass

## Rebuild preview (from repo root)

```bash
node docs/design/desktop/preview-tools/build-preview.mjs
```

Optional illustrative PNG (requires `sharp`):

```bash
pnpm add -Dw sharp
node docs/design/desktop/preview-tools/render-overview.mjs
```
