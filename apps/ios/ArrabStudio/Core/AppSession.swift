import Foundation
import Combine
import AuthenticationServices
import UIKit

enum StudioRole: String, CaseIterable {
  case individual, family, organization
}

struct ProfilePrefs: Codable, Equatable {
  var callName: String = ""
  var about: String = ""
  var focus: String = ""
  var reply: String = "balanced"
  var tone: String = "warm"

  private enum CodingKeys: String, CodingKey {
    case callName, about, focus, reply, tone
  }

  init() {}

  init(from decoder: Decoder) throws {
    let box = try decoder.container(keyedBy: CodingKeys.self)
    callName = try box.decodeIfPresent(String.self, forKey: .callName) ?? ""
    about = try box.decodeIfPresent(String.self, forKey: .about) ?? ""
    focus = try box.decodeIfPresent(String.self, forKey: .focus) ?? ""
    reply = try box.decodeIfPresent(String.self, forKey: .reply) ?? "balanced"
    tone = try box.decodeIfPresent(String.self, forKey: .tone) ?? "warm"
  }

  func encode(to encoder: Encoder) throws {
    var box = encoder.container(keyedBy: CodingKeys.self)
    try box.encode(callName, forKey: .callName)
    try box.encode(about, forKey: .about)
    try box.encode(focus, forKey: .focus)
    try box.encode(reply, forKey: .reply)
    try box.encode(tone, forKey: .tone)
  }

  func promptLine(arabic: Bool) -> String {
    var lines: [String] = []
    let name = callName.trimmingCharacters(in: .whitespacesAndNewlines)
    if !name.isEmpty {
      lines.append(arabic ? "نادِ المستخدم: \(name)." : "Address the user as \(name).")
    }
    let note = about.trimmingCharacters(in: .whitespacesAndNewlines)
    if !note.isEmpty {
      lines.append((arabic ? "عن المستخدم: " : "About the user: ") + note)
    }
    let work = focus.trimmingCharacters(in: .whitespacesAndNewlines)
    if !work.isEmpty {
      lines.append((arabic ? "يركّز الآن على: " : "Current focus: ") + work)
    }
    switch reply {
    case "brief":
      lines.append(arabic ? "خلّ الرد قصير." : "Keep replies short.")
    case "full":
      lines.append(arabic ? "وضّح الرد إذا الموضوع يبي تفصيل." : "Give a fuller reply when the topic needs it.")
    default:
      break
    }
    switch tone {
    case "direct":
      lines.append(arabic ? "كن واضح ومباشر." : "Be clear and direct.")
    case "formal":
      lines.append(arabic ? "استخدم أسلوباً مهذباً ومرتباً." : "Use a polite, composed tone.")
    default:
      lines.append(arabic ? "كن دافئ وطبيعي." : "Be warm and natural.")
    }
    return lines.joined(separator: " ")
  }
}

struct FamilyGuard: Codable, Equatable {
  var quietHours = false
  var quietStart = 21
  var quietEnd = 7
  var approvalRequired = true
  var boundary = "guided"

  var blocksChat: Bool {
    if boundary == "strict" { return true }
    guard quietHours else { return false }
    let hour = Calendar.current.component(.hour, from: Date())
    if quietStart == quietEnd { return true }
    if quietStart < quietEnd {
      return hour >= quietStart && hour < quietEnd
    }
    return hour >= quietStart || hour < quietEnd
  }
}

