import SwiftUI

enum MainTab: String, CaseIterable, Identifiable {
  case chat, studio, brain, tasks, me

  var id: String { rawValue }

  var title: String {
    switch self {
    case .chat: return "Chat"
    case .studio: return "Studio"
    case .brain: return "Brain"
    case .tasks: return "Tasks"
    case .me: return "Me"
    }
  }

  var systemImage: String {
    switch self {
    case .chat: return "bubble.left.and.bubble.right.fill"
    case .studio: return "sparkles"
    case .brain: return "brain.head.profile"
    case .tasks: return "checklist"
    case .me: return "person.crop.circle"
    }
  }
}

struct RootView: View {
  @EnvironmentObject private var session: AppSession
  @State private var tab: MainTab = .chat

  var body: some View {
    Group {
      if session.isSignedIn {
        mainShell
      } else {
        AuthView()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .adaptiveReader()
  }

  private var mainShell: some View {
    VStack(spacing: 0) {
      Group {
        switch tab {
        case .chat: ChatHomeView()
        case .studio: StudioHomeView()
        case .brain: BrainHomeView()
        case .tasks: TasksHomeView()
        case .me: MeHomeView()
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)

      ArrabTabBar(selection: $tab)
    }
  }
}

struct ArrabTabBar: View {
  @Binding var selection: MainTab
  @Environment(\.adaptive) private var adaptive

  var body: some View {
    HStack(spacing: 0) {
      ForEach(MainTab.allCases) { item in
        Button {
          selection = item
        } label: {
          VStack(spacing: 4) {
            Image(systemName: item.systemImage)
              .font(.system(size: 18, weight: .semibold))
            if adaptive.tabLabelVisible {
              Text(item.title)
                .font(.system(size: 10, weight: .medium))
            }
          }
          .foregroundStyle(selection == item ? ArrabTheme.text : ArrabTheme.muted)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 10)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title)
      }
    }
    .padding(.horizontal, 6)
    .padding(.top, 4)
    .padding(.bottom, 2)
    .background(
      ArrabTheme.card
        .overlay(alignment: .top) {
          Rectangle().fill(ArrabTheme.line).frame(height: 1)
        }
        .ignoresSafeArea(edges: .bottom)
    )
  }
}
