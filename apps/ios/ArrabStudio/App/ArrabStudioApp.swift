import SwiftUI

/// Dismisses the keyboard when the user taps anywhere outside the focused field.
struct KeyboardDismissInstaller: UIViewRepresentable {
  func makeUIView(context: Context) -> UIView {
    let view = UIView(frame: .zero)
    view.isUserInteractionEnabled = false
    view.backgroundColor = .clear
    DispatchQueue.main.async { context.coordinator.attach(to: view) }
    return view
  }

  func updateUIView(_ uiView: UIView, context: Context) {
    DispatchQueue.main.async { context.coordinator.attach(to: uiView) }
  }

  func makeCoordinator() -> Coordinator { Coordinator() }

  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    private var keyboardVisible = false

    override init() {
      super.init()
      NotificationCenter.default.addObserver(
        self, selector: #selector(showKeyboard), name: UIResponder.keyboardWillShowNotification, object: nil
      )
      NotificationCenter.default.addObserver(
        self, selector: #selector(hideKeyboard), name: UIResponder.keyboardWillHideNotification, object: nil
      )
    }

    func attach(to view: UIView) {
      guard let window = view.window else { return }
      if window.gestureRecognizers?.contains(where: { $0.name == "arrab.keyboard.dismiss" }) == true { return }
      let tap = UITapGestureRecognizer(target: self, action: #selector(dismiss(_:)))
      tap.cancelsTouchesInView = false
      tap.delegate = self
      tap.name = "arrab.keyboard.dismiss"
      window.addGestureRecognizer(tap)
    }

    @objc private func showKeyboard() { keyboardVisible = true }
    @objc private func hideKeyboard() { keyboardVisible = false }

    @objc private func dismiss(_ gesture: UITapGestureRecognizer) {
      guard keyboardVisible, let window = gesture.view as? UIWindow else { return }
      let point = gesture.location(in: window)
      if let first = window.arrabFirstResponder() {
        let frame = first.convert(first.bounds, to: window).insetBy(dx: -8, dy: -8)
        if frame.contains(point) { return }
      }
      window.endEditing(true)
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool { true }
  }
}

private extension UIView {
  func arrabFirstResponder() -> UIView? {
    if isFirstResponder { return self }
    for child in subviews {
      if let found = child.arrabFirstResponder() { return found }
    }
    return nil
  }
}

@main
struct ArrabStudioApp: App {
  @UIApplicationDelegateAdaptor(ArrabAppDelegate.self) private var appDelegate
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var session = AppSession()
  @StateObject private var link = PCLinkStore()
  @StateObject private var managed = ManagedClient.shared
  @StateObject private var themeStore = ThemeStore()
  @StateObject private var companions = CompanionSpaceStore()
  @StateObject private var router = ShellRouter()
  @StateObject private var notifyPrefs = NotificationPrefsStore()
  @StateObject private var network = NetworkMonitor.shared
  @StateObject private var lock = AppLockStore()

  init() {
    ArrabFont.install()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .background(KeyboardDismissInstaller())
        .environmentObject(session)
        .environmentObject(link)
        .environmentObject(managed)
        .environmentObject(themeStore)
        .environmentObject(companions)
        .environmentObject(router)
        .environmentObject(notifyPrefs)
        .environmentObject(network)
        .environmentObject(lock)
        .modifier(ManagedOverlayModifier(managed: managed, arabic: session.localeIsArabic))
        .dynamicTypeSize(.small ... .accessibility3)
        .onChange(of: scenePhase) { _, phase in
          switch phase {
          case .active:
            managed.enterForeground()
          case .background:
            managed.enterBackground()
            lock.lockIfNeeded()
          default:
            break
          }
        }
        .onChange(of: session.isSignedIn) { _, signedIn in
          guard signedIn else { return }
          lock.unlock()
          managed.start()
          PushRegistration.askAfterSignIn()
        }
        .onAppear {
          managed.arabic = session.localeIsArabic
          managed.signOutHandler = { [session] in await session.signOut() }
          PushRegistration.registerCategories(arabic: session.localeIsArabic)
        }
        .onChange(of: session.localeIsArabic) { _, arabic in
          managed.arabic = arabic
          PushRegistration.registerCategories(arabic: arabic)
        }
        .onOpenURL { url in
          if session.handleAuthDeepLink(url) {
            return
          }
          if ManagedAllowlist.parseDeepLink(url.absoluteString) != nil {
            managed.route(url.absoluteString)
            return
          }
          link.handleDeepLink(url)
          if let token = link.consumedSessionToken() {
            session.applySessionToken(token)
          }
        }
    }
  }
}
