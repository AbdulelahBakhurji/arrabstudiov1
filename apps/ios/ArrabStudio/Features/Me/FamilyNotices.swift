import Foundation
@preconcurrency import UserNotifications

struct FamilyNotice: Codable, Identifiable, Equatable {
  var id: String
  var kind: String
  var name: String
  var detail: String
  var at: Date
  var read: Bool
}

/// Parental and household notices. Each one is kept in the family inbox and shown on the phone.
@MainActor
final class FamilyNotices: ObservableObject {
  static let shared = FamilyNotices()

  @Published private(set) var items: [FamilyNotice] = []

  private let key = "arrab.family.notices"
  private let category = "ARRAB_FAMILY"

  private init() {
    if let data = UserDefaults.standard.data(forKey: key),
       let saved = try? JSONDecoder().decode([FamilyNotice].self, from: data) {
      items = saved
    }
  }

  var unread: Int { items.filter { !$0.read }.count }

  func post(kind: String, name: String = "", detail: String = "", arabic: Bool) {
    let item = FamilyNotice(
      id: "family.\(UUID().uuidString)",
      kind: kind,
      name: name,
      detail: detail,
      at: Date(),
      read: false
    )
    items.insert(item, at: 0)
    if items.count > 80 { items = Array(items.prefix(80)) }
    save()
    Task { await deliver(item, arabic: arabic, trigger: nil) }
  }

  func markRead(_ id: String) {
    guard let index = items.firstIndex(where: { $0.id == id }), !items[index].read else { return }
    items[index].read = true
    save()
  }

  func markAllRead() {
    for index in items.indices { items[index].read = true }
    save()
  }

  func remove(_ id: String) {
    items.removeAll { $0.id == id }
    save()
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
  }

  func clear() {
    let ids = items.map(\.id)
    items = []
    save()
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
  }

