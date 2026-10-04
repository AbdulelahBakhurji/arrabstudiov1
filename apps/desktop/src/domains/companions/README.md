# Companions domain

Solo / family companion chat, roster, memory, and professional desk.

```text
api.ts                 HTTP slice → arrabApi
model/                 State & persistence (companions, drafts, groups)
catalog/               Presets, purposes, portraits, accents, suggestions
lib/                   Pure helpers (avatar, assign, access, bootstrap)
pages/                 Routed screens
ui/                    Components
ui/hooks/              Room / chat hooks
```

Prefer deep imports (`@/domains/companions/model/companions`) over barrels for heavy modules.