@MainActor
final class AppSession: ObservableObject {
  @Published var account: AccountPublic?
  @Published var entitlements: AccountEntitlements? {
    didSet { applyAccountRole() }
  }
  @Published var isBusy = false
  @Published var error: String?
  @Published var webAuthWaiting = false
  @Published var webPreviewURL: URL?
  @Published var localeIsArabic: Bool {
    didSet { UserDefaults.standard.set(localeIsArabic, forKey: Self.localeKey) }
  }
  @Published var studioRole: StudioRole {
    didSet { UserDefaults.standard.set(studioRole.rawValue, forKey: Self.roleKey) }
  }
  @Published var preferredModel: String {
    didSet { UserDefaults.standard.set(preferredModel, forKey: Self.modelKey) }
  }
  @Published var professionalSpace: Bool {
    didSet { UserDefaults.standard.set(professionalSpace, forKey: Self.spaceKey) }
  }
  @Published var addedCompanionIds: [String] {
    didSet { UserDefaults.standard.set(addedCompanionIds, forKey: Self.addedKey) }
  }
  @Published var familyGuard: FamilyGuard {
    didSet {
      if let data = try? JSONEncoder().encode(familyGuard) {
        UserDefaults.standard.set(data, forKey: Self.guardKey)
      }
    }
  }
  @Published var localModelId: String {
    didSet { UserDefaults.standard.set(localModelId, forKey: Self.localKey) }
  }
  @Published var sessionMode: String {
    didSet { UserDefaults.standard.set(sessionMode, forKey: Self.modeKey) }
  }
  @Published var profilePrefs: ProfilePrefs {
    didSet {
      if let data = try? JSONEncoder().encode(profilePrefs) {
        UserDefaults.standard.set(data, forKey: Self.profileKey)
      }
    }
  }

  nonisolated static let arrabModelId = "deepseek/deepseek-v4.1-flash"
  @Published var lastCloudModel: String {
    didSet { UserDefaults.standard.set(lastCloudModel, forKey: Self.cloudKey) }
  }

  var chattingOnDevice: Bool { preferredModel == "local:on-device" }

  var resolvedModelId: String {
    switch preferredModel {
    case "", "auto", "arrab", "primary", "local:on-device":
      return Self.arrabModelId
    default:
      return preferredModel
    }
  }

  /// Cloud model shown in Intelligence. Choosing it also leaves the on-device model.
  var activeCloudModelId: String {
    let id = chattingOnDevice ? lastCloudModel : preferredModel
    switch id {
    case "", "auto", "arrab", "primary", "local:on-device":
      return Self.arrabModelId
    default:
      return id
    }
  }

  func selectCloudModel(_ id: String) {
    let next = id.isEmpty || id == "local:on-device" ? Self.arrabModelId : id
    lastCloudModel = next
    preferredModel = next
  }

  func selectLocalModel(_ id: String) {
    if !chattingOnDevice {
      lastCloudModel = preferredModel.isEmpty ? Self.arrabModelId : preferredModel
    }
    localModelId = id.isEmpty ? "on-device" : id
    preferredModel = "local:on-device"
  }

  private static let localeKey = "arrab.locale.isArabic"
  private static let roleKey = "arrab.studio.role"
  private static let modelKey = "arrab.studio.model"
  private static let cloudKey = "arrab.studio.cloudModel"
  private static let spaceKey = "arrab.studio.professional"
  private static let addedKey = "arrab.companions.added"
  private static let guardKey = "arrab.family.guard"
  private static let localKey = "arrab.local.model"
  private static let profileKey = "arrab.profile.prefs"
  private static let modeKey = "arrab.session.mode"
  private static let pendingWebKey = "arrab.pending.webAuth"
  private let api = ArrabAPIClient.shared
  private var webAuthTask: Task<Void, Never>?
  private var webAuthSession: ASWebAuthenticationSession?

  var isSignedIn: Bool { account != nil && api.hasSession }

  func rememberCompanion(_ id: String) {
    guard !addedCompanionIds.contains(id) else { return }
    addedCompanionIds.append(id)
  }

  func forgetCompanion(_ id: String) {
    addedCompanionIds.removeAll { $0 == id }
  }

  /// Role comes from the signed-in plan. It is not a switch in the app.
  func applyAccountRole() {
    let next = Self.role(for: entitlements?.planId)
    if studioRole != next { studioRole = next }
  }

  static func role(for planId: String?) -> StudioRole {
    switch planId {
    case "family_free", "family", "family_plus":
      return .family
    case "team", "unlimited", "scale":
      return .organization
    default:
      return .individual
    }
  }

