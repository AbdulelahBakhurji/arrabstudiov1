import Foundation
import Combine

/// Links the phone to Arrab Studio on Mac/PC via deep link, QR payload, or LAN API URL.
@MainActor
final class PCLinkStore: ObservableObject {
  @Published var pcHostLabel: String = ""
  @Published var isLinked = false
  @Published var lastMessage: String = ""
  @Published var pendingPairCode: String = ""

  private var pendingToken: String?

  private let defaultsKey = "arrab.pcLink.host"

  init() {
    pcHostLabel = UserDefaults.standard.string(forKey: defaultsKey) ?? ""
    isLinked = !pcHostLabel.isEmpty
  }

  /// Accepts:
  /// - `arrab://link?api=http://192.168.x.x:8787&token=...`
  /// - `arrab://pair?code=ABCD-1234`
  /// - plain `http(s)://...` API base
  func handleDeepLink(_ url: URL) {
    guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
    let items = comps.queryItems ?? []

    if comps.host == "pair" || comps.path.contains("pair") {
      if let code = items.first(where: { $0.name == "code" })?.value {
        pendingPairCode = code
        lastMessage = "Pair code ready — open Link PC and confirm."
      }
    }

    if let api = items.first(where: { $0.name == "api" })?.value {
      connect(apiBase: api)
    } else if url.scheme == "http" || url.scheme == "https" {
      connect(apiBase: url.absoluteString)
    }

    if let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty {
      pendingToken = token
      lastMessage = "Session received from PC."
    }
  }

  func connect(apiBase: String) {
    let trimmed = apiBase.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    ArrabAPIClient.shared.baseURL = trimmed
    pcHostLabel = trimmed
    UserDefaults.standard.set(trimmed, forKey: defaultsKey)
    isLinked = true
    lastMessage = "Connected to \(trimmed)"
  }

  func disconnect() {
    pcHostLabel = ""
    isLinked = false
    UserDefaults.standard.removeObject(forKey: defaultsKey)
    lastMessage = "PC link cleared. Cloud API still available."
  }

  func consumedSessionToken() -> String? {
    let token = pendingToken
    pendingToken = nil
    return token
  }

  /// Operator types the same short code shown on desktop Settings → Phone.
  func applyPairCode(_ code: String) {
    let clean = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    pendingPairCode = clean
    // Convention: desktop advertises LAN URL in Keychain/cloud; for v1 we map code → local default.
    // Prefer scanning QR / deep link when available.
    if clean.count >= 4 {
      lastMessage = "Code \(clean) saved. Scan the desktop QR or paste the LAN API URL to finish."
    }
  }
}
