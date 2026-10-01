import {
  API_BASE_KEY,
  API_ROUTE_PREFIX_KEY,
  CRASH_LOG_KEY,
  LAST_CHAT_AGENT_KEY,
  LAST_COWORK_AGENT_KEY,
  PREFS_KEY,
  defaultPrefs,
  writePrefs,
} from "@/shared/lib/prefs";

/** Keys / prefixes that survive “clear local studio data” (account + chrome). */
const PRESERVE_LOCAL_EXACT = new Set([
  "arrab.locale",
  "arrab.theme",
  "arrab.studioRole",
  "arrab.guest.localOnly",
]);

const PRESERVE_LOCAL_PREFIXES = [
  "arrab.account.",
  "arrab.device.",
  "arrab.org.employee.",
  "arrab.family.activeMemberId",
  "arrab.family.session",
] as const;

function shouldPreserveLocalKey(key: string): boolean {
  if (PRESERVE_LOCAL_EXACT.has(key)) return true;
  return PRESERVE_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function removeMatchingLocalKeys(predicate: (key: string) => boolean): void {
  const remove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && predicate(key)) remove.push(key);
  }
  for (const key of remove) {
    localStorage.removeItem(key);
  }
}

/** Local studio keys that Settings can wipe without touching API secrets. */
export const CLEARABLE_LOCAL_KEYS = [
  PREFS_KEY,
  API_BASE_KEY,
  API_ROUTE_PREFIX_KEY,
  CRASH_LOG_KEY,
  LAST_COWORK_AGENT_KEY,
  LAST_CHAT_AGENT_KEY,
  "arrab.cowork.folder",
  "arrab.chat.workspace",
  "arrab.workforce.ops",
  "arrab.workforce.directives",
  "arrab.workforce.teamMeta",
  "arrab.incognito.apiIds",
  "arrab.profile.photo",
  "arrab.firstLaunchSetup",
  "arrab.firstLaunchSetup.v2",
  "arrab.firstLaunchSetup.v3",
  "arrab.studioGoal",
  "arrab.gettingStarted",
  "arrab.crew.local",
  "arrab.pro.groups",
  "arrab.pro.sidebar",
  "arrab.pro.dossier",
  "arrab.notificationInbox.v1",
  "arrab.notificationWelcome.v1",
  "arrab.companion.workspaceFolder",
  "arrab.companionFocus",
  "arrab.companionDraft",
  "arrab.pro.clearedRoster.v2",
] as const;

/**
 * Wipe local studio drafts/prefs/notes/cache on this device.
 * Keeps signed-in account, locale/theme, and device-secure material.
 */
export async function clearLocalStudioData(_options?: { keepAppearance?: boolean }): Promise<void> {
  for (const key of CLEARABLE_LOCAL_KEYS) {
    localStorage.removeItem(key);
  }

  removeMatchingLocalKeys((key) => {
    if (!key.startsWith("arrab.")) return false;
    if (shouldPreserveLocalKey(key)) return false;
    return true;
  });

  try {
    const sessionKill = [
      "arrab.chatAgent",
      "arrab.companionFocus",
      "arrab.companionDraft",
      "arrab.companions.openAdd",
      "arrab.companions.assignMemberId",
    ];
    for (const key of sessionKill) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage may be unavailable
  }

  writePrefs(defaultPrefs());

  await Promise.all([
    import("@/core/storage/device-cache").then(({ clearDeviceCache }) => clearDeviceCache()),
    import("@/domains/chat/chat-history").then(({ clearChatHistory }) => clearChatHistory()),
    import("@/domains/encryption/incognito-vault").then(({ wipeAllIncognitoVaults }) => wipeAllIncognitoVaults()),
  ]);

  const [{ clearAllBrainPartitions }, { clearProfessionalGroups }, { forgetEverything }] =
    await Promise.all([
      import("@/domains/brain/second-brain"),
      import("@/domains/companions/professional-groups"),
      import("@/domains/companions/companions"),
    ]);

  clearAllBrainPartitions();
  clearProfessionalGroups();
  forgetEverything();

  // Drop every companion vault partition after memory wipe.
  removeMatchingLocalKeys(
    (key) =>
      key.startsWith("arrab.companions.") ||
      key === "arrab.companions.v2" ||
      key.startsWith("arrab.companions.syncedAt"),
  );

  writePrefs(defaultPrefs());
  window.dispatchEvent(new CustomEvent("arrab:local-data-cleared"));
}
