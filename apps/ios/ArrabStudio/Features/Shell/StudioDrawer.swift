import SwiftUI

struct StudioDrawer: View {
  var current: ShellDestination
  var onSelect: (ShellDestination) -> Void
  var onClose: () -> Void

  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var router: ShellRouter
  @EnvironmentObject private var themeStore: ThemeStore
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        ArrabWordmark(size: 22)
        Spacer()
        Button(action: onClose) {
          Image(systemName: "xmark")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.text)
            .frame(width: 32, height: 32)
            .background(theme.card)
            .clipShape(Circle())
            .overlay(Circle().stroke(theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(arabic ? "إغلاق" : "Close")
      }
      .padding(.horizontal, 20)
      .padding(.top, 18)
      .padding(.bottom, 16)

      Text(L10n.t(.studioMode, arabic: arabic))
        .font(ArrabFont.system(size: 13, weight: .medium))
        .foregroundStyle(theme.muted)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, 20)

      HStack(spacing: 8) {
        audienceChip(.individual, L10n.t(.individuals, arabic: arabic), "person")
        audienceChip(.organization, L10n.t(.organizations, arabic: arabic), "building.2")
        if session.studioRole == .family {
          audienceChip(.family, L10n.t(.family, arabic: arabic), "person.2")
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 10)
      .padding(.bottom, 18)

      Text(L10n.t(.goTo, arabic: arabic))
        .font(ArrabFont.system(size: 13, weight: .medium))
        .foregroundStyle(theme.muted)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, 20)
        .padding(.bottom, 6)

      ForEach(destinations) { item in
        navButton(item.title, item.icon, selected: item.selected) { open(item) }
      }

