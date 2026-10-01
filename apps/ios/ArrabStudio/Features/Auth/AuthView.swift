import SwiftUI
import AuthenticationServices
import WebKit

/// First-launch welcome + Continue sheet (Apple / Google / Email) — same Arrab API as desktop.
struct AuthView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var link: PCLinkStore
  @EnvironmentObject private var themeStore: ThemeStore
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.colorScheme) private var colorScheme

  @State private var showContinueSheet = false
  @State private var emailMode = false
  @State private var mode: EmailMode = .signIn
  @State private var email = ""
  @State private var password = ""
  @State private var name = ""
  @State private var showLink = false
  @State private var revealed = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  enum EmailMode { case signIn, create }

  private var arabic: Bool { session.localeIsArabic }
  private var isDark: Bool { colorScheme == .dark }

  var body: some View {
    ZStack {
      WelcomeAtmosphere(isDark: isDark, lavender: theme.lavender, bg: theme.bg, paused: reduceMotion)

      VStack(spacing: 0) {
        // Wordmark sits at the top, centered — language only, no theme switch, no corner mark.
        ZStack {
          WelcomeLogo(
            name: isDark ? "ArrabLogoWhite" : "ArrabLogo",
            width: adaptive.isPadLike ? 168 : 150,
            revealed: revealed,
            paused: reduceMotion
          )
          HStack {
            Spacer()
            Button {
              withAnimation(.spring(response: 0.35, dampingFraction: 0.82)) {
                session.localeIsArabic.toggle()
              }
            } label: {
              Text(arabic ? "EN" : "ع")
                .font(ArrabFont.system(size: 13, weight: .bold))
                .foregroundStyle(theme.muted)
                .contentTransition(.opacity)
                .frame(width: 36, height: 36)
                .background(theme.subtle.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(WelcomePressStyle())
            .accessibilityLabel(arabic ? "Switch to English" : "Switch to Arabic")
          }
        }
        .padding(.horizontal, adaptive.gutter + 4)
        .padding(.top, 8)
        .welcomeReveal(revealed, delay: 0.05, reduceMotion: reduceMotion)

        Spacer(minLength: 12)

        VStack(spacing: 18) {
          Text("ARRAB STUDIO")
            .font(ArrabFont.system(size: 11, weight: .bold))
            .tracking(2.6)
            .foregroundStyle(theme.lavender)
            .welcomeReveal(revealed, delay: 0.18, reduceMotion: reduceMotion)

          Text(arabic ? "وش في بالك؟" : "What's on your mind?")
            .font(ArrabFont.system(size: adaptive.isPadLike ? 36 : 32, weight: .semibold))
            .foregroundStyle(theme.text)
            .multilineTextAlignment(.center)
            .padding(.top, 4)
            .welcomeReveal(revealed, delay: 0.28, reduceMotion: reduceMotion)

          Text(
            arabic
              ? "سجّل الدخول مرة واحدة. رفاقك وخططك ومساحتك تتبعك على سطح المكتب والويب."
              : "Sign in once. Your companions, plans, and workspace follow you across desktop and web."
          )
          .font(ArrabFont.system(size: 15))
          .foregroundStyle(theme.muted)
          .multilineTextAlignment(.center)
          .lineSpacing(3)
          .frame(maxWidth: 320)
          .welcomeReveal(revealed, delay: 0.38, reduceMotion: reduceMotion)

          VStack(alignment: .leading, spacing: 14) {
            bullet(arabic ? "رفاق شخصيون ومهنيون" : "Personal & professional companions", delay: 0.48)
            bullet(arabic ? "ذكاء سحابي محروس عند الحاجة" : "Guarded cloud AI when you need it", delay: 0.56)
            bullet(arabic ? "حساب واحد على كل جهاز" : "One account across every device", delay: 0.64)
          }
          .padding(.top, 8)
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 28)

        Spacer(minLength: 28)

        VStack(spacing: 10) {
          if let error = session.error, session.webPreviewURL == nil {
            Text(error)
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.danger)
              .multilineTextAlignment(.center)
              .padding(.horizontal, 28)
          }
          continueButton
            .frame(maxWidth: 340)
            .padding(.horizontal, 28)
        }
        .padding(.bottom, 36)
        .welcomeReveal(revealed, delay: 0.74, reduceMotion: reduceMotion)
      }
    }
    .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
    .onAppear {
      guard !revealed else { return }
      if reduceMotion {
        revealed = true
      } else {
        withAnimation(.spring(response: 0.72, dampingFraction: 0.86)) {
          revealed = true
        }
      }
    }
    .sheet(isPresented: $showContinueSheet) {
      ContinueSheet(
        emailMode: $emailMode,
        mode: $mode,
        email: $email,
        password: $password,
        name: $name,
        onApple: { Task { await session.startProviderSignIn(providerHint: "apple") } },
        onGoogle: { Task { await session.startProviderSignIn(providerHint: "google") } },
        onEmail: {
          showContinueSheet = false
          Task { await session.startProviderSignIn(providerHint: "email") }
        },
        onEmailSubmit: {
          Task {
            if mode == .signIn {
              await session.signIn(email: email, password: password)
            } else {
              await session.createAccount(email: email, password: password, name: name)
            }
            if session.isSignedIn { showContinueSheet = false }
          }
        },
        onLinkPC: { showLink = true },
        onCancelWeb: { session.cancelWebAuth() }
      )
      .environmentObject(session)
      .environmentObject(themeStore)
      .environment(\.arrab, theme)
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
      .presentationCornerRadius(28)
    }
    .fullScreenCover(
      isPresented: Binding(
        get: { session.webPreviewURL != nil },
        set: { presented in
          if !presented, session.webPreviewURL != nil {
            session.cancelWebAuth()
          }
        }
      )
    ) {
      if let url = session.webPreviewURL {
        AuthWebPreview(url: url, arabic: session.localeIsArabic) {
          session.cancelWebAuth()
        }
        .environmentObject(session)
        .environment(\.arrab, theme)
      }
    }
    .onChange(of: session.isSignedIn) { _, signedIn in
      if signedIn {
        showContinueSheet = false
      }
    }
    .sheet(isPresented: $showLink) {
      LinkPCView()
        .environmentObject(link)
        .environmentObject(session)
        .presentationDetents([.medium, .large])
    }
  }

  private func bullet(_ text: String, delay: Double) -> some View {
    HStack(alignment: .center, spacing: 12) {
      Circle()
        .fill(theme.lavender)
        .frame(width: 7, height: 7)
      Text(text)
        .font(ArrabFont.system(size: 15, weight: .medium))
        .foregroundStyle(theme.text)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: 300, alignment: .leading)
    .welcomeReveal(revealed, delay: delay, reduceMotion: reduceMotion)
  }

  private var continueButton: some View {
    Button {
      ArrabHaptics.medium()
      emailMode = false
      showContinueSheet = true
    } label: {
      Text(arabic ? "متابعة" : "Continue")
        .font(ArrabFont.system(size: 16, weight: .semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .foregroundStyle(isDark ? Color.black.opacity(0.92) : Color.white)
        .background(isDark ? Color.white : Color.black.opacity(0.92))
        .clipShape(Capsule())
        .shadow(color: Color.black.opacity(isDark ? 0.35 : 0.12), radius: 16, y: 8)
    }
    .buttonStyle(WelcomePressStyle(pressedScale: 0.975))
  }
}

/// Slow lavender light that drifts with the clock. Stays still when Reduce Motion is on.
private struct WelcomeAtmosphere: View {
  var isDark: Bool
  var lavender: Color
  var bg: Color
  var paused: Bool

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: paused)) { timeline in
      let t = timeline.date.timeIntervalSinceReferenceDate
      let drift = paused ? 0.5 : (sin(t * 0.32) + 1) / 2
      let lift = paused ? 0.5 : (cos(t * 0.21) + 1) / 2
      ZStack {
        bg
        RadialGradient(
          colors: [lavender.opacity(isDark ? 0.32 : 0.20), .clear],
          center: UnitPoint(x: 0.42 + drift * 0.16, y: 0.02 + lift * 0.10),
          startRadius: 12,
          endRadius: 380 + drift * 90
        )
        RadialGradient(
          colors: [lavender.opacity(isDark ? 0.10 : 0.07), .clear],
          center: UnitPoint(x: 0.78 - lift * 0.2, y: 0.92),
          startRadius: 8,
          endRadius: 260
        )
      }
      .ignoresSafeArea()
    }
  }
}

