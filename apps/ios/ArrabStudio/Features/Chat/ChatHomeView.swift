import SwiftUI

struct ChatHomeView: View {
  @Environment(\.adaptive) private var adaptive
  @StateObject private var model = ChatViewModel()
  @FocusState private var focused: Bool

  private let suggestions = [
    "What should we get done?",
    "Summarize my latest project",
    "Draft a short status update",
    "Search the web for AI news",
  ]

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider().overlay(ArrabTheme.line)
      messages
      composer
    }
    .background(ArrabTheme.bg)
    .task { await model.bootstrap() }
  }

  private var header: some View {
    HStack {
      VStack(alignment: .leading, spacing: 2) {
        Text("ARRAB / CHAT")
          .font(.system(size: 10, weight: .bold))
          .tracking(1.2)
          .foregroundStyle(ArrabTheme.muted)
        Text(model.title)
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(ArrabTheme.text)
      }
      Spacer()
      if model.isBusy {
        ProgressView().tint(ArrabTheme.muted).scaleEffect(0.8)
      }
    }
    .padding(.horizontal, adaptive.gutter)
    .padding(.vertical, 12)
  }

  private var messages: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 10) {
          if model.lines.isEmpty {
            welcome
          } else {
            ForEach(model.lines) { line in
              bubble(line)
                .id(line.id)
            }
          }
        }
        .padding(adaptive.gutter)
        .frame(maxWidth: adaptive.contentMaxWidth)
        .frame(maxWidth: .infinity)
      }
      .onChange(of: model.lines.count) { _, _ in
        if let last = model.lines.last?.id {
          withAnimation { proxy.scrollTo(last, anchor: .bottom) }
        }
      }
    }
  }

  private var welcome: some View {
    VStack(spacing: 14) {
      Image(systemName: "sparkles")
        .font(.system(size: 28))
        .foregroundStyle(ArrabTheme.accent)
        .padding(.top, 40)
      Text("What should we get done?")
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(ArrabTheme.text)
        .multilineTextAlignment(.center)
      Text("Connect API or your PC, then give a real job.")
        .font(.system(size: 14))
        .foregroundStyle(ArrabTheme.muted)
        .multilineTextAlignment(.center)
      LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
        ForEach(suggestions, id: \.self) { item in
          Button {
            Task { await model.send(item) }
          } label: {
            Text(item)
              .font(.system(size: 12.5, weight: .medium))
              .foregroundStyle(ArrabTheme.text)
              .multilineTextAlignment(.center)
              .padding(12)
              .frame(maxWidth: .infinity, minHeight: 56)
              .background(ArrabTheme.subtle)
              .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          }
          .buttonStyle(.plain)
          .disabled(model.isBusy)
        }
      }
      .padding(.top, 8)
    }
    .frame(maxWidth: .infinity)
  }

  private func bubble(_ line: ChatLine) -> some View {
    HStack {
      if line.role == "user" { Spacer(minLength: 40) }
      Text(line.text)
        .font(.system(size: 14.5))
        .foregroundStyle(line.role == "user" ? ArrabTheme.onPrimary : ArrabTheme.text)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(line.role == "user" ? ArrabTheme.primary : ArrabTheme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      if line.role != "user" { Spacer(minLength: 40) }
    }
  }

  private var composer: some View {
    HStack(alignment: .bottom, spacing: 8) {
      TextField("Message Arrab…", text: $model.draft, axis: .vertical)
        .lineLimit(1...5)
        .focused($focused)
        .padding(12)
        .background(ArrabTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(ArrabTheme.line, lineWidth: 1)
        )
      Button {
        Task { await model.send() }
      } label: {
        Image(systemName: "arrow.up")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(ArrabTheme.onPrimary)
          .frame(width: 40, height: 40)
          .background(ArrabTheme.primary)
          .clipShape(Circle())
      }
      .disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
    }
    .padding(.horizontal, adaptive.gutter)
    .padding(.vertical, 10)
    .background(ArrabTheme.card.opacity(0.95))
  }
}

struct ChatLine: Identifiable, Equatable {
  let id: String
  let role: String
  var text: String
}

@MainActor
final class ChatViewModel: ObservableObject {
  @Published var lines: [ChatLine] = []
  @Published var draft = ""
  @Published var title = "Arrab"
  @Published var isBusy = false
  @Published var error: String?

  private let api = ArrabAPIClient.shared
  private var conversationId: String?
  private var agentId: String?

  func bootstrap() async {
    do {
      var agents = try await api.agents()
      if agents.isEmpty {
        let created = try await api.createAgent(
          CreateAgentRequest(
            name: "Arrab Assistant",
            role: "Assistant",
            specialty: "arrab-assistant",
            instructions: "You are Arrab Assistant on iOS. Be concise and helpful. Match the operator language.",
            status: "active"
          )
        )
        agents = [created]
      }
      let agent = agents.first { $0.specialty == "arrab-assistant" } ?? agents[0]
      agentId = agent.id
      title = agent.name
      let chats = try await api.conversations()
      if let existing = chats.first(where: { $0.agentId == agent.id }) ?? chats.first {
        conversationId = existing.id
        let detail = try await api.conversation(existing.id)
        lines = detail.messages.map {
          ChatLine(id: $0.id, role: $0.role == "user" || $0.role == "me" ? "user" : "assistant", text: $0.content)
        }
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  func send(_ override: String? = nil) async {
    let text = (override ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !isBusy else { return }
    draft = ""
    isBusy = true
    defer { isBusy = false }

    let userId = UUID().uuidString
    lines.append(ChatLine(id: userId, role: "user", text: text))
    let replyId = UUID().uuidString
    lines.append(ChatLine(id: replyId, role: "assistant", text: ""))

    do {
      if conversationId == nil {
        guard let agentId else { throw ArrabAPIError.empty }
        let convo = try await api.createConversation(agentId: agentId, title: String(text.prefix(48)))
        conversationId = convo.id
      }
      guard let conversationId else { throw ArrabAPIError.empty }
      _ = try await api.streamMessage(conversationId: conversationId, content: text) { [weak self] token in
        guard let self else { return }
        if let idx = self.lines.firstIndex(where: { $0.id == replyId }) {
          self.lines[idx].text += token
        }
      }
      if let idx = lines.firstIndex(where: { $0.id == replyId }), lines[idx].text.isEmpty {
        lines[idx].text = "No reply arrived. Try again."
      }
    } catch {
      if let idx = lines.firstIndex(where: { $0.id == replyId }) {
        lines[idx].text = error.localizedDescription
      }
    }
  }
}
