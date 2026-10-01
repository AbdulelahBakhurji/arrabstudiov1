import Foundation

/// Server commands are data, never code: only these types run, everything else is acked `ignored`.
enum ManagedCommandType: String, CaseIterable {
  case refreshConfig = "refresh_config"
  case showMessage = "show_message"
  case forceUpdate = "force_update"
  case openCompanion = "open_companion"
  case openUrl = "open_url"
  case clearCache = "clear_cache"
  case signOut = "sign_out"
  case resetDevice = "reset_device"
  case requestLogs = "request_logs"
}

enum CommandAckStatus: String { case done, failed, ignored }

struct CommandResult {
  var status: CommandAckStatus
  var error: String?
}

enum ManagedDeepLink: Equatable {
  case companion(String)
  case chat(String)
  case usage
  case update
  case family
}

enum ManagedAllowlist {
  private static let exactHosts: Set<String> = [
    "arrabai.com",
    "apps.apple.com",
    "play.google.com",
    "appgallery.huawei.com",
    "galaxystore.samsung.com",
  ]

  /// HTTPS only, no credentials in the URL, and only Arrab or official store hosts.
  static func isAllowedURL(_ raw: String?) -> Bool {
    guard let raw, let comps = URLComponents(string: raw),
          comps.scheme?.lowercased() == "https",
          comps.user == nil, comps.password == nil,
          let host = comps.host?.lowercased(), !host.isEmpty else { return false }
    return exactHosts.contains(host) || host.hasSuffix(".arrabai.com")
  }

  private static let idPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{1,120}$")

  private static func isSafeId(_ id: String) -> Bool {
    idPattern.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil
  }

  /// `arrab://companions/:id`, `arrab://chat/:conversationId`, `arrab://settings/usage`, `arrab://update`.
  static func parseDeepLink(_ raw: String?) -> ManagedDeepLink? {
    guard let raw, let url = URL(string: raw), url.scheme?.lowercased() == "arrab" else { return nil }
    let head = url.host?.lowercased() ?? ""
    let rest = url.path.split(separator: "/").map(String.init)
    switch (head, rest.count) {
    case ("companions", 1) where isSafeId(rest[0]): return .companion(rest[0])
    case ("chat", 1) where isSafeId(rest[0]): return .chat(rest[0])
    case ("settings", 1) where rest[0] == "usage": return .usage
    case ("update", 0): return .update
    case ("family", 0): return .family
    default: return nil
    }
  }
}

/// Side effects the router may ask for; the app decides how each one looks.
@MainActor
protocol ManagedCommandEffects: AnyObject {
  func refreshConfig() async
  func showMessage(title: LocalizedText, body: LocalizedText?, severity: MaintenanceSeverity)
  func forceUpdate(blocking: Bool)
  func companionExists(_ id: String) -> Bool
  func openCompanion(_ id: String)
  func openURL(_ url: URL)
  func clearCache()
  func signOut() async
  func resetDevice() async
  /// Asks the user first; returns false when they decline.
  func requestLogs() async -> Bool
}

@MainActor
final class CommandRouter {
  private let handledKey = "arrab.managed.handledCommands"
  private var handled: [String]
  private weak var effects: ManagedCommandEffects?

  init(effects: ManagedCommandEffects) {
    self.effects = effects
    handled = UserDefaults.standard.stringArray(forKey: handledKey) ?? []
  }

  /// `nil` when this id already ran — nothing to ack again.
  func handle(_ command: ClientCommand, now: Date = Date()) async -> CommandResult? {
    guard !handled.contains(command.id) else { return nil }
    remember(command.id)
    if ManagedRules.isExpired(command.expiresAt, now: now) {
      return CommandResult(status: .ignored, error: "expired")
    }
    guard let type = ManagedCommandType(rawValue: command.type), let effects else {
      return CommandResult(status: .ignored, error: "unsupported")
    }
    let payload = command.payload
    switch type {
    case .refreshConfig:
      await effects.refreshConfig()
    case .showMessage:
      guard let title = LocalizedText.parse(payload["title"]) else {
        return CommandResult(status: .failed, error: "missing title")
      }
      let severity = MaintenanceSeverity(rawValue: payload["severity"] as? String ?? "") ?? .info
      effects.showMessage(title: title, body: LocalizedText.parse(payload["body"]), severity: severity)
    case .forceUpdate:
      effects.forceUpdate(blocking: payload["blocking"] as? Bool == true)
    case .openCompanion:
      let id = payload["companionId"] as? String ?? ""
      guard effects.companionExists(id) else {
        return CommandResult(status: .failed, error: "companion unavailable")
      }
      effects.openCompanion(id)
    case .openUrl:
      let raw = payload["url"] as? String
      guard ManagedAllowlist.isAllowedURL(raw), let url = URL(string: raw!) else {
        return CommandResult(status: .failed, error: "url not allowed")
      }
      effects.openURL(url)
    case .clearCache:
      effects.clearCache()
    case .signOut:
      await effects.signOut()
    case .resetDevice:
      await effects.resetDevice()
    case .requestLogs:
      guard await effects.requestLogs() else {
        return CommandResult(status: .ignored, error: "user declined")
      }
    }
    return CommandResult(status: .done)
  }

  private func remember(_ id: String) {
    handled.append(id)
    if handled.count > 200 { handled.removeFirst(handled.count - 200) }
    UserDefaults.standard.set(handled, forKey: handledKey)
  }
}
