/**
 * Local deliverable builders for companions / desk tools:
 * Word (.docx), presentations (HTML slides), images (SVG), and document readers.
 */

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphsToDocXml(body: string): string {
  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) {
    return `<w:p><w:r><w:t></w:t></w:r></w:p>`;
  }
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trimEnd());
      const runs = lines
        .map((line, index) => {
          const text = escapeXml(line || " ");
          const br = index < lines.length - 1 ? `<w:br/>` : "";
          return `<w:r><w:t xml:space="preserve">${text}</w:t>${br}</w:r>`;
        })
        .join("");
      return `<w:p>${runs}</w:p>`;
    })
    .join("");
}

/** Minimal ZIP (store / no compression) — enough for OOXML. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]!;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ path: string; content: string | Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.path);
    const data =
      typeof file.content === "string" ? enc.encode(file.content) : file.content;
    const sum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true); // store
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, sum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(central.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0, true);
    cview.setUint16(10, 0, true);
    cview.setUint16(12, 0, true);
    cview.setUint16(14, 0, true);
    cview.setUint32(16, sum, true);
    cview.setUint32(20, data.length, true);
    cview.setUint32(24, data.length, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true);
    cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true);
    cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true);
    cview.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(4, 0, true);
  eview.setUint16(6, 0, true);
  eview.setUint16(8, files.length, true);
  eview.setUint16(10, files.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, offset, true);
  eview.setUint16(20, 0, true);

  const total =
    locals.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of locals) {
    out.set(part, at);
    at += part.length;
  }
  for (const part of centrals) {
    out.set(part, at);
    at += part.length;
  }
  out.set(end, at);
  return out;
}

export function buildDocxBytes(input: { title?: string; content: string }): Uint8Array {
  const title = (input.title || "Arrab document").trim() || "Arrab document";
  const bodyXml = paragraphsToDocXml(input.content);
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>
    ${bodyXml}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  return zipStore([
    { path: "[Content_Types].xml", content: contentTypes },
    { path: "_rels/.rels", content: rels },
    { path: "word/document.xml", content: documentXml },
    { path: "word/_rels/document.xml.rels", content: docRels },
  ]);
}

export type PresentationSlide = { title: string; body: string };

export function parsePresentationSlides(content: string): PresentationSlide[] {
  const raw = content.replace(/\r\n/g, "\n").trim();
  if (!raw) return [{ title: "Slide", body: "" }];
  if (raw.includes("---")) {
    return raw
      .split(/\n---\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const lines = chunk.split("\n");
        const title = (lines[0] || "Slide").replace(/^#\s*/, "").trim();
        const body = lines.slice(1).join("\n").trim();
        return { title: title || "Slide", body };
      });
  }
  const blocks = raw.split(/\n{2,}/).filter(Boolean);
  return blocks.map((block, index) => {
    const lines = block.split("\n");
    return {
      title: (lines[0] || `Slide ${index + 1}`).replace(/^#\s*/, "").trim(),
      body: lines.slice(1).join("\n").trim(),
    };
  });
}

export function buildPresentationHtml(input: {
  title?: string;
  content: string;
}): string {
  const deckTitle = escapeXml(input.title?.trim() || "Presentation");
  const slides = parsePresentationSlides(input.content);
  const slidesHtml = slides
    .map((slide, index) => {
      const bodyHtml = escapeXml(slide.body || "")
        .split("\n")
        .map((line) => (line.trim() ? `<p>${line}</p>` : "<p><br/></p>"))
        .join("");
      return `<section class="slide" data-index="${index}">
  <h1>${escapeXml(slide.title)}</h1>
  <div class="body">${bodyHtml || "<p></p>"}</div>
  <div class="foot">${index + 1} / ${slides.length}</div>
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${deckTitle}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; background: #0b0d10; color: #f4f1ea; }
    .deck { min-height: 100vh; }
    .slide { display: none; min-height: 100vh; padding: 8vh 10vw 12vh; flex-direction: column; justify-content: center; background:
      radial-gradient(ellipse 70% 50% at 12% 0%, rgba(255,255,255,0.08), transparent 55%),
      linear-gradient(160deg, #12151a, #0b0d10 60%); }
    .slide.on { display: flex; animation: in 280ms ease; }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    h1 { font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.1; margin: 0 0 1.2rem; letter-spacing: -0.02em; max-width: 18ch; }
    .body { font-size: clamp(1.05rem, 2.2vw, 1.45rem); line-height: 1.55; max-width: 42rem; opacity: 0.92; }
    .body p { margin: 0 0 0.7em; }
    .foot { position: fixed; inset-inline-end: 1.5rem; bottom: 1.2rem; font: 12px/1 ui-sans-serif, system-ui, sans-serif; opacity: 0.45; }
    .hint { position: fixed; inset-inline-start: 1.5rem; bottom: 1.2rem; font: 12px/1.3 ui-sans-serif, system-ui, sans-serif; opacity: 0.4; }
  </style>
</head>
<body>
  <div class="deck">${slidesHtml}</div>
  <div class="hint">← → or space · F fullscreen</div>
  <script>
    const slides = [...document.querySelectorAll(".slide")];
    let i = 0;
    function show(n) {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, idx) => s.classList.toggle("on", idx === i));
    }
    show(0);
    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); show(i + 1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); show(i - 1); }
      if (e.key === "f" || e.key === "F") document.documentElement.requestFullscreen?.();
    });
  </script>
</body>
</html>`;
}

export function buildImageSvg(input: {
  title?: string;
  content?: string;
  prompt?: string;
  width?: number;
  height?: number;
}): string {
  const width = Math.min(1920, Math.max(640, Number(input.width) || 1280));
  const height = Math.min(1080, Math.max(360, Number(input.height) || 720));
  const title = (input.title || input.prompt || "Arrab image").trim();
  const body = (input.content || input.prompt || "").trim();
  const lines = body
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const subtitle = lines[0] && lines[0] !== title ? lines[0] : lines.slice(1)[0] || "";
  const rest = lines.filter((line) => line !== title && line !== subtitle).slice(0, 4);
  const titleXml = escapeXml(title.slice(0, 80));
  const subXml = escapeXml(subtitle.slice(0, 120));
  const restXml = rest
    .map(
      (line, index) =>
        `<text x="96" y="${height - 160 + index * 28}" fill="rgba(244,241,234,0.72)" font-size="18" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(line.slice(0, 90))}</text>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a2230"/>
      <stop offset="55%" stop-color="#0f141c"/>
      <stop offset="100%" stop-color="#2a1f18"/>
    </linearGradient>
    <radialGradient id="glow" cx="20%" cy="15%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <rect x="48" y="48" width="${width - 96}" height="${height - 96}" rx="28" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
  <text x="96" y="${Math.round(height * 0.38)}" fill="#f4f1ea" font-size="54" font-family="Georgia, 'Iowan Old Style', serif" font-weight="600">${titleXml}</text>
  ${subXml ? `<text x="96" y="${Math.round(height * 0.38) + 56}" fill="rgba(244,241,234,0.78)" font-size="26" font-family="ui-sans-serif, system-ui, sans-serif">${subXml}</text>` : ""}
  ${restXml}
  <text x="96" y="${height - 72}" fill="rgba(244,241,234,0.35)" font-size="14" font-family="ui-sans-serif, system-ui, sans-serif">Arrab · image</text>
</svg>`;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