  init() {
    localeIsArabic = UserDefaults.standard.bool(forKey: Self.localeKey)
    studioRole = StudioRole(rawValue: UserDefaults.standard.string(forKey: Self.roleKey) ?? "") ?? .individual
    preferredModel = UserDefaults.standard.string(forKey: Self.modelKey) ?? Self.arrabModelId
    let storedCloud = UserDefaults.standard.string(forKey: Self.cloudKey) ?? ""
    lastCloudModel = storedCloud.isEmpty || storedCloud == "local:on-device" ? Self.arrabModelId : storedCloud
    professionalSpace = UserDefaults.standard.bool(forKey: Self.spaceKey)
    let stored = UserDefaults.standard.stringArray(forKey: Self.addedKey) ?? []
    let designStrip = ["layan", "razan", "health", "career"]
    if stored.isEmpty || stored == ["general"] {
      addedCompanionIds = designStrip
    } else {
      addedCompanionIds = stored
    }
    if let data = UserDefaults.standard.data(forKey: Self.guardKey),
       let decoded = try? JSONDecoder().decode(FamilyGuard.self, from: data) {
      familyGuard = decoded
    } else {
      familyGuard = FamilyGuard()
    }
    localModelId = UserDefaults.standard.string(forKey: Self.localKey) ?? ""
    if let data = UserDefaults.standard.data(forKey: Self.profileKey),
       let decoded = try? JSONDecoder().decode(ProfilePrefs.self, from: data) {
      profilePrefs = decoded
    } else {
      profilePrefs = ProfilePrefs()
    }
    let storedMode = UserDefaults.standard.string(forKey: Self.modeKey) ?? "agent"
    sessionMode = ["agent", "plan", "search", "debug", "think"].contains(storedMode) ? storedMode : "agent"
    let retiredLocal = ["", "on-device", "gemma-3", "gemma-3n", "gemma-2"]
    if preferredModel == "local:on-device", retiredLocal.contains(localModelId) {
      preferredModel = lastCloudModel
      localModelId = ""
    }
    applyAccountRole()
    Task { await restoreIfNeeded() }
  }

  private func restoreIfNeeded() async {
    guard api.hasSession else { return }
    do {
      try await api.ensureLiveAuthBase()
      let status = try await api.verifySession()
      if let account = status.account {
        self.account = account
        self.entitlements = status.entitlements
      } else {
        let full = try await api.account()
        self.account = full.account
        self.entitlements = full.entitlements
      }
    } catch {
      api.setSessionToken(nil)
      account = nil
      entitlements = nil
    }
  }

  func signIn(email: String, password: String) async {
    isBusy = true
    error = nil
    defer { isBusy = false }
    do {
      try await api.ensureLiveAuthBase()
      let res = try await api.signIn(email: email, password: password)
      account = res.account
      entitlements = res.entitlements
    } catch {
      self.error = error.localizedDescription
    }
  }

