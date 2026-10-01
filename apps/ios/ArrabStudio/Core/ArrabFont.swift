import SwiftUI
import UIKit

/// One face for every screen. Cairo covers Arabic and Latin in the same family
/// the desktop already uses, so a headline and a chip never fall through to
/// different system faces.
enum ArrabFont {
  static let family = "Cairo"
  /// OpenType 'wght' axis.
  private static let weightAxis = 0x77676874

  static func system(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
    Font(ui(size: size, weight: weight))
  }

  static func ui(size: CGFloat, weight: Font.Weight = .regular) -> UIFont {
    ui(size: size, uiWeight: uiWeight(weight))
  }

  static func ui(size: CGFloat, uiWeight: UIFont.Weight) -> UIFont {
    let fallback = UIFont.systemFont(ofSize: size, weight: uiWeight)
    guard let base = UIFont(name: family, size: size) else { return fallback }
    let described = base.fontDescriptor.addingAttributes([
      UIFontDescriptor.AttributeName(rawValue: "NSCTFontVariationAttribute"): [
        NSNumber(value: weightAxis): NSNumber(value: Double(axis(uiWeight))),
      ],
    ])
    return UIFont(descriptor: described, size: size)
  }

  /// Controls that ignore SwiftUI's font modifier (segmented pickers).
  static func install() {
    let label = ui(size: 13, weight: .semibold)
    let attrs: [NSAttributedString.Key: Any] = [.font: label]
    let segmented = UISegmentedControl.appearance()
    segmented.setTitleTextAttributes(attrs, for: .normal)
    segmented.setTitleTextAttributes(attrs, for: .selected)
    segmented.setTitleTextAttributes(attrs, for: .highlighted)
  }

  private static func uiWeight(_ weight: Font.Weight) -> UIFont.Weight {
    switch weight {
    case .ultraLight: return .ultraLight
    case .thin: return .thin
    case .light: return .light
    case .regular: return .regular
    case .medium: return .medium
    case .semibold: return .semibold
    case .bold: return .bold
    case .heavy: return .heavy
    case .black: return .black
    default: return .regular
    }
  }

  /// Cairo's weight axis runs 200...1000. Map the system weights onto it.
  private static func axis(_ weight: UIFont.Weight) -> CGFloat {
    switch weight {
    case .ultraLight: return 200
    case .thin: return 200
    case .light: return 300
    case .regular: return 400
    case .medium: return 500
    case .semibold: return 600
    case .bold: return 700
    case .heavy: return 800
    case .black: return 900
    default: return 400
    }
  }
}
