import { describe, expect, it } from "vitest";
import { messages } from "../apps/desktop/src/i18n/messages.ts";

describe("i18n", () => {
  it("every English key has an Arabic translation", () => {
    const enKeys = Object.keys(messages.en).sort();
    const arKeys = new Set(Object.keys(messages.ar));
    const missing = enKeys.filter((key) => !arKeys.has(key));
    expect(missing, `Missing Arabic keys: ${missing.join(", ")}`).toEqual([]);
  });

  it("every Arabic key exists in English", () => {
    const arKeys = Object.keys(messages.ar).sort();
    const enKeys = new Set(Object.keys(messages.en));
    const extra = arKeys.filter((key) => !enKeys.has(key));
    expect(extra, `Arabic-only keys: ${extra.join(", ")}`).toEqual([]);
  });
});
