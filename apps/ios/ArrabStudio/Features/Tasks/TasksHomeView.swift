import SwiftUI

struct TasksHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.adaptive) private var adaptive
  @Environment(\.arrab) private var theme

  @State private var segment: Segment = .tasks
  @State private var items: [TaskItem] = []
  @State private var draft = ""
  @State private var ideas: [String] = []

  private var arabic: Bool { session.localeIsArabic }

  enum Segment: String, CaseIterable, Identifiable {
    case tasks, topics
    var id: String { rawValue }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        VStack(alignment: .leading, spacing: 8) {
          Text(L10n.t(.tasks, arabic: arabic))
            .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(L10n.t(.workSubtitle, arabic: arabic))
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }

        HStack(spacing: 0) {
          segmentButton(.tasks, title: L10n.t(.tasks, arabic: arabic))
          segmentButton(.topics, title: L10n.t(.topics, arabic: arabic))
        }
        .overlay(alignment: .bottom) {
          Rectangle().fill(theme.line).frame(height: 1)
        }

        if segment == .tasks {
          composerCard
          tasksSection
        } else {
          ArrabCard {
            Text(L10n.t(.boardEmpty, arabic: arabic))
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.muted)
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .onAppear { restore() }
    .onChange(of: items) { _, _ in persist() }
    .onChange(of: ideas) { _, _ in persist() }
    .task { await loadRemote() }
  }

  private func restore() {
    if let data = UserDefaults.standard.data(forKey: "arrab.tasks.local"),
       let saved = try? JSONDecoder().decode([TaskItem].self, from: data), !saved.isEmpty {
      items = saved
    }
    ideas = UserDefaults.standard.stringArray(forKey: "arrab.ideas.local") ?? []
  }

  private func persist() {
    if let data = try? JSONEncoder().encode(items) {
      UserDefaults.standard.set(data, forKey: "arrab.tasks.local")
    }
    UserDefaults.standard.set(ideas, forKey: "arrab.ideas.local")
  }

  private func loadRemote() async {
    guard let remote = try? await ArrabAPIClient.shared.tasks(), !remote.isEmpty else { return }
    let known = Set(items.map(\.id))
    let extra = remote.filter { !known.contains($0.id) }.map {
      TaskItem(id: $0.id, title: $0.title, done: $0.status == "done")
    }
    if !extra.isEmpty { items.insert(contentsOf: extra, at: 0) }
  }

  private func segmentButton(_ value: Segment, title: String) -> some View {
    Button {
      segment = value
    } label: {
      VStack(spacing: 10) {
        Text(title)
          .font(ArrabFont.system(size: 14, weight: segment == value ? .semibold : .medium))
          .foregroundStyle(segment == value ? theme.text : theme.muted)
        Rectangle()
          .fill(segment == value ? theme.text : Color.clear)
          .frame(height: 2)
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.plain)
  }

  private var composerCard: some View {
    ArrabCard {
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          Image(systemName: "plus")
            .font(ArrabFont.system(size: 16, weight: .medium))
            .foregroundStyle(theme.muted)
          Spacer()
        }
        TextField(L10n.t(.workPlaceholder, arabic: arabic), text: $draft, axis: .vertical)
          .lineLimit(1...3)
          .font(ArrabFont.system(size: 16, weight: .medium))
          .foregroundStyle(theme.text)
          .multilineTextAlignment(arabic ? .trailing : .leading)

        HStack(spacing: 10) {
          Button {
            let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            items.insert(.init(id: UUID().uuidString, title: text, done: false), at: 0)
            draft = ""
          } label: {
            HStack(spacing: 6) {
              Image(systemName: "plus")
              Text(L10n.t(.addTask, arabic: arabic))
            }
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(theme.primary)
            .clipShape(Capsule())
          }
          .buttonStyle(.plain)

          Spacer(minLength: 0)

          Button {
            let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            ideas.insert(text, at: 0)
            draft = ""
          } label: {
            HStack(spacing: 6) {
              Image(systemName: "lightbulb")
              Text(L10n.t(.saveIdea, arabic: arabic))
            }
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.text)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .overlay(Capsule().stroke(theme.line, lineWidth: 1))
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private var tasksSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(L10n.t(.yourTasks, arabic: arabic))
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
        Text("\(items.filter { !$0.done }.count)")
          .font(ArrabFont.system(size: 11, weight: .bold))
          .foregroundStyle(theme.muted)
          .padding(6)
          .background(theme.subtle)
          .clipShape(Circle())
        Spacer()
        Text(L10n.t(.readyToDo, arabic: arabic))
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
      }

      if items.isEmpty {
        ArrabCard {
          VStack(spacing: 12) {
            ZStack {
              Circle()
                .fill(theme.lavenderSoft)
                .frame(width: 72, height: 72)
              Image(systemName: "sparkle")
                .font(ArrabFont.system(size: 26, weight: .semibold))
                .foregroundStyle(theme.lavender)
            }
            .padding(.top, 8)
            Text(L10n.t(.lighterDay, arabic: arabic))
              .font(ArrabFont.system(size: 17, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(L10n.t(.lighterDayHint, arabic: arabic))
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.muted)
              .multilineTextAlignment(.center)
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
        }
      } else {
        ForEach($items) { $item in
          ArrabCard(padding: 14) {
            HStack(spacing: 12) {
              Button {
                item.done.toggle()
              } label: {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                  .foregroundStyle(item.done ? theme.success : theme.muted)
              }
              .buttonStyle(.plain)
              Text(item.title)
                .strikethrough(item.done)
                .foregroundStyle(item.done ? theme.muted : theme.text)
              Spacer()
            }
          }
        }
      }

      if !ideas.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text(L10n.t(.saveIdea, arabic: arabic))
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.muted)
          ForEach(ideas, id: \.self) { idea in
            Text(idea)
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.text)
              .padding(12)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(theme.subtle)
              .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          }
        }
        .padding(.top, 8)
      }
    }
  }
}

struct TaskItem: Identifiable, Equatable, Codable {
  let id: String
  var title: String
  var done: Bool
}
