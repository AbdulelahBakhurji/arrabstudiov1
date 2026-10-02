import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertWorkspaceRelative, shellQuote } from "@/domains/chat/shell-safety";
import { normalizeBrowserAddress, safeHttpUrl } from "@/shared/lib/safe-url";

describe("shellQuote", () => {
  const hostile = [
    "$(touch /tmp/arrab-pwned)",
    "`touch /tmp/arrab-pwned`",
    'a"; touch /tmp/arrab-pwned; echo "',
    "it's; touch /tmp/arrab-pwned #",
    "a\nb",
    "*",
    "-rf",
  ];
  it.skipIf(process.platform === "win32").each(hostile)(
    "reaches a real shell as one literal word: %j",
    (value) => {
      const out = execFileSync("/bin/sh", ["-c", `printf '%s' ${shellQuote(value)}`], {
        encoding: "utf8",
      });
      expect(out).toBe(value);
    },
  );
});

describe("assertWorkspaceRelative", () => {
  it("accepts ordinary relative paths", () => {
    expect(assertWorkspaceRelative("src/app.ts")).toBe("src/app.ts");
    expect(assertWorkspaceRelative("./docs\\guide.md")).toBe("docs/guide.md");
    expect(assertWorkspaceRelative("مستند/ملف.pdf")).toBe("مستند/ملف.pdf");
  });
  it.each([
    "",
    "/etc/passwd",
    "C:\\Windows\\x",
    "~/.ssh/id_rsa",
    "../x",
    "a/../../x",
    "a\0b",
    "-rf",
    "a\nb",
  ])("rejects %j", (bad) => {
    expect(() => assertWorkspaceRelative(bad)).toThrow();
  });
});

describe("safe-url", () => {
  it("only lets plain http(s) URLs through", () => {
    expect(safeHttpUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "blob:https://x/1",
      "https://u:p@x.com",
      "https://x.com/a b",
      "",
      null,
    ]) {
      expect(safeHttpUrl(bad as string | null), String(bad)).toBeNull();
    }
  });
  it("treats a bare host as https and rejects script schemes typed as addresses", () => {
    expect(normalizeBrowserAddress("example.com/x")).toBe("https://example.com/x");
    expect(normalizeBrowserAddress("localhost:3000/app")).toBe("https://localhost:3000/app");
    expect(normalizeBrowserAddress("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserAddress("data:text/html,<script>1</script>")).toBeNull();
  });
});
