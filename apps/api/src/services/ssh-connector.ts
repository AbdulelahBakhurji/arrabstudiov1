import { ValidationError } from "@arrab/core";
import type { ConnectorResource } from "@arrab/shared";
import { Client } from "ssh2";

export type SshSecret = {
  kind: "ssh";
  host: string;
  port: number;
  username: string;
  authMode: "password" | "key";
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export function buildSshSecret(input: {
  host: string;
  port?: string | number;
  username: string;
  authMode?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}): SshSecret {
  const host = input.host.trim();
  const username = input.username.trim();
  const authMode = input.authMode === "key" ? "key" : "password";
  const port = Number(input.port ?? 22);
  if (!host) throw new ValidationError("SSH host is required");
  if (!username) throw new ValidationError("SSH username is required");
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new ValidationError("SSH port must be between 1 and 65535");
  }
  if (authMode === "password") {
    const password = input.password?.trim() ?? "";
    if (password.length < 1) throw new ValidationError("SSH password is required");
    return { kind: "ssh", host, port, username, authMode, password };
  }
  const privateKey = input.privateKey?.trim() ?? "";
  if (privateKey.length < 32) {
    throw new ValidationError("SSH private key is required");
  }
  return {
    kind: "ssh",
    host,
    port,
    username,
    authMode,
    privateKey,
    passphrase: input.passphrase?.trim() || undefined,
  };
}

export function parseSshSecret(raw: string): SshSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SshSecret>;
    if (parsed.kind !== "ssh" || !parsed.host || !parsed.username) return null;
    return buildSshSecret({
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      authMode: parsed.authMode,
      password: parsed.password,
      privateKey: parsed.privateKey,
      passphrase: parsed.passphrase,
    });
  } catch {
    return null;
  }
}

function connectClient(secret: SshSecret, readyTimeoutMs = 12_000): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => {
      client.end();
      reject(new ValidationError("SSH connection timed out"));
    }, readyTimeoutMs);

    client
      .on("ready", () => {
        clearTimeout(timer);
        resolve(client);
      })
      .on("error", (error) => {
        clearTimeout(timer);
        reject(new ValidationError(error.message || "SSH connection failed"));
      })
      .connect({
        host: secret.host,
        port: secret.port,
        username: secret.username,
        password: secret.authMode === "password" ? secret.password : undefined,
        privateKey: secret.authMode === "key" ? secret.privateKey : undefined,
        passphrase: secret.authMode === "key" ? secret.passphrase : undefined,
        readyTimeout: readyTimeoutMs,
        tryKeyboard: false,
      });
  });
}

async function withSshClient<T>(
  secret: SshSecret,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connectClient(secret);
  try {
    return await run(client);
  } finally {
    client.end();
  }
}

export async function verifySshSecret(
  secret: SshSecret,
): Promise<{ label: string; scopes: string[] }> {
  const output = await execSshCommand(secret, "uname -a || ver || echo ok", 8_000);
  const hostLabel = `${secret.username}@${secret.host}:${secret.port}`;
  if (!output.stdout.trim() && output.code !== 0) {
    throw new ValidationError(output.stderr.trim() || "SSH verification failed");
  }
  return {
    label: hostLabel,
    scopes: ["ssh:exec", "ssh:list"],
  };
}

export async function listSshHomeEntries(
  secret: SshSecret,
  query?: string,
): Promise<ConnectorResource[]> {
  const q = (query ?? "").trim().toLowerCase();
  const script = [
    'home="${HOME:-/}"',
    'printf "home\\tdir\\t%s\\n" "$home"',
    'ls -1A "$home" 2>/dev/null | head -n 80 | while IFS= read -r name; do',
    '  path="$home/$name"',
    '  if [ -d "$path" ]; then kind=dir; else kind=file; fi',
    '  printf "%s\\t%s\\t%s\\n" "$name" "$kind" "$path"',
    "done",
  ].join("\n");
  const result = await execSshCommand(secret, script, 12_000);
  if (result.code !== 0 && !result.stdout.trim()) {
    throw new ValidationError(result.stderr.trim() || "Could not list remote home directory");
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, kind, path] = line.split("\t");
      return {
        id: path || name || cryptoRandom(),
        name: name || path || "entry",
        url: null,
        kind: kind === "dir" ? "directory" : kind === "home" ? "home" : "file",
      } satisfies ConnectorResource;
    })
    .filter((item) => !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q));
}

export type SshExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export async function execSshCommand(
  secret: SshSecret,
  command: string,
  timeoutMs = 20_000,
): Promise<SshExecResult> {
  const cmd = command.trim();
  if (!cmd) throw new ValidationError("SSH command is required");
  if (cmd.length > 4000) throw new ValidationError("SSH command is too long");

  return withSshClient(secret, (client) =>
    new Promise<SshExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end();
        reject(new ValidationError("SSH command timed out"));
      }, timeoutMs);

      client.exec(cmd, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          reject(new ValidationError(error.message || "SSH exec failed"));
          return;
        }
        let stdout = "";
        let stderr = "";
        stream
          .on("close", (code: number | null) => {
            clearTimeout(timer);
            resolve({
              code: typeof code === "number" ? code : null,
              stdout: stdout.slice(0, 80_000),
              stderr: stderr.slice(0, 20_000),
            });
          })
          .on("data", (chunk: Buffer | string) => {
            stdout += chunk.toString();
          });
        stream.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
      });
    }),
  );
}

function cryptoRandom(): string {
  return `ssh-${Math.random().toString(36).slice(2, 10)}`;
}
