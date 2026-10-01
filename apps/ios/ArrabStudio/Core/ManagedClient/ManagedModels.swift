import Foundation

// Arrab Control managed-client contract (docs/MANAGED_CLIENT.md).
// Parsing is tolerant: every field is optional, unknown fields are ignored and a
// malformed item is skipped instead of failing the whole response.

struct LocalizedText: Codable, Equatable {
  var en: String
  var ar: String

  func text(arabic: Bool) -> String { arabic ? ar : en }

  static func parse(_ value: Any?) -> LocalizedText? {
    if let raw = value as? String {
      let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : LocalizedText(en: raw, ar: raw)
    }
    guard let dict = value as? [String: Any] else { return nil }
    let en = nonEmpty(dict["en"])
    let ar = nonEmpty(dict["ar"])
    guard en != nil || ar != nil else { return nil }
    return LocalizedText(en: en ?? ar!, ar: ar ?? en!)
  }
}

enum MaintenanceSeverity: String, Codable { case info, warning, critical }

struct Maintenance: Codable, Equatable {
  var message: LocalizedText?
  var severity: MaintenanceSeverity
  var requireUpdate: Bool
  var minVersion: String?
  var latestVersion: String?
  var downloadUrl: String?
  var readOnly: Bool
  var until: String?

  static func parse(_ value: Any?) -> Maintenance? {
    guard let d = value as? [String: Any] else { return nil }
    return Maintenance(
      message: LocalizedText.parse(d["message"]),
      severity: MaintenanceSeverity(rawValue: d["severity"] as? String ?? "") ?? .info,
      requireUpdate: d["requireUpdate"] as? Bool ?? false,
      minVersion: nonEmpty(d["minVersion"]),
      latestVersion: nonEmpty(d["latestVersion"]),
      downloadUrl: nonEmpty(d["downloadUrl"]),
      readOnly: d["readOnly"] as? Bool ?? false,
      until: nonEmpty(d["until"])
    )
  }
}

enum CompanionBadge: String, Codable { case new, beta }

struct CompanionPolicy: Codable, Equatable {
  var id: String
  var enabled: Bool
  var visible: Bool
  var pinned: Bool
  var order: Double?
  var badge: CompanionBadge?
  var maintenance: String?

  static func parse(_ value: Any?) -> CompanionPolicy? {
    guard let d = value as? [String: Any], let id = nonEmpty(d["id"]) else { return nil }
    return CompanionPolicy(
      id: id,
      enabled: d["enabled"] as? Bool ?? true,
      visible: d["visible"] as? Bool ?? true,
      pinned: d["pinned"] as? Bool ?? false,
      order: number(d["order"]),
      badge: CompanionBadge(rawValue: d["badge"] as? String ?? ""),
      maintenance: nonEmpty(d["maintenance"])
    )
  }
}

struct ClientLimits: Codable, Equatable {
  var plan: String?
  var messagesPerDay: Double?
  var messagesUsedToday: Double?
  var tokensPerMonth: Double?
  var tokensUsedThisMonth: Double?
  var maxAttachmentsMb: Double?
  var maxCompanions: Double?
  var resetsAt: String?

  static func parse(_ value: Any?) -> ClientLimits? {
    guard let d = value as? [String: Any] else { return nil }
    return ClientLimits(
      plan: nonEmpty(d["plan"]),
      messagesPerDay: number(d["messagesPerDay"]),
      messagesUsedToday: number(d["messagesUsedToday"]),
      tokensPerMonth: number(d["tokensPerMonth"]),
      tokensUsedThisMonth: number(d["tokensUsedThisMonth"]),
      maxAttachmentsMb: number(d["maxAttachmentsMb"]),
      maxCompanions: number(d["maxCompanions"]),
      resetsAt: nonEmpty(d["resetsAt"])
    )
  }
}

struct ClientConfig: Codable, Equatable {
  var version: String?
  var companions: [CompanionPolicy]
  var limits: ClientLimits?
  var features: [String: Bool]