      Text(L10n.t(.quickSettings, arabic: arabic))
        .font(ArrabFont.system(size: 12, weight: .medium))
        .foregroundStyle(theme.muted)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 6)

      Button { session.localeIsArabic.toggle() } label: {
        drawerLabel(
          title: arabic ? L10n.t(.switchToEnglish, arabic: true) : L10n.t(.switchToArabic, arabic: false),
          icon: "character.textbox",
          trailing: AnyView(
            Text(arabic ? "EN" : "ع")
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .foregroundStyle(theme.muted)
          )
        )
      }
      .buttonStyle(.plain)

      navButton(
        themeStore.mode == .dark
          ? L10n.t(.switchToLight, arabic: arabic)
          : L10n.t(.switchToDark, arabic: arabic),
        themeStore.mode == .dark ? "sun.max" : "moon"
      ) {
        themeStore.toggle()
      }

      Button { onSelect(.account) } label: {
        drawerLabel(
          title: L10n.t(.account, arabic: arabic),
          icon: "person",
          trailing: AnyView(
            Text(profileInitial)
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.text)
              .frame(width: 26, height: 26)
              .background(theme.lavenderSoft)
              .clipShape(Circle())
          )
        )
      }
      .buttonStyle(.plain)

      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(theme.bg)
  }

  private var profileInitial: String {
    let name = session.account?.displayName ?? session.account?.email ?? "A"
    return String(name.prefix(1)).uppercased()
  }

  private struct Dest: Identifiable {
    let id: String
    let title: String
    let icon: String
    let dest: ShellDestination
    let selected: Bool
  }

  private var destinations: [Dest] {
    switch session.studioRole {
    case .organization:
      return [
        dest("studio", L10n.t(.studio, arabic: arabic), "house", .studio, current == .tab(.chat) && router.orgTab == .studio),
        dest("chat", L10n.t(.chat, arabic: arabic), "bubble.left", .tab(.chat), current == .tab(.chat) && router.orgTab == .chat),
        dest("cowork", L10n.t(.cowork, arabic: arabic), "rectangle.split.3x1", .tab(.chat), current == .tab(.chat) && router.orgTab == .cowork),
        dest("workforce", L10n.t(.workforce, arabic: arabic), "person.3", .workforce, current == .workforce),
        dest("connectors", L10n.t(.connectors, arabic: arabic), "cable.connector", .connectors, current == .connectors),
        dest("activity", L10n.t(.activity, arabic: arabic), "clock.arrow.circlepath", .activity, current == .activity),
        dest("settings", L10n.t(.settings, arabic: arabic), "gearshape", .settings, current == .settings),
      ]
    case .family:
      return individualDestinations + [
        dest("family", L10n.t(.familyControl, arabic: arabic), "lock.shield", .familyControl, current == .familyControl),
      ]
    case .individual:
      return individualDestinations
    }
  }

  private var individualDestinations: [Dest] {
    [
      dest("chat", L10n.t(.chat, arabic: arabic), "bubble.left", .tab(.chat), current == .tab(.chat)),
      dest("board", L10n.t(.board, arabic: arabic), "square.grid.2x2", .tab(.board), current == .tab(.board)),
      dest("tasks", L10n.t(.tasks, arabic: arabic), "checklist", .tab(.tasks), current == .tab(.tasks)),
      dest("me", L10n.t(.me, arabic: arabic), "person", .me, current == .me),
      dest("companions", L10n.t(.manageCompanions, arabic: arabic), "person.2", .companions, current == .companions),
    ]
  }

  private func dest(_ id: String, _ title: String, _ icon: String, _ destination: ShellDestination, _ selected: Bool) -> Dest {
    Dest(id: id, title: title, icon: icon, dest: destination, selected: selected)
  }

  private func open(_ item: Dest) {
    switch item.id {
    case "studio":
      router.orgTab = .studio
      onSelect(.tab(.chat))
    case "chat":
      if session.studioRole == .organization { router.orgTab = .chat }
      onSelect(.tab(.chat))
    case "cowork":
      router.orgTab = .cowork
      onSelect(.tab(.chat))
    default:
      onSelect(item.dest)
    }
  }

  private func audienceChip(_ role: StudioRole, _ title: String, _ icon: String) -> some View {
    let selected = session.studioRole == role
    return Button {
      session.studioRole = role
      if role == .organization { router.orgTab = .studio }
      onSelect(.tab(.chat))
    } label: {
      HStack(spacing: 6) {
        Image(systemName: icon)
          .font(ArrabFont.system(size: 13, weight: .medium))
        Text(title)
          .font(ArrabFont.system(size: 14, weight: .semibold))
          .lineLimit(1)
      }
      .foregroundStyle(selected ? theme.onPrimary : theme.text)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(selected ? theme.primary : theme.card)
      .clipShape(Capsule())
      .overlay(Capsule().stroke(selected ? Color.clear : theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private func navButton(_ title: String, _ icon: String, selected: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      drawerLabel(title: title, icon: icon, selected: selected, trailing: AnyView(EmptyView()))
    }
    .buttonStyle(.plain)
  }

  private func drawerLabel(title: String, icon: String, selected: Bool = false, trailing: AnyView) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(ArrabFont.system(size: 16, weight: .regular))
        .foregroundStyle(theme.text)
        .frame(width: 22)
      Text(title)
        .font(ArrabFont.system(size: 16, weight: .medium))
        .foregroundStyle(theme.text)
      Spacer()
      trailing
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 13)
    .background(selected ? theme.card : Color.clear)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .padding(.horizontal, 10)
    .contentShape(Rectangle())
  }
}

struct ArrabWordmark: View {
  var size: CGFloat = 22
  @Environment(\.arrab) private var theme

  var body: some View {
    HStack(spacing: 6) {
      Image("ArrabSymbol")
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
        .frame(width: size, height: size)
      Text("Arrab")
        .font(ArrabFont.system(size: size * 0.82, weight: .semibold))
        .foregroundStyle(theme.text)
    }
    .foregroundStyle(theme.text)
    .accessibilityLabel("Arrab")
  }
}

struct ArrabMark: View {
  var size: CGFloat = 28
  @Environment(\.arrab) private var theme

  var body: some View {
    Text("A")
      .font(ArrabFont.system(size: size * 0.72, weight: .bold, design: .rounded))
      .foregroundStyle(theme.text)
      .frame(width: size, height: size)
      .overlay(
        Image(systemName: "arrow.up.right")
          .font(ArrabFont.system(size: size * 0.28, weight: .bold))
          .foregroundStyle(theme.text.opacity(0.001))
      )
      .accessibilityLabel("Arrab")
  }
}
