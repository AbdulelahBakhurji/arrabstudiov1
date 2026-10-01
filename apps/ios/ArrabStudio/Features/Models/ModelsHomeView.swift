import SwiftUI

struct ArrabModelChoice: Identifiable {
  let id: String
  let title: String
  let detail: String
  let detailAr: String
  let primary: Bool

  func detail(arabic: Bool) -> String { arabic ? detailAr : detail }
}

enum ArrabModelCatalog {
  static let choices: [ArrabModelChoice] = [
    ArrabModelChoice(
      id: AppSession.arrabModelId,
      title: "Arrab",
      detail: "",
      detailAr: "",
      primary: true
    ),
    ArrabModelChoice(
      id: "auto",
      title: "Auto",
      detail: "Picks Arrab for each reply",
      detailAr: "يختار عرّاب لكل رد",
      primary: false
    ),
    ArrabModelChoice(
      id: "anthropic/claude-opus-5.5",
      title: "Opus",
      detail: "Claude Opus 5.5",
      detailAr: "Claude Opus 5.5",
      primary: false
    ),
    ArrabModelChoice(
      id: "anthropic/claude-sonnet-5",
      title: "Sonnet",
      detail: "Claude Sonnet 5",
      detailAr: "Claude Sonnet 5",
      primary: false
    ),
    ArrabModelChoice(
      id: "moonshotai/kimi-k3",
      title: "Kimi",
      detail: "Kimi K3",
      detailAr: "Kimi K3",
      primary: false
    ),
    ArrabModelChoice(
      id: "moonshotai/kimi-k2.6",
      title: "Kimi K2",
      detail: "Kimi K2.6",
      detailAr: "Kimi K2.6",
      primary: false
    ),
    ArrabModelChoice(
      id: "google/gemini-2.5-pro",
      title: "Gemini Pro",
      detail: "Gemini 2.5 Pro",
      detailAr: "Gemini 2.5 Pro",
      primary: false
    ),
    ArrabModelChoice(
      id: "google/gemini-2.5-flash",
      title: "Gemini",
      detail: "Gemini 2.5 Flash",
      detailAr: "Gemini 2.5 Flash",
      primary: false
    ),
    ArrabModelChoice(
      id: "openai/gpt-5.5",
      title: "GPT-5.5",
      detail: "OpenAI GPT-5.5",
      detailAr: "OpenAI GPT-5.5",
      primary: false
    ),
    ArrabModelChoice(
      id: "openai/gpt-5.4-mini",
      title: "GPT mini",
      detail: "OpenAI GPT-5.4 mini",
      detailAr: "OpenAI GPT-5.4 mini",
      primary: false
    ),
    ArrabModelChoice(
      id: "x-ai/grok-4.7",
      title: "Grok",
      detail: "Grok 4.7",
      detailAr: "Grok 4.7",
      primary: false
    ),
    ArrabModelChoice(
      id: "qwen/qwen3.7-max",
      title: "Qwen",
      detail: "Qwen 3.7 Max",
      detailAr: "Qwen 3.7 Max",
      primary: false
    ),
    ArrabModelChoice(
      id: "deepseek/deepseek-v4-pro",
      title: "DeepSeek Pro",
      detail: "DeepSeek V4 Pro",
      detailAr: "DeepSeek V4 Pro",
      primary: false
    ),
  ]
}

@MainActor
final class CloudModelStore: ObservableObject {
  static let shared = CloudModelStore()
  @Published private(set) var choices: [ArrabModelChoice] = []
  @Published private(set) var configured: Bool?
  @Published private(set) var failed = false
  @Published private(set) var loading = false

  func load() async {
    if loading { return }
    loading = true
    defer { loading = false }
    do {
      let status = try await ArrabAPIClient.shared.aiStatus()
      configured = status.configured
      failed = false
      choices = Self.choices(from: status)
    } catch {
      failed = choices.isEmpty
    }
  }

  private static func choices(from status: AiGatewayStatus) -> [ArrabModelChoice] {
    var ids = status.models ?? []
    if ids.isEmpty, let fallback = status.defaultModel, !fallback.isEmpty {
      ids = [fallback]
    }
    var seen = Set<String>()
    return ids.compactMap { id in
      let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty, seen.insert(trimmed).inserted else { return nil }
      let primary = trimmed == status.defaultModel
        || trimmed == AppSession.arrabModelId
        || trimmed.hasSuffix("deepseek-v4.1-flash")
      let title = primary ? "Arrab" : shortName(trimmed)
      let detail = primary ? "" : trimmed
      return ArrabModelChoice(id: trimmed, title: title, detail: detail, detailAr: detail, primary: primary)
    }
  }

  private static func shortName(_ id: String) -> String {
    let tail = id.split(separator: "/").last.map(String.init) ?? id
    return tail.replacingOccurrences(of: "-", with: " ")
  }
}

struct ModelsHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @ObservedObject private var models = CloudModelStore.shared

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text(L10n.t(.models, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(L10n.t(.modelsSubtitle, arabic: arabic))
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)

        if models.loading && models.choices.isEmpty {
          ProgressView().tint(theme.lavender)
        } else if models.failed {
          Text(arabic ? "تعذّر قراءة النماذج من الحساب." : "Couldn’t read models from your account.")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
          Button(arabic ? "إعادة المحاولة" : "Try again") {
            Task { await models.load() }
          }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.lavender)
        }

        ForEach(models.choices) { choice in
          Button {
            session.selectCloudModel(choice.id)
          } label: {
            modelRow(choice)
          }
          .buttonStyle(.plain)
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .task { await models.load() }
  }

  private func modelRow(_ choice: ArrabModelChoice) -> some View {
    let selected = !session.chattingOnDevice && (session.preferredModel == choice.id
      || (choice.id == AppSession.arrabModelId && (session.preferredModel.isEmpty || session.preferredModel == "arrab" || session.preferredModel == "auto" || session.preferredModel == "primary")))
    return HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text(choice.title)
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.text)
          if choice.primary {
            Text(L10n.t(.modelPrimary, arabic: arabic))
              .font(ArrabFont.system(size: 10, weight: .bold))
              .foregroundStyle(theme.onPrimary)
              .padding(.horizontal, 8)
              .padding(.vertical, 3)
              .background(theme.lavender)
              .clipShape(Capsule())
          }
        }
        let detail = choice.detail(arabic: arabic)
        if !detail.isEmpty {
          Text(detail)
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
      }
      Spacer()
      Image(systemName: selected ? "checkmark.circle.fill" : "circle")
        .font(ArrabFont.system(size: 20))
        .foregroundStyle(selected ? theme.lavender : theme.line)
    }
    .padding(16)
    .background(selected ? theme.subtle : theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(selected ? theme.lavender : theme.line, lineWidth: selected ? 1.5 : 1)
    )
  }
}