/// Wordmark settles in, then rests with a small vertical breath.
private struct WelcomeLogo: View {
  var name: String
  var width: CGFloat
  var revealed: Bool
  var paused: Bool

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: paused || !revealed)) { timeline in
      let bob = paused || !revealed
        ? 0.0
        : sin(timeline.date.timeIntervalSinceReferenceDate * 0.85) * 3.5
      Image(name)
        .resizable()
        .scaledToFit()
        .frame(width: width)
        .scaleEffect(revealed ? 1 : 0.94)
        .opacity(revealed ? 1 : 0)
        .offset(y: revealed ? bob : 18)
        .animation(.spring(response: 0.85, dampingFraction: 0.82), value: revealed)
        .accessibilityLabel("Arrab")
    }
  }
}

private struct WelcomeReveal: ViewModifier {
  var shown: Bool
  var delay: Double
  var reduceMotion: Bool

  func body(content: Content) -> some View {
    content
      .opacity(shown ? 1 : 0)
      .offset(y: shown || reduceMotion ? 0 : 16)
      .animation(
        reduceMotion ? .easeOut(duration: 0.01) : .spring(response: 0.7, dampingFraction: 0.86).delay(delay),
        value: shown
      )
  }
}

private struct WelcomePressStyle: ButtonStyle {
  var pressedScale: CGFloat = 0.96

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? pressedScale : 1)
      .opacity(configuration.isPressed ? 0.92 : 1)
      .animation(.spring(response: 0.28, dampingFraction: 0.72), value: configuration.isPressed)
  }
}

