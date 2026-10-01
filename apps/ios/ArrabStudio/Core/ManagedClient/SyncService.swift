import Foundation
import SwiftUI
import UIKit
import UserNotifications

struct ManagedInboxItem: Codable, Identifiable, Equatable {
  var notification: ClientNotification
  var receivedAt: Date
  var read: Bool
  var id: String { notification.id }
}

struct ManagedMessage: Identifiable, Equatable {
  let id = UUID()
  var title: LocalizedText
  var body: LocalizedText?
  var severity: MaintenanceSeverity
}

/// Arrab Control client for iOS. Mirrors the desktop engine: silent on any
/// failure, cached config on error, 30 s → 60 s → 2 m → 5 m backoff with ±20%
/// jitter, and at most one sync every 20 s.
@MainActor
final class ManagedClient: ObservableObject, ManagedCommandEffects {
  static let shared = ManagedClient()

  static let syncPath = "/v1/client/sync"
  static let eventsPath = "/v1/client/events"
  static let minSyncGap: TimeInterval = 20
  private static let backoffSteps: [TimeInterval] = [30, 60, 120, 300]

  @Published private(set) var maintenance: Maintenance?
  @Published private(set) var config: ClientConfig?
  @Published private(set) var inbox: [ManagedInboxItem] = []
  @Published var message: ManagedMessage?
  @Published var forcedBlocking = false
  @Published var blockingCollapsed = false
  @Published var softDismissedAt: Date?
  @Published var pendingRoute: ManagedDeepLink?
  @Published var logsConsentPending = false
  @Published var serverLimitMessage: String?

  var arabic = false
  var activeScreen = "home"
  var activeCompanionId: String?
  var signOutHandler: (() async -> Void)?

  private let api = ArrabAPIClient.shared
  private lazy var router = CommandRouter(effects: self)
  private let defaults = UserDefaults.standard
  private var ackedCommands: [String] = []
  private var ackedNotifications: [String] = []
  private var handledNotifications: [String]
  private var failures = 0
  private var nextAt: Date?
  private var lastAttemptAt: Date?
  private var inFlight = false
  private var pollTask: Task<Void, Never>?
  private var liveTask: Task<Void, Never>?
  private var liveFailures = 0
  private var logsContinuation: CheckedContinuation<Bool, Never>?
  private var diagnostics: [(Date, String, String)] = []

  private enum Keys {
    static let maintenance = "arrab.managed.maintenance"
    static let config = "arrab.managed.config"
    static let inbox = "arrab.managed.inbox.v1"
    static let handledNotifications = "arrab.managed.handledNotifications"
    static let softDismissed = "arrab.managed.softDismissedAt"
  }

  private init() {
    handledNotifications = defaults.stringArray(forKey: Keys.handledNotifications) ?? []
    maintenance = decode(Maintenance.self, Keys.maintenance)
    config = decode(ClientConfig.self, Keys.config)
    inbox = decode([ManagedInboxItem].self, Keys.inbox) ?? []
    softDismissedAt = defaults.object(forKey: Keys.softDismissed) as? Date
  }

  // MARK: - Derived state

  var appVersion: String { DeviceIdentity.appVersion }

  var updateMode: ManagedRules.UpdateMode {
    forcedBlocking ? .blocking : ManagedRules.updateMode(appVersion: appVersion, maintenance: maintenance)
  }

  var readOnly: Bool { maintenance?.readOnly == true }

  var limitLevel: ManagedRules.LimitLevel { ManagedRules.limitLevel(config?.limits).level }

  var sendBlocked: Bool { updateMode == .blocking || readOnly || limitLevel == .blocked }

  var showSoftBanner: Bool {
    guard updateMode == .soft else { return false }
    guard let at = softDismissedAt else { return true }
    return Date().timeIntervalSince(at) >= 24 * 60 * 60
  }

  var unreadCount: Int { inbox.filter { !$0.read }.count }

  func policies() -> [CompanionPolicy] { config?.companions ?? [] }

  func applyPolicy(to agents: [Agent]) -> [Agent] {
    ManagedRules.applyPolicy(agents, policies: policies()) { [$0.id] }
  }

  func isCompanionEnabled(_ id: String) -> Bool {
    policies().first { $0.id == id }?.enabled ?? true
  }

  // MARK: - Lifecycle

  func start() {
    Task { await syncNow(reason: "launch") }
    openLive()
  }

  func enterBackground() {
    pollTask?.cancel()
    liveTask?.cancel()
    liveTask = nil
  }

  func enterForeground() {
    Task { await syncNow(reason: "foreground") }
    openLive()
  }

  // MARK: - Sync

