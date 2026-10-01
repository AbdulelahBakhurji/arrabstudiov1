import Foundation
import Combine

/// Local prefs for Control notification channels (mirrors desktop managed prefs).
@MainActor
final class NotificationPrefsStore: ObservableObject {
  @Published var updates: Bool {
    didSet { save() }
  }
  @Published var security: Bool {
    didSet { save() }
  }
  @Published var companions: Bool {
    didSet { save() }
  }
  @Published var general: Bool {
    didSet { save() }
  }

  private static let key = "arrab.notify.channels"

  init() {
    let defaults = UserDefaults.standard.dictionary(forKey: Self.key) as? [String: Bool] ?? [:]
    updates = defaults["updates"] ?? true
    security = defaults["security"] ?? true
    companions = defaults["companions"] ?? true
    general = defaults["general"] ?? true
  }

  func allows(_ kind: NotificationKind) -> Bool {
    switch kind {
    case .update: return updates
    case .security: return security
    case .companion: return companions
    case .info, .warning: return general
    }
  }

  private func save() {
    UserDefaults.standard.set(
      [
        "updates": updates,
        "security": security,
        "companions": companions,
        "general": general,
      ],
      forKey: Self.key
    )
  }
}