  func createAccount(email: String, password: String, name: String) async {
    isBusy = true
    error = nil
    defer { isBusy = false }
    do {
      try await api.ensureLiveAuthBase()
      let res = try await api.connectAccount(email: email, password: password, displayName: name)
      account = res.account
      entitlements = res.entitlements
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// Opens auth.arrabai.com inside the app and polls until the account is attached.
  func startProviderSignIn(providerHint: String) async {
    cancelWebAuth()
    isBusy = true
    error = nil
    defer { isBusy = false }
    do {
      try await api.ensureLiveAuthBase()
      let started = try await api.startWebAuth(returnTo: "arrab://auth/complete")
      guard let secret = started.pollSecret?.trimmingCharacters(in: .whitespacesAndNewlines),
            !secret.isEmpty,
            let url = URL(string: started.authorizationUrl) else {
        throw ArrabAPIError.empty
      }
      persistPending(state: started.state, secret: secret)
      webAuthWaiting = true
      webPreviewURL = url
      let interval = max(0.8, (started.pollIntervalMs ?? 1500) / 1000)
      webAuthTask = Task { [weak self] in
        await self?.pollUntilDone(state: started.state, secret: secret, interval: interval)
      }
    } catch {
      self.error = error.localizedDescription
      webAuthWaiting = false
      webPreviewURL = nil
    }
  }

  func cancelWebAuth() {
    webAuthTask?.cancel()
    webAuthTask = nil
    webAuthSession?.cancel()
    webAuthSession = nil
    webAuthWaiting = false
    webPreviewURL = nil
    UserDefaults.standard.removeObject(forKey: Self.pendingWebKey)
  }

  func applySessionToken(_ token: String) {
    api.setSessionToken(token)
    Task { await restoreIfNeeded() }
  }

  /// `arrab://auth/complete?session=…&state=…`
  func handleAuthDeepLink(_ url: URL) -> Bool {
    guard url.scheme == "arrab" else { return false }
    let hostPath = "\(url.host ?? "")\(url.path)".trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard hostPath.hasPrefix("auth/complete") || url.absoluteString.contains("auth/complete") else {
      return false
    }
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let session =
      items.first(where: { $0.name == "session" })?.value
      ?? items.first(where: { $0.name == "token" })?.value
    let state = items.first(where: { $0.name == "state" })?.value
    let pending = readPending()
    if let session, !session.isEmpty {
      if let pending, let state, pending.state == state {
        applySessionToken(session)
        cancelWebAuth()
        return true
      }
      // Accept session when deep link carries one and we started web auth.
      if pending != nil {
        applySessionToken(session)
        cancelWebAuth()
        return true
      }
    }
    return false
  }

  func signOut() async {
    cancelWebAuth()
    await api.logout()
    account = nil
    entitlements = nil
  }

  func updateAPIBase(_ url: String) {
    api.baseURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func pollUntilDone(state: String, secret: String, interval: Double) async {
    while !Task.isCancelled {
      do {
        let polled = try await api.pollWebAuth(state: state, pollSecret: secret)
        if polled.status == "completed", let token = polled.sessionToken, !token.isEmpty {
          applySessionToken(token)
          account = polled.account ?? account
          entitlements = polled.entitlements ?? entitlements
          webAuthWaiting = false
          webPreviewURL = nil
          webAuthTask = nil
          UserDefaults.standard.removeObject(forKey: Self.pendingWebKey)
          return
        }
        if polled.status == "expired" {
          error = polled.message ?? "Sign-in session expired"
          webAuthWaiting = false
          UserDefaults.standard.removeObject(forKey: Self.pendingWebKey)
          return
        }
      } catch {
        // Keep polling while the browser sheet is open; surface lasting errors later.
      }
      try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
    }
  }

  private func presentWebAuth(url: URL, state: String) {
    let session = ASWebAuthenticationSession(
      url: url,
      callbackURLScheme: "arrab"
    ) { [weak self] callbackURL, error in
      Task { @MainActor in
        guard let self else { return }
        if let callbackURL {
          _ = self.handleAuthDeepLink(callbackURL)
        } else if let error, (error as NSError).code != ASWebAuthenticationSessionError.canceledLogin.rawValue {
          self.error = error.localizedDescription
          self.webAuthWaiting = false
        }
      }
    }
    session.prefersEphemeralWebBrowserSession = false
    session.presentationContextProvider = WebAuthPresenter.shared
    self.webAuthSession = session
    _ = session.start()
  }

  private func persistPending(state: String, secret: String) {
    UserDefaults.standard.set(["state": state, "secret": secret], forKey: Self.pendingWebKey)
  }

  private func readPending() -> (state: String, secret: String)? {
    guard let dict = UserDefaults.standard.dictionary(forKey: Self.pendingWebKey),
          let state = dict["state"] as? String,
          let secret = dict["secret"] as? String else { return nil }
    return (state, secret)
  }
}

private final class WebAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
  static let shared = WebAuthPresenter()

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow } ?? ASPresentationAnchor()
  }
}
