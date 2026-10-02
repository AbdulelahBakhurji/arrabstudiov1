import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDom = await vi.hoisted(async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://arrab.test/",
    pretendToBeVisual: true,
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "Event",
    "CustomEvent",
    "localStorage",
  ]) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: (dom.window as unknown as Record<string, unknown>)[key],
    });
  }
  return dom;
});
afterAll(() => testDom.window.close());

const signInAccount = vi.fn();
const familyMemberSignIn = vi.fn();
const orgEmployeeSignIn = vi.fn();

vi.mock("@/core/api/api", () => ({
  arrabApi: {
    signInAccount: (...args: unknown[]) => signInAccount(...args),
    familyMemberSignIn: (...args: unknown[]) => familyMemberSignIn(...args),
    orgEmployeeSignIn: (...args: unknown[]) => orgEmployeeSignIn(...args),
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    code: string | null;
    constructor(message: string, status: number, code: string | null = null) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { ApiRequestError } from "@/core/api/api";
import { signInWithCredentials } from "@/domains/account/seat-sign-in";
import { readAccountSessionToken, clearAccountSession } from "@/core/session/account-session";
import {
  clearOrgEmployeeSession,
  readOrgEmployeeSession,
} from "@/domains/organization/org-employee-session";
import { readActiveFamilyMemberId } from "@/domains/family/family-session";
import { hasStudioCloudSession } from "@/domains/account/studio-session";

beforeEach(() => {
  localStorage.clear();
  clearAccountSession();
  clearOrgEmployeeSession();
  signInAccount.mockReset();
  familyMemberSignIn.mockReset();
  orgEmployeeSignIn.mockReset();
});

describe("signInWithCredentials", () => {
  it("uses account sign-in when credentials match the owner", async () => {
    signInAccount.mockResolvedValue({
      sessionToken: "a".repeat(40),
      account: { id: "acc_1", email: "owner@arrab.studio", displayName: "Owner" },
    });
    const result = await signInWithCredentials({
      email: "owner@arrab.studio",
      password: "securepass",
    });
    expect(result.kind).toBe("account");
    expect(readAccountSessionToken()).toBe("a".repeat(40));
    expect(readOrgEmployeeSession()).toBeNull();
    expect(hasStudioCloudSession()).toBe(true);
    expect(familyMemberSignIn).not.toHaveBeenCalled();
  });

  it("falls through to family seat and stores a seat-bound account session", async () => {
    signInAccount.mockRejectedValue(new ApiRequestError("Invalid email or password", 401));
    familyMemberSignIn.mockResolvedValue({
      sessionToken: "f".repeat(40),
      member: { id: "mem_kid", displayName: "Kid", email: "kid@arrab.studio" },
      account: { id: "acc_1", email: "parent@arrab.studio", displayName: "Parent" },
    });
    const result = await signInWithCredentials({
      email: "kid@arrab.studio",
      password: "kidpassword",
    });
    expect(result.kind).toBe("family");
    expect(readAccountSessionToken()).toBe("f".repeat(40));
    expect(readActiveFamilyMemberId()).toBe("mem_kid");
    expect(readOrgEmployeeSession()).toBeNull();
  });

  it("org employee sign-in clears any account bearer so the device is seat-scoped", async () => {
    localStorage.setItem("arrab.account.session", "o".repeat(40));
    signInAccount.mockRejectedValue(new ApiRequestError("Invalid email or password", 401));
    familyMemberSignIn.mockRejectedValue(new ApiRequestError("Invalid email or password", 401));
    orgEmployeeSignIn.mockResolvedValue({
      sessionToken: "e".repeat(40),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      employee: {
        id: "emp_1",
        email: "worker@co.test",
        displayName: "Worker",
        title: null,
        role: "member",
        departmentId: null,
        mustChangePassword: false,
      },
    });
    const result = await signInWithCredentials({
      email: "worker@co.test",
      password: "seatpass12",
    });
    expect(result.kind).toBe("organization");
    expect(readAccountSessionToken()).toBeNull();
    expect(readOrgEmployeeSession()?.sessionToken).toBe("e".repeat(40));
    expect(hasStudioCloudSession()).toBe(true);
    expect(localStorage.getItem("arrab.studioRole")).toBe("organization");
  });
});
