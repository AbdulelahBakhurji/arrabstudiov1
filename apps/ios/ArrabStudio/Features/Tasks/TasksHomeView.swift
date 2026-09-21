import SwiftUI

struct TasksHomeView: View {
  @Environment(\.adaptive) private var adaptive
  @State private var items: [TaskItem] = [
    .init(id: "1", title: "Review Brand voice principles", done: false),
    .init(id: "2", title: "Ship Studio chat composer fix", done: true),
    .init(id: "3", title: "Link iPhone to Mac desk", done: false),
  ]
  @State private var draft = ""

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          Text("ARRAB / TASKS")
            .font(.system(size: 10, weight: .bold))
            .tracking(1.2)
            .foregroundStyle(ArrabTheme.muted)
          Text("Tasks")
            .font(.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(ArrabTheme.text)
        }
        Spacer()
      }
      .padding(adaptive.gutter)

      List {
        ForEach($items) { $item in
          HStack(spacing: 12) {
            Button {
              item.done.toggle()
            } label: {
              Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(item.done ? ArrabTheme.success : ArrabTheme.muted)
            }
            .buttonStyle(.plain)
            Text(item.title)
              .strikethrough(item.done)
              .foregroundStyle(item.done ? ArrabTheme.muted : ArrabTheme.text)
          }
          .listRowBackground(ArrabTheme.card)
        }
        .onDelete { items.remove(atOffsets: $0) }
      }
      .scrollContentBackground(.hidden)
      .background(ArrabTheme.bg)

      HStack {
        TextField("Add a task", text: $draft)
          .textFieldStyle(ArrabFieldStyle())
        Button {
          let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !text.isEmpty else { return }
          items.insert(.init(id: UUID().uuidString, title: text, done: false), at: 0)
          draft = ""
        } label: {
          Image(systemName: "plus")
            .frame(width: 40, height: 40)
            .background(ArrabTheme.primary)
            .foregroundStyle(ArrabTheme.onPrimary)
            .clipShape(Circle())
        }
      }
      .padding(adaptive.gutter)
    }
    .background(ArrabTheme.bg)
  }
}

struct TaskItem: Identifiable, Equatable {
  let id: String
  var title: String
  var done: Bool
}
