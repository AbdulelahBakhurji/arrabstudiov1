import CryptoKit
import Foundation
import PDFKit
import UIKit
import Vision
#if canImport(ImagePlayground)
import ImagePlayground
#endif

enum PhoneCompanionTools {
  static func searchQuery(in text: String, forced: Bool) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let prefixes = [
      "search the web for:",
      "search the web for",
      "ابحث في الويب عن:",
      "ابحث في الويب عن",
    ]
    let lower = trimmed.lowercased()
    for prefix in prefixes {
      if lower.hasPrefix(prefix.lowercased()) {
        let rest = trimmed.dropFirst(prefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
        return rest.count >= 2 ? String(rest.prefix(240)) : nil
      }
    }
    if forced, trimmed.count >= 2 { return String(trimmed.prefix(240)) }
    return nil
  }

  static func searchWeb(_ query: String) async -> String {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard q.count >= 2 else { return "" }
    var parts: [String] = []
    if let instant = await duckInstant(q), !instant.isEmpty { parts.append(instant) }
    if let html = await duckHTML(q), !html.isEmpty { parts.append(html) }
    let body = parts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !body.isEmpty else {
      return "LIVE WEB SEARCH for \(q) returned no readable results."
    }
    return [
      "LIVE WEB SEARCH (already fetched — answer from this, and include the URLs):",
      "Query: \(q)",
      body.prefix(6000),
    ].joined(separator: "\n")
  }

