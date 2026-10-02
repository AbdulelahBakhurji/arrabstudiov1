/**
 * Reusable QA fixtures: a studio on a given plan with every kind of actor already signed in.
 * Tests call `bootWorld({ plan: "business" })` and then act as `world.as.owner / employee.member / child …`.
 */
import type { FastifyInstance } from "fastify";
import { buildApp, createApiContext, type ApiContext } from "../app.js";
import { makeTestEnv } from "./env.js";
import { FakeProvider } from "./fake-provider.js";

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON fixtures

export type PlanCode =
  | "FREE-ARRAB"
  | "SOLO-ARRAB"
  | "STUDIO-ARRAB"
  | "PRO-ARRAB"
  | "FAMILY-FREE-ARRAB"
  | "FAMILY-ARRAB"
  | "FAMILY-PLUS-ARRAB"
  | "TEAM-ARRAB"
  | "BUSINESS-ARRAB"
  | "ENTERPRISE-ARRAB"
  | "SCALE-ARRAB";

export const PLAN_CODE: Record<string, PlanCode> = {
  free: "FREE-ARRAB",
  solo: "SOLO-ARRAB",
  studio: "STUDIO-ARRAB",
  pro: "PRO-ARRAB",
  family_free: "FAMILY-FREE-ARRAB",
  family: "FAMILY-ARRAB",
  family_plus: "FAMILY-PLUS-ARRAB",
  team: "TEAM-ARRAB",
  business: "BUSINESS-ARRAB",
  enterprise: "ENTERPRISE-ARRAB",
  unlimited: "SCALE-ARRAB",
};

export type Headers = Record<string, string>;
export interface Reply {
  status: number;
  body: Json;
}
export type Caller = (method: string, url: string, payload?: unknown) => Promise<Reply>;

export interface World {
  app: FastifyInstance;
  context: ApiContext;
  /** Every actor as a ready-to-use caller. */
  as: {
    anonymous: Caller;
    owner: Caller;
    /** Org seats (only on organization plans). */
    employee?: { admin: Caller; manager: Caller; member: Caller };
    /** Family seats (only on family plans). */
    child?: Caller;
    partner?: Caller;
  };
  ownerToken: string;
  ids: { employees?: Json; familyMembers?: Json };
  /** Scriptable model provider registered as the studio's provider. */
  provider: FakeProvider;
  /** Record `tokens` of usage in the current billing period (as if chats had happened). */
  spendTokens(tokens: number): Promise<void>;
  close(): Promise<void>;
}

/** An agent + conversation for `who`, and a `send` that posts a chat message. */
export async function startChat(
  who: Caller,
): Promise<{
  agentId: string;
  conversationId: string;
  send: (content: string, extra?: Json) => Promise<Reply>;
}> {
  const agent = await who("POST", "/v1/agents", {
    name: "Analyst",
    role: "analysis",
    status: "active",
  });
  if (agent.status !== 200) throw new Error(`agent: ${agent.status} ${JSON.stringify(agent.body)}`);
  const conversation = await who("POST", "/v1/conversations", { agentId: agent.body.id });
  if (conversation.status !== 200)
    throw new Error(`conversation: ${conversation.status} ${JSON.stringify(conversation.body)}`);
  return {
    agentId: agent.body.id,
    conversationId: conversation.body.id,
    send: (content, extra = {}) =>
      who("POST", `/v1/conversations/${conversation.body.id}/messages`, { content, ...extra }),
  };
}

let counter = 0;

function caller(app: FastifyInstance, headers: Headers): Caller {
  return async (method, url, payload) => {
    const res = await app.inject({
      method: method as never,
      url,
      payload: payload as never,
      headers,
    });
    let body: Json = {};
    try {
      body = res.json() as Json;
    } catch {
      body = { raw: res.body };
    }
    return { status: res.statusCode, body };
  };
}

