import SwiftUI
import Combine

/// Arrab Studio companion tokens — mirrors desktop `companions.css` `--cp-*`.
struct ArrabPalette {
  let bg: Color
  let card: Color
  let subtle: Color
  let line: Color
  let text: Color
  let muted: Color
  let faint: Color
  let lavender: Color
  let lavenderSoft: Color
  let yellow: Color
  let yellowSoft: Color
  let primary: Color
  let onPrimary: Color
  let focus: Color
  let controlLine: Color
  let success: Color
  let warn: Color
  let danger: Color

  static let dark = ArrabPalette(
    bg: Color(hex: 0x17171F),
    card: Color(hex: 0x21212B),
    subtle: Color(hex: 0x292934),
    line: Color(hex: 0x3A3947),
    text: Color(hex: 0xF4F3FB),
    muted: Color(hex: 0xB0ADBF),
    faint: Color(hex: 0xAAA6BB),
    lavender: Color(hex: 0xC9BCFF),
    lavenderSoft: Color(hex: 0x343044),
    yellow: Color(hex: 0xFFDA80),
    yellowSoft: Color(hex: 0x413A29),
    primary: Color(hex: 0xE9E5FA),
    onPrimary: Color(hex: 0x181720),
    focus: Color(hex: 0xC9BCFF),
    controlLine: Color(hex: 0x8B849F),
    success: Color(red: 0.35, green: 0.78, blue: 0.55),
    warn: Color(red: 0.95, green: 0.72, blue: 0.28),
    danger: Color(red: 0.90, green: 0.35, blue: 0.35)
  )

  static let light = ArrabPalette(
    bg: Color(hex: 0xE8E9F0),
    card: Color(hex: 0xF8F9FD),
    subtle: Color(hex: 0xEDEEF5),
    line: Color(hex: 0xD9DAE5),
    text: Color(hex: 0x17171F),
    muted: Color(hex: 0x5A5768),
    faint: Color(hex: 0x656272),
    lavender: Color(hex: 0x756096),
    lavenderSoft: Color(hex: 0xE5DFFD),
    yellow: Color(hex: 0xB45309),
    yellowSoft: Color(hex: 0xFFF0C7),
    primary: Color(hex: 0x15141B),
    onPrimary: Color.white,
    focus: Color(hex: 0x756096),
    controlLine: Color(hex: 0x827D90),
    success: Color(red: 0.22, green: 0.62, blue: 0.40),
    warn: Color(red: 0.78, green: 0.52, blue: 0.10),
    danger: Color(red: 0.78, green: 0.22, blue: 0.22)
  )
}

enum ArrabTheme {
  static let radiusCard: CGFloat = 22
  static let radiusChip: CGFloat = 14
  static let radiusPill: CGFloat = 999
  static let radiusComposer: CGFloat = 20

  /// Fallback for views that have not yet picked up ThemeStore (auth, early paint).
  static var bg: Color { ArrabPalette.dark.bg }
  static var card: Color { ArrabPalette.dark.card }
  static var subtle: Color { ArrabPalette.dark.subtle }
  static var line: Color { ArrabPalette.dark.line }
  static var text: Color { ArrabPalette.dark.text }
  static var muted: Color { ArrabPalette.dark.muted }
  static var primary: Color { ArrabPalette.dark.primary }
  static var onPrimary: Color { ArrabPalette.dark.onPrimary }
  static var accent: Color { ArrabPalette.dark.lavender }
  static var success: Color { ArrabPalette.dark.success }
  static var warn: Color { ArrabPalette.dark.warn }
  static var danger: Color { ArrabPalette.dark.danger }

  static var nodeProject: Color { Color(red: 0.30, green: 0.82, blue: 0.55) }
  static var nodeSession: Color { Color(red: 0.45, green: 0.70, blue: 0.98) }
  static var nodeDecision: Color { Color(red: 0.95, green: 0.78, blue: 0.30) }
  static var nodeFile: Color { Color(red: 0.65, green: 0.55, blue: 0.95) }
  static var nodePerson: Color { Color(red: 0.95, green: 0.45, blue: 0.65) }
}

enum ThemeMode: String, CaseIterable, Identifiable {
  case system, light, dark
  var id: String { rawValue }
}

@MainActor
final class ThemeStore: ObservableObject {
  @Published var mode: ThemeMode {
    didSet { UserDefaults.standard.set(mode.rawValue, forKey: Self.key) }
  }

  private static let key = "arrab.theme.mode"
  private static let legacyKey = "arrab.theme.isDark"

  /// Back-compat for toggles that still read/write dark vs light.
  var isDark: Bool {
    get { mode == .dark }
    set { mode = newValue ? .dark : .light }
  }

  init() {
    if let raw = UserDefaults.standard.string(forKey: Self.key),
       let parsed = ThemeMode(rawValue: raw) {
      mode = parsed
    } else if UserDefaults.standard.object(forKey: Self.legacyKey) != nil {
      mode = UserDefaults.standard.bool(forKey: Self.legacyKey) ? .dark : .light
    } else {
      mode = .system
    }
  }

  func palette(matching colorScheme: ColorScheme) -> ArrabPalette {
    switch mode {
    case .system: return colorScheme == .dark ? .dark : .light
    case .light: return .light
    case .dark: return .dark
    }
  }

  /// `nil` follows the device appearance.
  var preferredColorScheme: ColorScheme? {
    switch mode {
    case .system: return nil
    case .light: return .light
    case .dark: return .dark
    }
  }

  func toggle() {
    switch mode {
    case .system, .light: mode = .dark
    case .dark: mode = .light
    }
  }

  func cycle() {
    switch mode {
    case .system: mode = .light
    case .light: mode = .dark
    case .dark: mode = .system
    }
  }
}

private struct ArrabPaletteKey: EnvironmentKey {
  static let defaultValue = ArrabPalette.dark
}

extension EnvironmentValues {
  var arrab: ArrabPalette {
    get { self[ArrabPaletteKey.self] }
    set { self[ArrabPaletteKey.self] = newValue }
  }
}

struct ArrabCard<Content: View>: View {
  var padding: CGFloat = 16
  @Environment(\.arrab) private var theme
  @ViewBuilder var content: () -> Content

  var body: some View {
    content()
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(theme.line.opacity(0.85), lineWidth: 1)
      )
  }
}

struct ArrabChip: View {
  let title: String
  var selected = false
  var action: () -> Void = {}
  @Environment(\.arrab) private var theme

  var body: some View {
    Button(action: action) {
      Text(title)
        .font(ArrabFont.system(size: 13, weight: selected ? .semibold : .medium))
        .foregroundStyle(selected ? theme.onPrimary : theme.text)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(selected ? theme.primary : theme.subtle)
        .clipShape(Capsule())
        .overlay(
          Capsule().stroke(theme.line.opacity(selected ? 0 : 0.9), lineWidth: 1)
        )
    }
    .buttonStyle(.plain)
  }
}

struct ArrabPrimaryButton: View {
  let title: String
  var systemImage: String? = nil
  var action: () -> Void
  @Environment(\.arrab) private var theme

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if let systemImage {
          Image(systemName: systemImage)
            .font(ArrabFont.system(size: 13, weight: .semibold))
        }
        Text(title)
          .font(ArrabFont.system(size: 14, weight: .semibold))
      }
      .foregroundStyle(theme.onPrimary)
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(theme.primary)
      .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    let r = Double((hex >> 16) & 0xFF) / 255
    let g = Double((hex >> 8) & 0xFF) / 255
    let b = Double(hex & 0xFF) / 255
    self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
  }
}
