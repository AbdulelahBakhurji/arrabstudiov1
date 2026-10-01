import Foundation
import UIKit
@preconcurrency import UserNotifications

/// APNs registration and notification taps. The app holds only the OS-issued
/// device token; the APNs key lives on the server.
enum PushRegistration {
  static let generalCategory = "ARRAB_GENERAL"
  static let updateCategory = "ARRAB_UPDATE"
  static let reminderCategory = "ARRAB_REMINDER"
  static let openAction = "ARRAB_OPEN"
  static let updateAction = "ARRAB_UPDATE_NOW"
  static let snoozeAction = "ARRAB_SNOOZE"
  private static let askedKey = "arrab.managed.notifyAsked"

  @MainActor
  static func registerCategories(arabic: Bool) {
    let open = UNNotificationAction(
      identifier: openAction,
      title: ManagedStrings.t(.open, arabic: arabic),
      options: [.foreground]
    )
    let update = UNNotificationAction(
      identifier: updateAction,
      title: ManagedStrings.t(.updateNow, arabic: arabic),
      options: [.foreground]
    )
    let snooze = UNNotificationAction(
      identifier: snoozeAction,
      title: arabic ? "بعد ٥ دقائق" : "Snooze 5 min",
      options: []
    )
    UNUserNotificationCenter.current().setNotificationCategories([
      UNNotificationCategory(identifier: generalCategory, actions: [open], intentIdentifiers: []),
      UNNotificationCategory(identifier: updateCategory, actions: [update, open], intentIdentifiers: []),
      UNNotificationCategory(identifier: reminderCategory, actions: [snooze, open], intentIdentifiers: []),
    ])
  }

  /// Ask once, after sign-in (never at first launch). Registers for remote push if allowed.
  @MainActor
  static func askAfterSignIn() {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      Task { @MainActor in
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
          UIApplication.shared.registerForRemoteNotifications()
        case .notDetermined:
          guard !UserDefaults.standard.bool(forKey: askedKey) else { return }
          UserDefaults.standard.set(true, forKey: askedKey)
          let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound, .timeSensitive])) ?? false
          if granted { UIApplication.shared.registerForRemoteNotifications() }
        default:
          break
        }
      }
    }
  }

  static func tokenString(_ token: Data) -> String {
    token.map { String(format: "%02x", $0) }.joined()
  }

  /// Shows a notice that arrived through sync or the live channel.
  static func postLocal(_ notification: ClientNotification, arabic: Bool) {
    let defaults = UserDefaults.standard.dictionary(forKey: "arrab.notify.channels") as? [String: Bool] ?? [:]
    let channelName = channel(for: notification.kind)
    if defaults[channelName] == false { return }
    let content = UNMutableNotificationContent()
    content.title = notification.title.text(arabic: arabic)
    if let body = notification.body { content.body = body.text(arabic: arabic) }
    content.categoryIdentifier = notification.kind == .update ? updateCategory : generalCategory
    content.threadIdentifier = channel(for: notification.kind)
    content.userInfo = ["notificationId": notification.id, "deepLink": notification.deepLink ?? ""]
    content.sound = .default
    let request = UNNotificationRequest(identifier: "arrab.\(notification.id)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }

  /// Same four channels as Android.
  static func channel(for kind: NotificationKind) -> String {
    switch kind {
    case .update: return "updates"
    case .security: return "security"
    case .companion: return "companions"
    case .info, .warning: return "general"
    }
  }
}

final class ArrabAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = PushRegistration.tokenString(deviceToken)
    Task { @MainActor in
      guard DeviceIdentity.pushToken != token else { return }
      DeviceIdentity.pushToken = token
      await ManagedClient.shared.syncNow(reason: "push-token")
    }
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    // Push is optional; polling and the live channel still work.
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let info = response.notification.request.content.userInfo
    let id = info["notificationId"] as? String
    let deepLink = info["deepLink"] as? String
    let action = response.actionIdentifier
    let title = response.notification.request.content.title
    let body = response.notification.request.content.body
    Task { @MainActor in
      if action == PushRegistration.snoozeAction {
        await AgentAlerts.snooze(title: title, body: body)
        completionHandler()
        return
      }
      if let id, id.hasPrefix("family.") {
        FamilyNotices.shared.markRead(id)
        if action != UNNotificationDismissActionIdentifier {
          ManagedClient.shared.route("arrab://family")
        }
        completionHandler()
        return
      }
      let client = ManagedClient.shared
      if let id {
        client.markRead(id)
        let dismissed = action == UNNotificationDismissActionIdentifier
        client.ackNotification(id, action: dismissed ? "dismissed" : "opened")
      }
      if action == PushRegistration.updateAction {
        client.openStore()
      } else if action != UNNotificationDismissActionIdentifier {
        client.route(deepLink)
      }
      completionHandler()
    }
  }
}