  static func parse(_ value: Any?) -> ClientConfig? {
    guard let d = value as? [String: Any] else { return nil }
    let companions = (d["companions"] as? [Any] ?? []).compactMap(CompanionPolicy.parse)
    var features: [String: Bool] = [:]
    for (key, flag) in d["features"] as? [String: Any] ?? [:] {
      if let flag = flag as? Bool { features[key] = flag }
    }
    return ClientConfig(
      version: nonEmpty(d["version"]),
      companions: companions,
      limits: ClientLimits.parse(d["limits"]),
      features: features
    )
  }
}

enum NotificationKind: String, Codable { case info, warning, update, security, companion }

struct ClientNotification: Codable, Equatable, Identifiable {
  var id: String
  var title: LocalizedText
  var body: LocalizedText?
  var kind: NotificationKind
  var deepLink: String?
  var native: Bool
  var inApp: Bool
  var expiresAt: String?

  static func parse(_ value: Any?) -> ClientNotification? {
    guard let d = value as? [String: Any], let id = nonEmpty(d["id"]),
          let title = LocalizedText.parse(d["title"]) else { return nil }
    return ClientNotification(
      id: id,
      title: title,
      body: LocalizedText.parse(d["body"]),
      kind: NotificationKind(rawValue: d["kind"] as? String ?? "") ?? .info,
      deepLink: nonEmpty(d["deepLink"]),
      native: d["native"] as? Bool ?? false,
      inApp: d["inApp"] as? Bool ?? true,
      expiresAt: nonEmpty(d["expiresAt"])
    )
  }
}

struct ClientCommand {
  var id: String
  /// Raw so unknown types can still be acked as `ignored`.
  var type: String
  var payload: [String: Any]
  var expiresAt: String?

  static func parse(_ value: Any?) -> ClientCommand? {
    guard let d = value as? [String: Any], let id = nonEmpty(d["id"]),
          let type = nonEmpty(d["type"]) else { return nil }
    return ClientCommand(
      id: id,
      type: type,
      payload: d["payload"] as? [String: Any] ?? [:],
      expiresAt: nonEmpty(d["expiresAt"])
    )
  }
}

struct SyncResponse {
  var pollAfterSec: Double?
  var maintenance: Maintenance?
  var config: ClientConfig?
  var notifications: [ClientNotification]
  var commands: [ClientCommand]

  /// Anything unparseable becomes an empty response.
  static func parse(_ data: Data) -> SyncResponse {
    let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    return SyncResponse(
      pollAfterSec: number(root["pollAfterSec"]),
      maintenance: Maintenance.parse(root["maintenance"]),
      config: ClientConfig.parse(root["config"]),
      notifications: (root["notifications"] as? [Any] ?? []).compactMap(ClientNotification.parse),
      commands: (root["commands"] as? [Any] ?? []).compactMap(ClientCommand.parse)
    )
  }
}

// MARK: - Rules shared with the desktop client

