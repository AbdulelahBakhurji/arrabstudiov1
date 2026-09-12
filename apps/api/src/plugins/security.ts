import type { AuthPrincipal } from "@arrab/core";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthPrincipal;
  }
}

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request) => {
    request.principal = { type: "anonymous" };
  });
}
