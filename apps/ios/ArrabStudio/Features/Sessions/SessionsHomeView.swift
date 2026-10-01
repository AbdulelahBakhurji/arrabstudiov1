import SwiftUI

struct SessionsHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var items: [Conversation] = []
  @State private var snippets: [String: SessionSnippet] = [:]
  @State private var query = ""
  @State private var busy = false
  @State private var error: String?

  private var arabic: Bool { session.localeIsArabic }

  private var filtered: [Conversation] {
    let visible = items.filter { ($0.title ?? "") != "arrab-incognito" }
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let sorted = visible.sorted { $0.sortStamp > $1.sortStamp }
    guard !q.isEmpty else { return sorted }
    return sorted.filter {
      ($0.title ?? "").localizedCaseInsensitiveContains(q)
        || companionName($0.agentId).localizedCaseInsensitiveContains(q)
        || (snippets[$0.id]?.preview ?? "").localizedCaseInsensitiveContains(q)
    }
  }

  private var groups: [SessionGroup] {
    var order: [String] = []
    var buckets: [String: [Conversation]] = [:]
    for item in filtered {
      let key = item.agentId ?? "general"
      if buckets[key] == nil { order.append(key) }
      buckets[key, default: []].append(item)
    }
    return order.map { key in
      let face = CompanionCatalog.item(matching: key, specialty: nil, name: nil) ?? CompanionCatalog.general
      return SessionGroup(id: key, face: face, items: buckets[key] ?? [])
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: adaptive.isPadLike ? 18 : 14) {
      HStack(alignment: .center) {
        Text(L10n.t(.sessions, arabic: arabic))
          .font(ArrabFont.system(size: headerSize, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer()
        Button { router.go(.tab(.chat)) } label: {
          Image(systemName: "xmark")
            .font(ArrabFont.system(size: adaptive.isSmallPhone ? 12 : 14, weight: .semibold))
            .foregroundStyle(theme.text)
            .frame(width: closeSize, height: closeSize)
            .background(theme.card)
            .clipShape(Circle())
            .overlay(Circle().stroke(theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(arabic ? "إغلاق" : "Close")
      }

      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .font(ArrabFont.system(size: adaptive.isSmallPhone ? 14 : 16))
          .foregroundStyle(theme.muted)
        TextField(L10n.t(.searchSessions, arabic: arabic), text: $query)
          .font(ArrabFont.system(size: adaptive.isSmallPhone ? 15 : 16))
          .multilineTextAlignment(arabic ? .trailing : .leading)
          .foregroundStyle(theme.text)
        if !query.isEmpty {
          Button { query = "" } label: {
            Image(systemName: "xmark")
              .font(ArrabFont.system(size: 12, weight: .bold))
              .foregroundStyle(theme.text)
              .frame(width: 22, height: 22)
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 14)
      .padding(.vertical, adaptive.isSmallPhone ? 10 : 12)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(theme.lavender.opacity(0.55), lineWidth: 1)
      )

      if let error {
        Text(error).font(ArrabFont.system(size: 13)).foregroundStyle(theme.warn)
      }

      if filtered.isEmpty && !busy {
        VStack(spacing: 8) {
          Text(query.isEmpty
            ? (arabic ? "لا جلسات بعد" : "No sessions yet")
            : (arabic ? "لا نتائج" : "No matches"))
            .font(ArrabFont.system(size: adaptive.isPadLike ? 20 : 17, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(query.isEmpty
            ? (arabic ? "المحادثات التي تفتحها تظهر هنا." : "Conversations you open show up here.")
            : (arabic ? "جرّب كلمة أخرى." : "Try another word."))
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, adaptive.isPadLike ? 72 : 48)
      } else {
        List {
          ForEach(groups) { group in
            Section {
              ForEach(group.items) { item in
                sessionRow(item)
                  .listRowInsets(EdgeInsets(top: 8, leading: 2, bottom: 10, trailing: 2))
                  .listRowSeparator(.hidden)
                  .listRowBackground(Color.clear)
                  .swipeActions {
                    Button(role: .destructive) {
                      Task { await remove(item) }
                    } label: {
                      Label(arabic ? "حذف" : "Delete", systemImage: "trash")
                    }
                  }
              }
            } header: {
              groupHeader(group)
            }
          }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listSectionSpacing(adaptive.isPadLike ? 18 : 12)
        .environment(\.locale, Locale(identifier: arabic ? "ar" : "en"))
      }
    }
    .padding(.horizontal, adaptive.gutter)
    .padding(.top, adaptive.isPadLike ? 22 : 16)
    .frame(maxWidth: adaptive.isPadLike ? 760 : .infinity)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(theme.bg)
    .overlay { if busy && items.isEmpty { ProgressView().tint(theme.lavender) } }
    .refreshable { await reload() }
    .task { await reload() }
  }

  private var headerSize: CGFloat {
    if adaptive.isPhoneLandscape { return 20 }
    if adaptive.isSmallPhone { return 20 }
    return adaptive.isPadLike ? 28 : 22
  }

  private var closeSize: CGFloat { adaptive.isPadLike ? 40 : (adaptive.isSmallPhone ? 32 : 36) }
  private var faceSize: CGFloat { adaptive.isPadLike ? 40 : (adaptive.isSmallPhone ? 30 : 34) }

  private func groupHeader(_ group: SessionGroup) -> some View {
    HStack(spacing: 10) {
      CompanionFace(item: group.face, size: faceSize)
      Text(group.face.displayName(arabic: arabic))
        .font(ArrabFont.system(size: adaptive.isPadLike ? 17 : 15, weight: .semibold))
        .foregroundStyle(theme.text)
        .lineLimit(1)
      Spacer(minLength: 8)
      Text(sessionCount(group.items.count))
        .font(ArrabFont.system(size: adaptive.isSmallPhone ? 11 : 12, weight: .semibold))
        .foregroundStyle(theme.muted)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(theme.bg)
        .clipShape(Capsule())
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(theme.subtle)
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    .textCase(nil)
  }

  private func sessionRow(_ item: Conversation) -> some View {
    let companionId = item.agentId ?? "general"
    let face = CompanionCatalog.item(matching: companionId, specialty: nil, name: nil) ?? CompanionCatalog.general
    let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines)
    let shown = (title?.isEmpty == false ? title! : L10n.t(.chat, arabic: arabic))
    let snippet = snippets[item.id]
    return Button {
      router.openChat(conversationId: item.id, companionId: face.id)
    } label: {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text(shown)
            .font(ArrabFont.system(size: adaptive.isPadLike ? 18 : 16, weight: .semibold))
            .foregroundStyle(theme.text)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
          if let preview = snippet?.preview, !preview.isEmpty {
            Text(preview)
              .font(ArrabFont.system(size: adaptive.isSmallPhone ? 13 : 14))
              .foregroundStyle(theme.muted)
              .lineLimit(2)
              .multilineTextAlignment(arabic ? .trailing : .leading)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        VStack(alignment: .trailing, spacing: 8) {
          Text(relative(item.updatedAt ?? item.createdAt))
            .font(ArrabFont.system(size: adaptive.isSmallPhone ? 11 : 12))
            .foregroundStyle(theme.muted)
            .lineLimit(1)
          if let turns = snippet?.turns, turns > 0 {
            Text(turnCount(turns))
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.muted)
              .padding(.horizontal, 10)
              .padding(.vertical, 5)
              .background(theme.subtle)
              .clipShape(Capsule())
          }
        }
      }
      .padding(.vertical, 2)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func sessionCount(_ n: Int) -> String {
    let formatted = n.formatted(.number.locale(Locale(identifier: arabic ? "ar" : "en")))
    if arabic { return n == 1 ? "جلسة" : "\(formatted) جلسات" }
    return n == 1 ? "1 session" : "\(formatted) sessions"
  }

  private func turnCount(_ n: Int) -> String {
    let formatted = n.formatted(.number.locale(Locale(identifier: arabic ? "ar" : "en")))
    if arabic { return "\(formatted) مرات" }
    return n == 1 ? "1 time" : "\(formatted) times"
  }

  private func relative(_ raw: String?) -> String {
    guard let date = parseDate(raw) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = Locale(identifier: arabic ? "ar" : "en")
    formatter.unitsStyle = .full
    return formatter.localizedString(for: date, relativeTo: Date())
  }

  private func parseDate(_ raw: String?) -> Date? {
    guard let raw, !raw.isEmpty else { return nil }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = iso.date(from: raw) { return date }
    iso.formatOptions = [.withInternetDateTime]
    return iso.date(from: raw)
  }

  private func companionName(_ id: String?) -> String {
    guard let id else { return arabic ? "عام" : "General" }
    return CompanionCatalog.item(matching: id, specialty: nil, name: nil)?.displayName(arabic: arabic)
      ?? (arabic ? "عام" : "General")
  }

  private func remove(_ item: Conversation) async {
    await ArrabAPIClient.shared.deleteConversation(item.id)
    items.removeAll { $0.id == item.id }
    snippets[item.id] = nil
  }

  private func reload() async {
    busy = true
    defer { busy = false }
    do {
      let next = try await ArrabAPIClient.shared.conversations()
      items = next
      error = nil
      await loadSnippets(next)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func loadSnippets(_ list: [Conversation]) async {
    let pending = list.prefix(24).map(\.id)
    await withTaskGroup(of: (String, SessionSnippet)?.self) { group in
      for id in pending {
        group.addTask {
          guard let detail = try? await ArrabAPIClient.shared.conversation(id) else { return nil }
          let messages = detail.messages.filter { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
          let turns = messages.filter { $0.role == "user" }.count
          let preview = messages.last.map { String($0.content.prefix(140)).replacingOccurrences(of: "\n", with: " ") } ?? ""
          return (id, SessionSnippet(preview: preview, turns: turns))
        }
      }
      for await row in group {
        if let row { snippets[row.0] = row.1 }
      }
    }
  }
}

private struct SessionSnippet {
  var preview: String
  var turns: Int
}

private struct SessionGroup: Identifiable {
  var id: String
  var face: CompanionItem
  var items: [Conversation]
}

struct IncognitoHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var draft = ""
  @State private var lines: [(id: String, role: String, text: String)] = []
  @State private var busy = false
  @State private var hiddenConversation: String?
  @State private var stream = ChatStream()

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(L10n.t(.incognitoTitle, arabic: arabic))
            .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(theme.text)
          Spacer()
          Button(L10n.t(.leaveIncognito, arabic: arabic)) {
            lines = []
            draft = ""
            router.incognitoActive = false
            router.go(.tab(.chat))
          }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.lavender)
        }
        Text(L10n.t(.incognitoBody, arabic: arabic))
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)
      }
      .padding(adaptive.gutter)

      ScrollView {
        LazyVStack(alignment: .leading, spacing: 10) {
          if lines.isEmpty {
            ArrabCard {
              VStack(spacing: 10) {
                Image(systemName: "theatermasks")
                  .font(ArrabFont.system(size: 28))
                  .foregroundStyle(theme.lavender)
                Text(L10n.t(.incognitoTitle, arabic: arabic))
                  .font(ArrabFont.system(size: 16, weight: .semibold))
                  .foregroundStyle(theme.text)
                Text(L10n.t(.incognitoBody, arabic: arabic))
                  .font(ArrabFont.system(size: 13))
                  .foregroundStyle(theme.muted)
                  .multilineTextAlignment(.center)
              }
              .frame(maxWidth: .infinity)
            }
          } else {
            ForEach(lines, id: \.id) { line in
              HStack {
                if line.role == "user" { Spacer(minLength: 40) }
                Text(line.text)
                  .padding(12)
                  .background(line.role == "user" ? theme.primary : theme.subtle)
                  .foregroundStyle(line.role == "user" ? theme.onPrimary : theme.text)
                  .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                if line.role != "user" { Spacer(minLength: 40) }
              }
            }
          }
        }
        .padding(adaptive.gutter)
      }

      ComposerBar(
        draft: $draft,
        placeholder: L10n.t(.writeMind, arabic: arabic),
        isBusy: busy,
        sendBlocked: false,
        onSend: { Task { await send() } },
        onPause: {
          stream.cancel()
          busy = false
          lines.removeAll { $0.role == "assistant" && $0.text.isEmpty }
        }
      )
    }
    .background(theme.bg)
    .onDisappear {
      let id = hiddenConversation
      hiddenConversation = nil
      lines = []
      guard let id else { return }
      Task { await ArrabAPIClient.shared.deleteConversation(id) }
    }
  }

  private func send() async {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !busy else { return }
    draft = ""
    let stream = ChatStream()
    self.stream = stream
    busy = true
    defer { if !stream.isStopped { busy = false } }
    let replyId = UUID().uuidString
    lines.append((UUID().uuidString, "user", text))
    lines.append((replyId, "assistant", ""))
    do {
      if hiddenConversation == nil {
        let agents = try await ArrabAPIClient.shared.agents()
        let agentId = agents.first?.id ?? "general"
        let convo = try await ArrabAPIClient.shared.createConversation(agentId: agentId, title: "arrab-incognito")
        hiddenConversation = convo.id
      }
      guard let hiddenConversation else { return }
      _ = try await ArrabAPIClient.shared.streamMessage(conversationId: hiddenConversation, content: text, stream: stream) { token in
        if stream.isStopped { return }
        if let idx = lines.firstIndex(where: { $0.id == replyId }) {
          let current = lines[idx]
          lines[idx] = (current.id, current.role, current.text + token)
        }
      }
    } catch {
      if stream.isStopped || error is CancellationError { return }
      if let urlError = error as? URLError, urlError.code == .cancelled { return }
      if let idx = lines.firstIndex(where: { $0.id == replyId }), lines[idx].text.isEmpty {
        lines[idx] = (replyId, "assistant", error.localizedDescription)
      }
    }
  }
}