export async function bootWorld(
  options: {
    /** Plan id to put the studio on (default: free). Uses the dev-only redeem codes. */
    plan?: string;
    env?: Parameters<typeof makeTestEnv>[0];
    /** Create one seat per role / a child + partner seat. Default true. */
    seats?: boolean;
    /** Register the scriptable provider (default true). */
    provider?: boolean;
  } = {},
): Promise<World> {
  counter += 1;
  const plan = options.plan ?? "free";
  const context = await createApiContext(makeTestEnv({ allowPlanCodes: true, ...options.env }));
  const app = await buildApp(context);
  const connect = await app.inject({
    method: "POST",
    url: "/v1/account/connect",
    payload: {
      email: `owner${counter}@arrab.studio`,
      password: "securepass",
      displayName: "Owner",
    },
  });
  const ownerToken = (connect.json() as { sessionToken: string }).sessionToken;
  const ownerHeaders = { authorization: `Bearer ${ownerToken}` };
  const owner = caller(app, ownerHeaders);
  if (plan !== "free") {
    const res = await owner("POST", "/v1/account/subscribe", { code: PLAN_CODE[plan] });
    if (res.status !== 200)
      throw new Error(`could not put studio on ${plan}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const provider = new FakeProvider("bedrock");
  if (options.provider !== false) context.aiGateway.register(provider);
  const world: World = {
    app,
    context,
    provider,
    spendTokens: async (tokens) => {
      await context.persistence.usage.append({
        id: `use_${Math.random().toString(36).slice(2)}`,
        workspaceId: context.persistence.workspaceId,
        conversationId: null,
        agentId: null,
        providerId: "bedrock",
        model: "amazon.nova-lite-v1:0",
        inputTokens: Math.floor(tokens / 2),
        outputTokens: tokens - Math.floor(tokens / 2),
        createdAt: new Date().toISOString(),
      } as never);
    },
    as: { anonymous: caller(app, {}), owner },
    ownerToken,
    ids: {},
    close: async () => {
      await app.close();
    },
  };

  const audience = (await owner("GET", "/v1/account")).body.account?.planId as string;
  const isOrg = ["team", "business", "enterprise", "unlimited"].includes(audience);
  const isFamily = ["family_free", "family", "family_plus"].includes(audience);

  if (options.seats !== false && isOrg) {
    const employees: Json = {};
    const callers: Record<string, Caller> = {};
    for (const role of ["admin", "manager", "member"] as const) {
      const email = `${role}${counter}@corp.test`;
      const created = await owner("POST", "/v1/org/employees", {
        email,
        password: "Seat-Pass-1a",
        displayName: role,
        role,
      });
      if (created.status !== 200)
        throw new Error(`employee ${role}: ${created.status} ${JSON.stringify(created.body)}`);
      employees[role] = created.body;
      let signIn = await caller(app, {})("POST", "/v1/org/employees/sign-in", {
        email,
        password: "Seat-Pass-1a",
      });
      if (signIn.status !== 200)
        throw new Error(`sign-in ${role}: ${signIn.status} ${JSON.stringify(signIn.body)}`);
      let token = signIn.body.sessionToken as string;
      // Seats start with a temporary password; clear that gate like a real user would.
      if (signIn.body.employee?.mustChangePassword) {
        const changed = await caller(app, { "x-arrab-employee-session": token, ...ownerHeaders })(
          "POST",
          "/v1/org/employees/change-password",
          {
            currentPassword: "Seat-Pass-1a",
            newPassword: "Seat-Pass-2b",
          },
        );
        if (changed.status !== 200)
          throw new Error(
            `change-password ${role}: ${changed.status} ${JSON.stringify(changed.body)}`,
          );
        signIn = await caller(app, {})("POST", "/v1/org/employees/sign-in", {
          email,
          password: "Seat-Pass-2b",
        });
        token = signIn.body.sessionToken as string;
      }
      // A seat authenticates with its own session only — never the owner's account token.
      callers[role] = caller(app, { "x-arrab-employee-session": token });
    }
    world.as.employee = {
      admin: callers.admin!,
      manager: callers.manager!,
      member: callers.member!,
    };
    world.ids.employees = employees;
  }

  if (options.seats !== false && isFamily) {
    const members: Json = {};
    const add = async (name: string, role: string, extra: Json) => {
      const email = `${name}${counter}@home.test`;
      const created = await owner("POST", "/v1/family/members", {
        displayName: name,
        role,
        email,
        password: "kidpassword",
        ...extra,
      });
      if (created.status !== 200)
        throw new Error(`family ${name}: ${created.status} ${JSON.stringify(created.body)}`);
      members[name] = { ...created.body, email };
    };
    await add("kid", "child", { ageTier: "tier_10_13" });
    await add("partner", "partner", {});
    world.ids.familyMembers = members;
  }
  return world;
}

/** Sign a family seat in and return a caller bound to the session it received. */
export async function signInFamilySeat(world: World, name: string): Promise<Caller> {
  const member = world.ids.familyMembers?.[name];
  const res = await world.as.anonymous("POST", "/v1/family/members/sign-in", {
    email: member.email,
    password: "kidpassword",
  });
  if (res.status !== 200)
    throw new Error(`family sign-in ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return caller(world.app, { authorization: `Bearer ${res.body.sessionToken}` });
}
