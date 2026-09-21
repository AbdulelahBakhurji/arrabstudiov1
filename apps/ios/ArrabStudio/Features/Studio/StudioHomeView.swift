import SwiftUI

struct StudioHomeView: View {
  @Environment(\.adaptive) private var adaptive
  @State private var selected: StudioCompanionCard?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 6) {
          Text("ARRAB / STUDIO")
            .font(.system(size: 10, weight: .bold))
            .tracking(1.2)
            .foregroundStyle(ArrabTheme.muted)
          Text("Studio")
            .font(.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(ArrabTheme.text)
          Text("Start with Arrab Assistant — or pick web, phone, and specialist companions.")
            .font(.system(size: 13.5))
            .foregroundStyle(ArrabTheme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }

        let main = StudioCatalog.companions.first { $0.isMain }
        let rest = StudioCatalog.companions.filter { !$0.isMain }

        if let main {
          companionCard(main, large: true)
        }

        LazyVGrid(
          columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: adaptive.studioColumns),
          spacing: 10
        ) {
          ForEach(rest) { item in
            companionCard(item, large: false)
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(ArrabTheme.bg)
    .sheet(item: $selected) { item in
      NavigationStack {
        StudioCompanionChatView(companion: item)
      }
    }
  }

  private func companionCard(_ item: StudioCompanionCard, large: Bool) -> some View {
    ArrabCard(padding: large ? 16 : 14) {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Text(item.isMain ? "ARRAB ASSISTANT" : item.badge)
            .font(.system(size: 10, weight: .bold))
            .tracking(0.8)
            .foregroundStyle(ArrabTheme.muted)
          Spacer()
          if item.isMain {
            Text("MAIN")
              .font(.system(size: 10, weight: .bold))
              .padding(.horizontal, 8)
              .padding(.vertical, 4)
              .background(ArrabTheme.subtle)
              .clipShape(Capsule())
              .foregroundStyle(ArrabTheme.text)
          }
        }
        HStack(spacing: 12) {
          Circle()
            .fill(Color(hue: item.hue / 360, saturation: 0.45, brightness: 0.55))
            .frame(width: large ? 52 : 40, height: large ? 52 : 40)
            .overlay {
              Image(systemName: "face.smiling")
                .foregroundStyle(.white.opacity(0.9))
            }
          VStack(alignment: .leading, spacing: 4) {
            Text(item.name)
              .font(.system(size: large ? 18 : 15, weight: .semibold))
              .foregroundStyle(ArrabTheme.text)
            Text(item.blurb)
              .font(.system(size: 12.5))
              .foregroundStyle(ArrabTheme.muted)
              .lineLimit(large ? 3 : 2)
          }
        }
        Text(item.badge)
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(ArrabTheme.muted)
        Button {
          selected = item
        } label: {
          Text("Open")
            .font(.system(size: 14, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .foregroundStyle(ArrabTheme.onPrimary)
            .background(ArrabTheme.primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
  }
}

struct StudioCompanionChatView: View {
  let companion: StudioCompanionCard
  @Environment(\.dismiss) private var dismiss
  @Environment(\.adaptive) private var adaptive
  @StateObject private var model = ChatViewModel()
  @State private var draft = ""

  private var suggestions: [String] {
    switch companion.id {
    case "brand":
      return ["Write three voice principles", "Propose a color palette", "Pick type pairing"]
    case "copywriter":
      return ["Draft the primary headline", "Write primary CTAs", "Write empty-state copy"]
    case "web-designer":
      return ["Modern landing page", "Portfolio gallery", "Pricing with 3 plans"]
    case "phone-designer":
      return ["Design a mobile login", "Product card for phone", "Bottom tab bar"]
    default:
      return ["Search the web for…", "Generate a short PDF report", "Triage important mail"]
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Button { dismiss() } label: {
          Image(systemName: "chevron.left")
            .foregroundStyle(ArrabTheme.text)
        }
        Text(companion.name)
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(ArrabTheme.text)
        Spacer()
      }
      .padding(adaptive.gutter)

      ScrollView {
        if model.lines.isEmpty {
          VStack(spacing: 12) {
            Circle()
              .fill(Color(hue: companion.hue / 360, saturation: 0.45, brightness: 0.55))
              .frame(width: 72, height: 72)
            Text("What should we get done?")
              .font(.system(size: 20, weight: .semibold))
              .foregroundStyle(ArrabTheme.text)
            Text(companion.blurb)
              .font(.system(size: 13))
              .foregroundStyle(ArrabTheme.muted)
              .multilineTextAlignment(.center)
            ForEach(suggestions, id: \.self) { item in
              Button {
                Task { await model.send(item) }
              } label: {
                Text(item)
                  .font(.system(size: 13))
                  .foregroundStyle(ArrabTheme.text)
                  .padding(12)
                  .frame(maxWidth: .infinity)
                  .background(ArrabTheme.subtle)
                  .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
              }
              .buttonStyle(.plain)
            }
          }
          .padding(adaptive.gutter)
        } else {
          LazyVStack(alignment: .leading, spacing: 8) {
            ForEach(model.lines) { line in
              HStack {
                if line.role == "user" { Spacer(minLength: 36) }
                Text(line.text)
                  .font(.system(size: 14))
                  .padding(10)
                  .background(line.role == "user" ? ArrabTheme.primary : ArrabTheme.subtle)
                  .foregroundStyle(line.role == "user" ? ArrabTheme.onPrimary : ArrabTheme.text)
                  .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                if line.role != "user" { Spacer(minLength: 36) }
              }
            }
          }
          .padding(adaptive.gutter)
        }
      }

      HStack(spacing: 8) {
        TextField("Message this Studio companion…", text: $draft, axis: .vertical)
          .lineLimit(1...4)
          .padding(12)
          .background(ArrabTheme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        Button {
          let text = draft
          draft = ""
          Task { await model.send(text) }
        } label: {
          Image(systemName: "arrow.up")
            .frame(width: 40, height: 40)
            .background(ArrabTheme.primary)
            .foregroundStyle(ArrabTheme.onPrimary)
            .clipShape(Circle())
        }
        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
      }
      .padding(adaptive.gutter)
    }
    .background(ArrabTheme.bg.ignoresSafeArea())
    .task { await model.bootstrap() }
  }
}
