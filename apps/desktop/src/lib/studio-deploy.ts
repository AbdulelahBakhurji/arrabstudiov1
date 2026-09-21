import { arrabApi } from "@/lib/api";
import type { StudioFile } from "@/lib/studio-catalog";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toBase64(content: string): string {
  if (content.startsWith("data:") && content.includes("base64,")) {
    return content.slice(content.indexOf("base64,") + 7);
  }
  // UTF-8 safe base64 in the browser
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function chunkString(value: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out.length ? out : [""];
}

/**
 * Write Studio project files to a remote SSH host via the Arrab connector.
 * Uses base64 chunks because SSH exec commands are length-capped.
 */
export async function deployFilesOverSsh(input: {
  connectorId: string;
  files: StudioFile[];
  remoteDir: string;
  onProgress?: (message: string) => void;
}): Promise<{ ok: true; remoteDir: string } | { ok: false; error: string }> {
  const root = input.remoteDir.trim().replace(/\/+$/, "") || "~/arrab-studio-site";
  const mkdir = await arrabApi.sshExec(input.connectorId, {
    command: `mkdir -p ${shellQuote(root)}`,
  });
  if ((mkdir.code ?? 1) !== 0) {
    return { ok: false, error: mkdir.stderr || mkdir.stdout || "Could not create remote folder." };
  }

  const files = input.files.filter((file) => !(file.path.endsWith(".gitkeep") && !file.content));
  for (const file of files) {
    const remotePath = `${root}/${file.path.replace(/^\/+/, "")}`;
    const dir = remotePath.includes("/") ? remotePath.slice(0, remotePath.lastIndexOf("/")) : root;
    input.onProgress?.(`Writing ${file.path}…`);
    const prep = await arrabApi.sshExec(input.connectorId, {
      command: `mkdir -p ${shellQuote(dir)} && : > ${shellQuote(`${remotePath}.b64`)}`,
    });
    if ((prep.code ?? 1) !== 0) {
      return { ok: false, error: prep.stderr || `Failed preparing ${file.path}` };
    }

    const b64 = toBase64(file.content);
    for (const part of chunkString(b64, 2800)) {
      const append = await arrabApi.sshExec(input.connectorId, {
        command: `printf %s ${shellQuote(part)} >> ${shellQuote(`${remotePath}.b64`)}`,
      });
      if ((append.code ?? 1) !== 0) {
        return { ok: false, error: append.stderr || `Failed writing ${file.path}` };
      }
    }

    const finish = await arrabApi.sshExec(input.connectorId, {
      command: `base64 -d ${shellQuote(`${remotePath}.b64`)} > ${shellQuote(remotePath)} && rm -f ${shellQuote(`${remotePath}.b64`)}`,
    });
    if ((finish.code ?? 1) !== 0) {
      // busybox / older hosts sometimes use `base64 -D`
      const alt = await arrabApi.sshExec(input.connectorId, {
        command: `(base64 -D ${shellQuote(`${remotePath}.b64`)} 2>/dev/null || base64 --decode ${shellQuote(`${remotePath}.b64`)}) > ${shellQuote(remotePath)} && rm -f ${shellQuote(`${remotePath}.b64`)}`,
      });
      if ((alt.code ?? 1) !== 0) {
        return { ok: false, error: finish.stderr || alt.stderr || `Failed decoding ${file.path}` };
      }
    }
  }

  input.onProgress?.("Done");
  return { ok: true, remoteDir: root };
}

/** Read a browser File into a Studio project file (text or data-URL for binaries). */
export async function fileToStudioFile(file: File, folder = "assets"): Promise<{ path: string; content: string }> {
  const safeName = file.name.replace(/[^\w.\-()+ ]+/g, "_").replace(/\s+/g, "-") || "upload.bin";
  const path = `${folder.replace(/\/+$/, "")}/${safeName}`;
  const isText =
    file.type.startsWith("text/") ||
    /\.(html?|css|js|ts|tsx|jsx|json|md|svg|txt|csv|xml|yml|yaml)$/i.test(safeName);

  if (isText && file.size < 1_500_000) {
    const content = await file.text();
    return { path, content };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
  return { path, content: dataUrl };
}
