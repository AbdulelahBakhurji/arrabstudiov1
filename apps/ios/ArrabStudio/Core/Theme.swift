import SwiftUI

/// Arrab Studio dark system — mirrors desktop `companions.css` tokens, phone-shortened.
enum ArrabTheme {
  static let bg = Color(red: 0.07, green: 0.07, blue: 0.09)
  static let card = Color(red: 0.10, green: 0.10, blue: 0.13)
  static let subtle = Color(red: 0.14, green: 0.14, blue: 0.18)
  static let line = Color.white.opacity(0.08)
  static let text = Color.white.opacity(0.94)
  static let muted = Color.white.opacity(0.55)
  static let primary = Color(red: 0.92, green: 0.92, blue: 0.95)
  static let onPrimary = Color.black.opacity(0.88)
  static let accent = Color(red: 0.55, green: 0.45, blue: 0.95)
  static let success = Color(red: 0.35, green: 0.78, blue: 0.55)
  static let warn = Color(red: 0.95, green: 0.72, blue: 0.28)
  static let danger = Color(red: 0.90, green: 0.35, blue: 0.35)

  static let nodeProject = Color(red: 0.30, green: 0.82, blue: 0.55)
  static let nodeSession = Color(red: 0.45, green: 0.70, blue: 0.98)
  static let nodeDecision = Color(red: 0.95, green: 0.78, blue: 0.30)
  static let nodeFile = Color(red: 0.65, green: 0.55, blue: 0.95)
  static let nodePerson = Color(red: 0.95, green: 0.45, blue: 0.65)

  static let radiusCard: CGFloat = 18
  static let radiusChip: CGFloat = 12
  static let radiusPill: CGFloat = 999
}

struct ArrabCard<Content: View>: View {
  var padding: CGFloat = 14
  @ViewBuilder var content: () -> Content

  var body: some View {
    content()
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ArrabTheme.card)
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(ArrabTheme.line, lineWidth: 1)
      )
  }
}

struct ArrabChip: View {
  let title: String
  var selected = false
  var action: () -> Void = {}

  var body: some View {
    Button(action: action) {
      Text(title)
        .font(.system(size: 12.5, weight: selected ? .semibold : .medium))
        .foregroundStyle(selected ? ArrabTheme.onPrimary : ArrabTheme.text)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(selected ? ArrabTheme.primary : ArrabTheme.subtle)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}
