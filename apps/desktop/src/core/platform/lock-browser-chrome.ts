import { isTauriRuntime } from "./terminal";

/**
 * Treat the desktop shell like a native app: no browser Inspect menu,
 * no DevTools shortcut chrome. Custom app menus still work — they call
 * preventDefault themselves and render React UI.
 */
export function lockBrowserChrome(): void {
  if (!isTauriRuntime()) return;

  document.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;
      const openDevtools =
        key === "f12" ||
        (meta && event.shiftKey && (key === "i" || key === "j" || key === "c")) ||
        (meta && event.altKey && (key === "i" || key === "j" || key === "c"));
      if (openDevtools) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
}