private extension View {
  func welcomeReveal(_ shown: Bool, delay: Double, reduceMotion: Bool) -> some View {
    modifier(WelcomeReveal(shown: shown, delay: delay, reduceMotion: reduceMotion))
  }
}

struct ContinueSheet: View {
  @Binding var emailMode: Bool
  @Binding var mode: AuthView.EmailMode
  @Binding var email: String
  @Binding var password: String
  @Binding var name: String
  var onApple: () -> Void
  var onGoogle: () -> Void
  var onEmail: () -> Void
  var onEmailSubmit: () -> Void
  var onLinkPC: () -> Void
  var onCancelWeb: () -> Void

  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.openURL) private var openURL
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shown = false

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(spacing: 12) {
        Capsule()
          .fill(theme.line)
          .frame(width: 36, height: 4)
          .padding(.top, 8)

        Text(arabic ? "متابعة إلى Arrab" : "Continue to Arrab")
          .font(ArrabFont.system(size: 18, weight: .semibold))
          .foregroundStyle(theme.text)
          .padding(.bottom, 8)

        if session.webAuthWaiting {
          VStack(alignment: .leading, spacing: 8) {
            ProgressView()
              .tint(theme.lavender)
            Text(arabic ? "أكمل تسجيل الدخول في المتصفح…" : "Finish signing in in the browser…")
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.muted)
            Button(arabic ? "إلغاء" : "Cancel") { onCancelWeb() }
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .foregroundStyle(theme.lavender)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(14)
          .background(theme.subtle)
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }

        if !emailMode {
          providerButton(
            title: arabic ? "المتابعة مع Apple" : "Continue with Apple",
            mark: .system("apple.logo"),
            light: true,
            delay: 0.05,
            action: onApple
          )
          providerButton(
            title: arabic ? "المتابعة مع Google" : "Continue with Google",
            mark: .google,
            light: true,
            delay: 0.12,
            action: onGoogle
          )
          providerButton(
            title: arabic ? "المتابعة بالبريد" : "Continue with Email",
            mark: .system("envelope.fill"),
            light: false,
            delay: 0.19,
            action: onEmail
          )
        } else {
          emailForm
            .transition(.opacity.combined(with: .move(edge: .bottom)))
        }

        if let error = session.error {
          Text(error)
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        Text(
          arabic
            ? "بالمتابعة أنت توافق على شروط Arrab وسياسة الخصوصية."
            : "By continuing, you agree to Arrab’s Terms and Privacy Policy."
        )
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
        .multilineTextAlignment(.center)
        .padding(.top, 8)

        HStack(spacing: 16) {
          Button(arabic ? "الخصوصية" : "Privacy") { openURL(ArrabLegal.privacyURL) }
          Button(arabic ? "الشروط" : "Terms") { openURL(ArrabLegal.termsURL) }
        }
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.lavender)

        Button {
          onLinkPC()
        } label: {
          Label(
            arabic ? "ربط بجهاز Mac / PC" : "Link to Mac / PC",
            systemImage: "laptopcomputer.and.iphone"
          )
          .font(ArrabFont.system(size: 13, weight: .medium))
          .foregroundStyle(theme.muted)
        }
        .buttonStyle(.plain)
        .padding(.top, 4)
        .padding(.bottom, 12)
      }
      .padding(.horizontal, 20)
    }
    .background(theme.bg.ignoresSafeArea())
    .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
    .onAppear {
      if reduceMotion {
        shown = true
      } else {
        withAnimation(.spring(response: 0.55, dampingFraction: 0.86)) {
          shown = true
        }
      }
    }
  }

  private var emailForm: some View {
    VStack(spacing: 12) {
      Picker("", selection: $mode) {
        Text(arabic ? "دخول" : "Sign in").tag(AuthView.EmailMode.signIn)
        Text(arabic ? "إنشاء" : "Create").tag(AuthView.EmailMode.create)
      }
      .pickerStyle(.segmented)

      if mode == .create {
        TextField(arabic ? "الاسم" : "Display name", text: $name)
          .font(ArrabFont.system(size: 16))
          .textFieldStyle(ArrabFieldStyle())
      }
      TextField(arabic ? "البريد" : "Email", text: $email)
        .font(ArrabFont.system(size: 16))
        .textFieldStyle(ArrabFieldStyle())
        .textInputAutocapitalization(.never)
        .keyboardType(.emailAddress)
        .textContentType(.username)
      SecureField(arabic ? "كلمة المرور" : "Password", text: $password)
        .font(ArrabFont.system(size: 16))
        .textFieldStyle(ArrabFieldStyle())
        .textContentType(mode == .create ? .newPassword : .password)

      Button {
        ArrabHaptics.light()
        onEmailSubmit()
      } label: {
        HStack {
          if session.isBusy { ProgressView().tint(.black) }
          Text(mode == .signIn ? (arabic ? "تسجيل الدخول" : "Sign in") : (arabic ? "إنشاء حساب" : "Create account"))
            .font(ArrabFont.system(size: 15, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .foregroundStyle(Color.black.opacity(0.9))
        .background(Color.white)
        .clipShape(Capsule())
      }
      .buttonStyle(WelcomePressStyle())
      .disabled(session.isBusy || email.isEmpty || password.isEmpty)

      Button(arabic ? "رجوع" : "Back") {
        withAnimation { emailMode = false }
      }
      .font(ArrabFont.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.muted)
    }
    .padding(14)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
  }

  private enum ProviderMark {
    case system(String)
    case google
  }

  private func providerButton(
    title: String,
    mark: ProviderMark,
    light: Bool,
    delay: Double,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Group {
          switch mark {
          case .system(let name):
            Image(systemName: name)
              .font(ArrabFont.system(size: 18, weight: .semibold))
          case .google:
            GoogleMark()
              .frame(width: 18, height: 18)
          }
        }
        .frame(width: 22)
        Text(title)
          .font(ArrabFont.system(size: 15, weight: .semibold))
        Spacer(minLength: 0)
      }
      .foregroundStyle(light ? Color.black.opacity(0.9) : theme.text)
      .padding(.horizontal, 18)
      .padding(.vertical, 15)
      .background(light ? Color.white : theme.subtle)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(light ? Color.clear : theme.line, lineWidth: 1)
      )
    }
    .buttonStyle(WelcomePressStyle())
    .welcomeReveal(shown, delay: delay, reduceMotion: reduceMotion)
    .disabled(session.isBusy || session.webAuthWaiting)
  }
}

