import SwiftUI
import WebKit

struct DesignFile: Codable, Identifiable, Equatable {
  var path: String
  var content: String
  var id: String { path }
}

enum DesignProject {
  static func load(_ companionId: String) -> [DesignFile] {
    guard let data = try? Data(contentsOf: storeURL(companionId)),
          let files = try? JSONDecoder().decode([DesignFile].self, from: data) else { return [] }
    return files
  }

  static func save(_ companionId: String, _ files: [DesignFile]) {
    let url = storeURL(companionId)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let data = try? JSONEncoder().encode(files) {
      try? data.write(to: url, options: .atomic)
    }
  }

  static func merge(_ base: [DesignFile], _ next: [DesignFile]) -> [DesignFile] {
    var map = Dictionary(uniqueKeysWithValues: base.map { ($0.path, $0) })
    for file in next where !file.path.isEmpty { map[file.path] = file }
    return map.values.sorted { $0.path < $1.path }
  }

  static func files(from reply: String) -> [DesignFile] {
    guard let regex = try? NSRegularExpression(
      pattern: #"```([A-Za-z0-9_+.\-]*)(?:[ \t]+([^\n`]+))?\n([\s\S]*?)```"#,
      options: []
    ) else { return [] }
    let ns = reply as NSString
    var out: [DesignFile] = []
    for match in regex.matches(in: reply, range: NSRange(location: 0, length: ns.length)) {
      let lang = ns.substring(with: match.range(at: 1)).lowercased()
      var path = match.range(at: 2).location == NSNotFound ? "" : ns.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespaces)
      var body = ns.substring(with: match.range(at: 3))
      if body.hasSuffix("\n") { body.removeLast() }
      if path.isEmpty {
        switch lang {
        case "html", "htm": path = "index.html"
        case "css": path = "styles.css"
        case "js", "javascript": path = "app.js"
        default: continue
        }
      }
      path = path.replacingOccurrences(of: #"^\.?/+"#, with: "", options: .regularExpression)
      if !path.contains("."), lang == "html" { path += ".html" }
      if !path.contains("."), lang == "css" { path += ".css" }
      if !path.contains("."), (lang == "js" || lang == "javascript") { path += ".js" }
      out.append(DesignFile(path: path, content: body))
    }
    return out
  }

