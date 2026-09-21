# Verification — Arrab Desktop Improved

Date: 2026-09-14

## Design-language unification pass

The organizations side (Chat, Cowork, Workforce, Employee Desk, Settings,
Account, Activity, Connectors, Sign-in) previously fell outside the
`.companion-app` CSS scope and used a separate, partially-finished
gray/black palette in `globals.css`. It has been unified onto the same
token system, shell chrome, and light/dark theming used by the
individuals/companions side. See `source/` git history for the exact diff
(`StudioFrame.tsx`, `globals.css`, `companions.css`, `SignInPage.tsx`).

- Desktop TypeScript check: PASS (no emit), re-run after the unification changes.
- Vite production standalone build: PASS, 1,769 modules transformed, re-run after the unification changes.
- Unit and component checks: 28 passing tests in 5 files, no live AI/API traffic, re-run after the unification changes — unaffected, since the changes were presentational (CSS/className) rather than behavioral.
  - Draft persistence and isolation: 4.
  - Existing companion regressions: 7.
  - Request cancellation: 5.
  - Task creation, deduplication and exact-item navigation: 9.
  - Mounted React chat interactions in JSDOM: 3.
- Standalone HTML: no external script or stylesheet resources; revised labels and controls found in output.
- Readability colors calculated from CSS: faint text #656272 on #e8e9f0 is approximately 4.895:1; on #e5dffd approximately 4.602:1.
- Static illustrative PNG inspected for Arabic legibility. It was drawn from the design and is not an application screenshot.
- Visual regression sweep: all 17 routes in `screens.json`, across both roles and both themes (34 renders), captured headless via Playwright against the rebuilt standalone preview and reviewed for color/contrast/layout defects. The initial pass used a flawed dark-theme setup (`localStorage` + reload, which the preview adapter silently re-seeds to light on every reload) and was redone by clicking the in-app theme toggle instead, confirmed via `document.documentElement.className`.

## Follow-up pass: exhaustive hardcoded-color audit

After the first pass, a full `grep` sweep of every `.tsx` file under `src/`
(not just the previously-known spots) found roughly 150 more literal
near-black/white colors — Tailwind arbitrary hex values (`bg-[#0a0a0a]`)
and built-in `bg-white`/`bg-black`/`border-white` utilities — that never
responded to the theme toggle. The most consequential was `bg-white` +
`text-black`, this app's shared convention for "this is the primary/
active/selected element" (CTA buttons, active tabs, the outgoing chat
bubble, the role-switch pill): the first pass's generic override had
flattened that pairing to the same muted card color as an ordinary
panel, so every primary/active state in the app — individuals included —
lost its visual pop. Also found and fixed: a malformed Tailwind opacity
suffix (`bg-[#060606]/0.9]`) repeated ~12 times that was silently
rendering those cards fully opaque regardless of the intended value, and
a `from-black/80` composer-fade gradient that painted a dark smudge above
the chat/cowork composer in light theme.

- Desktop TypeScript check: PASS (no emit), re-run after this pass.
- Vite production standalone build: PASS, 1,769 modules transformed, re-run after this pass.
- Unit and component checks: 28/28 passing, re-run after this pass — unaffected (presentational-only changes).
- Full 17-route x light/dark screenshot re-sweep confirms: card/panel surfaces, form fields, the composer fade, and primary/active-state buttons and pills all now repaint correctly with the theme toggle, in both roles.

## Follow-up pass: the workforce org chart going invisible in light theme

The workforce map's node-connector lines (`bg-white/12`, and a
`from-white/35 to-white/8` gradient) were thin (1px) near-white fills —
visible against the dark background but effectively invisible against
the light theme's near-white background, so the chart's tree structure
disappeared in light mode. The same applied to the chart's "live" pulse
dot, its avatar hover ring, and its background glow (all fixed
light-gray/white values). Retinted the lines to `--color-border` (tuned
for visible-but-quiet lines in both themes) and the accents to
`--color-accent`/`color-mix()`; the non-root chart node's flat
`bg-black/80` chip was also switched to `--color-surface-2` so it reads
as a normal card instead of a fixed dark tile.

- Desktop TypeScript check: PASS (no emit), re-run after this pass.
- Vite production build: PASS, re-run after this pass.
- Unit and component checks: 28/28 passing, re-run after this pass.
- Targeted light/dark screenshot check of the workforce map confirms the connector lines, live dot, and node chips are now visible and consistent in both themes.

## Follow-up pass: programmatic contrast audit

Screenshot review was not sufficient. A DOM audit was written that walks
every visible element on 16 routes in both themes, composites the real
stacked background (including translucent overlay layers), and computes
the actual WCAG contrast ratio for each text node and icon. A second pass
does the same after opening the command palette, dropdown menus and
modal dialogs, which never appear in a static screenshot. A third checks
every button for an accessible name, a clipped label, or an undersized
target.

First run: 26 text-contrast failures, 5 low-contrast icons, 8 hardcoded
SVG colors. The causes were 22 CSS rules setting a literal text color,
19 setting a literal background wash and 14 a literal border, all with no
light-theme counterpart — plus status hues (info/warn/success) that had
only one fixed value for both themes. All were converted to tokens; see
`source/` git history for the diff.

Note on the audit itself: its first colour parser only understood `rgb()`,
so elements coloured in `oklch()` (Tailwind v4's default palette) were
mis-measured and produced two false positives. The parser now resolves
every CSS colour space through a canvas, and skips elements whose
background is a gradient rather than guessing a single value for them.

- Current audit result: 0 text-contrast, 0 icon-contrast and 0 hardcoded-SVG findings, in both themes, static and with menus/modals/palette open.
- 0 icon-only controls without an accessible name; 0 clipped button labels.
- Remaining reported "overflow" entries are intentional: a screen-reader-only label and a decorative image that deliberately bleeds past a container with `overflow: hidden`.
- Desktop TypeScript check, 28/28 unit tests and the Vite production build all pass after this pass.

Not covered by any of the above: real-device rendering, viewport widths
other than 1440x900, pointer hover states, animation timing, and whether
the resulting palette is aesthetically right — that is a judgement call,
not something a contrast ratio can settle.

## Meaningful interaction coverage

The mounted chat tests exercise Personal/Professional switching, unmount/remount draft recovery, an editable composer during an active reply, Stop preserving the next draft, stale callbacks after a new send, and a StrictMode board handoff appending to the correct existing draft exactly once.

## Limits

No native Tauri installer was built. Real provider latency, server-side computation cancellation and real account integrations were not tested. Browser opening of the supplied local HTML was security-policy blocked; no browser screenshot, responsive visual pass, or real-user usability study is claimed. JSDOM tests validate component behavior, not visual layout. The preview adapter is local simulated data, resets on reload, and never sends AI requests.