/// Official four-color Google “G” used on the sign-in button.
private struct GoogleMark: View {
  var body: some View {
    Canvas { context, size in
      let scale = min(size.width, size.height) / 48
      let transform = CGAffineTransform(scaleX: scale, y: scale)
      let parts: [(String, Color)] = [
        ("M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z", Color(red: 0.918, green: 0.263, blue: 0.208)),
        ("M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z", Color(red: 0.259, green: 0.522, blue: 0.957)),
        ("M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z", Color(red: 0.984, green: 0.737, blue: 0.020)),
        ("M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z", Color(red: 0.204, green: 0.659, blue: 0.325)),
      ]
      for (data, color) in parts {
        context.fill(SVGPath.path(data).applying(transform), with: .color(color))
      }
    }
    .accessibilityLabel("Google")
  }
}

private enum SVGPath {
  static func path(_ data: String) -> Path {
    var path = Path()
    let tokens = tokenize(data)
    var index = 0
    var command: Character = "M"
    var x: CGFloat = 0
    var y: CGFloat = 0
    var startX: CGFloat = 0
    var startY: CGFloat = 0
    var ctrlX: CGFloat = 0
    var ctrlY: CGFloat = 0

    func number() -> CGFloat? {
      guard index < tokens.count else { return nil }
      let value = CGFloat(Double(tokens[index]) ?? 0)
      index += 1
      return value
    }

    while index < tokens.count {
      let token = tokens[index]
      if token.count == 1, let letter = token.first, letter.isLetter {
        command = letter
        index += 1
      }
      let relative = command.isLowercase
      switch command.uppercased().first {
      case "M":
        guard let nx = number(), let ny = number() else { return path }
        x = relative ? x + nx : nx
        y = relative ? y + ny : ny
        path.move(to: CGPoint(x: x, y: y))
        startX = x
        startY = y
        command = relative ? "l" : "L"
      case "L":
        guard let nx = number(), let ny = number() else { return path }
        x = relative ? x + nx : nx
        y = relative ? y + ny : ny
        path.addLine(to: CGPoint(x: x, y: y))
      case "H":
        guard let nx = number() else { return path }
        x = relative ? x + nx : nx
        path.addLine(to: CGPoint(x: x, y: y))
      case "V":
        guard let ny = number() else { return path }
        y = relative ? y + ny : ny
        path.addLine(to: CGPoint(x: x, y: y))
      case "C":
        guard var x1 = number(), var y1 = number(), var x2 = number(), var y2 = number(),
              var nx = number(), var ny = number() else { return path }
        if relative {
          x1 += x; y1 += y; x2 += x; y2 += y; nx += x; ny += y
        }
        path.addCurve(to: CGPoint(x: nx, y: ny), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
        ctrlX = x2
        ctrlY = y2
        x = nx
        y = ny
      case "S":
        guard var x2 = number(), var y2 = number(), var nx = number(), var ny = number() else { return path }
        if relative {
          x2 += x; y2 += y; nx += x; ny += y
        }
        let x1 = 2 * x - ctrlX
        let y1 = 2 * y - ctrlY
        path.addCurve(to: CGPoint(x: nx, y: ny), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
        ctrlX = x2
        ctrlY = y2
        x = nx
        y = ny
      case "Z":
        path.closeSubpath()
        x = startX
        y = startY
      default:
        index += 1
      }
      let kind = command.uppercased().first
      if kind != "C", kind != "S" {
        ctrlX = x
        ctrlY = y
      }
    }
    return path
  }

  private static func tokenize(_ data: String) -> [String] {
    var tokens: [String] = []
    var current = ""
    func flush() {
      if !current.isEmpty {
        tokens.append(current)
        current = ""
      }
    }
    for character in data {
      if character.isLetter {
        flush()
        tokens.append(String(character))
      } else if character == "," || character.isWhitespace {
        flush()
      } else if character == "-", !current.isEmpty, current.last != "e", current.last != "E" {
        flush()
        current = "-"
      } else if character == ".", current.contains(".") {
        // SVG writes the next number immediately: "3.88.92"
        flush()
        current = "."
      } else {
        current.append(character)
      }
    }
    flush()
    return tokens
  }
}

/// In-app preview of auth.arrabai.com. The session is attached by polling, not by a custom scheme.
struct AuthWebPreview: View {
  let url: URL
  var arabic: Bool
  var onClose: () -> Void

  @Environment(\.arrab) private var theme
  @State private var loading = true

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Button(arabic ? "إغلاق" : "Close", action: onClose)
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(theme.lavender)
        Spacer()
        Text("auth.arrabai.com")
          .font(ArrabFont.system(size: 13, weight: .medium))
          .foregroundStyle(theme.muted)
        Spacer()
        if loading {
          ProgressView().tint(theme.lavender)
        } else {
          Color.clear.frame(width: 20, height: 20)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(theme.bg)

      AuthWebView(url: url, isLoading: $loading)
    }
    .background(theme.bg.ignoresSafeArea())
  }
}

private struct AuthWebView: UIViewRepresentable {
  let url: URL
  @Binding var isLoading: Bool

