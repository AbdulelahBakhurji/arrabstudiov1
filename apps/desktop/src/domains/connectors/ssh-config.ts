import { invoke } from "@tauri-apps/api/core";
import type { ConnectorPublic } from "@arrab/shared";
import { isTauriRuntime } from "@/core/platform/terminal";

export type SshConfigHost = {
  alias: string;
  hostName: string;
  user: string;
  port: string;
  identityFile: string | null;
};

const LOCAL_KEY = "arrab.ssh.config.connectors";

export type LocalSshConnector = {
  id: string;
  alias: string;
  label: string;
  host: string;
  user: string;
  port: string;
  connectedAt: string;
};

export async function listSshConfigHosts(): Promise<SshConfigHost[]> {
  if (!isTauriRuntime()) return [];
  try {
    const hosts = await invoke<SshConfigHost[]>("list_ssh_config_hosts");
    return Array.isArray(hosts) ? hosts : [];
  } catch {
    return [];
  }
}

export async function readSshIdentity(path: string): Promise<string | null> {
  if (!isTauriRuntime() || !path.trim()) return null;
  try {
    const text = await invoke<string>("read_ssh_identity", { path });
    return text.trim() || null;
  } catch {
    return null;
  }
}

export async function execSshConfig(
  alias: string,
  command: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return invoke("ssh_config_exec", { alias, command });
}

function readLocal(): LocalSshConnector[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalSshConnector[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(items: LocalSshConnector[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
}

export function localSshConnectors(): ConnectorPublic[] {
  return readLocal().map((item) => ({
    id: item.id,
    provider: "ssh",
    status: "connected",
    accountLabel: item.label,
    scopes: ["ssh"],
    connectedAt: item.connectedAt,
    lastVerifiedAt: item.connectedAt,
    error: null,
    familyMemberId: null,
  }));
}

export function rememberLocalSsh(host: SshConfigHost): LocalSshConnector {
  const id = `sshcfg:${host.alias}`;
  const next: LocalSshConnector = {
    id,
    alias: host.alias,
    label: host.user ? `${host.user}@${host.alias}` : host.alias,
    host: host.hostName || host.alias,
    user: host.user,
    port: host.port || "22",
    connectedAt: new Date().toISOString(),
  };
  const items = readLocal().filter((item) => item.id !== id && item.alias !== host.alias);
  items.unshift(next);
  writeLocal(items);
  return next;
}

export function forgetLocalSsh(id: string): void {
  writeLocal(readLocal().filter((item) => item.id !== id));
}

export function localSshAlias(id: string): string | null {
  return readLocal().find((item) => item.id === id)?.alias ?? null;
}
