import SwiftUI

enum IndividualsTab: String, CaseIterable, Identifiable {
  case chat, board, tasks, me

  var id: String { rawValue }

  var l10n: L10n.Key {
    switch self {
    case .chat: return .chat
    case .board: return .board
    case .tasks: return .tasks
    case .me: return .me
    }
  }

  var systemImage: String {
    switch self {
    case .chat: return "bubble.left"
    case .board: return "square.grid.2x2"
    case .tasks: return "checklist"
    case .me: return "person"
    }
  }

  var asDestination: ShellDestination {
    switch self {
    case .chat, .board, .tasks: return .tab(self)
    case .me: return .me
    }
  }
}

struct IndividualsShellView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var themeStore: ThemeStore
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.keyboardVisible) private var keyboardVisible
  @Environment(\.layoutDirection) private var layoutDirection
  @Environment(\.scenePhase) private var scenePhase

  @State private var drawerOpen = false

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ZStack(alignment: .leading) {
      Group {
        if adaptive.showSideRail {
          padShell
        } else {
          phoneShell
        }
      }
      .background(theme.bg.ignoresSafeArea())
      .focusable()
      .onKeyPress("1") { router.go(.tab(.chat)); return .handled }
      .onKeyPress("2") { router.go(.tab(.board)); return .handled }
      .onKeyPress("3") { router.go(.tab(.tasks)); return .handled }
      .onKeyPress("s") { router.go(.settings); return .handled }
      .onKeyPress(",") { router.go(.settings); return .handled }

    }
    .overlay {
      if drawerOpen && !adaptive.showSideRail {
        ZStack(alignment: .bottom) {
          Color.black.opacity(0.45)
            .ignoresSafeArea()
            .onTapGesture { closeDrawer() }
          CircleRail(arabic: arabic) { closeDrawer() }
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom))
        }
      }
    }
    .sheet(isPresented: sessionsPresented) {
      SessionsHomeView()
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
    }
    .sheet(isPresented: $router.showCompanionPicker) {
      CompanionPickerSheet()
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
    .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
    .onChange(of: router.tab) { _, next in
      managed.activeScreen = screenName(for: router.destination)
      if case .tab = router.destination {
        router.destination = .tab(next == .me ? .chat : next)
      }
    }
    .onChange(of: router.destination) { _, dest in
      managed.activeScreen = screenName(for: dest)
    }
    .onChange(of: managed.pendingRoute) { _, route in
      guard let route else { return }
      switch route {
      case .companion:
        router.openChat(companionId: managed.activeCompanionId)
      case .chat:
        router.go(.tab(.chat))
      case .usage:
        router.go(.settings)
      case .update:
        break
      case .family:
        router.go(.familyControl)
      }
      managed.pendingRoute = nil
    }
    .task {
      await companions.reload(from: managed)
      await ApprovalInbox.shared.refresh(arabic: arabic)
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        Task { await ApprovalInbox.shared.refresh(arabic: arabic) }
      }
    }
    .onChange(of: managed.config) { _, _ in
      Task { await companions.reload(from: managed) }
    }
  }

  private var railTab: IndividualsTab {
    switch router.destination {
    case .tab(let t): return t
    case .me, .account: return .me
    default: return router.tab
    }
  }

  private var showsOrgChrome: Bool {
    if case .tab = router.destination { return true }
    return false
  }

  @ViewBuilder
  private var content: some View {
    if session.studioRole == .organization && showsOrgChrome {
      orgContent
    } else {
      individualContent
    }
  }

  @ViewBuilder
  private var orgContent: some View {
    switch router.orgTab {
    case .studio:
      OrgStudioHomeView()
    case .chat:
      OrgChatHomeView()
    case .cowork:
      TasksHomeView()
    }
  }

  @ViewBuilder
  private var individualContent: some View {
    switch router.destination {
    case .tab(.chat):
      chatBody
    case .tab(.board):
      BoardHomeView()
    case .tab(.tasks):
      TasksHomeView()
    case .me:
      MeHomeView(mode: .me)
    case .tab(.me):
      MeHomeView(mode: .me)
    case .account:
      MeHomeView(mode: .account)
    case .companions:
      CompanionsManageView()
    case .settings:
      SettingsHomeView()
    case .connectors:
      ConnectorsHomeView()
    case .sessions:
      chatBody
    case .incognito:
      IncognitoHomeView()
    case .studio:
      StudioHomeView()
    case .brain:
      BrainHomeView()
    case .roles:
      RolesHomeView()
    case .models:
      ModelsHomeView()
    case .familyControl:
      FamilyControlView()
    case .activity:
      ActivityHomeView()
    case .workforce:
      WorkforceHomeView()
    case .workplace:
      WorkplaceHomeView()
    case .library:
      LibraryHomeView()
    }
  }

  private var phoneShell: some View {
    VStack(spacing: 0) {
      ManagedBanner()
      StudioTopBar(
        arabic: arabic,
        onMenu: { withAnimation(.easeOut(duration: 0.22)) { drawerOpen = true } },
        onMe: { router.go(.me) },
        onWork: { router.go(.sessions) }
      )
      if adaptive.showsPhoneTabs {
        if session.studioRole == .organization {
          OrgTopTabs(arabic: arabic)
        } else {
          IndividualsTopTabs(
            highlight: phoneTabHighlight,
            arabic: arabic,
            onSelect: { router.go(.tab($0)) }
          )
        }
      }
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var padShell: some View {
    HStack(spacing: 10) {
      PadSideRail(arabic: arabic)
        .padding(.leading, 8)
        .padding(.vertical, 12)
      VStack(spacing: 0) {
        ManagedBanner()
        PadTopChrome(
          arabic: arabic,
          onTheme: { themeStore.toggle() },
          onLanguage: { session.localeIsArabic.toggle() },
          onMe: { router.go(.me) }
        )
        content
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }

  private var phoneTabHighlight: IndividualsTab? {
    if case .tab(let tab) = router.destination, tab != .me { return tab }
    return nil
  }

  private var sessionsPresented: Binding<Bool> {
    Binding(
      get: { router.destination == .sessions },
      set: { if !$0 { router.go(.tab(.chat)) } }
    )
  }

  private func closeDrawer() {
    withAnimation(.easeOut(duration: 0.22)) { drawerOpen = false }
  }

  private var chatBody: some View {
    VStack(spacing: 0) {
      if adaptive.showSideRail {
        chatPadHeader
      }
      if adaptive.showsCompanionStrip && !adaptive.showSideRail && !keyboardVisible {
        CompanionStripView(arabic: arabic, showsAdd: true)
          .padding(.top, 4)
          .padding(.bottom, 8)
      }
      chatCanvas
    }
  }

  private var chatCanvas: some View {
    Group {
      if adaptive.showSideRail {
        VStack(spacing: 0) {
          if adaptive.showsCompanionStrip && !keyboardVisible {
            CompanionStripView(arabic: arabic, showsAdd: true)
              .padding(.top, 8)
          }
          ChatHomeView(embeddedInShell: true)
        }
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .padding(.horizontal, adaptive.gutter)
        .padding(.bottom, 12)
      } else {
        ChatHomeView(embeddedInShell: true)
          .background(theme.card)
          .clipShape(
            UnevenRoundedRectangle(
              topLeadingRadius: 28,
              bottomLeadingRadius: 0,
              bottomTrailingRadius: 0,
              topTrailingRadius: 28,
              style: .continuous
            )
          )
      }
    }
  }

  private var chatPadHeader: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text("ARRAB / COMPANIONS")
          .font(ArrabFont.system(size: 10, weight: .bold))
          .tracking(1.1)
          .foregroundStyle(theme.muted)
        Text(L10n.t(.chat, arabic: arabic))
          .font(ArrabFont.system(size: 26, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      Spacer()
      HStack(spacing: 0) {
        spacePill(L10n.t(.personal, arabic: arabic), selected: !session.professionalSpace) {
          session.professionalSpace = false
        }
        spacePill(L10n.t(.professional, arabic: arabic), selected: session.professionalSpace) {
          session.professionalSpace = true
        }
      }
      .padding(3)
      .background(theme.subtle)
      .clipShape(Capsule())
    }
    .padding(.horizontal, adaptive.gutter)
    .padding(.top, 8)
  }

  private func spacePill(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(selected ? theme.text : theme.muted)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(selected ? theme.card : Color.clear)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private func screenName(for dest: ShellDestination) -> String {
    switch dest {
    case .tab(.chat): return "chat"
    case .tab(.board): return "board"
    case .tab(.tasks): return "work"
    case .me, .tab(.me): return "me"
    case .account: return "account"
    case .settings: return "settings"
    case .connectors: return "connectors"
    case .sessions: return "sessions"
    case .incognito: return "incognito"
    case .companions: return "companions"
    case .studio: return "studio"
    case .brain: return "brain"
    case .roles: return "roles"
    case .models: return "models"
    case .familyControl: return "family"
    case .activity: return "activity"
    case .workforce: return "workforce"
    case .workplace: return "workplace"
    case .library: return "library"
    }
  }
}

struct CircleRail: View {
  var arabic: Bool
  var onNavigate: () -> Void
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  var body: some View {
    VStack(spacing: adaptive.isSmallPhone ? 12 : 16) {
      Capsule()
        .fill(theme.line)
        .frame(width: 36, height: 4)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: adaptive.isPadLike ? 12 : 8) {
          ForEach(items) { item in
            Button {
              ArrabHaptics.selection()
              item.go()
              onNavigate()
            } label: {
              VStack(spacing: 6) {
                ZStack {
                  Circle()
                    .fill(item.selected ? theme.primary : Color.clear)
                    .frame(width: iconBox, height: iconBox)
                  Circle()
                    .stroke(item.selected ? Color.clear : theme.line, lineWidth: 1)
                    .frame(width: iconBox, height: iconBox)
                  Image(systemName: item.icon)
                    .font(ArrabFont.system(size: adaptive.isSmallPhone ? 16 : 18, weight: item.selected ? .semibold : .regular))
                    .foregroundStyle(item.selected ? theme.onPrimary : theme.muted)
                }
                Text(L10n.t(item.key, arabic: arabic))
                  .font(ArrabFont.system(size: adaptive.isSmallPhone ? 10 : 11, weight: .medium))
                  .foregroundStyle(item.selected ? theme.text : theme.muted)
                  .lineLimit(1)
              }
              .frame(width: adaptive.isSmallPhone ? 58 : (adaptive.isPadLike ? 76 : 68))
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 8)
      }
    }
    .padding(.top, 10)
    .padding(.bottom, adaptive.isSmallPhone ? 12 : 18)
    .frame(maxWidth: .infinity)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: adaptive.isPadLike ? 32 : 28, style: .continuous))
    .padding(.horizontal, adaptive.gutter > 16 ? 16 : 10)
  }

  private var iconBox: CGFloat { adaptive.isSmallPhone ? 44 : (adaptive.isPadLike ? 56 : 52) }

  private struct Item: Identifiable {
    let id: String
    let key: L10n.Key
    let icon: String
    let selected: Bool
    let go: () -> Void
  }

  private var items: [Item] {
    switch session.studioRole {
    case .individual:
      return [
        item("chat", .chat, "bubble.left", router.destination == .tab(.chat)),
        item("library", .library, "square.stack", router.destination == .library),
        item("studio", .studio, "sparkle", router.destination == .studio),
        item("board", .board, "square.grid.2x2", router.destination == .tab(.board)),
        item("brain", .brain, "brain.head.profile", router.destination == .brain),
        item("tasks", .tasks, "checklist", router.destination == .tab(.tasks)),
        item("me", .me, "person", router.destination == .me),
        item("settings", .settings, "gearshape", router.destination == .settings),
      ]
    case .family:
      return [
        item("chat", .chat, "bubble.left", router.destination == .tab(.chat)),
        item("library", .library, "square.stack", router.destination == .library),
        item("studio", .studio, "sparkle", router.destination == .studio),
        item("board", .board, "square.grid.2x2", router.destination == .tab(.board)),
        item("brain", .brain, "brain.head.profile", router.destination == .brain),
        item("tasks", .tasks, "checklist", router.destination == .tab(.tasks)),
        item("family", .familyControl, "lock.shield", router.destination == .familyControl),
        item("me", .me, "person", router.destination == .me),
        item("connectors", .connectors, "cable.connector", router.destination == .connectors),
        item("settings", .settings, "gearshape", router.destination == .settings),
      ]
    case .organization:
      return [
        item("studio", .studio, "sparkle", router.orgTab == .studio && showsOrg),
        item("library", .library, "square.stack", router.destination == .library),
        item("workplace", .workplace, "briefcase", router.destination == .workplace),
        item("chat", .chat, "bubble.left", router.orgTab == .chat && showsOrg),
        item("brain", .brain, "brain.head.profile", router.destination == .brain),
        item("workforce", .workforce, "person.3", router.destination == .workforce),
        item("connectors", .connectors, "cable.connector", router.destination == .connectors),
        item("activity", .activity, "clock.arrow.circlepath", router.destination == .activity),
        item("settings", .settings, "gearshape", router.destination == .settings),
      ]
    }
  }

  private var showsOrg: Bool {
    if case .tab = router.destination { return true }
    return false
  }

  private func item(_ id: String, _ key: L10n.Key, _ icon: String, _ selected: Bool) -> Item {
    Item(id: id, key: key, icon: icon, selected: selected) {
      switch id {
      case "chat":
        if session.studioRole == .organization { router.orgTab = .chat }
        router.go(.tab(.chat))
      case "board": router.go(.tab(.board))
      case "tasks": router.go(.tab(.tasks))
      case "me": router.go(.me)
      case "settings": router.go(.settings)
      case "studio":
        if session.studioRole == .organization {
          router.orgTab = .studio
          router.go(.tab(.chat))
        } else {
          router.go(.studio)
        }
      case "brain": router.go(.brain)
      case "family": router.go(.familyControl)
      case "connectors": router.go(.connectors)
      case "activity": router.go(.activity)
      case "workforce": router.go(.workforce)
      case "workplace": router.go(.workplace)
      case "library": router.go(.library)
      case "cowork":
        router.orgTab = .cowork
        router.go(.tab(.chat))
      default: break
      }
    }
  }
}

struct PadSideRail: View {
  var arabic: Bool
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  var body: some View {
    ScrollView(showsIndicators: false) {
      VStack(spacing: adaptive.isPadLike ? 8 : 6) {
        ForEach(items) { item in
          Button {
            ArrabHaptics.selection()
            item.go()
          } label: {
            VStack(spacing: 4) {
              Image(systemName: item.icon)
                .font(ArrabFont.system(size: adaptive.isPadLike ? 20 : 18, weight: item.selected ? .semibold : .regular))
              Text(L10n.t(item.key, arabic: arabic))
                .font(ArrabFont.system(size: adaptive.isPadLike ? 12 : 11, weight: item.selected ? .semibold : .medium))
                .lineLimit(1)
            }
            .foregroundStyle(item.selected ? theme.text : theme.muted)
            .frame(width: adaptive.isPadLike ? 76 : 64, height: adaptive.isPadLike ? 64 : 58)
            .background(item.selected ? theme.card : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.vertical, 8)
      .padding(.horizontal, 6)
    }
    .background(theme.bg.opacity(0.01))
    .background(theme.card.opacity(0.55))
    .clipShape(RoundedRectangle(cornerRadius: adaptive.isPadLike ? 32 : 28, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: adaptive.isPadLike ? 32 : 28, style: .continuous)
        .stroke(theme.line.opacity(0.7), lineWidth: 1)
    )
  }

  private struct Item: Identifiable {
    let id: String
    let key: L10n.Key
    let icon: String
    let selected: Bool
    let go: () -> Void
  }

  private var items: [Item] {
    if session.studioRole == .organization {
      let home = showsOrg
      return [
        Item(id: "studio", key: .studio, icon: "house", selected: home && router.orgTab == .studio) {
          router.orgTab = .studio
          router.go(.tab(.chat))
        },
        Item(id: "chat", key: .chat, icon: "bubble.left", selected: home && router.orgTab == .chat) {
          router.orgTab = .chat
          router.go(.tab(.chat))
        },
        Item(id: "cowork", key: .cowork, icon: "rectangle.split.3x1", selected: home && router.orgTab == .cowork) {
          router.orgTab = .cowork
          router.go(.tab(.chat))
        },
        Item(id: "me", key: .me, icon: "person", selected: router.destination == .me) {
          router.go(.me)
        },
      ]
    }
    if session.studioRole == .family {
      return [
        Item(id: "chat", key: .chat, icon: "bubble.left", selected: router.destination == .tab(.chat)) { router.go(.tab(.chat)) },
        Item(id: "studio", key: .studio, icon: "sparkle", selected: router.destination == .studio) { router.go(.studio) },
        Item(id: "board", key: .board, icon: "square.grid.2x2", selected: router.destination == .tab(.board)) { router.go(.tab(.board)) },
        Item(id: "brain", key: .brain, icon: "brain.head.profile", selected: router.destination == .brain) { router.go(.brain) },
        Item(id: "tasks", key: .tasks, icon: "checklist", selected: router.destination == .tab(.tasks)) { router.go(.tab(.tasks)) },
        Item(id: "family", key: .familyControl, icon: "lock.shield", selected: router.destination == .familyControl) { router.go(.familyControl) },
        Item(id: "me", key: .me, icon: "person", selected: router.destination == .me) { router.go(.me) },
        Item(id: "connectors", key: .connectors, icon: "cable.connector", selected: router.destination == .connectors) { router.go(.connectors) },
        Item(id: "settings", key: .settings, icon: "gearshape", selected: router.destination == .settings) { router.go(.settings) },
      ]
    }
    return [
      Item(id: "chat", key: .chat, icon: "bubble.left", selected: router.destination == .tab(.chat)) {
        router.go(.tab(.chat))
      },
      Item(id: "board", key: .board, icon: "square.grid.2x2", selected: router.destination == .tab(.board)) {
        router.go(.tab(.board))
      },
      Item(id: "tasks", key: .tasks, icon: "checklist", selected: router.destination == .tab(.tasks)) {
        router.go(.tab(.tasks))
      },
      Item(id: "me", key: .me, icon: "person", selected: router.destination == .me || router.destination == .tab(.me)) {
        router.go(.me)
      },
    ]
  }

  private var showsOrg: Bool {
    if case .tab = router.destination { return true }
    return false
  }
}

struct PadTopChrome: View {
  var arabic: Bool
  var onTheme: () -> Void
  var onLanguage: () -> Void
  var onMe: () -> Void
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.colorScheme) private var colorScheme
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var themeStore: ThemeStore
  @EnvironmentObject private var router: ShellRouter

  private var appearanceIsDark: Bool {
    switch themeStore.mode {
    case .dark: return true
    case .light: return false
    case .system: return colorScheme == .dark
    }
  }

  var body: some View {
    HStack(spacing: 10) {
      ArrabWordmark(size: 22)

      Spacer(minLength: 8)

      audienceChip(L10n.t(.individuals, arabic: arabic), "person", session.studioRole != .organization) {
        session.studioRole = .individual
        router.go(.tab(.chat))
      }
      audienceChip(L10n.t(.organizations, arabic: arabic), "building.2", session.studioRole == .organization) {
        session.studioRole = .organization
        router.orgTab = .studio
        router.go(.tab(.chat))
      }

      Button(action: onLanguage) {
        HStack(spacing: 1) {
          Text("ع")
          Text("A")
        }
        .font(ArrabFont.system(size: 12, weight: .bold))
        .foregroundStyle(theme.text)
        .frame(width: 36, height: 36)
        .background(theme.card)
        .clipShape(Circle())
        .overlay(Circle().stroke(theme.line, lineWidth: 1))
      }
      .buttonStyle(.plain)
      .accessibilityLabel(arabic ? "English" : "العربية")

      iconCircle(appearanceIsDark ? "sun.max" : "moon", action: onTheme)
        .accessibilityLabel(appearanceIsDark ? L10n.t(.switchToLight, arabic: arabic) : L10n.t(.switchToDark, arabic: arabic))

      Button(action: onMe) {
        Text(profileInitial)
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
          .frame(width: 36, height: 36)
          .background(theme.card)
          .clipShape(Circle())
          .overlay(Circle().stroke(theme.line, lineWidth: 1))
      }
      .buttonStyle(.plain)
      .accessibilityLabel(L10n.t(.account, arabic: arabic))
    }
    .padding(.horizontal, adaptive.gutter)
    .padding(.vertical, 10)
  }

  private var profileInitial: String {
    let name = session.account?.displayName ?? session.account?.email ?? "A"
    return String(name.prefix(1)).uppercased()
  }

  private func iconCircle(_ system: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: system)
        .font(ArrabFont.system(size: 15, weight: .medium))
        .foregroundStyle(theme.text)
        .frame(width: 36, height: 36)
        .background(theme.card)
        .clipShape(Circle())
        .overlay(Circle().stroke(theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private func audienceChip(_ title: String, _ icon: String, _ selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Image(systemName: icon).font(ArrabFont.system(size: 12, weight: .medium))
        Text(title).font(ArrabFont.system(size: 13, weight: .semibold))
      }
      .foregroundStyle(selected ? theme.onPrimary : theme.muted)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(selected ? theme.primary : Color.clear)
      .clipShape(Capsule())
      .overlay(Capsule().stroke(theme.line, lineWidth: selected ? 0 : 1))
    }
    .buttonStyle(.plain)
  }
}

struct StudioTopBar: View {
  var arabic: Bool
  var onMenu: () -> Void
  var onMe: () -> Void
  var onWork: () -> Void
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  var body: some View {
    HStack(spacing: 8) {
      Button(action: onMenu) {
        Image(systemName: "line.3.horizontal")
          .font(ArrabFont.system(size: 18, weight: .medium))
          .foregroundStyle(theme.text)
          .frame(width: 36, height: 36)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(arabic ? "القائمة" : "Menu")

      Spacer(minLength: 8)

      Button {
        ArrabHaptics.selection()
        withAnimation(.spring(response: 0.35, dampingFraction: 0.82)) {
          session.localeIsArabic.toggle()
        }
      } label: {
        Text(arabic ? "EN" : "ع")
          .font(ArrabFont.system(size: 15, weight: .bold))
          .foregroundStyle(theme.text)
          .contentTransition(.opacity)
          .frame(width: 36, height: 36)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(arabic ? L10n.t(.switchToEnglish, arabic: arabic) : L10n.t(.switchToArabic, arabic: arabic))

      if session.studioRole != .organization {
        Button(action: onWork) {
          Image(systemName: "clock.arrow.circlepath")
            .font(ArrabFont.system(size: 17, weight: .regular))
            .foregroundStyle(theme.text)
            .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.t(.sessions, arabic: arabic))
        Color.clear.frame(width: 34, height: 34)
      }
    }
    .overlay(alignment: .trailing) {
      if session.studioRole != .organization {
        Button(action: onMe) {
          Text(meMark)
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .frame(width: 34, height: 34)
            .background(theme.primary)
            .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.t(.me, arabic: arabic))
      }
    }
    .environment(\.layoutDirection, .leftToRight)
    .padding(.horizontal, adaptive.gutter)
    .padding(.top, adaptive.isPhoneLandscape ? 2 : 4)
    .padding(.bottom, adaptive.isPhoneLandscape ? 4 : 6)
  }

  private var meMark: String {
    let name = session.account?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
    let source = (name?.isEmpty == false ? name : session.account?.email) ?? "A"
    return String(source.prefix(1)).uppercased()
  }
}

struct IndividualsTopTabs: View {
  var highlight: IndividualsTab?
  var arabic: Bool
  var onSelect: (IndividualsTab) -> Void
  @Environment(\.arrab) private var theme

  private let phoneTabs: [IndividualsTab] = [.chat, .board, .tasks]

  var body: some View {
    HStack(spacing: 0) {
      ForEach(phoneTabs) { item in
        let selected = highlight == item
        Button {
          onSelect(item)
        } label: {
          VStack(spacing: 6) {
            Image(systemName: item.systemImage)
              .font(ArrabFont.system(size: 18, weight: selected ? .semibold : .regular))
            Text(L10n.t(item.l10n, arabic: arabic))
              .font(ArrabFont.system(size: 12, weight: selected ? .semibold : .medium))
          }
          .foregroundStyle(selected ? theme.text : theme.muted)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.bottom, 2)
  }
}

struct OrgTopTabs: View {
  var arabic: Bool
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme

  var body: some View {
    HStack(spacing: 0) {
      orgTab(.studio, "house", .studio)
      orgTab(.chat, "bubble.left", .chat)
      orgTab(.cowork, "rectangle.split.3x1", .cowork)
    }
    .padding(.bottom, 4)
  }

  private func orgTab(_ key: L10n.Key, _ icon: String, _ tab: OrgTab) -> some View {
    let onHome: Bool = {
      if case .tab = router.destination { return true }
      return false
    }()
    let selected = onHome && router.orgTab == tab
    return Button {
      ArrabHaptics.selection()
      router.orgTab = tab
      router.go(.tab(.chat))
    } label: {
      VStack(spacing: 6) {
        Image(systemName: icon)
          .font(ArrabFont.system(size: 18, weight: selected ? .semibold : .regular))
        Text(L10n.t(key, arabic: arabic))
          .font(ArrabFont.system(size: 12, weight: selected ? .semibold : .medium))
      }
      .foregroundStyle(selected ? theme.text : theme.muted)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 8)
    }
    .buttonStyle(.plain)
  }
}
