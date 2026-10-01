# Notifications

Every alert goes through `apps/desktop/src/domains/notifications/`.

| Layer | What it does |
| --- | --- |
| Bell inbox (`notify.ts`, `managed/ui/NotificationCenter.tsx`) | Always records the alert. Local alerts plus Arrab Control notices, unread state, mark-all, clear. |
| Toast (`ui/ToastHost.tsx`) | In-app pop-up. Approvals stay until dismissed. |
| Native notification | macOS Notification Center / Windows Action Center via `tauri-plugin-notification`. |
| Presence HUD (`agent-presence.ts`) | Floating agent card for approvals and long runs. |
| Policy (`notification-policy.ts`) | Pure rules: per-kind toggles, quiet hours, Do Not Disturb snooze, OS throttle. |

## What interrupts the user

`deliveryFor(kind, prefs, now)` decides `{ toast, os, presence }`. The inbox is **never** skipped for an enabled kind, so nothing is lost while alerts are held.

- **Quiet hours** (Settings → Notifications): daily window, may wrap midnight (22:00 → 07:00).
- **Do Not Disturb**: snooze 30 min / 1 h / 4 h / until 08:00, from the bell. The bell icon changes while active.
- **Approvals** may break through quiet time (setting, on by default) because an agent is blocked on the user.
- **OS throttle**: same tag within 4 s is dropped, at most 4 native notifications per 10 s.

## Cross-platform behaviour

| | macOS | Windows |
| --- | --- | --- |
| Native notification | Notification Center (permission asked once after sign-in) | Action Center toast (app identifier `com.arrab.studio`; shows its name once installed, dev builds show a generic name) |
| Unread badge | Dock badge count (`setBadgeCount`) | Taskbar label `(3) Arrab Studio` (`setTitle`) |
| Click a notification | Plugin does not report clicks, so focusing the app within 60 s opens the link the last notification pointed at | same |

Capabilities needed: `notification:default`, `core:window:allow-set-badge-count`, `core:window:allow-set-title` (`src-tauri/capabilities/default.json`).

## Adding an alert

Call `notifyStudio({ kind, title, body, href })` for background events (it applies all the rules above). Use `pushToast` only for the result of something the user just did.