  static func readFile(at url: URL) -> String {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let name = url.lastPathComponent
    let ext = url.pathExtension.lowercased()
    if ext == "pdf", let doc = PDFDocument(url: url) {
      let pages = (0..<min(doc.pageCount, 20)).compactMap { doc.page(at: $0)?.string }
      let text = pages.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
      return clip(text.isEmpty ? "PDF \(name) had no extractable text." : "FILE \(name):\n\(text)")
    }
    if let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8), looksTextual(text) {
      return clip("FILE \(name):\n\(text)")
    }
    if let data = try? Data(contentsOf: url), let ocr = recognize(data), !ocr.isEmpty {
      return clip("FILE \(name) (text in image):\n\(ocr)")
    }
    return "FILE \(name): attached, but this phone could not read it as text. Ask the user for a PDF, text, or a clearer photo."
  }

  static func readPhoto(_ data: Data, name: String) -> String {
    if let ocr = recognize(data), !ocr.isEmpty {
      return clip("PHOTO \(name):\n\(ocr)")
    }
    return "PHOTO \(name): the user attached an image. No readable text was found in it."
  }

  static func run(tool: String, args: [String: String]) -> (result: String, file: URL?) {
    switch tool {
    case "generate_pdf":
      return writePDF(args)
    case "generate_docx":
      return writeRTF(args)
    case "export_csv":
      return writePlain(args, fallback: "arrab-export.csv", kind: "CSV")
    case "generate_presentation":
      return writeHTML(args, fallback: "arrab-presentation.html", slides: true)
    case "preview_html":
      return writeHTML(args, fallback: "arrab-preview.html", slides: false)
    case "generate_image":
      let prompt = args["prompt"] ?? args["content"] ?? args["title"] ?? ""
      if let url = renderPoster(prompt: prompt) {
        return ("GENERATED photo \(url.lastPathComponent) on this iPhone. It is in Library.", url)
      }
      return ("FAILED generate_image: requires a prompt.", nil)
    case "write_file":
      return writePlain(args, fallback: "arrab-note.txt", kind: "file")
    case "read_file", "read_document":
      return readSaved(args)
    case "list_files":
      return (listSaved(), nil)
    case "search_code":
      return (searchSaved(args["query"] ?? ""), nil)
    case "create_dir":
      return makeDir(args)
    default:
      return (
        "This iPhone can search the web, read files the user attaches, and create documents in the Arrab folder. It does not run a computer terminal.",
        nil
      )
    }
  }

  static func attest(token: String, result: String) -> String {
    let payload = "\(token.trimmingCharacters(in: .whitespacesAndNewlines))\n\(result)"
    let digest = SHA256.hash(data: Data(payload.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  static func activity(for tool: String, arabic: Bool) -> String {
    switch tool {
    case "web_search", "scrape_page", "fetch_url":
      return arabic ? "يبحث في الويب" : "Searching the web"
    case "generate_pdf", "generate_docx", "generate_presentation", "generate_image", "export_csv", "preview_html", "write_file":
      return arabic ? "ينشئ ملفاً" : "Creating a file"
    case "read_file", "read_document", "list_files", "search_code":
      return arabic ? "يقرأ الملفات" : "Reading files"
    default:
      return arabic ? "يعمل" : "Working"
    }
  }

  private static func duckInstant(_ query: String) async -> String? {
    var parts = URLComponents(string: "https://api.duckduckgo.com/")
    parts?.queryItems = [
      URLQueryItem(name: "q", value: query),
      URLQueryItem(name: "format", value: "json"),
      URLQueryItem(name: "no_html", value: "1"),
      URLQueryItem(name: "skip_disambig", value: "1"),
    ]
    guard let url = parts?.url, let data = try? await fetch(url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    var lines: [String] = []
    for key in ["Heading", "Answer", "AbstractText", "Definition"] {
      if let value = json[key] as? String, !value.isEmpty { lines.append(value) }
    }
    if let url = json["AbstractURL"] as? String, !url.isEmpty { lines.append(url) }
    return lines.isEmpty ? nil : lines.joined(separator: "\n")
  }

  private static func duckHTML(_ query: String) async -> String? {
    var parts = URLComponents(string: "https://html.duckduckgo.com/html/")
    parts?.queryItems = [URLQueryItem(name: "q", value: query)]
    guard let url = parts?.url, let data = try? await fetch(url), let html = String(data: data, encoding: .utf8) else {
      return nil
    }
    var lines: [String] = []
    let pattern = #"<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(html.startIndex..., in: html)
    regex.enumerateMatches(in: html, range: range) { match, _, stop in
      guard let match, lines.count < 6,
            let hrefRange = Range(match.range(at: 1), in: html),
            let titleRange = Range(match.range(at: 2), in: html) else { return }
      var href = String(html[hrefRange])
      if let decoded = href.removingPercentEncoding, let uddg = URL(string: href)?.queryValue("uddg") ?? URL(string: decoded)?.queryValue("uddg") {
        href = uddg
      }
      let title = html[titleRange].replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
      if href.hasPrefix("http"), !title.isEmpty {
        lines.append("• \(title.trimmingCharacters(in: .whitespacesAndNewlines))\n  \(href)")
      }
      if lines.count >= 6 { stop.pointee = true }
    }
    return lines.isEmpty ? nil : lines.joined(separator: "\n")
  }

  private static func fetch(_ url: URL) async throws -> Data {
    var request = URLRequest(url: url)
    request.timeoutInterval = 15
    request.setValue("ArrabStudio/1.1 (iPhone web lookup)", forHTTPHeaderField: "User-Agent")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw URLError(.badServerResponse)
    }
    return data
  }

  private static func recognize(_ data: Data) -> String? {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ar-SA", "en-US"]
    let handler = VNImageRequestHandler(data: data, options: [:])
    guard (try? handler.perform([request])) != nil else { return nil }
    let lines = request.results?.compactMap { $0.topCandidates(1).first?.string } ?? []
    let text = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  private static func looksTextual(_ text: String) -> Bool {
    let sample = text.prefix(400)
    let bad = sample.filter { $0.unicodeScalars.contains { $0.value < 9 } }.count
    return bad < 8
  }

  private static func clip(_ text: String) -> String {
    String(text.prefix(12_000))
  }

  static func savedFiles() -> [URL] {
    let urls = (try? FileManager.default.contentsOfDirectory(
      at: folder,
      includingPropertiesForKeys: [.contentModificationDateKey],
      options: [.skipsHiddenFiles]
    )) ?? []
    return urls.filter { !$0.hasDirectoryPath }.sorted { left, right in
      let a = (try? left.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      let b = (try? right.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      return a > b
    }
  }

  static func makePhoto(prompt: String) async -> URL? {
    let clean = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard clean.count >= 2 else { return nil }
    if let data = try? await ArrabAPIClient.shared.generatePhoto(prompt: clean),
       let url = writePhoto(data) {
      return url
    }
    #if canImport(ImagePlayground)
    if #available(iOS 18.4, *) {
      do {
        let creator = try await ImageCreator()
        let style = creator.availableStyles.first ?? .illustration
        let stream = creator.images(for: [.text(String(clean.prefix(200)))], style: style, limit: 1)
        for try await created in stream {
          return saveImage(created.cgImage)
        }
      } catch {
        return nil
      }
    }
    #endif
    return nil
  }

  private static func writePhoto(_ data: Data) -> URL? {
    let dest = folder.appendingPathComponent("photo-\(Int(Date().timeIntervalSince1970)).png")
    do {
      try data.write(to: dest, options: .atomic)
      return dest
    } catch {
      return nil
    }
  }

  static func keepPhoto(at url: URL) -> URL? {
    let data = try? Data(contentsOf: url)
    if let data, let image = UIImage(data: data), let png = image.pngData() {
      let dest = folder.appendingPathComponent("photo-\(Int(Date().timeIntervalSince1970)).png")
      do {
        try png.write(to: dest, options: .atomic)
        return dest
      } catch {
        return nil
      }
    }
    let dest = folder.appendingPathComponent("photo-\(Int(Date().timeIntervalSince1970)).\(url.pathExtension.isEmpty ? "png" : url.pathExtension)")
    do {
      if FileManager.default.fileExists(atPath: dest.path) {
        try FileManager.default.removeItem(at: dest)
      }
      try FileManager.default.copyItem(at: url, to: dest)
      return dest
    } catch {
      return nil
    }
  }

  static func renderPoster(prompt: String) -> URL? {
    let clean = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard clean.count >= 2 else { return nil }
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1024, height: 1024))
    let seed = clean.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
    let image = renderer.image { ctx in
      let colors = posterColors(seed)
      let space = CGColorSpaceCreateDeviceRGB()
      let gradient = CGGradient(
        colorsSpace: space,
        colors: [colors.0.cgColor, colors.1.cgColor] as CFArray,
        locations: [0, 1]
      )
      if let gradient {
        ctx.cgContext.drawLinearGradient(
          gradient,
          start: .zero,
          end: CGPoint(x: 1024, y: 1024),
          options: []
        )
      }
      ctx.cgContext.setFillColor(UIColor.white.withAlphaComponent(0.9).cgColor)
      ctx.cgContext.fillEllipse(in: CGRect(x: 680, y: 120, width: 180, height: 180))
      ctx.cgContext.setFillColor(colors.2.cgColor)
      ctx.cgContext.fillEllipse(in: CGRect(x: -80, y: 640, width: 520, height: 280))
      ctx.cgContext.fillEllipse(in: CGRect(x: 360, y: 700, width: 760, height: 340))
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center
      let caption = NSAttributedString(
        string: String(clean.prefix(80)),
        attributes: [
          .font: ArrabFont.ui(size: 36, weight: .semibold),
          .foregroundColor: UIColor.white,
          .paragraphStyle: paragraph,
        ]
      )
      caption.draw(in: CGRect(x: 64, y: 860, width: 896, height: 120))
    }
    guard let png = image.pngData() else { return nil }
    let dest = folder.appendingPathComponent("photo-\(Int(Date().timeIntervalSince1970)).png")
    do {
      try png.write(to: dest, options: .atomic)
      return dest
    } catch {
      return nil
    }
  }

  private static func saveImage(_ image: CGImage) -> URL? {
    let ui = UIImage(cgImage: image)
    guard let png = ui.pngData() else { return nil }
    let dest = folder.appendingPathComponent("photo-\(Int(Date().timeIntervalSince1970)).png")
    do {
      try png.write(to: dest, options: .atomic)
      return dest
    } catch {
      return nil
    }
  }

  private static func posterColors(_ seed: Int) -> (UIColor, UIColor, UIColor) {
    let palettes: [(UIColor, UIColor, UIColor)] = [
      (UIColor(red: 0.12, green: 0.18, blue: 0.38, alpha: 1), UIColor(red: 0.95, green: 0.55, blue: 0.32, alpha: 1), UIColor(red: 0.18, green: 0.42, blue: 0.38, alpha: 1)),
      (UIColor(red: 0.08, green: 0.22, blue: 0.28, alpha: 1), UIColor(red: 0.35, green: 0.62, blue: 0.78, alpha: 1), UIColor(red: 0.12, green: 0.32, blue: 0.28, alpha: 1)),
      (UIColor(red: 0.22, green: 0.12, blue: 0.28, alpha: 1), UIColor(red: 0.72, green: 0.38, blue: 0.62, alpha: 1), UIColor(red: 0.28, green: 0.16, blue: 0.36, alpha: 1)),
      (UIColor(red: 0.18, green: 0.16, blue: 0.14, alpha: 1), UIColor(red: 0.86, green: 0.62, blue: 0.28, alpha: 1), UIColor(red: 0.32, green: 0.24, blue: 0.16, alpha: 1)),
    ]
    return palettes[abs(seed) % palettes.count]
  }

  static var folder: URL {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Arrab", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private static func safeName(_ raw: String, fallback: String) -> String {
    let base = (raw as NSString).lastPathComponent
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._- "))
    let cleaned = String(base.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" })
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? fallback : String(cleaned.prefix(80))
  }

  private static func writePDF(_ args: [String: String]) -> (String, URL?) {
    let content = args["content"] ?? args["html"] ?? ""
    guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return ("FAILED generate_pdf: requires content.", nil)
    }
    var name = safeName(args["path"] ?? "arrab-report.pdf", fallback: "arrab-report.pdf")
    if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
    let plain = content
      .replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: .regularExpression)
      .replacingOccurrences(of: "</p>|</h[1-3]>", with: "\n\n", options: .regularExpression)
      .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
      .replacingOccurrences(of: "&nbsp;", with: " ")
      .replacingOccurrences(of: "&amp;", with: "&")
    let url = folder.appendingPathComponent(name)
    let page = CGRect(x: 0, y: 0, width: 595, height: 842)
    let renderer = UIGraphicsPDFRenderer(bounds: page)
    let title = args["title"] ?? "Arrab"
    do {
      try renderer.writePDF(to: url) { context in
        let font = ArrabFont.ui(size: 13)
        let titleFont = ArrabFont.ui(size: 18, weight: .semibold)
        let bounds = CGSize(width: 515, height: 800)
        func lineHeight(_ value: String, font: UIFont) -> CGFloat {
          let rect = (value as NSString).boundingRect(
            with: bounds,
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font],
            context: nil
          )
          return max(18, ceil(rect.height))
        }
        context.beginPage()
        var y: CGFloat = 48
        (title as NSString).draw(in: CGRect(x: 40, y: y, width: 515, height: 28), withAttributes: [.font: titleFont])
        y += 40
        for line in plain.components(separatedBy: "\n") {
          let height = lineHeight(line.isEmpty ? " " : line, font: font)
          if y + height > 800 {
            context.beginPage()
            y = 48
          }
          (line as NSString).draw(
            in: CGRect(x: 40, y: y, width: 515, height: height),
            withAttributes: [.font: font, .foregroundColor: UIColor.black]
          )
          y += height + 2
        }
      }
      return ("GENERATED PDF \(name) on this iPhone in the Arrab folder.", url)
    } catch {
      return ("FAILED generate_pdf: \(error.localizedDescription)", nil)
    }
  }

  private static func writeRTF(_ args: [String: String]) -> (String, URL?) {
    let content = args["content"] ?? args["body"] ?? ""
    guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return ("FAILED generate_docx: requires content.", nil)
    }
    var name = safeName(args["path"] ?? "arrab-document.rtf", fallback: "arrab-document.rtf")
    if name.lowercased().hasSuffix(".docx") { name = String(name.dropLast(5)) + ".rtf" }
    if !name.lowercased().hasSuffix(".rtf") { name += ".rtf" }
    var body = ""
    for scalar in content.unicodeScalars {
      if scalar.value == 10 || scalar.value == 13 { body += "\\par\n"; continue }
      if scalar == "\\" || scalar == "{" || scalar == "}" { body += "\\\(scalar)"; continue }
      if scalar.value < 128 { body.append(Character(scalar)); continue }
      let n = Int16(bitPattern: UInt16(truncatingIfNeeded: scalar.value))
      body += "\\u\(n)?"
    }
    let rtf = "{\\rtf1\\ansi\\uc1\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 \(body)}"
    let url = folder.appendingPathComponent(name)
    do {
      try rtf.write(to: url, atomically: true, encoding: .utf8)
      return ("GENERATED document \(name) on this iPhone. Pages and Word can open this RTF file.", url)
    } catch {
      return ("FAILED generate_docx: \(error.localizedDescription)", nil)
    }
  }

  private static func writePlain(_ args: [String: String], fallback: String, kind: String) -> (String, URL?) {
    let content = args["content"] ?? ""
    guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return ("FAILED \(kind): requires content.", nil)
    }
    let name = safeName(args["path"] ?? fallback, fallback: fallback)
    let url = folder.appendingPathComponent(name)
    do {
      try content.write(to: url, atomically: true, encoding: .utf8)
      return ("WROTE \(kind) \(name) on this iPhone in the Arrab folder.", url)
    } catch {
      return ("FAILED \(kind): \(error.localizedDescription)", nil)
    }
  }

  private static func writeHTML(_ args: [String: String], fallback: String, slides: Bool) -> (String, URL?) {
    let content = args["content"] ?? args["html"] ?? args["slides"] ?? ""
    guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return ("FAILED html: requires content.", nil)
    }
    var name = safeName(args["path"] ?? fallback, fallback: fallback)
    if !name.lowercased().hasSuffix(".html") { name += ".html" }
    let title = args["title"] ?? "Arrab"
    let body = slides ? slidesHTML(title: title, content: content) : content
    let html = body.lowercased().contains("<html") ? body : """
    <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\(title)</title>
    <style>body{font-family:-apple-system,sans-serif;margin:24px;line-height:1.5}</style></head><body>\(body)</body></html>
    """
    let url = folder.appendingPathComponent(name)
    do {
      try html.write(to: url, atomically: true, encoding: .utf8)
      return ("WROTE \(name) on this iPhone.", url)
    } catch {
      return ("FAILED html: \(error.localizedDescription)", nil)
    }
  }

  private static func slidesHTML(title: String, content: String) -> String {
    let slides = content.components(separatedBy: "---").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    let sections = slides.map { "<section>\($0.replacingOccurrences(of: "\n", with: "<br>"))</section>" }.joined()
    return """
    <!doctype html><html><head><meta charset="utf-8"><title>\(title)</title>
    <style>section{min-height:70vh;padding:32px;border-bottom:1px solid #ddd;font-family:-apple-system,sans-serif}</style>
    </head><body><h1>\(title)</h1>\(sections)</body></html>
    """
  }

  private static func readSaved(_ args: [String: String]) -> (String, URL?) {
    let name = safeName(args["path"] ?? "", fallback: "")
    guard !name.isEmpty else { return ("FAILED read: requires path.", nil) }
    let url = folder.appendingPathComponent(name)
    guard let text = try? String(contentsOf: url, encoding: .utf8) else {
      return ("FAILED read: \(name) is not in the Arrab folder on this iPhone.", nil)
    }
    return (clip("FILE \(name):\n\(text)"), url)
  }

  private static func listSaved() -> String {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    if names.isEmpty { return "Arrab folder on this iPhone is empty." }
    return "Files in the Arrab folder:\n" + names.sorted().map { "• \($0)" }.joined(separator: "\n")
  }

  private static func searchSaved(_ query: String) -> String {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard q.count >= 2 else { return "FAILED search: query is required." }
    let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    var hits: [String] = []
    for name in names {
      guard let text = try? String(contentsOf: folder.appendingPathComponent(name), encoding: .utf8) else { continue }
      if text.localizedCaseInsensitiveContains(q) || name.localizedCaseInsensitiveContains(q) {
        hits.append(name)
      }
    }
    return hits.isEmpty ? "No files in the Arrab folder matched \(q)." : "Matches:\n" + hits.map { "• \($0)" }.joined(separator: "\n")
  }

  private static func makeDir(_ args: [String: String]) -> (String, URL?) {
    let name = safeName(args["path"] ?? "folder", fallback: "folder")
    let url = folder.appendingPathComponent(name, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
      return ("CREATED folder \(name) in the Arrab folder.", url)
    } catch {
      return ("FAILED create_dir: \(error.localizedDescription)", nil)
    }
  }
}

private extension URL {
  func queryValue(_ name: String) -> String? {
    URLComponents(url: self, resolvingAgainstBaseURL: false)?
      .queryItems?
      .first { $0.name == name }?
      .value?
      .removingPercentEncoding
  }
}
