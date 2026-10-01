import Foundation
@preconcurrency import UserNotifications

enum AgentPlanKind {
  case reminder
  case alarm
}

struct AgentPlan {
  var kind: AgentPlanKind
  var note: String
  var fire: Date
  var repeatsDaily: Bool
  /// True when the user named a clock time ("at 7:30") rather than a delay ("in 10 minutes").
  var clock: Bool = false
}

enum AgentCommand {
  case schedule(AgentPlan)
  case cancel
}

/// Turns "remind me … after …" and "set an alarm …" into a local notification.
@MainActor
enum AgentAlerts {
  static func containsArabic(_ text: String) -> Bool {
    text.unicodeScalars.contains { (0x0600...0x06FF).contains($0.value) }
  }

  static func parse(_ raw: String) -> AgentCommand? {
    let text = digits(raw).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, leadingIntent(text) else { return nil }
    if isCancel(text) { return .cancel }
    let alarm = isAlarm(text)
    let reminder = isReminder(text)
    guard alarm || reminder else { return nil }
    let kind: AgentPlanKind = alarm && !startsAsReminder(text) ? .alarm : (reminder ? .reminder : .alarm)
    let daily = isDaily(text)
    let note = kind == .alarm ? "" : note(from: text)
    if let seconds = relativeSeconds(text) {
      let fire = Date().addingTimeInterval(max(5, min(seconds, 14 * 24 * 3600)))
      return .schedule(AgentPlan(kind: kind, note: note, fire: fire, repeatsDaily: false, clock: false))
    }
    if let clock = clockTime(text, allowBareFor: kind == .alarm),
       let fire = nextOccurrence(hour: clock.hour, minute: clock.minute, marker: clock.marker) {
      return .schedule(AgentPlan(kind: kind, note: note, fire: fire, repeatsDaily: daily, clock: true))
    }
    return nil
  }

  static func commit(_ command: AgentCommand, companion: String, arabic: Bool) async -> String {
    switch command {
    case .cancel:
      return await cancelPending(arabic: arabic)
    case .schedule(let plan):
      return await schedule(plan, companion: companion, arabic: arabic)
    }
  }

  static func snooze(title: String, body: String) async {
    let plan = AgentPlan(
      kind: .reminder,
      note: body,
      fire: Date().addingTimeInterval(5 * 60),
      repeatsDaily: false
    )
    _ = await schedule(plan, companion: title, arabic: containsArabic(title + body))
  }