  func syncNow(reason: String) async {
    guard !inFlight else { return }
    let now = Date()
    if reason != "poll", failures > 0, let nextAt, nextAt > now { return }
    if reason != "poll", let last = lastAttemptAt, now.timeIntervalSince(last) < Self.minSyncGap {
      schedule(after: Self.minSyncGap - now.timeIntervalSince(last))
      return
    }
    guard api.hasSession else { return }
    inFlight = true
    lastAttemptAt = now
    defer { inFlight = false }

    let sentCommands = ackedCommands
    let sentNotifications = ackedNotifications
    guard let body = try? JSONSerialization.data(withJSONObject: requestBody(sentCommands, sentNotifications)) else { return }
    let result = await api.managedRequest("POST", path: Self.syncPath, json: body, timeout: 15)
    guard let result, (200..<300).contains(result.status) else {
      failures += 1
      let delay = Self.jitter(Self.backoffSteps[min(failures, Self.backoffSteps.count) - 1])
      nextAt = Date().addingTimeInterval(delay)
      log("sync", "failed \(result?.status ?? 0)")
      schedule(after: delay)
      return
    }
    failures = 0
    nextAt = nil
    ackedCommands.removeAll { sentCommands.contains($0) }
    ackedNotifications.removeAll { sentNotifications.contains($0) }
    log("sync", "ok")
    let response = SyncResponse.parse(result.body)
    await apply(response)
    schedule(after: Self.jitter(min(600, max(30, response.pollAfterSec ?? 60))))
  }

  private func requestBody(_ commands: [String], _ notifications: [String]) -> [String: Any] {
    var capabilities = ["local_notifications", "deep_link"]
    if DeviceIdentity.pushToken != nil { capabilities.append("remote_push") }
    let state: String = UIApplication.shared.applicationState == .active ? "foreground" : "background"
    return [
      "deviceId": DeviceIdentity.deviceId,
      "platform": DeviceIdentity.platform,
      "vendor": "apple",
      "osVersion": DeviceIdentity.osVersion,
      "appVersion": appVersion,
      "build": DeviceIdentity.build,
      "channel": DeviceIdentity.channel,
      "locale": arabic ? "ar" : "en",
      "timezone": TimeZone.current.identifier,
      "pushProvider": DeviceIdentity.pushToken == nil ? "none" : "apns",
      "pushToken": DeviceIdentity.pushToken ?? NSNull(),
      "capabilities": capabilities,
      "state": state,
      "activeScreen": activeScreen,
      "activeCompanionId": activeCompanionId ?? NSNull(),
      "configVersion": config?.version ?? NSNull(),
      "ackedCommandIds": commands,
      "ackedNotificationIds": notifications,
    ]
  }

  private func apply(_ response: SyncResponse) async {
    setMaintenance(response.maintenance)
    if let next = response.config { setConfig(next) }
    for notification in response.notifications { deliver(notification) }
    for command in response.commands { await run(command) }
  }

