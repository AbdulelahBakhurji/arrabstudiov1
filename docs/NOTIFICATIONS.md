# Notifications

Notifications are **device notifications only**: macOS Notification Center and Windows Action Center via `tauri-plugin-notification`. The app has no in-app toast stack and no bell inbox.

Everything lives in `apps/desktop/src/domains/notifications/`.

| File | Role |
| --- | --- |
| `notify.ts` | `pushToast` (feedback for something the user just did), `notifyStudio` (background alerts: approvals, team launch, connectors, cowork, agents), `postNativeNotification`, `ensureNotificationPermission`. All end in one native notification. |
| `notification-policy.ts` | Pure rules, unit-tested: per-kind switches, quiet hours, Do Not Disturb, OS flood throttle, deep-link memory. |
| `agent-presence.ts` | Floating agent card (its own OS window) for approvals and long runs. |

## What interrupts the user

`deliveryFor(kind, prefs, now)` decides `{ toast, os, presence }`. Nothing is queued while alerts are held.

- **Per-kind switches** (Settings → Notifications). A switched-off kind is dropped.
- **Quiet hours:** a daily window that may wrap midnight (22:00 → 07:00).
- **Do Not Disturb:** snooze 30 min / 1 h / 4 h / until 08:00 in Settings → Notifications.
- **Approvals and warnings** break through quiet time (approvals only when "Let approvals through" is on) because the user is blocking an agent or something failed.
- **Throttle:** the same tag within 4 s is dropped; at most 4 native notifications per 10 s.

## Cross-platform notes

| | macOS | Windows |
| --- | --- | --- |
| Delivery | Notification Center (permission asked once after sign-in) | Action Center toast. App identifier `com.arrab.studio`; installed builds show the app name, dev builds a generic one. |
| Click | The plugin does not report clicks, so focusing the app within 60 s opens the link the last notification pointed at (`StudioFrame`). | same |

If the OS permission is denied nothing is shown, so every flow that can fail also shows its error inline on the page.

Capability needed: `notification:default` (`src-tauri/capabilities/default.json`).

## Adding an alert

Call `notifyStudio({ kind, title, body, href })` for background events. Use `pushToast` for the result of a user action.
