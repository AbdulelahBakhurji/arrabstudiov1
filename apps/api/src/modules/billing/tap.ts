import { createHmac, timingSafeEqual } from "node:crypto";
import { ServiceUnavailableError, ValidationError } from "@arrab/core";

const TAP_API = "https://api.tap.company/v2";
const TAP_TIMEOUT_MS = 15_000;

/** Currencies Tap expects with 3 decimal places. Everything else (incl. SAR) is 2. */
const THREE_DECIMAL = new Set(["KWD", "BHD", "OMR", "JOD"]);

export interface TapCharge {
  id: string;
  /** Tap status: INITIATED, CAPTURED, FAILED, … */
  status: string;
  /** Major units from Tap (e.g. 49.00 SAR). */
  amount: number;
  /** Smallest currency unit used across Arrab billing (halalas for SAR). */
  amountHalalas: number;
  currency: string;
  description: string | null;
  /** Hosted checkout URL (`transaction.url`) when status is INITIATED. */
  url: string | null;
  metadata?: Record<string, string> | null;
  reference?: { gateway?: string | null; payment?: string | null } | null;
  transactionCreated?: string | null;
}

export interface CreateTapChargeInput {
  /** Amount in Arrab smallest units (halalas for SAR). */
  amountHalalas: number;
  currency: string;
  description: string;
  /** Webhook URL — Tap POSTs the charge payload here. */
  postUrl: string;
  /** Browser redirect after payment. */
  redirectUrl: string;
  customer: { email: string; firstName: string };
  metadata: Record<string, string>;
}

export type TapWebhookHashInput = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reference?: { gateway?: string | null; payment?: string | null } | null;
  transactionCreated?: string | null;
};

export interface TapClient {
  createCharge(input: CreateTapChargeInput): Promise<TapCharge>;
  getCharge(id: string): Promise<TapCharge>;
  /** True when the `hashstring` header matches Tap's HMAC over the charge fields. */
  verifyWebhookHash(charge: TapWebhookHashInput, hashstring: string | undefined): boolean;
}

export function halalasToMajor(halalas: number, currency: string): number {
  const decimals = THREE_DECIMAL.has(currency.toUpperCase()) ? 3 : 2;
  return Math.round(halalas) / 10 ** decimals;
}

export function majorToHalalas(amount: number, currency: string): number {
  const decimals = THREE_DECIMAL.has(currency.toUpperCase()) ? 3 : 2;
  return Math.round(Number(amount) * 10 ** decimals);
}

function formatAmountForHash(amount: number, currency: string): string {
  const decimals = THREE_DECIMAL.has(currency.toUpperCase()) ? 3 : 2;
  return Number(amount).toFixed(decimals);
}

export function computeTapHashstring(
  secretKey: string,
  charge: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    reference?: { gateway?: string | null; payment?: string | null } | null;
    transactionCreated?: string | null;
  },
): string {
  const toHash =
    `x_id${charge.id}` +
    `x_amount${formatAmountForHash(charge.amount, charge.currency)}` +
    `x_currency${charge.currency}` +
    `x_gateway_reference${charge.reference?.gateway ?? ""}` +
    `x_payment_reference${charge.reference?.payment ?? ""}` +
    `x_status${charge.status}` +
    `x_created${charge.transactionCreated ?? ""}`;
  return createHmac("sha256", secretKey).update(toHash).digest("hex");
}

function normalizeMetadata(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

function mapCharge(raw: Record<string, unknown>): TapCharge {
  const currency = typeof raw.currency === "string" ? raw.currency : "SAR";
  const amount = typeof raw.amount === "number" ? raw.amount : Number(raw.amount ?? 0);
  const transaction =
    raw.transaction && typeof raw.transaction === "object"
      ? (raw.transaction as Record<string, unknown>)
      : null;
  const reference =
    raw.reference && typeof raw.reference === "object"
      ? (raw.reference as Record<string, unknown>)
      : null;
  const url = typeof transaction?.url === "string" ? transaction.url : null;
  return {
    id: String(raw.id ?? ""),
    status: String(raw.status ?? ""),
    amount,
    amountHalalas: majorToHalalas(amount, currency),
    currency,
    description: typeof raw.description === "string" ? raw.description : null,
    url,
    metadata: normalizeMetadata(raw.metadata),
    reference: {
      gateway: typeof reference?.gateway === "string" ? reference.gateway : null,
      payment: typeof reference?.payment === "string" ? reference.payment : null,
    },
    transactionCreated:
      transaction?.created != null ? String(transaction.created) : null,
  };
}

async function parseTapError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ description?: string; code?: string }>;
      message?: string;
    };
    const first = body.errors?.[0]?.description;
    if (first) return first;
    if (body.message) return body.message;
  } catch {
    // ignore
  }
  return `Tap request failed (${response.status})`;
}

export class HttpTapClient implements TapClient {
  constructor(private readonly secretKey: string) {}

  private async request(path: string, init?: RequestInit): Promise<TapCharge> {
    let response: Response;
    try {
      response = await fetch(`${TAP_API}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TAP_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new ServiceUnavailableError("The payment provider did not respond. Try again in a moment.");
    }
    if (!response.ok) {
      throw new ValidationError(await parseTapError(response));
    }
    return mapCharge((await response.json()) as Record<string, unknown>);
  }

  async createCharge(input: CreateTapChargeInput): Promise<TapCharge> {
    const amount = halalasToMajor(input.amountHalalas, input.currency);
    const body = {
      amount,
      currency: input.currency,
      threeDSecure: true,
      save_card: false,
      customer_initiated: true,
      description: input.description,
      metadata: input.metadata,
      receipt: { email: true, sms: false },
      customer: {
        first_name: input.customer.firstName.slice(0, 64) || "Arrab",
        email: input.customer.email,
      },
      source: { id: "src_all" },
      redirect: { url: input.redirectUrl },
      post: { url: input.postUrl },
    };
    return this.request("/charges", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getCharge(id: string): Promise<TapCharge> {
    const trimmed = id.trim();
    if (!trimmed) {
      throw new ValidationError("Charge id is required");
    }
    return this.request(`/charges/${encodeURIComponent(trimmed)}`);
  }

  verifyWebhookHash(charge: TapWebhookHashInput, hashstring: string | undefined): boolean {
    const posted = hashstring?.trim() ?? "";
    if (!posted) return false;
    const expected = computeTapHashstring(this.secretKey, charge);
    try {
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(posted, "utf8");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

export function createTapClient(secretKey: string | undefined): TapClient | null {
  const key = secretKey?.trim();
  if (!key) return null;
  return new HttpTapClient(key);
}

export function requireTapClient(client: TapClient | null): TapClient {
  if (!client) {
    throw new ServiceUnavailableError(
      "Tap Payments is not configured yet. Add TAP_SECRET_KEY on the API, then try again.",
    );
  }
  return client;
}

/** CAPTURED is the success state for a hosted charge. */
export function isTapChargePaid(status: string): boolean {
  return status.toUpperCase() === "CAPTURED";
}
