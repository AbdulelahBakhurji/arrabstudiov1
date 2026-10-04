export type RuntimeTarget = "pc" | "ssh" | "github";

export type CompanionWorkspaceAccess = {
  target: RuntimeTarget;
  folderPath: string | null;
  sshConnectorId: string;
  githubConnectorId: string;
  githubRepo: string;
};

const KEY = "arrab.cowork.companionAccess.v1";

type Store = Record<string, CompanionWorkspaceAccess>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function readCompanionAccess(agentId: string): CompanionWorkspaceAccess | null {
  if (!agentId) return null;
  return readStore()[agentId] ?? null;
}

export function writeCompanionAccess(agentId: string, access: CompanionWorkspaceAccess) {
  if (!agentId) return;
  const store = readStore();
  store[agentId] = access;
  writeStore(store);
}

export function accessLabel(access: CompanionWorkspaceAccess | null, fallback = "No access yet"): string {
  if (!access) return fallback;
  if (access.target === "pc" && access.folderPath) {
    const parts = access.folderPath.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || access.folderPath;
  }
  if (access.target === "ssh") return access.sshConnectorId ? "SSH server" : "SSH";
  if (access.target === "github") return access.githubRepo || "GitHub";
  return fallback;
}
