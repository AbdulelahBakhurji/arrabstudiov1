import type {
  ConnectAccountRequest,
  ConnectAccountResponse,
  AccountStatusResponse,
  AccountSessionPublic,
  ActivateSubscriptionRequest,
  CorrectAccountPlanRequest,
  BillingCheckoutRequest,
  BillingCheckoutResponse,
  BillingTopUpRequest,
  BillingTopUpResponse,
  SignInAccountRequest,
  StartWebAuthRequest,
  StartWebAuthResponse,
  PollWebAuthResponse,
  UpdateAccountProfileRequest,
  VerifyAccountSessionRequest,
  UsageSummaryResponse,
} from "@arrab/shared";
import { request } from "@/core/api/http";

export type AccountSessionsResponse = { sessions: AccountSessionPublic[] };

export const accountApi = {
  account: () => request<AccountStatusResponse>("/v1/account", { timeoutMs: 15_000 }),
  connectAccount: (body: ConnectAccountRequest) =>
    request<ConnectAccountResponse>("/v1/account/connect", { method: "POST", body }),
  signInAccount: (body: SignInAccountRequest) =>
    request<ConnectAccountResponse>("/v1/account/sign-in", { method: "POST", body }),
  disconnectAccount: () =>
    request<AccountStatusResponse>("/v1/account/disconnect", { method: "POST" }),
  logoutAccount: () => request<AccountStatusResponse>("/v1/account/logout", { method: "POST" }),
  listAccountSessions: () => request<AccountSessionsResponse>("/v1/account/sessions"),
  revokeAccountSession: (sessionId: string) =>
    request<AccountSessionsResponse>(`/v1/account/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),
  /** Sign out other devices. Pass `includeCurrent: true` to end this device too. */
  revokeAllAccountSessions: (body: { includeCurrent?: boolean } = {}) =>
    request<AccountSessionsResponse>("/v1/account/sessions/revoke-all", {
      method: "POST",
      body,
    }),
  startWebAuth: (body: StartWebAuthRequest = {}) =>
    request<StartWebAuthResponse>("/v1/account/auth/web/start", {
      method: "POST",
      body,
      timeoutMs: 20_000,
    }),
  pollWebAuth: (state: string, pollSecret: string) =>
    request<PollWebAuthResponse>(
      `/v1/account/auth/web/poll?state=${encodeURIComponent(state)}&pollSecret=${encodeURIComponent(pollSecret)}`,
      { timeoutMs: 15_000 },
    ),
  activateSubscription: (body: ActivateSubscriptionRequest) =>
    request<AccountStatusResponse>("/v1/account/subscribe", { method: "POST", body }),
  /** Fix mistaken Scale (org) → Solo / Studio / Pro (individual). */
  correctAccountPlan: (body: CorrectAccountPlanRequest) =>
    request<AccountStatusResponse>("/v1/account/plan/correct", { method: "POST", body }),
  updateAccountProfile: (body: UpdateAccountProfileRequest) =>
    request<AccountStatusResponse>("/v1/account", { method: "PATCH", body }),
  verifyAccountSession: (body: VerifyAccountSessionRequest, timeoutMs = 12_000) =>
    request<AccountStatusResponse>("/v1/account/session", {
      method: "POST",
      body,
      timeoutMs,
    }),
  billingCheckout: (body: BillingCheckoutRequest) =>
    request<BillingCheckoutResponse>("/v1/billing/checkout", { method: "POST", body }),
  billingTopUp: (body: BillingTopUpRequest) =>
    request<BillingTopUpResponse>("/v1/billing/top-up", { method: "POST", body }),
  billingConfirm: (invoiceId: string) =>
    request<AccountStatusResponse>(`/v1/billing/confirm?invoice=${encodeURIComponent(invoiceId)}`),
  usage: () => request<UsageSummaryResponse>("/v1/usage"),
};