enum ManagedRules {
  static func parseDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let full = ISO8601DateFormatter()
    full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = full.date(from: value) { return date }
    return ISO8601DateFormatter().date(from: value)
  }

  static func isExpired(_ expiresAt: String?, now: Date = Date()) -> Bool {
    guard let at = parseDate(expiresAt) else { return false }
    return at <= now
  }

  /// Semver precedence; `nil` when either side is not a version.
  static func compareVersions(_ a: String, _ b: String) -> Int? {
    guard let left = Semver(a), let right = Semver(b) else { return nil }
    return left.compare(right)
  }

  enum UpdateMode { case none, soft, blocking }

  static func updateMode(appVersion: String, maintenance: Maintenance?) -> UpdateMode {
    guard let m = maintenance else { return .none }
    if let min = m.minVersion, let cmp = compareVersions(appVersion, min), cmp < 0 { return .blocking }
    let latestCmp = m.latestVersion.flatMap { compareVersions(appVersion, $0) }
    if m.requireUpdate, latestCmp == nil || latestCmp! < 0 { return .soft }
    if let latestCmp, latestCmp < 0 { return .soft }
    return .none
  }

  enum LimitLevel: Int, Comparable {
    case ok = 0, warn80, warn95, blocked
    static func < (a: LimitLevel, b: LimitLevel) -> Bool { a.rawValue < b.rawValue }
  }

  static func level(used: Double?, cap: Double?) -> (LimitLevel, Double)? {
    guard let used, let cap, cap > 0 else { return nil }
    let ratio = used / cap
    let level: LimitLevel = ratio >= 1 ? .blocked : ratio >= 0.95 ? .warn95 : ratio >= 0.8 ? .warn80 : .ok
    return (level, ratio)
  }

  /// The worst of the daily-message and monthly-token meters.
  static func limitLevel(_ limits: ClientLimits?) -> (level: LimitLevel, ratio: Double) {
    guard let limits else { return (.ok, 0) }
    let meters = [
      level(used: limits.messagesUsedToday, cap: limits.messagesPerDay),
      level(used: limits.tokensUsedThisMonth, cap: limits.tokensPerMonth),
    ].compactMap { $0 }
    return meters.max { $0.1 < $1.1 }.map { ($0.0, $0.1) } ?? (.ok, 0)
  }

  static func applyPolicy<T>(_ items: [T], policies: [CompanionPolicy], ids: (T) -> [String]) -> [T] {
    guard !policies.isEmpty else { return items }
    let byId = Dictionary(policies.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    func policy(_ item: T) -> CompanionPolicy? { ids(item).lazy.compactMap { byId[$0] }.first }
    return items.enumerated()
      .filter { entry in
        guard let p = policy(entry.element) else { return true }
        return p.enabled && p.visible
      }
      .sorted { lhs, rhs in
        let a = policy(lhs.element), b = policy(rhs.element)
        let pa = a?.pinned ?? false, pb = b?.pinned ?? false
        if pa != pb { return pa }
        let oa = a?.order ?? .infinity, ob = b?.order ?? .infinity
        if oa != ob { return oa < ob }
        return lhs.offset < rhs.offset
      }
      .map(\.element)
  }
}

struct Semver {
  let core: [Int]
  let pre: [String]

  init?(_ raw: String) {
    var text = raw.trimmingCharacters(in: .whitespaces)
    if text.hasPrefix("v") || text.hasPrefix("V") { text.removeFirst() }
    text = String(text.split(separator: "+", maxSplits: 1).first ?? "")
    let parts = text.split(separator: "-", maxSplits: 1).map(String.init)
    guard let head = parts.first else { return nil }
    let nums = head.split(separator: ".").map { Int($0) }
    guard nums.count == 3, nums.allSatisfy({ $0 != nil && $0! >= 0 }) else { return nil }
    core = nums.map { $0! }
    pre = parts.count > 1 ? parts[1].split(separator: ".").map(String.init) : []
  }

  func compare(_ other: Semver) -> Int {
    for (a, b) in zip(core, other.core) where a != b { return a < b ? -1 : 1 }
    if pre.isEmpty != other.pre.isEmpty { return pre.isEmpty ? 1 : -1 }
    for (a, b) in zip(pre, other.pre) where a != b {
      switch (Int(a), Int(b)) {
      case let (x?, y?): return x < y ? -1 : 1
      case (.some, nil): return -1
      case (nil, .some): return 1
      default: return a < b ? -1 : 1
      }
    }
    return pre.count == other.pre.count ? 0 : (pre.count < other.pre.count ? -1 : 1)
  }
}

private func nonEmpty(_ value: Any?) -> String? {
  guard let s = value as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  return s
}

private func number(_ value: Any?) -> Double? {
  guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
  let d = n.doubleValue
  return d.isFinite ? d : nil
}
