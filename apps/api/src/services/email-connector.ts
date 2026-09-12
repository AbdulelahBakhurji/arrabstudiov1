import { ValidationError } from "@arrab/core";
import type {
  ConnectorResource,
  EmailMessageDetail,
  EmailMessageSummary,
  SendEmailResponse,
} from "@arrab/shared";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export type EmailSecret = {
  kind: "email";
  address: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
};

export const EMAIL_PRESETS: Record<
  string,
  { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; secure: boolean }
> = {
  gmail: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    secure: true,
  },
  outlook: {
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    secure: false,
  },
  icloud: {
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    secure: false,
  },
  yahoo: {
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    secure: true,
  },
};

export function parseEmailSecret(raw: string): EmailSecret | null {
  try {
    const parsed = JSON.parse(raw) as Partial<EmailSecret>;
    if (parsed.kind !== "email" || !parsed.address || !parsed.password || !parsed.imapHost) {
      return null;
    }
    return {
      kind: "email",
      address: parsed.address,
      password: parsed.password,
      imapHost: parsed.imapHost,
      imapPort: Number(parsed.imapPort) || 993,
      smtpHost: parsed.smtpHost || parsed.imapHost.replace(/^imap/i, "smtp"),
      smtpPort: Number(parsed.smtpPort) || 465,
      secure: parsed.secure !== false,
    };
  } catch {
    return null;
  }
}

export function buildEmailSecret(input: {
  address: string;
  password: string;
  imapHost: string;
  imapPort?: number | string;
  smtpHost: string;
  smtpPort?: number | string;
  secure?: boolean | string;
}): EmailSecret {
  const address = input.address.trim();
  const password = input.password.trim();
  if (!address.includes("@") || password.length < 4) {
    throw new ValidationError("Email address and app password are required");
  }
  const imapHost = input.imapHost.trim();
  const smtpHost = input.smtpHost.trim();
  if (!imapHost || !smtpHost) {
    throw new ValidationError("IMAP and SMTP hosts are required");
  }
  return {
    kind: "email",
    address,
    password,
    imapHost,
    imapPort: Number(input.imapPort) || 993,
    smtpHost,
    smtpPort: Number(input.smtpPort) || 465,
    secure: input.secure === false || input.secure === "false" ? false : true,
  };
}

async function withImap<T>(secret: EmailSecret, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: secret.imapHost,
    port: secret.imapPort,
    secure: true,
    auth: { user: secret.address, pass: secret.password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 16_000,
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export async function verifyEmailSecret(secret: EmailSecret): Promise<{ label: string; scopes: string[] }> {
  await withImap(secret, async (client) => {
    const boxes = await client.list();
    if (!boxes || boxes.length === 0) {
      throw new ValidationError("IMAP connected but no mailboxes were returned");
    }
  });
  // SMTP smoke: create transport and verify
  const transport = nodemailer.createTransport({
    host: secret.smtpHost,
    port: secret.smtpPort,
    secure: secret.smtpPort === 465 || secret.secure,
    auth: { user: secret.address, pass: secret.password },
    connectionTimeout: 16_000,
  });
  try {
    await transport.verify();
  } catch (err: unknown) {
    // Some providers block SMTP verify; IMAP success is enough to connect.
    const message = err instanceof Error ? err.message : String(err);
    if (/imap/i.test(message)) {
      throw new ValidationError(message);
    }
  } finally {
    transport.close();
  }
  return {
    label: secret.address,
    scopes: ["imap", "smtp", "inbox", "send"],
  };
}

export async function listEmailMailboxes(secret: EmailSecret): Promise<ConnectorResource[]> {
  return withImap(secret, async (client) => {
    const boxes = await client.list();
    return boxes.slice(0, 80).map((box) => ({
      id: box.path,
      name: box.path,
      url: null,
      kind: box.specialUse || (box.subscribed ? "mailbox" : "folder"),
    }));
  });
}

function addressText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const entry = item as { name?: string; address?: string };
        return entry.name ? `${entry.name} <${entry.address ?? ""}>` : entry.address ?? "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    const entry = value as { name?: string; address?: string };
    return entry.name ? `${entry.name} <${entry.address ?? ""}>` : entry.address ?? "";
  }
  return String(value);
}

export async function listEmailMessages(
  secret: EmailSecret,
  mailbox = "INBOX",
  limit = 30,
): Promise<EmailMessageSummary[]> {
  return withImap(secret, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const exists = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists : 0;
      if (!exists) return [];
      const start = Math.max(1, exists - limit + 1);
      const items: EmailMessageSummary[] = [];
      for await (const msg of client.fetch(`${start}:*`, {
        uid: true,
        flags: true,
        envelope: true,
      })) {
        const envelope = msg.envelope;
        const subject = envelope?.subject?.trim() || "(no subject)";
        const from = addressText(envelope?.from) || "unknown";
        const date = envelope?.date ? new Date(envelope.date).toISOString() : null;
        const seen = Boolean(msg.flags?.has("\\Seen"));
        items.push({
          id: String(msg.uid),
          subject,
          from,
          date,
          seen,
          snippet: null,
        });
      }
      return items.reverse();
    } finally {
      lock.release();
    }
  });
}

export async function readEmailMessage(
  secret: EmailSecret,
  uid: string,
  mailbox = "INBOX",
): Promise<EmailMessageDetail> {
  return withImap(secret, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const message = await client.fetchOne(
        uid,
        { uid: true, flags: true, envelope: true, source: true },
        { uid: true },
      );
      if (!message) {
        throw new ValidationError("Email message not found");
      }
      const envelope = message.envelope;
      const rawSource = message.source as unknown;
      const source = Buffer.isBuffer(rawSource)
        ? rawSource.toString("utf8")
        : typeof rawSource === "string"
          ? rawSource
          : "";
      const textMatch = source.match(/\r?\n\r?\n([\s\S]*)$/);
      const text = textMatch?.[1]?.trim() || source.slice(0, 8000);
      return {
        id: String(message.uid ?? uid),
        subject: envelope?.subject?.trim() || "(no subject)",
        from: addressText(envelope?.from) || "unknown",
        to: (envelope?.to ?? []).map((item) => addressText(item)).filter(Boolean),
        cc: (envelope?.cc ?? []).map((item) => addressText(item)).filter(Boolean),
        date: envelope?.date ? new Date(envelope.date).toISOString() : null,
        seen: Boolean(message.flags?.has("\\Seen")),
        snippet: text.replace(/\s+/g, " ").slice(0, 160),
        text: text.slice(0, 20_000),
        html: null,
      };
    } finally {
      lock.release();
    }
  });
}

export async function sendEmailMessage(
  secret: EmailSecret,
  input: { to: string; subject: string; text: string; cc?: string | null; html?: string | null },
): Promise<SendEmailResponse> {
  const to = input.to.trim();
  const subject = input.subject.trim();
  const text = input.text.trim();
  if (!to || !subject || !text) {
    throw new ValidationError("to, subject, and text are required");
  }
  const transport = nodemailer.createTransport({
    host: secret.smtpHost,
    port: secret.smtpPort,
    secure: secret.smtpPort === 465 || secret.secure,
    auth: { user: secret.address, pass: secret.password },
    connectionTimeout: 20_000,
  });
  try {
    const info = await transport.sendMail({
      from: secret.address,
      to,
      cc: input.cc?.trim() || undefined,
      subject,
      text,
      html: input.html?.trim() || undefined,
    });
    return {
      messageId: info.messageId ?? null,
      accepted: (info.accepted ?? []).map(String),
    };
  } finally {
    transport.close();
  }
}
