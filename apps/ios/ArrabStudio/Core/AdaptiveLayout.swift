import SwiftUI

/// Scales spacing/type for SE → Pro Max → iPad without fixed phone-only frames.
struct AdaptiveMetrics {
  let width: CGFloat
  let height: CGFloat
  let horizontalSize: UserInterfaceSizeClass?
  let verticalSize: UserInterfaceSizeClass?

  var isCompactWidth: Bool {
    horizontalSize == .compact || width < 700
  }

  var isPadLike: Bool {
    horizontalSize == .regular && width >= 700
  }

  var contentMaxWidth: CGFloat {
    if isPadLike { return min(920, max(width - 48, 320)) }
    return max(width, 320)
  }

  var gutter: CGFloat {
    width < 360 ? 12 : (isPadLike ? 24 : 16)
  }

  var titleSize: CGFloat {
    width < 360 ? 22 : (isPadLike ? 28 : 24)
  }

  var tabLabelVisible: Bool {
    width >= 340
  }

  var studioColumns: Int {
    if width >= 900 { return 3 }
    if width >= 560 { return 2 }
    return 1
  }

  var brainMapMinHeight: CGFloat {
    max(280, min(height * 0.48, 520))
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

extension EnvironmentValues {
  var adaptive: AdaptiveMetrics {
    get { self[AdaptiveMetricsKey.self] }
    set { self[AdaptiveMetricsKey.self] = newValue }
  }
}

/// Avoids root `GeometryReader` (can leave a blank black screen on first launch).
struct AdaptiveReader: ViewModifier {
  @Environment(\.horizontalSizeClass) private var hSize
  @Environment(\.verticalSizeClass) private var vSize
  @State private var size: CGSize = CGSize(width: 390, height: 844)

  func body(content: Content) -> some View {
    content
      .environment(
        \.adaptive,
        AdaptiveMetrics(
          width: size.width,
          height: size.height,
          horizontalSize: hSize,
          verticalSize: vSize
        )
      )
      .background(
        GeometryReader { geo in
          Color.clear
            .onAppear { size = geo.size }
            .onChange(of: geo.size) { _, newSize in size = newSize }
        }
      )
  }
}

extension View {
  func adaptiveReader() -> some View {
    modifier(AdaptiveReader())
  }
}
