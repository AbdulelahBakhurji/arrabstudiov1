import { ServiceUnavailableError, ValidationError } from "@arrab/core";

const MOYASAR_API = "https://api.moyasar.com/v1";

export interface MoyasarInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string | null;
  url: string | null;
  amount_format?: string;
  metadata?: Record<string, string> | null;
}

export interface CreateMoyasarInvoiceInput {
  amount: number;
  currency: string;
  description: string;
  callbackUrl: string;
  successUrl: string;
  backUrl: string;
  metadata: Record<string, string>;
}

export interface MoyasarClient {
  createInvoice(input: CreateMoyasarInvoiceInput): Promise<MoyasarInvoice>;
  getInvoice(id: string): Promise<MoyasarInvoice>;
}

function moyasarAuthHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

async function parseMoyasarError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; type?: string };
    if (body.message) {
      return body.message;
    }
  } catch {
    // ignore
  }
  return `Moyasar request failed (${response.status})`;
}

export class HttpMoyasarClient implements MoyasarClient {
  constructor(private readonly secretKey: string) {}

  private async request(path: string, init?: RequestInit): Promise<MoyasarInvoice> {
    const response = await fetch(`${MOYASAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: moyasarAuthHeader(this.secretKey),
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new ValidationError(await parseMoyasarError(response));
    }
    return (await response.json()) as MoyasarInvoice;
  }

  async createInvoice(input: CreateMoyasarInvoiceInput): Promise<MoyasarInvoice> {
    const body: Record<string, unknown> = {
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      callback_url: input.callbackUrl,
      success_url: input.successUrl,
      back_url: input.backUrl,
      metadata: input.metadata,
    };
    try {
      return await this.request("/invoices", {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      delete body.metadata;
      return this.request("/invoices", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
  }

  async getInvoice(id: string): Promise<MoyasarInvoice> {
    const trimmed = id.trim();
    if (!trimmed) {
      throw new ValidationError("Invoice id is required");
    }
    return this.request(`/invoices/${encodeURIComponent(trimmed)}`);
  }
}

export function createMoyasarClient(secretKey: string | undefined): MoyasarClient | null {
  const key = secretKey?.trim();
  if (!key) {
    return null;
  }
  return new HttpMoyasarClient(key);
}

export function requireMoyasarClient(client: MoyasarClient | null): MoyasarClient {
  if (!client) {
    throw new ServiceUnavailableError(
      "Moyasar billing is not configured yet. Add MOYASAR_SECRET_KEY on the API, then try again.",
    );
  }
  return client;
}