  private func schedule(after seconds: TimeInterval) {
    pollTask?.cancel()
    pollTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(max(1, seconds) * 1_000_000_000))
      guard !Task.isCancelled else { return }
      await self?.syncNow(reason: "poll")
    }
  }

  private static func jitter(_ seconds: TimeInterval) -> TimeInterval {
    seconds * Double.random(in: 0.8...1.2)
  }

  // MARK: - Live channel (foreground only; APNs covers the background)

  private func openLive() {
    guard liveTask == nil, api.hasSession else { return }
    liveTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        if let bytes = await self.api.managedEvents(path: Self.eventsPath) {
          self.liveFailures = 0
          await self.readEvents(bytes)
        }
        self.liveFailures += 1
        let step = Self.backoffSteps[min(self.liveFailures, Self.backoffSteps.count) - 1]
        try? await Task.sleep(nanoseconds: UInt64(Self.jitter(step) * 1_000_000_000))
      }
    }
  }

  private func readEvents(_ bytes: URLSession.AsyncBytes) async {
    var event = "message"
    var data = ""
    do {
      for try await line in bytes.lines {
        if Task.isCancelled { return }
        if line.hasPrefix("event:") {
          event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
          if !data.isEmpty { data += "\n" }
          data += line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        } else if line.isEmpty {
          await handleLive(event: event, data: data)
          event = "message"
          data = ""
        }
      }
    } catch {
      return
    }
  }

  private func handleLive(event: String, data: String) async {
    guard event != "ping", let raw = data.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: raw) else { return }
    switch event {
    case "maintenance": setMaintenance(Maintenance.parse(json))
    case "config": if let next = ClientConfig.parse(json) { setConfig(next) }
    case "notification": if let n = ClientNotification.parse(json) { deliver(n) }
    case "command": if let c = ClientCommand.parse(json) { await run(c) }
    default: break
    }
  }

  // MARK: - State

  private func setMaintenance(_ next: Maintenance?) {
    maintenance = next
    encode(next, Keys.maintenance)
  }

  private func setConfig(_ next: ClientConfig) {
    config = next
    encode(next, Keys.config)
  }

  func dismissSoftUpdate() {
    softDismissedAt = Date()
    defaults.set(softDismissedAt, forKey: Keys.softDismissed)
  }

  // MARK: - Notifications

  func deliver(_ notification: ClientNotification) {
    guard !handledNotifications.contains(notification.id) else { return }
    handledNotifications.append(notification.id)
    if handledNotifications.count > 200 { handledNotifications.removeFirst(handledNotifications.count - 200) }
    defaults.set(handledNotifications, forKey: Keys.handledNotifications)
    guard !ManagedRules.isExpired(notification.expiresAt) else { return }
    if notification.inApp {
      inbox.insert(ManagedInboxItem(notification: notification, receivedAt: Date(), read: false), at: 0)
      if inbox.count > 50 { inbox.removeLast(inbox.count - 50) }
      encode(inbox, Keys.inbox)
    }
    if notification.native { PushRegistration.postLocal(notification, arabic: arabic) }
    ackNotification(notification.id, action: "delivered")
  }

  func open(_ item: ManagedInboxItem) {
    markRead(item.id)
    ackNotification(item.id, action: "opened")
    route(item.notification.deepLink)
  }

  func dismiss(_ item: ManagedInboxItem) {
    inbox.removeAll { $0.id == item.id }
    encode(inbox, Keys.inbox)
    ackNotification(item.id, action: "dismissed")
  }

  func markRead(_ id: String?) {
    inbox = inbox.map { item in
      var copy = item
      if id == nil || item.id == id { copy.read = true }
      return copy
    }
    encode(inbox, Keys.inbox)
  }

  /// Push tap or in-app open. Only allowlisted `arrab://` links navigate.
  func route(_ deepLink: String?) {
    guard let link = ManagedAllowlist.parseDeepLink(deepLink) else { return }
    if case .update = link {
      openStore()
      return
    }
    pendingRoute = link
  }

  func ackNotification(_ id: String, action: String) {
    if !ackedNotifications.contains(id) { ackedNotifications.append(id) }
    post("/v1/client/notifications/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)/ack", ["action": action])
  }

  private func ackCommand(_ id: String, _ result: CommandResult) {
    if !ackedCommands.contains(id) { ackedCommands.append(id) }
    var body: [String: Any] = ["status": result.status.rawValue]
    if let error = result.error { body["error"] = error }
    log("command_ack", result.status.rawValue)
    post("/v1/client/commands/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)/ack", body)
  }

  private func post(_ path: String, _ body: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
    Task { _ = await api.managedRequest("POST", path: path, json: data) }
  }

  // MARK: - Commands

  private func run(_ command: ClientCommand) async {
    if let result = await router.handle(command) { ackCommand(command.id, result) }
  }

  func refreshConfig() async {
    lastAttemptAt = nil
    await syncNow(reason: "command")
  }

  func showMessage(title: LocalizedText, body: LocalizedText?, severity: MaintenanceSeverity) {
    message = ManagedMessage(title: title, body: body, severity: severity)
  }

  func forceUpdate(blocking: Bool) {
    if blocking {
      forcedBlocking = true
      blockingCollapsed = false
    } else {
      softDismissedAt = nil
      defaults.removeObject(forKey: Keys.softDismissed)
    }
  }

  func companionExists(_ id: String) -> Bool { isCompanionEnabled(id) && !id.isEmpty }

  func openCompanion(_ id: String) { pendingRoute = .companion(id) }

  func openURL(_ url: URL) { UIApplication.shared.open(url) }

  func clearCache() {
    config = nil
    defaults.removeObject(forKey: Keys.config)
    URLCache.shared.removeAllCachedResponses()
  }

  func signOut() async {
    inbox = []
    encode(inbox, Keys.inbox)
    await signOutHandler?()
  }

  func resetDevice() async {
    await signOut()
    DeviceIdentity.resetDeviceId()
  }

  func requestLogs() async -> Bool {
    let agreed = await withCheckedContinuation { continuation in
      logsContinuation = continuation
      logsConsentPending = true
    }
    guard agreed else { return false }
    // TODO(contract): diagnostics body shape is not specified; redacted metadata only.
    let formatter = ISO8601DateFormatter()
    let body: [String: Any] = [
      "deviceId": DeviceIdentity.deviceId,
      "appVersion": appVersion,
      "entries": diagnostics.map { ["at": formatter.string(from: $0.0), "kind": $0.1, "detail": $0.2] },
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return false }
    let result = await api.managedRequest("POST", path: "/v1/client/diagnostics", json: data)
    return result.map { (200..<300).contains($0.status) } ?? false
  }

  func answerLogsConsent(_ agreed: Bool) {
    logsConsentPending = false
    logsContinuation?.resume(returning: agreed)
    logsContinuation = nil
  }

  // MARK: - Updates

  /// App Store link from Arrab Control, only when it is on the allowlist.
  func openStore() {
    // TODO(contract): the App Store id is not in the contract; without a downloadUrl nothing opens.
    guard let raw = maintenance?.downloadUrl, ManagedAllowlist.isAllowedURL(raw), let url = URL(string: raw) else { return }
    UIApplication.shared.open(url)
  }

  // MARK: - Helpers

  private func log(_ kind: String, _ detail: String) {
    diagnostics.append((Date(), kind, String(detail.prefix(120))))
    if diagnostics.count > 100 { diagnostics.removeFirst(diagnostics.count - 100) }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
    guard let data = defaults.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }

  private func encode<T: Encodable>(_ value: T?, _ key: String) {
    guard let value, let data = try? JSONEncoder().encode(value) else {
      defaults.removeObject(forKey: key)
      return
    }
    defaults.set(data, forKey: key)
  }
}
