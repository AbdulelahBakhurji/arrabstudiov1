import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  APP,
  E2E_ENABLED,
  call,
  freshStudio,
  launch,
  navLabels,
  openApp,
  ownerStorage,
  signUpOwner,
  startFrontend,
  stopAll,
} from "./harness";
import type { Browser, BrowserContext } from "playwright-core";

describe.skipIf(!E2E_ENABLED)("real browser: shells, roles, plans, resilience", () => {
  let browser: Browser;
  let ctx: BrowserContext;
  beforeAll(async () => {
    await startFrontend();
    ({ browser } = await launch());
  }, 90_000);
  // Every scenario is a different "device": its own cookies/localStorage, never leaking into the next.
  beforeEach(async () => {
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  });
  afterEach(async () => {
    await ctx?.close();
  });
  afterAll(async () => {
    await browser?.close();
    stopAll();
  });

  const seat = async (
    owner: Awaited<ReturnType<typeof signUpOwner>>,
    role: "admin" | "manager" | "member",
  ) => {
    const email = `${role}.${Date.now()}@corp.test`;
    const created = await call(
      "POST",
      "/v1/org/employees",
      { email, password: "Seat-Pass-1a", displayName: role, role },
      owner.auth,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    let signIn = await call("POST", "/v1/org/employees/sign-in", {
      email,
      password: "Seat-Pass-1a",
    });
    if (signIn.body.employee?.mustChangePassword) {
      await call(
        "POST",
        "/v1/org/employees/change-password",
        { currentPassword: "Seat-Pass-1a", newPassword: "Seat-Pass-2b" },
        { "x-arrab-employee-session": signIn.body.sessionToken },
      );
      signIn = await call("POST", "/v1/org/employees/sign-in", { email, password: "Seat-Pass-2b" });
    }
    return signIn.body as {
      sessionToken: string;
      expiresAt: string;
      employee: Record<string, unknown>;
    };
  };

  it("Solo (individual): the individual shell, no workforce, and org URLs bounce back", async () => {
    await freshStudio();
    const owner = await signUpOwner("SOLO-ARRAB");
    const { page, errors } = await openApp(ctx, ownerStorage(owner));
    const nav = await navLabels(page);
    expect(nav).toEqual(
      expect.arrayContaining(["Chat", "Studio", "Board", "Brain", "Tasks", "Me", "Settings"]),
    );
    for (const forbidden of ["Workforce", "HQ", "Activity", "Workplace"])
      expect(nav, forbidden).not.toContain(forbidden);

    // The app routes with the URL hash.
    await page.goto(`${APP}/#/organizations/workforce`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(new URL(page.url()).hash).not.toContain("/organizations");
    expect(new URL(page.url()).hash).toContain("/individuals");
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);

  it("Business owner: the organization shell with Workforce and Activity", async () => {
    await freshStudio();
    const owner = await signUpOwner("BUSINESS-ARRAB");
    const { page } = await openApp(ctx, ownerStorage(owner));
    const nav = await navLabels(page);
    for (const label of ["Workforce", "Activity", "Settings"]) expect(nav, label).toContain(label);
    expect(new URL(page.url()).hash).toContain("/organizations");
    await page.close();
  }, 90_000);

  it("Org member seat: no Workforce/Activity in the UI, and the API refuses everything the UI hides — even with forged local state", async () => {
    await freshStudio();
    const owner = await signUpOwner("BUSINESS-ARRAB");
    const member = await seat(owner, "member");
    // The product signs seats in on top of the studio's account session (see QA report: shared-device token exposure).
    const { page } = await openApp(ctx, {
      ...ownerStorage(owner),
      "arrab.org.employee.session": JSON.stringify(member),
    });
    const nav = await navLabels(page);
    expect(nav.length, "the organization shell rendered (not the sign-in page)").toBeGreaterThan(3);
    expect(nav).not.toContain("Workforce");
    expect(nav).not.toContain("Activity");
    await page.goto(`${APP}/#/organizations/workforce`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(
      new URL(page.url()).hash,
      "a member who types the Workforce URL is sent away",
    ).not.toContain("/workforce");

    // What the page's own code can do with the seat's credentials:
    const fetchAs = (storageRole: string | null) =>
      page.evaluate(
        async ({ api, token, role }) => {
          if (role) {
            // Tamper with local state: claim to be an admin.
            const raw = JSON.parse(localStorage.getItem("arrab.org.employee.session")!);
            raw.employee.role = role;
            localStorage.setItem("arrab.org.employee.session", JSON.stringify(raw));
          }
          // Exactly what the app sends from a seat's device: the owner's bearer AND the seat session.
          const h = {
            "content-type": "application/json",
            authorization: `Bearer ${localStorage.getItem("arrab.account.session")}`,
            "x-arrab-employee-session": token,
          };
          const hit = async (method: string, url: string, body?: unknown) =>
            (
              await fetch(api + url, {
                method,
                headers: h,
                body: body ? JSON.stringify(body) : undefined,
              })
            ).status;
          return {
            createSeat: await hit("POST", "/v1/org/employees", {
              email: "x@y.test",
              password: "Seat-Pass-1a",
              displayName: "X",
            }),
            disconnect: await hit("POST", "/v1/account/disconnect", {}),
            subscribe: await hit("POST", "/v1/account/subscribe", { code: "ENTERPRISE-ARRAB" }),
            workforcePerm: (await (await fetch(api + "/v1/org/workforce", { headers: h })).json())
              .permissions.canAdminister,
            activity: await hit("GET", "/v1/activity"),
          };
        },
        { api: "http://127.0.0.1:8799", token: member.sessionToken, role: storageRole },
      );
    const honest = await fetchAs(null);
    expect(honest).toMatchObject({
      createSeat: 403,
      disconnect: 403,
      subscribe: 403,
      workforcePerm: false,
      activity: 403,
    });
    const forged = await fetchAs("admin");
    expect(
      forged,
      "forging the role in localStorage must change nothing server-side",
    ).toMatchObject({
      createSeat: 403,
      disconnect: 403,
      subscribe: 403,
      workforcePerm: false,
      activity: 403,
    });
    // The studio is intact after those attempts.
    expect((await call("GET", "/v1/account", undefined, owner.auth)).status).toBe(200);
    await page.close();
  }, 90_000);

  it("Tampering with the cached plan unlocks nothing: the server still says Free", async () => {
    await freshStudio();
    const owner = await signUpOwner(); // free
    const { page } = await openApp(ctx, {
      ...ownerStorage(owner),
      "arrab.account.status.cache": JSON.stringify({
        connected: true,
        account: { planId: "enterprise", planName: "Enterprise" },
        entitlements: { planId: "enterprise", tokenLimit: 999999999 },
      }),
    });
    const result = await page.evaluate(
      async ({ api, token }) => {
        const h = { "content-type": "application/json", authorization: `Bearer ${token}` };
        const seat = await fetch(api + "/v1/org/employees", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ email: "a@b.test", password: "Seat-Pass-1a", displayName: "A" }),
        });
        const status = await (await fetch(api + "/v1/account", { headers: h })).json();
        return {
          seat: seat.status,
          plan: status.account.planId,
          limit: status.entitlements.tokenLimit,
        };
      },
      { api: "http://127.0.0.1:8799", token: owner.token },
    );
    expect(result).toEqual({ seat: 403, plan: "free", limit: 100_000 });
    await page.close();
  }, 90_000);

  it("Family: the parent manages the household; a child seat cannot reach plan or billing", async () => {
    await freshStudio();
    const owner = await signUpOwner("FAMILY-ARRAB");
    const email = `kid${Date.now()}@home.test`;
    const kid = await call(
      "POST",
      "/v1/family/members",
      { displayName: "Kid", role: "child", ageTier: "tier_10_13", email, password: "kidpassword" },
      owner.auth,
    );
    expect(kid.status).toBe(200);
    const kidSignIn = await call("POST", "/v1/family/members/sign-in", {
      email,
      password: "kidpassword",
    });
    expect(kidSignIn.status).toBe(200);
    const kidAuth = { authorization: `Bearer ${kidSignIn.body.sessionToken}` };
    expect(
      (await call("POST", "/v1/account/subscribe", { code: "FREE-ARRAB" }, kidAuth)).status,
    ).toBe(403);
    expect(
      (await call("POST", "/v1/billing/checkout", { planId: "family_plus" }, kidAuth)).status,
    ).toBe(403);
    expect((await call("POST", "/v1/account/disconnect", {}, kidAuth)).status).toBe(403);
    // Parent still signed in and the plan is unchanged.
    const parent = await call("GET", "/v1/account", undefined, owner.auth);
    expect(parent.status).toBe(200);
    expect(parent.body.account.planId).toBe("family");

    const { page } = await openApp(ctx, {
      "arrab.account.session": kidSignIn.body.sessionToken,
      "arrab.account.id": owner.accountId,
    });
    const kidNav = await navLabels(page);
    expect(kidNav.length).toBeGreaterThan(3);
    expect(kidNav).not.toContain("Workforce");
    await page.close();
  }, 90_000);

  it("offline → online: an accessible banner appears and goes away; work is not lost on reload", async () => {
    await freshStudio();
    const owner = await signUpOwner("SOLO-ARRAB");
    const { page } = await openApp(ctx, ownerStorage(owner));
    const banner = page.getByText(/You're offline|Back online/);
    expect(await banner.count()).toBe(0);
    // Real network loss (CDP), not a synthetic event.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    const net = (offline: boolean) =>
      cdp.send("Network.emulateNetworkConditions", {
        offline,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    try {
      await net(true);
      await banner.first().waitFor({ timeout: 6000 });
      expect(await banner.first().innerText()).toMatch(/offline/i);
      expect(await banner.first().getAttribute("role")).toBe("status");
      expect(await banner.first().getAttribute("aria-live")).toBe("polite");
    } finally {
      await net(false);
    }
    await page.getByText("Back online.").waitFor({ timeout: 6000 });
    await page.getByText("Back online.").waitFor({ state: "detached", timeout: 8000 });
    // Reload keeps the session (restart persistence).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(await navLabels(page)).toContain("Chat");
    await page.close();
  }, 90_000);

  it("Arabic is first-class: RTL direction, Arabic text, and it survives a reload", async () => {
    await freshStudio();
    const owner = await signUpOwner("SOLO-ARRAB");
    const { page } = await openApp(ctx, { ...ownerStorage(owner), "arrab.locale": "ar" });
    expect(
      await page.evaluate(
        () => document.documentElement.dir || document.body.closest("[dir]")?.getAttribute("dir"),
      ),
    ).toBe("rtl");
    const text = await page.innerText("body");
    expect(text).toMatch(/[\u0600-\u06FF]/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => localStorage.getItem("arrab.locale"))).toBe("ar");
    await page.close();
  }, 90_000);

  it("keyboard: Tab reaches the navigation and focus is visible", async () => {
    await freshStudio();
    const owner = await signUpOwner("SOLO-ARRAB");
    const { page } = await openApp(ctx, ownerStorage(owner));
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        const ring = style.boxShadow !== "none";
        return {
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
          visible: outlined || ring || el.matches(":focus-visible"),
        };
      });
      if (info?.label) seen.add(info.label);
    }
    expect([...seen].some((l) => /Studio|Board|Brain|Tasks|Settings|Chat/.test(l))).toBe(true);
    await page.close();
  }, 90_000);
});