  private static func schedule(_ plan: AgentPlan, companion: String, arabic: Bool) async -> String {
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    var allowed = settings.authorizationStatus == .authorized
      || settings.authorizationStatus == .provisional
      || settings.authorizationStatus == .ephemeral
    if settings.authorizationStatus == .notDetermined {
      allowed = (try? await center.requestAuthorization(options: [.alert, .sound, .badge, .timeSensitive])) ?? false
    }
    guard allowed else {
      return arabic
        ? "الإشعارات مقفلة. فعّلها من الإعدادات عشان أقدر أذكّرك."
        : "Notifications are off. Turn them on in Settings so I can remind you."
    }
    PushRegistration.registerCategories(arabic: arabic)
    let content = UNMutableNotificationContent()
    content.title = companion.isEmpty ? "Arrab" : companion
    if plan.kind == .alarm {
      content.body = arabic ? "حان وقت المنبه." : "Alarm."
    } else if plan.note.isEmpty {
      content.body = arabic ? "تذكير من Arrab." : "Reminder from Arrab."
    } else {
      content.body = plan.note
    }
    content.sound = .default
    content.interruptionLevel = .timeSensitive
    content.categoryIdentifier = PushRegistration.reminderCategory
    content.userInfo = [
      "deepLink": "arrab://chat/home",
      "kind": plan.kind == .alarm ? "alarm" : "reminder",
    ]
    let trigger: UNNotificationTrigger
    if plan.repeatsDaily {
      let parts = Calendar.current.dateComponents([.hour, .minute], from: plan.fire)
      trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: true)
    } else {
      let interval = max(5, plan.fire.timeIntervalSinceNow)
      trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
    }
    let request = UNNotificationRequest(
      identifier: "arrab.alert.\(UUID().uuidString)",
      content: content,
      trigger: trigger
    )
    do {
      try await center.add(request)
    } catch {
      return arabic ? "ما قدرت أضبط التذكير. حاول مرة ثانية." : "I couldn't set that. Try again."
    }
    let detail = plan.kind == .alarm
      ? (arabic ? "منبه" : "Alarm")
      : (plan.note.isEmpty ? (arabic ? "تذكير" : "Reminder") : plan.note)
    AgentLive.showCountdown(companion: companion, detail: detail, endsAt: plan.fire, alarm: plan.kind == .alarm)
    return confirmation(plan, arabic: arabic)
  }

  private static func cancelPending(arabic: Bool) async -> String {
    let center = UNUserNotificationCenter.current()
    let pending = await center.pendingNotificationRequests()
    let ids = pending.map(\.identifier).filter { $0.hasPrefix("arrab.alert.") }
    guard !ids.isEmpty else {
      return arabic ? "ما فيه تذكير أو منبه مضبوط." : "You don't have a reminder or alarm set."
    }
    center.removePendingNotificationRequests(withIdentifiers: ids)
    AgentLive.endCountdown()
    return arabic ? "ألغيت التذكيرات والمنبهات." : "Cancelled your reminders and alarms."
  }

  private static func confirmation(_ plan: AgentPlan, arabic: Bool) -> String {
    let when = whenPhrase(plan, arabic: arabic)
    if plan.kind == .alarm {
      return arabic ? "ضبطت المنبه \(when)." : "Alarm set \(when)."
    }
    if plan.note.isEmpty {
      return arabic ? "بذكّرك \(when)." : "I'll remind you \(when)."
    }
    return arabic ? "بذكّرك \(when): \(plan.note)." : "I'll remind you \(when): \(plan.note)."
  }

  private static func whenPhrase(_ plan: AgentPlan, arabic: Bool) -> String {
    let clock = clockPhrase(plan.fire, arabic: arabic)
    if plan.repeatsDaily {
      return arabic ? "كل يوم الساعة \(clock)" : "every day at \(clock)"
    }
    if plan.clock {
      if Calendar.current.isDateInToday(plan.fire) {
        return arabic ? "الساعة \(clock)" : "at \(clock)"
      }
      return arabic ? "بكرة الساعة \(clock)" : "tomorrow at \(clock)"
    }
    return relativePhrase(max(1, plan.fire.timeIntervalSinceNow), arabic: arabic)
  }

  private static func relativePhrase(_ interval: TimeInterval, arabic: Bool) -> String {
    let total = max(1, Int(interval.rounded()))
    if total < 60 {
      return arabic ? "بعد \(local(total, arabic: arabic)) ثانية" : "in \(total) second\(total == 1 ? "" : "s")"
    }
    let minutes = max(1, Int((interval / 60).rounded()))
    if minutes < 60 {
      if arabic { return "بعد \(arabicCount(minutes, one: "دقيقة", two: "دقيقتين", many: "دقائق"))" }
      return "in \(minutes) minute\(minutes == 1 ? "" : "s")"
    }
    let hours = minutes / 60
    let extra = minutes % 60
    if arabic {
      let hour = arabicCount(hours, one: "ساعة", two: "ساعتين", many: "ساعات")
      if extra == 0 { return "بعد \(hour)" }
      return "بعد \(hour) و\(arabicCount(extra, one: "دقيقة", two: "دقيقتين", many: "دقائق"))"
    }
    if extra == 0 { return "in \(hours) hour\(hours == 1 ? "" : "s")" }
    return "in \(hours) hour\(hours == 1 ? "" : "s") \(extra) minute\(extra == 1 ? "" : "s")"
  }

  private static func arabicCount(_ n: Int, one: String, two: String, many: String) -> String {
    switch n {
    case 1: return one
    case 2: return two
    default: return "\(local(n, arabic: true)) \(many)"
    }
  }

  private static func clockPhrase(_ date: Date, arabic: Bool) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: arabic ? "ar" : "en")
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    return formatter.string(from: date)
  }

  private static func local(_ n: Int, arabic: Bool) -> String {
    let raw = String(n)
    guard arabic else { return raw }
    let map: [Character: Character] = [
      "0": "٠", "1": "١", "2": "٢", "3": "٣", "4": "٤",
      "5": "٥", "6": "٦", "7": "٧", "8": "٨", "9": "٩",
    ]
    return String(raw.map { map[$0] ?? $0 })
  }

  private static func digits(_ raw: String) -> String {
    let map: [Character: Character] = [
      "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
      "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    ]
    return String(raw.map { map[$0] ?? $0 })
  }

  private static func leadingIntent(_ text: String) -> Bool {
    firstMatch(
      #"(?i)^\s*(?:please\s+|لو سمحت\s+|من فضلك\s+)?(?:remind me|set (?:an? |the )?(?:alarm|reminder|timer)|wake me|start (?:an? |the )?timer|alarm\b|timer\b|ذكرني|ذكّرني|نبهني|نبّهني|(?:اضبط|حط|ضع|خلي)(?:\s+لي)?\s+(?:منبه|مؤقت|تايمر)|منبه|مؤقت|تايمر|الغي|ألغي|الغِ)"#,
      in: text
    ) != nil
  }

  private static func isCancel(_ text: String) -> Bool {
    firstMatch(
      #"(?i)^\s*(?:please\s+)?(?:cancel|stop|clear|remove)\s+(?:my\s+|the\s+|all\s+)?(?:alarms?|reminders?|timers?)\s*\.?\s*$|^\s*(?:الغي|ألغي|الغِ)\s+(?:كل\s+)?(?:المنبهات|المنبه|التذكيرات|التذكير|المؤقت)\s*$"#,
      in: text
    ) != nil
  }

  private static func isAlarm(_ text: String) -> Bool {
    firstMatch(#"(?i)\b(alarm|wake me|timer)\b|منبه|مؤقت|تايمر"#, in: text) != nil
  }

  private static func isReminder(_ text: String) -> Bool {
    firstMatch(#"(?i)remind me|set a reminder|ذكرني|ذكّرني|نبهني|نبّهني"#, in: text) != nil
  }

  private static func startsAsReminder(_ text: String) -> Bool {
    firstMatch(#"(?i)^\s*(?:please\s+)?(?:remind me|set a reminder|ذكرني|ذكّرني|نبهني|نبّهني)"#, in: text) != nil
  }

  private static func isDaily(_ text: String) -> Bool {
    firstMatch(#"(?i)\bevery day\b|\bdaily\b|كل يوم"#, in: text) != nil
  }

  private static func relativeSeconds(_ text: String) -> TimeInterval? {
    if let match = firstMatch(
      #"(?i)(?:\bin\b|\bafter\b|\bfor\b|بعد|خلال)\s+(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|ثاني[ةه]|ثواني|دقيق[ةه]|دقائق|دقايق|ساع[ةه]|ساعات)"#,
      in: text
    ),
      let countRaw = group(match, 1, in: text),
      let count = Int(countRaw),
      let unit = group(match, 2, in: text),
      let seconds = seconds(count: count, unit: unit) {
      return seconds
    }
    if firstMatch(#"(?i)(?:\bin\b|\bafter\b|بعد|خلال)\s+half(?:\s+an?)?\s+hour\b|نص(?:ف)?\s+ساع"#, in: text) != nil {
      return 30 * 60
    }
    if firstMatch(#"(?i)(?:\bin\b|\bafter\b|بعد|خلال)\s+(?:an?\s+hour|ساع[ةه])\b"#, in: text) != nil {
      return 60 * 60
    }
    return nil
  }

  private static func seconds(count: Int, unit: String) -> TimeInterval? {
    guard count >= 0 else { return nil }
    let unit = unit.lowercased()
    if unit.hasPrefix("sec") || unit.hasPrefix("ثاني") { return TimeInterval(count) }
    if unit.hasPrefix("min") || unit.hasPrefix("دقيق") || unit.hasPrefix("دقا") { return TimeInterval(count * 60) }
    if unit.hasPrefix("hour") || unit.hasPrefix("hr") || unit.hasPrefix("ساع") { return TimeInterval(count * 3600) }
    return nil
  }

  private static func clockTime(_ text: String, allowBareFor: Bool) -> (hour: Int, minute: Int, marker: String?)? {
    let pattern = #"(?i)(?:\bat\b|\bfor\b|الساع[ةه]|على|عند)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|صباح[اً]?|مساء[اً]?)?(?!\s*(?:min|sec|hour|hr|دقيق|دقا|ساع|ثاني))"#
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    for match in regex.matches(in: text, options: [], range: range) {
      guard let hourRaw = group(match, 1, in: text), let hour = Int(hourRaw) else { continue }
      let minute = Int(group(match, 2, in: text) ?? "") ?? 0
      guard (0...23).contains(hour), (0...59).contains(minute) else { continue }
      let marker = group(match, 3, in: text)
      let fragment = group(match, 0, in: text)?.lowercased() ?? ""
      let bareFor = fragment.hasPrefix("for") && group(match, 2, in: text) == nil && marker == nil
      if bareFor && !allowBareFor { continue }
      return (hour, minute, marker)
    }
    return nil
  }

  private static func nextOccurrence(hour: Int, minute: Int, marker: String?) -> Date? {
    let calendar = Calendar.current
    func at(hour: Int, dayOffset: Int) -> Date? {
      guard (0...23).contains(hour) else { return nil }
      var parts = calendar.dateComponents([.year, .month, .day], from: Date())
      parts.hour = hour
      parts.minute = minute
      parts.second = 0
      guard let base = calendar.date(from: parts) else { return nil }
      return calendar.date(byAdding: .day, value: dayOffset, to: base)
    }
    let marker = marker?.lowercased() ?? ""
    let isPM = marker == "pm" || marker.contains("مساء")
    let isAM = marker == "am" || marker.contains("صباح")
    if isAM || isPM {
      var hour = hour
      if hour > 12 { return nil }
      if isPM, hour < 12 { hour += 12 }
      if isAM, hour == 12 { hour = 0 }
      if let today = at(hour: hour, dayOffset: 0), today.timeIntervalSinceNow > 30 { return today }
      return at(hour: hour, dayOffset: 1)
    }
    if hour > 12 || hour == 0 {
      if let today = at(hour: hour, dayOffset: 0), today.timeIntervalSinceNow > 30 { return today }
      return at(hour: hour, dayOffset: 1)
    }
    let morning = hour == 12 ? 0 : hour
    let evening = hour == 12 ? 12 : hour + 12
    let candidates = [at(hour: morning, dayOffset: 0), at(hour: evening, dayOffset: 0), at(hour: morning, dayOffset: 1)]
      .compactMap { $0 }
    return candidates.filter { $0.timeIntervalSinceNow > 30 }.min()
  }

  private static func note(from text: String) -> String {
    var body = text
    body = replacing(
      #"(?i)^\s*(?:please\s+|لو سمحت\s+|من فضلك\s+)?(?:remind me|set a reminder|ذكرني|ذكّرني|نبهني|نبّهني)\s+(?:to|if|that|about|when|اذا|إذا|ان|أن|ب)?\s*"#,
      in: body,
      with: ""
    )
    body = replacing(
      #"(?i)(?:\bin\b|\bafter\b|\bat\b|\bfor\b|بعد|خلال)\s+half(?:\s+an?)?\s+hour\b|نص(?:ف)?\s+ساع[ةه]"#,
      in: body,
      with: " "
    )
    body = replacing(
      #"(?i)(?:\bin\b|\bafter\b|\bfor\b|بعد|خلال)\s+(?:an?\s+hour|\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|ثاني[ةه]|ثواني|دقيق[ةه]|دقائق|دقايق|ساع[ةه]|ساعات))"#,
      in: body,
      with: " "
    )
    body = replacing(
      #"(?i)(?:\bat\b|الساع[ةه]|على|عند)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|صباح[اً]?|مساء[اً]?)?|\bfor\b\s*\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\bfor\b\s*\d{1,2}\s*(?:am|pm)\b"#,
      in: body,
      with: " "
    )
    body = replacing(#"(?i)\b(?:every day|daily)\b|كل يوم"#, in: body, with: " ")
    body = replacing(#"(?i)^\s*(?:to|if|that|about|when)\s+"#, in: body, with: "")
    let trimmed = body
      .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .trimmingCharacters(in: CharacterSet(charactersIn: ".,!؟?"))
    return trimmed
  }

  private static func firstMatch(_ pattern: String, in text: String) -> NSTextCheckingResult? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    return regex.firstMatch(in: text, options: [], range: range)
  }

  private static func group(_ result: NSTextCheckingResult, _ index: Int, in text: String) -> String? {
    guard index < result.numberOfRanges else { return nil }
    let range = result.range(at: index)
    guard range.location != NSNotFound, let swift = Range(range, in: text) else { return nil }
    let value = String(text[swift]).trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }

  private static func replacing(_ pattern: String, in text: String, with template: String) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
    let range = NSRange(text.startIndex..., in: text)
    return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: template)
  }
}
