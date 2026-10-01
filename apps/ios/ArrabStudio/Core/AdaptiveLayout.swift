import SwiftUI

/// Scales spacing/type for SE → Pro Max → iPad / fold without fixed phone-only frames.
struct AdaptiveMetrics {
  let width: CGFloat
  let height: CGFloat
  let horizontalSize: UserInterfaceSizeClass?
  let verticalSize: UserInterfaceSizeClass?

  var isLandscape: Bool { width > height + 40 }

  /// A phone on its side, not a tablet. Height stays short.
  var isPhoneLandscape: Bool { isLandscape && height < 520 }

  var isCompactWidth: Bool {
    if isPhoneLandscape { return true }
    return horizontalSize == .compact || width < 700
  }

  var isPadLike: Bool {
    !isPhoneLandscape && horizontalSize == .regular && width >= 700 && height >= 600
  }

  /// Tablet/fold: permanent rail instead of hamburger-only chrome.
  var showSideRail: Bool { isPadLike }

  /// iPhone SE / 320-wide frames hide the tab row and companion strip.
  var isSmallPhone: Bool { !isPadLike && !isPhoneLandscape && width < 360 }

  /// Phone frames (390) show Chat / Board / Tasks under the top bar.
  var showsPhoneTabs: Bool { !showSideRail && !isSmallPhone && !isPhoneLandscape }

  /// Small phones keep only the chat card. Phone, fold, and tablet show faces.
  var showsCompanionStrip: Bool { showSideRail || (!isSmallPhone && !isPhoneLandscape) }

  var contentMaxWidth: CGFloat {
    if isPadLike { return min(1100, max(width - (showSideRail ? 120 : 48), 320)) }
    return max(width, 320)
  }

  var gutter: CGFloat {
    if isPhoneLandscape { return 16 }
    return width < 360 ? 12 : (isPadLike ? 28 : 16)
  }

  var titleSize: CGFloat {
    if isPhoneLandscape { return 20 }
    return width < 360 ? 22 : (isPadLike ? 30 : 24)
  }

  var tabLabelVisible: Bool { width >= 340 }

  var studioColumns: Int {
    if width >= 1100 { return 3 }
    if width >= 700 { return 2 }
    return 1
  }

  var settingsColumns: Int {
    if width >= 900 { return 3 }
    return 2
  }

  var connectorColumns: Int {
    if width >= 1100 { return 3 }
    if width >= 700 { return 2 }
    return 1
  }

  var sideRailWidth: CGFloat { 88 }

  var brainMapMinHeight: CGFloat {
    max(280, min(height * 0.48, 560))
  }
}

private struct AdaptiveMetricsKey: EnvironmentKey {
  static let defaultValue = AdaptiveMetrics(
    width: 390,
    height: 844,
    horizontalSize: .compact,
    verticalSize: .regular
  )
}

private struct KeyboardVisibleKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  var adaptive: AdaptiveMetrics {
    get { self[AdaptiveMetricsKey.self] }
    set { self[AdaptiveMetricsKey.self] = newValue }
  }

  /// True while the software keyboard covers the bottom of the screen.
  var keyboardVisible: Bool {
    get { self[KeyboardVisibleKey.self] }
    set { self[KeyboardVisibleKey.self] = newValue }
  }
}

struct AdaptiveReader: ViewModifier {
  @Environment(\.horizontalSizeClass) private var hSize
  @Environment(\.verticalSizeClass) private var vSize
  @State private var size: CGSize = CGSize(width: 390, height: 844)
  @State private var keyboard = false

  func body(content: Content) -> some View {
    content
      .environment(\.adaptive, metrics)
      .environment(\.keyboardVisible, keyboard)
      .background(
        GeometryReader { geo in
          Color.clear
            .onAppear { size = Self.stable(geo.size) }
            .onChange(of: geo.size) { _, newSize in size = Self.stable(newSize) }
        }
      )
      .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
        keyboard = Self.keyboardCovers(note)
      }
      .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
        keyboard = false
      }
  }

  private var metrics: AdaptiveMetrics {
    AdaptiveMetrics(
      width: size.width,
      height: size.height,
      horizontalSize: hSize,
      verticalSize: vSize
    )
  }

  /// The keyboard shrinks the laid-out height. Keep the full screen so a phone
  /// does not flip into a landscape layout and rescale chrome while typing.
  private static func stable(_ reported: CGSize) -> CGSize {
    let screen = screenSize()
    guard screen.width > 1, screen.height > 1 else { return reported }
    let portrait = CGSize(
      width: min(screen.width, screen.height),
      height: max(screen.width, screen.height)
    )
    let landscape = CGSize(width: portrait.height, height: portrait.width)
    let full = abs(reported.width - landscape.width) < 48 ? landscape : portrait
    let widthMatches = abs(reported.width - full.width) < 48
    if widthMatches, reported.height < full.height - 80 {
      return full
    }
    return reported
  }

  private static func screenSize() -> CGSize {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    return scene?.screen.bounds.size ?? .zero
  }

  private static func keyboardCovers(_ note: Notification) -> Bool {
    guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return false }
    let screen = screenSize()
    guard screen.height > 1 else { return frame.height > 120 }
    return frame.height > 120 && frame.minY < screen.height - 40
  }
}

extension View {
  func adaptiveReader() -> some View {
    modifier(AdaptiveReader())
  }
}
