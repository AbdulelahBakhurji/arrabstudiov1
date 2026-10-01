import SwiftUI

struct BoardCard: Identifiable, Equatable {
  let id: String
  let name: String
  let source: String
  let body: String
  let action: String
  let companionId: String
  let conversationId: String?
  let draft: String?
}

struct BoardHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var cards: [BoardCard] = []
  @State private var loaded = false
  @State private var toast: String?

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        header

        if !loaded {
          ProgressView()
            .tint(theme.lavender)
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
        } else if cards.isEmpty {
          ArrabCard {
            VStack(alignment: .leading, spacing: 8) {
              Text(L10n.t(.boardEmpty, arabic: arabic))
                .font(ArrabFont.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(L10n.t(.boardSubtitle, arabic: arabic))
                .font(ArrabFont.system(size: 13))
                .foregroundStyle(theme.muted)
            }
          }
        } else {
          ForEach(cards) { card in
            boardCard(card)
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .task { await reload() }
    .refreshable { await reload() }
    .onChange(of: session.localeIsArabic) { _, _ in
      Task { await reload() }
    }
    .overlay(alignment: .bottom) {
      if let toast {
        Text(toast)
          .font(ArrabFont.system(size: 13, weight: .medium))
          .foregroundStyle(theme.text)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(theme.card)
          .clipShape(Capsule())
          .padding(.bottom, 16)
      }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(L10n.t(.board, arabic: arabic))
        .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
        .foregroundStyle(theme.text)
      Text(L10n.t(.boardSubtitle, arabic: arabic))
        .font(ArrabFont.system(size: 14))
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)

      HStack {
        Text(Self.todayLabel(arabic: arabic))
          .font(ArrabFont.system(size: 12, weight: .medium))
          .foregroundStyle(theme.muted)
        Spacer()
        Button {
          router.go(.tab(.chat))
        } label: {
          HStack(spacing: 6) {
            Image(systemName: "bubble.left")
              .font(ArrabFont.system(size: 11, weight: .semibold))
            Text(L10n.t(.chat, arabic: arabic))
              .font(ArrabFont.system(size: 12, weight: .semibold))
          }
          .foregroundStyle(theme.text)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(theme.subtle)
          .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
      .padding(.top, 4)
    }
  }

  private func boardCard(_ card: BoardCard) -> some View {
    ArrabCard(padding: 16) {
      VStack(alignment: .leading, spacing: 14) {
        HStack(alignment: .top) {
          HStack(spacing: 10) {
            CompanionFace(item: face(for: card), size: 40)
            VStack(alignment: .leading, spacing: 2) {
              Text(card.name)
                .font(ArrabFont.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(card.source)
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
            }
          }
          Spacer()
          Button {
            dismiss(card)
          } label: {
            Image(systemName: "xmark")
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.muted)
              .frame(width: 30, height: 30)
              .background(theme.subtle)
              .clipShape(Circle())
          }
          .buttonStyle(.plain)
        }

        Text(card.body)
          .font(ArrabFont.system(size: 16, weight: .medium))
          .foregroundStyle(theme.text)
          .fixedSize(horizontal: false, vertical: true)

        HStack {
          Spacer(minLength: 0)
          Button {
            open(card)
          } label: {
            HStack(spacing: 6) {
              Image(systemName: "arrow.up.right")
                .font(ArrabFont.system(size: 12, weight: .semibold))
              Text(card.action)
                .font(ArrabFont.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(theme.text)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(theme.card)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(theme.line, lineWidth: 1))
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private func face(for card: BoardCard) -> CompanionItem {
    companions.companions.first { $0.id == card.companionId }
      ?? CompanionCatalog.item(matching: card.companionId, specialty: nil, name: card.name)
      ?? CompanionCatalog.general
  }

  private func open(_ card: BoardCard) {
    if let draft = card.draft, !draft.isEmpty {
      router.pendingDraft = draft
    }
    router.openChat(conversationId: card.conversationId, companionId: card.companionId)
  }

  private func dismiss(_ card: BoardCard) {
    var ids = Set(UserDefaults.standard.stringArray(forKey: Self.dismissedKey) ?? [])
    ids.insert(card.id)
    UserDefaults.standard.set(Array(ids), forKey: Self.dismissedKey)
    withAnimation { cards.removeAll { $0.id == card.id } }
  }

  private func reload() async {
    let api = ArrabAPIClient.shared
    try? await api.ensureLiveAuthBase()
    async let conversationResult = Self.load { try await api.conversations() }
    async let activityResult = Self.load { try await api.activity() }
    async let taskResult = Self.load { try await api.tasks() }
    let conversations = await conversationResult ?? []
    let activity = await activityResult ?? []
    let tasks = await taskResult ?? []
    let dismissed = Set(UserDefaults.standard.stringArray(forKey: Self.dismissedKey) ?? [])
    var next = await conversationCards(Array(conversations
      .filter { ($0.title ?? "") != "arrab-incognito" }
      .sorted { $0.sortStamp > $1.sortStamp }
      .prefix(5)))
    for item in activity.prefix(6) {
      let summary = item.summary.trimmingCharacters(in: .whitespacesAndNewlines)
      guard summary.count > 1 else { continue }
      next.append(BoardCard(
        id: "activity-\(item.id)",
        name: companions.selected.displayName(arabic: arabic),
        source: item.verb.replacingOccurrences(of: "_", with: " "),
        body: summary,
        action: L10n.t(.talkAboutIt, arabic: arabic),
        companionId: companions.selected.id,
        conversationId: nil,
        draft: summary
      ))
    }
    for task in tasks where !Self.isDone(task.status) {
      next.append(BoardCard(
        id: "task-\(task.id)",
        name: companions.selected.displayName(arabic: arabic),
        source: arabic ? "مهمة" : "Task",
        body: task.title,
        action: L10n.t(.openTopic, arabic: arabic),
        companionId: companions.selected.id,
        conversationId: nil,
        draft: task.title
      ))
      if next.filter({ $0.id.hasPrefix("task-") }).count >= 3 { break }
    }
    cards = next.filter { !dismissed.contains($0.id) }
    loaded = true
  }

  private func conversationCards(_ conversations: [Conversation]) async -> [BoardCard] {
    var built: [BoardCard] = []
    for conversation in conversations {
      built.append(await conversationCard(conversation))
    }
    return built
  }

  private func conversationCard(_ conversation: Conversation) async -> BoardCard {
    let detail = try? await ArrabAPIClient.shared.conversation(conversation.id)
    let preview = detail?.messages.reversed().compactMap { message -> String? in
      let text = ChatViewModel.publicText(message.content)
      return text.isEmpty ? nil : text
    }.first
    let title = conversation.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let companion = companionId(for: conversation.agentId)
    let person = companions.companions.first { $0.id == companion }
    let name = person?.displayName(arabic: arabic) ?? (title.isEmpty ? "Arrab" : title)
    let body = preview ?? (title.isEmpty ? (arabic ? "محادثة مفتوحة" : "Open conversation") : title)
    return BoardCard(
      id: conversation.id,
      name: name,
      source: L10n.t(.fromChats, arabic: arabic),
      body: String(body.prefix(180)),
      action: L10n.t(.talkAboutIt, arabic: arabic),
      companionId: companion,
      conversationId: conversation.id,
      draft: nil
    )
  }

  private func companionId(for agentId: String?) -> String {
    guard let agentId, !agentId.isEmpty else { return companions.selected.id }
    if let match = companions.companions.first(where: { $0.agentId == agentId || $0.id == agentId }) {
      return match.id
    }
    return companions.selected.id
  }

  private static func isDone(_ status: String) -> Bool {
    let value = status.lowercased()
    return value == "done" || value == "completed" || value == "cancelled"
  }

  private static func load<T>(_ work: () async throws -> T) async -> T? {
    try? await work()
  }

  private static let dismissedKey = "arrab.board.dismissed"

  private static func todayLabel(arabic: Bool) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: arabic ? "ar" : "en")
    formatter.dateFormat = "EEEE, d MMMM"
    return formatter.string(from: Date())
  }
}
