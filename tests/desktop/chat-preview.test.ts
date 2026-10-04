import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/shared/i18n/LanguageProvider";
import {
  collectSources,
  extractLinks,
  forgetAttachmentsForTests,
  languageForName,
  parseAttachments,
  previewRequestUrl,
  rememberAttachments,
  rememberedFile,
  stripAttachmentBlocks,
  tokenizeCodeLine,
} from "@/domains/chat/lib/chat-sources";
import { ChatPreviewPanel, ChatSourceChip, type PreviewTarget } from "@/domains/chat/ui/ChatPreviewPanel";

const testDom = await vi.hoisted(async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://arrab.test/",
    pretendToBeVisual: true,
  });
  for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Event", "MouseEvent", "localStorage"]) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  return dom;
});
afterAll(() => testDom.window.close());

vi.mock("@/core/api/api", () => ({
  arrabApi: {
    unfurlUrl: vi.fn(async () => ({ error: "offline in tests" })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const MESSAGE = [
  "Please review these https://example.com/docs, thanks.",
  "[Attached file: app.ts]\nconst answer = 42; // the answer\nexport default answer;",
  `[Attached image: logo.png (image/png, 1KB)]\n${IMG}`,
  "[Attached document: brief.pdf (application/pdf, 220KB). Ask me to save it on the Arrab desk and call read_document, or summarize from the filename if that is enough.]",
  "[Attached file: data.bin (binary, 12KB)]",
].join("\n\n");

describe("chat sources parsing", () => {
  it("finds every attachment block with its kind and body", () => {
    const files = parseAttachments(MESSAGE, "m1");
    expect(files.map((file) => [file.kind, file.name])).toEqual([
      ["text", "app.ts"],
      ["image", "logo.png"],
      ["document", "brief.pdf"],
      ["file", "data.bin"],
    ]);
    expect(files[0]!.text).toBe("const answer = 42; // the answer\nexport default answer;");
    expect(files[1]!.dataUrl).toBe(IMG);
    expect(files[2]!.mime).toBe("application/pdf");
    expect(files[2]!.sizeKb).toBe(220);
    expect(files[3]!.mime).toBeNull();
    expect(files[3]!.sizeKb).toBe(12);
  });

  it("rejects non-image data in an image block", () => {
    const [file] = parseAttachments("[Attached image: x.png (image/png, 1KB)]\njavascript:alert(1)");
    expect(file!.dataUrl).toBeNull();
  });

  it("strips attachment bodies and extracts only safe http links", () => {
    expect(stripAttachmentBlocks(MESSAGE)).toBe("Please review these https://example.com/docs, thanks.");
    expect(extractLinks(stripAttachmentBlocks(MESSAGE))).toEqual(["https://example.com/docs"]);
    expect(extractLinks("javascript:alert(1) and ftp://x.y and http://ok.test/a).")).toEqual(["http://ok.test/a"]);
  });

  it("collects sources newest message first and dedupes links", () => {
    const sources = collectSources([
      { id: "a", text: "see https://example.com" },
      { id: "b", text: "again https://example.com and https://arrab.test/x" },
    ]);
    expect(sources.map((source) => source.id)).toEqual(["link:https://example.com/", "link:https://arrab.test/x"]);
  });

  it("detects 'preview this site' prompts in English and Arabic", () => {
    expect(previewRequestUrl("Screenshot and preview this page for me: https://example.com")).toBe("https://example.com/");
    expect(previewRequestUrl("خذ لقطة وشوف لي هالصفحة: https://example.com/ar")).toBe("https://example.com/ar");
    expect(previewRequestUrl("hello https://example.com")).toBeNull();
  });

  it("labels languages and tokenizes code without HTML", () => {
    expect(languageForName("a.tsx")).toBe("ts");
    expect(languageForName("notes.md")).toBe("md");
    expect(languageForName("x.unknown")).toBe("text");
    const tokens = tokenizeCodeLine('const s = "<b>"; // hi', "ts");
    expect(tokens.find((token) => token.kind === "keyword")?.text).toBe("const");
    expect(tokens.find((token) => token.kind === "string")?.text).toBe('"<b>"');
    expect(tokens.find((token) => token.kind === "comment")?.text).toBe("// hi");
    expect(tokens.map((token) => token.text).join("")).toBe('const s = "<b>"; // hi');
  });

  it("remembers attached File objects for this session", () => {
    forgetAttachmentsForTests();
    const file = new testDom.window.File(["hello"], "note.txt", { type: "text/plain" }) as unknown as File;
    rememberAttachments([file]);
    expect(rememberedFile("note.txt")).toBe(file);
    expect(rememberedFile("other.txt")).toBeNull();
  });
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.setItem("arrab.locale", "en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function renderPanel(target: PreviewTarget | null, onClose = vi.fn(), onSelect = vi.fn()) {
  const sources = collectSources([{ id: "m1", text: MESSAGE }]);
  await act(async () =>
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement(ChatPreviewPanel, {
          target,
          sources,
          width: 420,
          onWidthChange: () => undefined,
          onSelect,
          onClose,
        }),
      ),
    ),
  );
  return { sources, onClose, onSelect };
}

describe("chat preview panel", () => {
  it("shows a web page in a sandboxed frame with an open-in-browser fallback", async () => {
    await renderPanel({ kind: "link", url: "https://example.com/docs" });
    const panel = host.querySelector(".cp-preview-panel")!;
    expect(panel.getAttribute("data-preview-kind")).toBe("link");
    const frame = panel.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("https://example.com/docs");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups");
    expect(panel.querySelector(".cp-preview-fallback button")?.textContent).toContain("Open in browser");
  });

  it("never frames an unsafe address", async () => {
    await renderPanel({ kind: "link", url: "javascript:alert(1)" });
    expect(host.querySelector(".cp-preview-panel iframe")).toBeNull();
  });

  it("previews code with line numbers and highlighted tokens", async () => {
    const files = parseAttachments(MESSAGE, "m1");
    await renderPanel({ kind: "file", file: files[0]! });
    const code = host.querySelector(".cp-preview-code")!;
    expect(code.getAttribute("dir")).toBe("ltr");
    expect(code.querySelectorAll(".cp-preview-code-line")).toHaveLength(2);
    expect(code.querySelector(".tok-keyword")?.textContent).toBe("const");
    expect(code.querySelector(".tok-comment")?.textContent).toBe("// the answer");
    expect(host.querySelector(".cp-preview-meta")?.textContent).toContain("2 lines");
  });

  it("renders markdown files with a raw toggle", async () => {
    const [file] = parseAttachments("[Attached file: notes.md]\n# Plan\n\n- one\n- two");
    await renderPanel({ kind: "file", file: file! });
    expect(host.querySelector(".cp-preview-md .chat-md-heading")?.textContent).toBe("Plan");
    const toggle = host.querySelector<HTMLButtonElement>(".cp-preview-filebar .cp-preview-pill")!;
    await act(async () => toggle.click());
    expect(host.querySelector(".cp-preview-md")).toBeNull();
    expect(host.querySelector(".cp-preview-code")).not.toBeNull();
  });

  it("shows images inline and a details card for other files", async () => {
    const files = parseAttachments(MESSAGE, "m1");
    await renderPanel({ kind: "file", file: files[1]! });
    expect(host.querySelector(".cp-preview-image img")?.getAttribute("src")).toBe(IMG);
    await renderPanel({ kind: "file", file: files[3]! });
    const card = host.querySelector(".cp-preview-card")!;
    expect(card.textContent).toContain("data.bin");
    expect(card.textContent).toContain("12 KB");
  });

  it("lists the chat's sources when nothing is open, and closes", async () => {
    const { onClose, onSelect } = await renderPanel(null);
    const chips = host.querySelectorAll<HTMLButtonElement>(".cp-preview-list .cp-source-chip");
    expect(chips.length).toBe(5);
    await act(async () => chips[0]!.click());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "file" }));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!.click());
    expect(onClose).toHaveBeenCalled();
  });

  it("source chips open their target", async () => {
    const onOpen = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          LanguageProvider,
          null,
          createElement(ChatSourceChip, {
            source: { kind: "link", id: "link:https://example.com/", url: "https://example.com/", host: "example.com" },
            onOpen,
          }),
        ),
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>(".cp-source-chip")!.click());
    expect(onOpen).toHaveBeenCalledWith({ kind: "link", url: "https://example.com/" });
  });
});
