import SwiftUI

struct RootView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var themeStore: ThemeStore
  @EnvironmentObject private var lock: AppLockStore
  @EnvironmentObject private var network: NetworkMonitor
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.scenePhase) private var scenePhase

  private var palette: ArrabPalette { themeStore.palette(matching: colorScheme) }
  @State private var showLaunch = true
  @State private var launchID = UUID()
  @State private var leftApp = false

  var body: some View {
    Group {
      if session.isSignedIn {
        if lock.lockEnabled && !lock.isUnlocked {
          AppLockGate()
        } else {
          VStack(spacing: 0) {
            OfflineBanner()
            IndividualsShellView()
          }
        }
      } else {
        AuthView()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .adaptiveReader()
    .environment(\.arrab, palette)
    .environment(\.font, ArrabFont.system(size: 17))
    // Welcome/auth always follows the device; in-app appearance is Settings-controlled.
    .preferredColorScheme(session.isSignedIn ? themeStore.preferredColorScheme : nil)
    .onChange(of: scenePhase) { _, phase in
      if phase == .background {
        leftApp = true
        lock.lockIfNeeded()
      } else if phase == .inactive {
        lock.lockIfNeeded()
      } else if phase == .active, session.isSignedIn, leftApp {
        leftApp = false
        launchID = UUID()
        showLaunch = true
      }
    }
    .onChange(of: session.isSignedIn) { _, signedIn in
      if signedIn {
        launchID = UUID()
        showLaunch = true
      }
    }
    .overlay {
      if session.isSignedIn && showLaunch {
        let token = launchID
        LaunchMark(arabic: session.localeIsArabic) {
          if launchID == token { showLaunch = false }
        }
        .id(token)
      }
    }
  }
}

private struct LaunchMark: View {
  var arabic: Bool
  var onFinish: () -> Void
  @Environment(\.arrab) private var theme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shown = false
  @State private var progress: CGFloat = 0
  @State private var cover = true

  var body: some View {
    ZStack {
      theme.bg.ignoresSafeArea()
      VStack(spacing: 28) {
        Image("ArrabSymbol")
          .renderingMode(.template)
          .resizable()
          .scaledToFit()
          .frame(width: 72, height: 72)
          .foregroundStyle(theme.text)
          .scaleEffect(shown ? 1 : 0.92)
          .opacity(shown ? 1 : 0)
          .accessibilityLabel("Arrab")
        VStack(spacing: 14) {
          Text(L10n.t(.preparingWorkspace, arabic: arabic))
            .font(ArrabFont.system(size: 15, weight: .medium))
            .foregroundStyle(theme.muted)
            .opacity(shown ? 1 : 0)
          ZStack(alignment: .leading) {
            Capsule()
              .fill(theme.line)
            Capsule()
              .fill(theme.text)
              .frame(width: 148 * progress)
          }
          .frame(width: 148, height: 2)
          .accessibilityHidden(true)
        }
      }
    }
    .opacity(cover ? 1 : 0)
    .allowsHitTesting(cover)
    .onAppear {
      if reduceMotion {
        shown = true
        progress = 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { finish() }
        return
      }
      withAnimation(.easeOut(duration: 0.35)) { shown = true }
      withAnimation(.easeInOut(duration: 1.05)) { progress = 1 }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { finish() }
    }
  }

  private func finish() {
    withAnimation(.easeOut(duration: 0.32)) { cover = false }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.32) { onFinish() }
  }
}