  func makeCoordinator() -> Coordinator { Coordinator(isLoading: $isLoading) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.defaultWebpagePreferences.allowsContentJavaScript = true
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = context.coordinator
    web.isOpaque = false
    web.backgroundColor = .black
    web.scrollView.contentInsetAdjustmentBehavior = .never
    web.load(URLRequest(url: url))
    return web
  }

  func updateUIView(_ uiView: WKWebView, context: Context) {}

  final class Coordinator: NSObject, WKNavigationDelegate {
    @Binding var isLoading: Bool
    init(isLoading: Binding<Bool>) { _isLoading = isLoading }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
      isLoading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      isLoading = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      isLoading = false
    }

    func webView(
      _ webView: WKWebView,
      decidePolicyFor navigationAction: WKNavigationAction,
      decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
      if navigationAction.request.url?.scheme == "arrab" {
        decisionHandler(.cancel)
        return
      }
      decisionHandler(.allow)
    }
  }
}

struct ArrabFieldStyle: TextFieldStyle {
  @Environment(\.arrab) private var theme

  func _body(configuration: TextField<_Label>) -> some View {
    configuration
      .padding(12)
      .background(theme.subtle)
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(theme.line, lineWidth: 1)
      )
      .foregroundStyle(theme.text)
  }
}
