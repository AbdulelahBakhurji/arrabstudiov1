import { describe, expect, it } from "vitest";
import { guardianHardHit, toolResultAttestationPayload } from "./guardian-hard.js";
import { createHash } from "node:crypto";

describe("guardianHardHit", () => {
  it("flags self-harm and contact sharing", () => {
    expect(guardianHardHit("I want to kill myself")?.id).toBe("hard-self-harm");
    expect(guardianHardHit("message me on whatsapp")?.id).toBe("hard-contact");
    expect(guardianHardHit("help with math homework")).toBeNull();
  });
});

describe("toolResultAttestationPayload", () => {
  it("binds token to result for sha256", () => {
    const payload = toolResultAttestationPayload("abc", "ok");
    expect(payload).toBe("abc\nok");
    const hex = createHash("sha256").update(payload).digest("hex");
    expect(hex).toHaveLength(64);
  });
});
