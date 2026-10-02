import type { BillingCheckoutRequest, BillingTopUpRequest } from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { RouteHelpers, V1Deps } from "../../http/deps.js";

export function registerBillingRoutes(app: FastifyInstance, deps: V1Deps, { assertCap, assertOwnerSession }: RouteHelpers): void {
  app.get("/v1/billing/plans", async () => deps.billing.catalog());

  app.post<{ Body: BillingCheckoutRequest }>("/v1/billing/checkout", async (request) => {
    assertOwnerSession(request, "Only the account owner can manage billing");
    await assertCap(request, "canAdminister", "Only admins can change organization plans");
    return deps.billing.checkout(request.body?.planId ?? "");
  });

  app.post<{ Body: BillingTopUpRequest }>("/v1/billing/top-up", async (request) => {
    assertOwnerSession(request, "Only the account owner can manage billing");
    await assertCap(request, "canAdminister", "Only admins can add usage for the organization");
    if (typeof request.body?.amountSar === "number") {
      return deps.billing.checkoutCustomCredit(request.body.amountSar);
    }
    return deps.billing.checkoutTopUp(request.body?.packId ?? "");
  });

  app.get<{ Querystring: { id?: string; invoice?: string } }>(
    "/v1/billing/confirm",
    async (request) =>
      deps.billing.confirmInvoice(request.query.id ?? request.query.invoice ?? ""),
  );

  app.post("/v1/billing/moyasar/callback", async (request) =>
    deps.billing.handleCallback(request.body),
  );
}
