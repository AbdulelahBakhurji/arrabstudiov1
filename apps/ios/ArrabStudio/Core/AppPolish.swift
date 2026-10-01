import UIKit
import SwiftUI

enum ArrabHaptics {
  static func light() {
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
  }

  static func medium() {
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
  }

  static func success() {
    UINotificationFeedbackGenerator().notificationOccurred(.success)
  }

  static func warning() {
    UINotificationFeedbackGenerator().notificationOccurred(.warning)
  }

  static func error() {
    UINotificationFeedbackGenerator().notificationOccurred(.error)
  }

  static func selection() {
    UISelectionFeedbackGenerator().selectionChanged()
  }
}

enum ArrabLegal {
  static let privacyURL = URL(string: "https://arrabai.com/privacy")!
  static let termsURL = URL(string: "https://arrabai.com/terms")!
  static let supportURL = URL(string: "https://arrabai.com/support")!
  static let supportEmail = "support@arrabai.com"

  static var supportMailto: URL {
    URL(string: "mailto:\(supportEmail)?subject=Arrab%20Studio%20iOS")!
  }
}

@MainActor
final class AppLockStore: ObservableObject {
  @Published var lockEnabled: Bool {
    didSet { UserDefaults.standard.set(lockEnabled, forKey: Self.lockKey) }
  }
  @Published var isUnlocked = false

  private static let lockKey = "arrab.lock.enabled"

  init() {
    lockEnabled = UserDefaults.standard.bool(forKey: Self.lockKey)
    isUnlocked = !lockEnabled
  }

  func lockIfNeeded() {
    if lockEnabled { isUnlocked = false }
  }

  func unlock() {
    isUnlocked = true
  }
}
