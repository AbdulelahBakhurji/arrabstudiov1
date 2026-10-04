# Chat domain

Cloud and local chat, cowork, composer tools, and session modes.

```text
api.ts          HTTP slice → arrabApi
model/          History, tabs, session mode, AI prefs
lib/            Tools, safety, attachments, local models, skills
pages/          ChatPage, CoworkPage
ui/             Composer, markdown, thinking, artifacts
```

Use deep imports (`@/domains/chat/model/ai-prefs`, `@/domains/chat/lib/local-models`).