  static func note(from reply: String) -> String {
    var text = reply.replacingOccurrences(of: #"```[\s\S]*?```"#, with: "", options: .regularExpression)
    if let open = text.range(of: "```") { text = String(text[..<open.lowerBound]) }
    return text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func previewHTML(_ files: [DesignFile]) -> String {
    let map = Dictionary(uniqueKeysWithValues: files.map { ($0.path, $0.content) })
    var html = map["index.html"] ?? files.first { $0.path.hasSuffix(".html") }?.content
      ?? "<!DOCTYPE html><html><body><p>No index.html yet.</p></body></html>"
    let css = map["styles.css"] ?? map["style.css"] ?? ""
    let js = map["app.js"] ?? map["main.js"] ?? ""
    if !css.isEmpty {
      if html.range(of: #"href=["']styles\.css["']"#, options: .regularExpression) != nil {
        html = html.replacingOccurrences(
          of: #"<link[^>]+href=["']styles\.css["'][^>]*>"#,
          with: "<style>\n\(css)\n</style>",
          options: .regularExpression
        )
      } else if html.lowercased().contains("</head>") {
        html = html.replacingOccurrences(of: "</head>", with: "<style>\n\(css)\n</style>\n</head>", options: .caseInsensitive)
      } else {
        html = "<style>\(css)</style>\(html)"
      }
    }
    if !js.isEmpty {
      if html.range(of: #"src=["']app\.js["']"#, options: .regularExpression) != nil {
        html = html.replacingOccurrences(
          of: #"<script[^>]+src=["']app\.js["'][^>]*></script>"#,
          with: "<script>\n\(js)\n</script>",
          options: .regularExpression
        )
      } else if html.lowercased().contains("</body>") {
        html = html.replacingOccurrences(of: "</body>", with: "<script>\n\(js)\n</script>\n</body>", options: .caseInsensitive)
      } else {
        html += "<script>\(js)</script>"
      }
    }
    let hook = """
    <script>window.onerror=function(m){try{webkit.messageHandlers.arrab.postMessage(String(m))}catch(e){}};console.error=function(){try{webkit.messageHandlers.arrab.postMessage(Array.from(arguments).join(' '))}catch(e){}};</script>
    """
    if html.lowercased().contains("</body>") {
      html = html.replacingOccurrences(of: "</body>", with: hook + "</body>", options: .caseInsensitive)
    } else {
      html += hook
    }
    return html
  }

  static func fallback(prompt: String, phone: Bool) -> [DesignFile] {
    let title = title(from: prompt)
    let safeTitle = escape(title)
    let safePrompt = escape(String(prompt.prefix(180)))
    if phone { return phoneScreen(title: safeTitle, prompt: safePrompt, raw: prompt) }
    return webSite(title: safeTitle, prompt: safePrompt, raw: prompt)
  }

  private static func title(from prompt: String) -> String {
    var text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    let drops = ["design", "build", "make", "create", "a", "an", "the", "me", "صفحة", "صمم", "سو", "اعمل", "أبي", "ابغى"]
    for word in drops {
      if text.lowercased().hasPrefix(word + " ") { text = String(text.dropFirst(word.count + 1)) }
    }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Arrab" : String(trimmed.prefix(42))
  }

  private static func webSite(title: String, prompt: String, raw: String) -> [DesignFile] {
    let pricing = raw.localizedCaseInsensitiveContains("pric") || raw.contains("تسع") || raw.contains("خطط")
    let gallery = raw.localizedCaseInsensitiveContains("port") || raw.contains("معرض") || raw.contains("gallery")
    let cards = pricing
      ? #"<article><h2>Start</h2><p class="price">SAR 0</p><p>Try the first page.</p></article><article class="hot"><h2>Studio</h2><p class="price">SAR 49</p><p>The page people actually use.</p></article><article><h2>House</h2><p class="price">SAR 149</p><p>A full site for the team.</p></article>"#
      : gallery
        ? #"<article class="shot"></article><article class="shot b"></article><article class="shot c"></article>"#
        : #"<article><h2>01</h2><p>A clear first screen.</p></article><article><h2>02</h2><p>The work, without clutter.</p></article><article><h2>03</h2><p>One next step.</p></article>"#
    let html = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>\(title)</title>
    <link rel="stylesheet" href="styles.css" />
    </head>
    <body>
    <header class="top">
      <strong>\(title)</strong>
      <nav>
        <a href="#work">Work</a>
        <a href="#about">About</a>
        <button id="theme" type="button">Theme</button>
      </nav>
    </header>
    <main>
      <section class="hero">
        <p class="eyebrow">Studio</p>
        <h1>\(title)</h1>
        <p>\(prompt)</p>
        <a class="cta" href="#work">Open</a>
      </section>
      <section id="work" class="grid">\(cards)</section>
    </main>
    <footer id="about">Built in Arrab Studio</footer>
    <script src="app.js"></script>
    </body>
    </html>
    """
    let css = """
    :root { --bg:#101218; --ink:#f6f5f1; --muted:#a8a4b8; --line:rgba(255,255,255,.12); --accent:#e8dcc8; }
    body.light { --bg:#f7f4ee; --ink:#1c1915; --muted:#6d675e; --line:rgba(0,0,0,.08); --accent:#1c1915; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Georgia, "Iowan Old Style", serif; background:var(--bg); color:var(--ink); }
    .top { display:flex; justify-content:space-between; align-items:center; padding:18px 7vw; border-bottom:1px solid var(--line); position:sticky; top:0; background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter:blur(10px); }
    nav { display:flex; gap:16px; align-items:center; }
    a, button { color:var(--muted); background:none; border:0; font:inherit; text-decoration:none; cursor:pointer; }
    .hero { min-height:68vh; display:grid; align-content:center; gap:14px; padding:8vh 7vw; background:radial-gradient(circle at 85% 0%, #2b3348, transparent 42%), var(--bg); }
    .eyebrow { letter-spacing:.18em; text-transform:uppercase; font-size:11px; color:var(--muted); margin:0; }
    h1 { margin:0; font-size:clamp(2.4rem, 8vw, 4.6rem); line-height:.95; max-width:12ch; }
    .hero p { max-width:36rem; color:var(--muted); }
    .cta { width:fit-content; padding:12px 18px; border-radius:999px; background:var(--accent); color:#17140f; font-family:system-ui,sans-serif; font-size:13px; font-weight:700; }
    body.light .cta { color:#f7f4ee; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; padding:36px 7vw 64px; }
    article { border:1px solid var(--line); border-radius:18px; padding:20px; min-height:140px; background:rgba(255,255,255,.03); }
    .hot { outline:1px solid var(--accent); }
    .price { font-family:system-ui,sans-serif; font-size:1.4rem; margin:8px 0; }
    .shot { min-height:180px; background:linear-gradient(160deg,#2b3348,#101218); }
    .shot.b { background:linear-gradient(160deg,#3a2a22,#101218); }
    .shot.c { background:linear-gradient(160deg,#1e3a32,#101218); }
    footer { padding:28px 7vw 48px; color:var(--muted); border-top:1px solid var(--line); }
    """
    let js = """
    document.getElementById("theme")?.addEventListener("click", () => document.body.classList.toggle("light"));
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (event) => {
        const id = link.getAttribute("href")?.slice(1);
        const target = id && document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth" });
      });
    });
    """
    return [
      DesignFile(path: "index.html", content: html),
      DesignFile(path: "styles.css", content: css),
      DesignFile(path: "app.js", content: js),
    ]
  }

  private static func phoneScreen(title: String, prompt: String, raw: String) -> [DesignFile] {
    let login = raw.localizedCaseInsensitiveContains("login") || raw.contains("دخول")
    let product = raw.localizedCaseInsensitiveContains("product") || raw.contains("منتج")
    let html = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>\(title)</title>
    <link rel="stylesheet" href="styles.css" />
    </head>
    <body>
    <main id="app"></main>
    <nav class="tabs">
      <button data-tab="home" class="on">Home</button>
      <button data-tab="work">Work</button>
      <button data-tab="you">You</button>
    </nav>
    <script src="app.js"></script>
    </body>
    </html>
    """
    let home = login
      ? #"<section class="card"><h1>\#(title)</h1><p>\#(prompt)</p><label>Email</label><input value="you@arrab.ai" /><label>Password</label><input type="password" value="••••••••" /><button class="go">Continue</button></section>"#
      : product
        ? #"<section class="card"><div class="photo"></div><h1>\#(title)</h1><p>\#(prompt)</p><strong>SAR 240</strong><button class="go">Add</button></section>"#
        : #"<section class="card"><p class="eyebrow">Today</p><h1>\#(title)</h1><p>\#(prompt)</p><div class="row"><span>Inbox</span><b>3</b></div><div class="row"><span>Drafts</span><b>1</b></div></section>"#
    let css = """
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; font-family:-apple-system, system-ui, sans-serif; background:#0e1016; color:#f4f1ea; }
    main { padding:28px 18px 92px; }
    .card { background:#171b24; border:1px solid rgba(255,255,255,.08); border-radius:24px; padding:22px; display:grid; gap:10px; }
    h1 { margin:0; font-size:1.7rem; }
    p, label { color:#a9a4b4; margin:0; }
    input { width:100%; border:0; border-radius:12px; padding:12px; background:#0e1016; color:inherit; }
    .go { border:0; border-radius:999px; padding:12px; background:#e8dcc8; color:#17140f; font-weight:700; }
    .photo { height:160px; border-radius:16px; background:linear-gradient(145deg,#31405c,#1a120e); }
    .row { display:flex; justify-content:space-between; padding:12px 0; border-top:1px solid rgba(255,255,255,.08); }
    .tabs { position:fixed; left:12px; right:12px; bottom:12px; display:grid; grid-template-columns:repeat(3,1fr); gap:6px; padding:8px; border-radius:20px; background:rgba(20,22,30,.92); backdrop-filter:blur(12px); }
    .tabs button { border:0; background:transparent; color:#a9a4b4; padding:10px; border-radius:14px; }
    .tabs button.on { background:#e8dcc8; color:#17140f; font-weight:700; }
    .eyebrow { letter-spacing:.16em; text-transform:uppercase; font-size:11px; }
    """
    let js = """
    const home = `\(home.replacingOccurrences(of: "`", with: "\\`"))`;
    const screens = {
      home,
      work: '<section class="card"><h1>Work</h1><p>Files in this studio update the screen.</p></section>',
      you: '<section class="card"><h1>You</h1><p>\(prompt)</p></section>'
    };
    const app = document.getElementById("app");
    function show(name) {
      app.innerHTML = screens[name] || screens.home;
      document.querySelectorAll(".tabs button").forEach((button) => {
        button.classList.toggle("on", button.dataset.tab === name);
      });
    }
    document.querySelectorAll(".tabs button").forEach((button) => {
      button.addEventListener("click", () => show(button.dataset.tab));
    });
    show("home");
    """
    return [
      DesignFile(path: "index.html", content: html),
      DesignFile(path: "styles.css", content: css),
      DesignFile(path: "app.js", content: js),
    ]
  }

  private static func escape(_ value: String) -> String {
    value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&#39;")
  }

  private static func storeURL(_ id: String) -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("studio-projects", isDirectory: true)
      .appendingPathComponent("\(id).json")
  }
}

struct DesignStudioView: View {
  let companion: StudioCompanionCard
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.dismiss) private var dismiss
  @StateObject private var model = ChatViewModel()
  @StateObject private var speech = SpeechDictation()
  @State private var files: [DesignFile] = []
  @State private var active = "index.html"
  @State private var surface = 0
  @State private var viewport = 1
  @State private var draft = ""
  @State private var note = ""
  @State private var console = ""
  @State private var previewToken = 0
  @State private var showFiles = false
  @State private var newName = "index.html"
  @State private var renaming = false
  @State private var shareItem: DesignShareItem?
  @State private var sawReply = ""

  private var arabic: Bool { session.localeIsArabic }
  private var phone: Bool { companion.id == "phone-designer" }

  var body: some View {
    VStack(spacing: 0) {
      header
      Group {
        switch surface {
        case 1: editor
        default: preview
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      if !note.isEmpty {
        Text(note)
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 16)
          .padding(.top, 6)
      }
      composer
    }
    .background(theme.bg.ignoresSafeArea())
    .task {
      files = DesignProject.load(companion.id)
      if let first = files.first { active = first.path }
      model.modelId = session.resolvedModelId
      model.prefersArabic = arabic
      model.companionId = companion.id
      model.title = companion.title(arabic: arabic)
      model.wantsDesignFiles = true
      await model.bootstrap()
    }
    .onChange(of: model.isBusy) { _, busy in
      guard !busy else { return }
      guard let last = model.lines.last(where: { $0.role == "assistant" }), last.text != sawReply else { return }
      sawReply = last.text
      let harvested = DesignProject.files(from: last.text)
      if !harvested.isEmpty {
        files = DesignProject.merge(files, harvested)
        if let first = harvested.first { active = first.path }
        surface = 0
        previewToken += 1
      }
      let spoken = DesignProject.note(from: last.text)
      if !spoken.isEmpty { note = spoken }
      DesignProject.save(companion.id, files)
    }
    .onChange(of: files) { _, next in
      DesignProject.save(companion.id, next)
    }
    .sheet(isPresented: $showFiles) { fileSheet }
    .alert(arabic ? "ملف جديد" : "New file", isPresented: $renaming) {
      TextField("index.html", text: $newName)
      Button(arabic ? "إنشاء" : "Create") { createFile() }
      Button(arabic ? "إلغاء" : "Cancel", role: .cancel) {}
    }
    .sheet(item: $shareItem) { item in
      DesignShareSheet(url: item.url)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Button { dismiss() } label: {
          Image(systemName: "xmark")
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.text)
            .frame(width: 36, height: 36)
            .background(theme.card)
            .clipShape(Circle())
        }
        .buttonStyle(.plain)
        StudioPortrait(id: companion.id, size: 40)
        VStack(alignment: .leading, spacing: 2) {
          Text(companion.title(arabic: arabic))
            .font(ArrabFont.system(size: 17, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(phone
            ? (arabic ? "شاشة حية على إطار الجوال" : "Live screen in a phone frame")
            : (arabic ? "صفحة حية، ملفات، ومعاينة" : "Live page, files, and preview"))
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
        Spacer()
        Button { exportHTML() } label: {
          Image(systemName: "square.and.arrow.up")
            .foregroundStyle(theme.text)
        }
        .buttonStyle(.plain)
      }
      Picker("", selection: $surface) {
        Text(arabic ? "معاينة" : "Preview").tag(0)
        Text(arabic ? "الكود" : "Code").tag(1)
      }
      .pickerStyle(.segmented)
      .onChange(of: surface) { _, value in
        if value == 0 { previewToken += 1 }
      }
      if !phone {
        HStack(spacing: 8) {
          viewportChip(0, arabic ? "جوال" : "Phone")
          viewportChip(1, arabic ? "مكتب" : "Desktop")
          Spacer()
          Button {
            previewToken += 1
            surface = 0
          } label: {
            Label(arabic ? "تشغيل" : "Run", systemImage: "play.fill")
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .foregroundStyle(theme.onPrimary)
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .background(theme.primary)
              .clipShape(Capsule())
          }
          .buttonStyle(.plain)
          Text("\(files.count)")
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.muted)
        }
      }
    }
    .padding(16)
  }

  private var preview: some View {
    VStack(spacing: 8) {
      ZStack {
        if files.isEmpty {
          VStack(spacing: 10) {
            Text(arabic ? "ما فيه صفحة بعد" : "No page yet")
              .font(ArrabFont.system(size: 18, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(arabic ? "اكتب ماذا تبي، والصفحة تظهر هنا." : "Say what you want. The page appears here.")
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.muted)
            ForEach(starters, id: \.self) { item in
              Button(item) { ask(item) }
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(theme.card)
                .clipShape(Capsule())
            }
          }
        } else if phone {
          DesignWebView(html: DesignProject.previewHTML(files), token: previewToken) { console = $0 }
            .frame(width: 280)
            .frame(maxHeight: 560)
            .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 36, style: .continuous).stroke(theme.text.opacity(0.85), lineWidth: 8))
            .shadow(color: .black.opacity(0.25), radius: 18, y: 8)
        } else {
          DesignWebView(html: DesignProject.previewHTML(files), token: previewToken) { console = $0 }
            .frame(maxWidth: viewport == 0 ? 390 : .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
            .padding(.horizontal, 12)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      if !console.isEmpty {
        Text(console)
          .font(ArrabFont.system(size: 11))
          .foregroundStyle(theme.warn)
          .lineLimit(2)
          .padding(.horizontal, 16)
      }
    }
  }

  private func viewportChip(_ id: Int, _ title: String) -> some View {
    let on = viewport == id
    return Button {
      viewport = id
      previewToken += 1
      surface = 0
    } label: {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(on ? theme.onPrimary : theme.text)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(on ? theme.lavender : theme.card)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }

  private var editor: some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(files) { file in
            Button(file.path) { active = file.path }
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(active == file.path ? theme.onPrimary : theme.text)
              .padding(.horizontal, 10)
              .padding(.vertical, 6)
              .background(active == file.path ? theme.primary : theme.card)
              .clipShape(Capsule())
          }
          Button { newName = "page.html"; renaming = true } label: {
            Image(systemName: "plus")
              .foregroundStyle(theme.text)
              .frame(width: 28, height: 28)
              .background(theme.card)
              .clipShape(Circle())
          }
          .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
      }
      TextEditor(text: editorText)
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.text)
        .scrollContentBackground(.hidden)
        .padding(8)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 12)
    }
  }

  private var editorText: Binding<String> {
    Binding(
      get: { files.first { $0.path == active }?.content ?? "" },
      set: { next in
        if let index = files.firstIndex(where: { $0.path == active }) {
          files[index].content = next
        }
      }
    )
  }

  private var composer: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let notice = speech.notice, !speech.listening {
        Text(notice)
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.warn)
          .padding(.horizontal, 4)
      }
      HStack(spacing: 8) {
      Button { showFiles = true } label: {
        Image(systemName: "folder")
          .foregroundStyle(theme.text)
          .frame(width: 40, height: 40)
          .background(theme.card)
          .clipShape(Circle())
      }
      .buttonStyle(.plain)
      TextField(arabic ? "صف الصفحة…" : "Describe the page…", text: $draft, axis: .vertical)
        .font(ArrabFont.system(size: 16))
        .lineLimit(1...3)
        .padding(12)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      Button {
        ArrabHaptics.light()
        speech.toggle(arabic: arabic, current: draft) { draft = $0 }
      } label: {
        Image(systemName: speech.listening ? "mic.fill" : "mic")
          .foregroundStyle(speech.listening ? theme.onPrimary : theme.text)
          .frame(width: 40, height: 40)
          .background(speech.listening ? theme.primary : theme.card)
          .clipShape(Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(arabic ? (speech.listening ? "إيقاف" : "تحدّث") : (speech.listening ? "Stop" : "Speak"))
      Button {
        speech.stop()
        let text = draft
        draft = ""
        ask(text)
      } label: {
        Image(systemName: model.isBusy ? "pause.fill" : "arrow.up")
          .frame(width: 40, height: 40)
          .background(theme.primary)
          .foregroundStyle(theme.onPrimary)
          .clipShape(Circle())
      }
      .buttonStyle(.plain)
      .disabled(!model.isBusy && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .padding(12)
    .onDisappear { speech.stop() }
  }

  private var starters: [String] {
    if phone {
      return arabic
        ? ["شاشة دخول", "بطاقة منتج", "شريط سفلي بثلاث خانات"]
        : ["A login screen", "A product card", "A bottom bar with three tabs"]
    }
    return arabic
      ? ["صفحة هبوط", "معرض أعمال", "تسعير بثلاث خطط"]
      : ["A landing page", "A portfolio", "Pricing with three plans"]
  }

  private var fileSheet: some View {
    NavigationStack {
      List {
        ForEach(files) { file in
          Button {
            active = file.path
            surface = 1
            showFiles = false
          } label: {
            Text(file.path).foregroundStyle(theme.text)
          }
        }
        .onDelete { offsets in
          files.remove(atOffsets: offsets)
          active = files.first?.path ?? "index.html"
        }
      }
      .navigationTitle(arabic ? "الملفات" : "Files")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(arabic ? "جديد" : "New") { renaming = true }
        }
        ToolbarItem(placement: .cancellationAction) {
          Button(arabic ? "تم" : "Done") { showFiles = false }
        }
      }
    }
  }

  private func ask(_ text: String) {
    if model.isBusy {
      model.pause()
      return
    }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    if files.isEmpty {
      files = DesignProject.fallback(prompt: trimmed, phone: phone)
      active = "index.html"
      previewToken += 1
      surface = 0
    }
    note = arabic ? "يبني الصفحة…" : "Building the page…"
    model.beginSend(trimmed)
  }

  private func createFile() {
    let path = newName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty, !files.contains(where: { $0.path == path }) else { return }
    files.append(DesignFile(path: path, content: ""))
    active = path
    surface = 1
  }

  private func exportHTML() {
    let html = DesignProject.previewHTML(files)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(companion.id).html")
    try? html.write(to: url, atomically: true, encoding: .utf8)
    shareItem = DesignShareItem(url: url)
  }
}

private struct DesignShareItem: Identifiable {
  let url: URL
  var id: String { url.path }
}

private struct DesignShareSheet: UIViewControllerRepresentable {
  let url: URL
  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: [url], applicationActivities: nil)
  }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct DesignWebView: UIViewRepresentable {
  var html: String
  var token: Int
  var onConsole: (String) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onConsole: onConsole) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.userContentController.add(context.coordinator, name: "arrab")
    let view = WKWebView(frame: .zero, configuration: config)
    view.isOpaque = false
    view.backgroundColor = .clear
    view.scrollView.backgroundColor = .clear
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {
    context.coordinator.onConsole = onConsole
    guard context.coordinator.token != token else { return }
    context.coordinator.token = token
    view.loadHTMLString(html, baseURL: nil)
  }

  final class Coordinator: NSObject, WKScriptMessageHandler {
    var onConsole: (String) -> Void
    var token = -1
    init(onConsole: @escaping (String) -> Void) { self.onConsole = onConsole }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      let text = String(describing: message.body)
      DispatchQueue.main.async { self.onConsole(text) }
    }
  }
}