  /// Repeating bedtime warning and the moment chat pauses. Does not add an inbox row.
  func scheduleBedtime(id: String, name: String, hour: Int, arabic: Bool) async {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: ["family.soon.\(id)", "family.bed.\(id)"])
    guard await allowed() else { return }
    let soon = DateComponents(hour: hour == 0 ? 23 : hour - 1, minute: hour == 0 ? 45 : 45)
    let start = DateComponents(hour: hour, minute: 0)
    await add(
      id: "family.soon.\(id)",
      title: arabic ? "اقترب وقت النوم" : "Bedtime is close",
      body: arabic ? "بعد ١٥ دقيقة يتوقف الدردشة لـ \(name)." : "Chat pauses for \(name) in 15 minutes.",
      when: soon
    )
    await add(
      id: "family.bed.\(id)",
      title: arabic ? "وقت النوم" : "Bedtime",
      body: arabic ? "توقفت الدردشة لـ \(name) حتى ٧:٠٠." : "Chat is paused for \(name) until 7:00.",
      when: start
    )
  }

  func cancelBedtime(id: String) {
    UNUserNotificationCenter.current().removePendingNotificationRequests(
      withIdentifiers: ["family.soon.\(id)", "family.bed.\(id)"]
    )
  }

  func scheduleQuiet(start: Int, enabled: Bool, arabic: Bool) async {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: ["family.quiet"])
    guard enabled, await allowed() else { return }
    await add(
      id: "family.quiet",
      title: arabic ? "ساعات الهدوء" : "Quiet hours",
      body: arabic ? "الدردشة تنتظر حتى الصباح." : "Chat waits until morning.",
      when: DateComponents(hour: start, minute: 0)
    )
  }

  func title(_ item: FamilyNotice, arabic: Bool) -> String {
    switch item.kind {
    case "member": return arabic ? "مقعد جديد" : "New seat"
    case "pause": return arabic ? "إيقاف" : "Paused"
    case "resume": return arabic ? "استئناف" : "Resumed"
    case "tokens": return arabic ? "رموز" : "Tokens"
    case "guidance": return arabic ? "توجيه" : "Guidance"
    case "switch": return arabic ? "المقعد الحالي" : "Active seat"
    case "quietOn": return arabic ? "ساعات الهدوء" : "Quiet hours"
    case "quietOff": return arabic ? "ساعات الهدوء" : "Quiet hours"
    case "approvalOn", "approvalOff": return arabic ? "الموافقة" : "Approval"
    case "boundary": return arabic ? "الحد" : "Boundary"
    case "bedtime": return arabic ? "وقت النوم" : "Bedtime"
    default: return arabic ? "العائلة" : "Family"
    }
  }

  func body(_ item: FamilyNotice, arabic: Bool) -> String {
    switch item.kind {
    case "member":
      return arabic ? "\(item.name) انضم إلى البيت." : "\(item.name) joined the house."
    case "pause":
      return arabic ? "توقفت الدردشة لـ \(item.name)." : "Chat is paused for \(item.name)."
    case "resume":
      return arabic ? "\(item.name) يقدر يدردش من جديد." : "\(item.name) can chat again."
    case "tokens":
      return arabic ? "أُضيفت \(item.detail) رمز إلى \(item.name)." : "\(item.detail) tokens added for \(item.name)."
    case "guidance":
      return arabic ? "ملاحظة خاصة لـ \(item.name)." : "A private note for \(item.name)."
    case "switch":
      return arabic ? "البيت الآن على مقعد \(item.name)." : "The house is now on \(item.name)."
    case "quietOn":
      return arabic ? "الدردشة تنتظر من \(item.detail)." : "Chat waits from \(item.detail)."
    case "quietOff":
      return arabic ? "ساعات الهدوء متوقفة." : "Quiet hours are off."
    case "approvalOn":
      return arabic ? "ردود الرفاق تحتاج موافقة." : "Companion replies need approval."
    case "approvalOff":
      return arabic ? "الموافقة لم تعد مطلوبة." : "Approval is no longer required."
    case "boundary":
      return arabic ? "الحد الآن: \(item.detail)." : "Boundary is now \(item.detail)."
    case "bedtime":
      return arabic ? "دردشة \(item.name) تتوقف الساعة \(item.detail)." : "Chat for \(item.name) pauses at \(item.detail)."
    default:
      return item.detail
    }
  }

  func isCare(_ kind: String) -> Bool {
    ["pause", "resume", "quietOn", "quietOff", "approvalOn", "approvalOff", "boundary", "bedtime"].contains(kind)
  }

  private func deliver(_ item: FamilyNotice, arabic: Bool, trigger: UNNotificationTrigger?) async {
    guard await allowed() else { return }
    let content = UNMutableNotificationContent()
    content.title = title(item, arabic: arabic)
    content.body = body(item, arabic: arabic)
    content.sound = .default
    content.categoryIdentifier = category
    content.threadIdentifier = "family"
    content.userInfo = ["notificationId": item.id, "deepLink": "arrab://family"]
    if isCare(item.kind) { content.interruptionLevel = .timeSensitive }
    let request = UNNotificationRequest(identifier: item.id, content: content, trigger: trigger)
    try? await UNUserNotificationCenter.current().add(request)
  }

  private func add(id: String, title: String, body: String, when: DateComponents) async {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    content.interruptionLevel = .timeSensitive
    content.threadIdentifier = "family"
    content.categoryIdentifier = category
    content.userInfo = ["notificationId": id, "deepLink": "arrab://family"]
    let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
    try? await UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: id, content: content, trigger: trigger)
    )
  }

  private func allowed() async -> Bool {
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral:
      return true
    case .notDetermined:
      return (try? await center.requestAuthorization(options: [.alert, .sound, .badge, .timeSensitive])) ?? false
    default:
      return false
    }
  }

  private func save() {
    if let data = try? JSONEncoder().encode(items) {
      UserDefaults.standard.set(data, forKey: key)
    }
  }
}
