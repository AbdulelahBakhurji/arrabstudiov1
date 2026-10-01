import Foundation
import UIKit

/// What the app says about itself in `/v1/client/sync`. No secrets: the device id,
/// the OS-issued APNs token and public build facts only.
enum DeviceIdentity {
  private static let deviceIdKey = "managed.deviceId"
  private static let pushTokenKey = "managed.apnsToken"

  /// Random UUID v4, kept in the Keychain (this device only).
  static var deviceId: String {
    if let saved = KeychainStore.string(forKey: deviceIdKey), UUID(uuidString: saved) != nil {
      return saved
    }
    let fresh = UUID().uuidString.lowercased()
    KeychainStore.set(fresh, forKey: deviceIdKey)
    return fresh
  }

  static func resetDeviceId() {
    KeychainStore.remove(deviceIdKey)
    KeychainStore.remove(pushTokenKey)
  }

  static var pushToken: String? {
    get { KeychainStore.string(forKey: pushTokenKey) }
    set {
      if let newValue { KeychainStore.set(newValue, forKey: pushTokenKey) } else { KeychainStore.remove(pushTokenKey) }
    }
  }

  static var appVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
  }

  static var build: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
  }

  @MainActor
  static var platform: String {
    UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
  }

  @MainActor
  static var osVersion: String { UIDevice.current.systemVersion }

  static var channel: String {
    #if DEBUG
    return "dev"
    #else
    return "stable"
    #endif
  }
}
