import SwiftUI

struct MeHomeView: View {
  enum Mode { case me, account }

  var mode: Mode = .me

  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var link: PCLinkStore
  @EnvironmentObject private var themeStore: ThemeStore
  @Environment(\.adaptive) private var adaptive
  @Environment(\.arrab) private var theme

  @Environment(\.scenePhase) private var scenePhase
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var router: ShellRouter
  @ObservedObject private var voices = CompanionVoiceStore.shared
  @State private var showLink = false
  @State private var memoryDraft = ""
  @State private var meTab = "profile"
  @State private var accountChip = "overview"
  @State private var connectorQuery = ""
  @State private var connectorFilter = "all"
  @StateObject private var connectorsModel = ConnectorsViewModel()

  private var arabic: Bool { session.localeIsArabic }
  private var wide: Bool { adaptive.isPhoneLandscape || adaptive.isPadLike }

  var body: some View {
    ScrollView {
      Group {
        if mode == .me {
          profilePage
        } else {
          accountSection
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.isPadLike ? 980 : .infinity)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .sheet(isPresented: $showLink) {
      LinkPCView()
        .environmentObject(link)
        .environmentObject(session)
        .presentationDetents([.medium, .large])
    }
    .sheet(item: $connectorsModel.tokenCard) { card in
      ConnectorTokenSheet(card: card, arabic: arabic) { token, label, config in
        try await connectorsModel.submitToken(card, token: token, label: label, config: config)
      }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active, meTab == "connectors" || mode == .account {
        Task { await connectorsModel.reload() }
      }
    }
  }

  private var profilePage: some View {
    VStack(alignment: .leading, spacing: 20) {
      identityCard
      meTabs
      Group {
        switch meTab {
        case "voice": voiceGroup
        case "memory": memoryGroup
        case "connectors": connectorsTab
        default: youGroup
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button { router.go(.account) } label: {
        HStack(spacing: 12) {
          Image(systemName: "person.crop.circle")
            .font(ArrabFont.system(size: 18, weight: .semibold))
            .foregroundStyle(theme.lavender)
          VStack(alignment: .leading, spacing: 2) {
            Text(arabic ? "الحساب والاشتراك" : "Account and plan")
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(session.account?.email ?? (arabic ? "إدارة الحساب" : "Manage the account"))
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
              .lineLimit(1)
          }
          Spacer()
          Image(systemName: "chevron.forward")
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.muted)
            .flipsForRightToLeftLayoutDirection(true)
        }
        .padding(14)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
      }
      .buttonStyle(.plain)
    }
  }

  private var memoryGroup: some View {
    VStack(alignment: .leading, spacing: 8) {
      meCaption(arabic ? "الذاكرة" : "Memory")
      meInset {
        TextField(L10n.t(.rememberPlaceholder, arabic: arabic), text: $memoryDraft, axis: .vertical)
          .lineLimit(1...3)
          .font(ArrabFont.system(size: 16))
          .foregroundStyle(theme.text)
          .multilineTextAlignment(arabic ? .trailing : .leading)
          .padding(.vertical, 6)
        meLine
        HStack {
          Text(arabic ? "يُحفظ لهذا الرفيق" : "Saved for the selected companion")
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
          Spacer()
          Button(action: addMemory) {
            Text(L10n.t(.add, arabic: arabic))
              .font(ArrabFont.system(size: 14, weight: .semibold))
              .foregroundStyle(canAddMemory ? theme.onPrimary : theme.muted)
          }
          .buttonStyle(.plain)
          .disabled(!canAddMemory)
        }
        .padding(.vertical, 8)
      }
      meFoot(arabic ? "الرفاق يستخدمون ما تحفظه في الرد التالي." : "Companions use what you save on the next reply.")
      if shownFacts.isEmpty {
        Text(arabic ? "لا شيء محفوظ بعد." : "Nothing saved yet.")
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)
          .padding(.horizontal, 4)
      }
      ForEach(shownFacts) { fact in
        meInset {
          VStack(alignment: .leading, spacing: 8) {
            Text(fact.text)
              .font(ArrabFont.system(size: 16))
              .foregroundStyle(theme.text)
            HStack {
              Text(fact.meta)
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
              Spacer()
              Button {
                voices.removeFact(fact.text, for: fact.companionId)
              } label: {
                Image(systemName: "trash")
                  .font(ArrabFont.system(size: 13, weight: .semibold))
                  .foregroundStyle(theme.danger)
              }
              .buttonStyle(.plain)
            }
          }
          .padding(.vertical, 8)
        }
      }
    }
  }

  private var canAddMemory: Bool {
    !memoryDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private struct ShownFact: Identifiable {
    let id: String
    let companionId: String
    let text: String
    let meta: String
    let stored: Bool
  }

  private var shownFacts: [ShownFact] {
    voices.remembered().map { fact in
      let name = companions.companions.first { $0.id == fact.id }?.displayName(arabic: arabic) ?? fact.id
      return ShownFact(id: fact.id + fact.text, companionId: fact.id, text: fact.text, meta: name, stored: true)
    }
  }

  private var meTabs: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        meTabButton("profile", arabic ? "الملف" : "Profile", "person.crop.circle")
        meTabButton("voice", arabic ? "الصوت" : "Voice", "waveform")
        meTabButton("memory", arabic ? "الذاكرة" : "Memory", "brain")
        meTabButton("connectors", arabic ? "الموصلات" : "Connectors", "cable.connector")
      }
    }
  }

  private func meTabButton(_ id: String, _ title: String, _ symbol: String) -> some View {
    let on = meTab == id
    return Button {
      withAnimation(.easeOut(duration: 0.2)) { meTab = id }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: symbol)
          .font(ArrabFont.system(size: 13, weight: .semibold))
        Text(title)
          .font(ArrabFont.system(size: 14, weight: .semibold))
      }
      .foregroundStyle(on ? theme.onPrimary : theme.text)
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      .background(on ? theme.primary : theme.card)
      .clipShape(Capsule())
      .overlay(Capsule().stroke(on ? Color.clear : theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private var shownName: String {
    let custom = session.profilePrefs.callName.trimmingCharacters(in: .whitespacesAndNewlines)
    if !custom.isEmpty { return custom }
    return session.account?.displayName ?? L10n.t(.previewAccount, arabic: arabic)
  }

  private var identityCard: some View {
    VStack(spacing: 12) {
      Text(initials)
        .font(ArrabFont.system(size: 36, weight: .semibold))
        .foregroundStyle(theme.text)
        .frame(width: 96, height: 96)
        .background(
          LinearGradient(
            colors: [theme.lavender.opacity(0.55), theme.lavenderSoft],
            startPoint: .top,
            endPoint: .bottom
          )
        )
        .clipShape(Circle())
        .overlay(Circle().stroke(theme.lavender.opacity(0.55), lineWidth: 1))
      Text(shownName)
        .font(ArrabFont.system(size: wide ? 34 : 28, weight: .semibold))
        .foregroundStyle(theme.text)
        .multilineTextAlignment(.center)
      Text(session.account?.email ?? "")
        .font(ArrabFont.system(size: 15))
        .foregroundStyle(theme.muted)
        .lineLimit(1)
      Text(planLabel)
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.lavender)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(theme.lavenderSoft)
        .clipShape(Capsule())
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 8)
  }

  private var connectorsTab: some View {
    let linked = connectorsModel.cards.filter(\.connected).count
    let shown = filteredConnectors
    return VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 4) {
          Text(arabic ? "الموصلات" : "Connectors")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.lavender)
          Text(arabic ? "اربط الأدوات التي يستخدمها الرفاق." : "Link the tools your companions can use.")
            .font(ArrabFont.system(size: 15))
            .foregroundStyle(theme.muted)
        }
        Spacer()
        if linked > 0 {
          Text(arabic ? "\(linked) متصل" : "\(linked) linked")
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.lavender)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(theme.lavenderSoft)
            .clipShape(Capsule())
        }
      }

      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .foregroundStyle(theme.muted)
        TextField(arabic ? "ابحث" : "Search", text: $connectorQuery)
          .font(ArrabFont.system(size: 16))
          .foregroundStyle(theme.text)
      }
      .padding(12)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(theme.line, lineWidth: 1))

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          connectorFilterChip("all", arabic ? "الكل" : "All")
          connectorFilterChip("comms", arabic ? "التواصل" : "Messages")
          connectorFilterChip("dev", arabic ? "التطوير" : "Code")
          connectorFilterChip("workspace", arabic ? "العمل" : "Workspace")
          connectorFilterChip("health", arabic ? "الصحة" : "Health")
          connectorFilterChip("markets", arabic ? "الأسواق" : "Markets")
        }
      }

      if let error = connectorsModel.error {
        Text(error)
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.warn)
      }

      if connectorsModel.isBusy && connectorsModel.cards.isEmpty {
        ProgressView().tint(theme.lavender)
      } else if shown.isEmpty {
        Text(arabic ? "ما فيه موصلات في هذا التبويب." : "Nothing in this tab.")
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)
      } else {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
          ForEach(shown) { card in
            connectorRow(card)
          }
        }
      }
    }
    .task { await connectorsModel.reload() }
  }

  private var filteredConnectors: [ConnectorCardModel] {
    connectorsModel.cards.filter { card in
      if connectorFilter != "all" && connectorLane(card.provider) != connectorFilter { return false }
      let q = connectorQuery.trimmingCharacters(in: .whitespacesAndNewlines)
      if q.isEmpty { return true }
      let title = arabic ? card.titleAr : card.title
      return title.localizedCaseInsensitiveContains(q) || card.provider.localizedCaseInsensitiveContains(q)
    }
  }

  private func connectorLane(_ provider: String) -> String {
    switch provider {
    case "gmail", "outlook", "email", "slack", "whatsapp": return "comms"
    case "github", "gitlab", "bitbucket", "ssh": return "dev"
    case "linear", "notion", "google_drive", "google_calendar", "figma", "files": return "workspace"
    case "whoop", "fitbit": return "health"
    case "finnhub": return "markets"
    default: return "workspace"
    }
  }

  private func connectorFilterChip(_ id: String, _ title: String) -> some View {
    let on = connectorFilter == id
    return Button { connectorFilter = id } label: {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(on ? theme.onPrimary : theme.text)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(on ? theme.lavender : theme.card)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(on ? Color.clear : theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private func connectorRow(_ card: ConnectorCardModel) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        ConnectorGlyph(provider: card.provider, logoUrl: card.logoUrl, size: 40)
        Spacer(minLength: 0)
        if card.connected {
          Image(systemName: "checkmark.circle.fill")
            .foregroundStyle(theme.success)
        }
      }
      Text(arabic ? card.titleAr : card.title)
        .font(ArrabFont.system(size: 15, weight: .semibold))
        .foregroundStyle(theme.text)
        .lineLimit(1)
      Text(arabic ? card.bodyAr : card.body)
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
        .lineLimit(2)
        .frame(minHeight: 32, alignment: .topLeading)
      Button {
        Task {
          if card.connected { await connectorsModel.disconnect(card) }
          else { await connectorsModel.connect(card) }
        }
      } label: {
        Text(card.connected ? (arabic ? "فصل" : "Disconnect") : (arabic ? "ربط" : "Connect"))
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(card.connected ? theme.text : theme.onPrimary)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .background(card.connected ? theme.subtle : theme.primary)
          .clipShape(Capsule())
      }
      .buttonStyle(.plain)
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(card.connected ? theme.lavenderSoft.opacity(0.55) : theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(card.connected ? theme.lavender.opacity(0.7) : theme.line, lineWidth: 1)
    )
  }

  private var youGroup: some View {
    VStack(alignment: .leading, spacing: 8) {
      meCaption(arabic ? "عنك" : "About you")
      meInset {
        profileField(arabic ? "الاسم" : "Name", hint: arabic ? "كيف يناديك الرفاق" : "What companions call you", text: callName)
        meLine
        profileField(arabic ? "نبذة" : "About", hint: arabic ? "سطر يعرّفك" : "A line that introduces you", text: aboutYou)
        meLine
        profileField(arabic ? "التركيز" : "Focus", hint: arabic ? "ما تعمل عليه الآن" : "What you are working on", text: focusLine)
      }
      meFoot(arabic ? "الرفاق يستخدمون هذا في الرد التالي." : "Companions use this on the next reply.")
    }
  }

  private var voiceGroup: some View {
    VStack(alignment: .leading, spacing: 8) {
      meCaption(arabic ? "الصوت" : "Voice")
      meInset {
        VStack(alignment: .leading, spacing: 10) {
          Text(arabic ? "طول الرد" : "Reply length")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.muted)
          chipRow(
            [
              ("brief", arabic ? "قصير" : "Brief"),
              ("balanced", arabic ? "متوازن" : "Balanced"),
              ("full", arabic ? "مفصّل" : "Full"),
            ],
            selected: session.profilePrefs.reply
          ) { session.profilePrefs.reply = $0 }
        }
        .padding(.vertical, 4)
        meLine
        VStack(alignment: .leading, spacing: 10) {
          Text(arabic ? "الأسلوب" : "Tone")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.muted)
          chipRow(
            [
              ("warm", arabic ? "دافئ" : "Warm"),
              ("direct", arabic ? "مباشر" : "Direct"),
              ("formal", arabic ? "مهذب" : "Formal"),
            ],
            selected: session.profilePrefs.tone
          ) { session.profilePrefs.tone = $0 }
        }
        .padding(.vertical, 4)
        meLine
        VStack(alignment: .leading, spacing: 10) {
          Text(arabic ? "اللغة" : "Language")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.muted)
          Picker(arabic ? "اللغة" : "Language", selection: $session.localeIsArabic) {
            Text("English").tag(false)
            Text("العربية").tag(true)
          }
          .pickerStyle(.segmented)
        }
        .padding(.vertical, 4)
      }
      meFoot(arabic ? "العربية تُجاب بلهجة سعودية بيضاء." : "Arabic replies use a clear Saudi accent.")
    }
  }

  private func meCaption(_ title: String) -> some View {
    Text(title)
      .font(ArrabFont.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.muted)
      .textCase(.uppercase)
      .padding(.horizontal, 4)
  }

  private func meFoot(_ title: String) -> some View {
    Text(title)
      .font(ArrabFont.system(size: 12))
      .foregroundStyle(theme.muted)
      .padding(.horizontal, 4)
  }

  private func meInset<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      content()
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .stroke(theme.line.opacity(0.9), lineWidth: 0.5)
    )
  }

  private var meLine: some View {
    Rectangle()
      .fill(theme.line)
      .frame(height: 0.5)
      .padding(.vertical, 8)
  }

  private var callName: Binding<String> {
    Binding(get: { session.profilePrefs.callName }, set: { session.profilePrefs.callName = $0 })
  }

  private var aboutYou: Binding<String> {
    Binding(get: { session.profilePrefs.about }, set: { session.profilePrefs.about = $0 })
  }

  private var focusLine: Binding<String> {
    Binding(get: { session.profilePrefs.focus }, set: { session.profilePrefs.focus = $0 })
  }

  private func profileField(_ title: String, hint: String, text: Binding<String>) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.muted)
      TextField(hint, text: text)
        .font(ArrabFont.system(size: 17))
        .foregroundStyle(theme.text)
    }
    .padding(.vertical, 6)
  }

  private func chipRow(_ items: [(String, String)], selected: String, choose: @escaping (String) -> Void) -> some View {
    HStack(spacing: 8) {
      ForEach(items, id: \.0) { item in
        let on = selected == item.0
        Button { choose(item.0) } label: {
          Text(item.1)
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(on ? theme.onPrimary : theme.text)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(on ? theme.primary : theme.subtle)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(on ? Color.clear : theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
      }
    }
  }

  private var knowledgeColumn: some View {
    let facts = voices.remembered()
    return VStack(alignment: .leading, spacing: 8) {
      meCaption(L10n.t(.knowsAboutYou, arabic: arabic))
      meInset {
        HStack(spacing: 10) {
          TextField(L10n.t(.rememberPlaceholder, arabic: arabic), text: $memoryDraft)
            .font(ArrabFont.system(size: 17))
            .foregroundStyle(theme.text)
          Button(action: addMemory) {
            Image(systemName: "plus.circle.fill")
              .font(ArrabFont.system(size: 22))
              .foregroundStyle(memoryDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? theme.muted : theme.lavender)
          }
          .buttonStyle(.plain)
          .disabled(memoryDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          .accessibilityLabel(L10n.t(.add, arabic: arabic))
        }
        .padding(.vertical, 8)
        if facts.isEmpty {
          Text(arabic ? "ما فيه شيء محفوظ بعد." : "Nothing is saved yet.")
            .font(ArrabFont.system(size: 15))
            .foregroundStyle(theme.muted)
            .padding(.bottom, 8)
        } else {
          ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
            meLine
            knowledgeRow(companionId: fact.id, text: fact.text)
          }
        }
      }
      meFoot(L10n.t(.knowsHint, arabic: arabic))
    }
  }

  private func knowledgeRow(companionId: String, text: String) -> some View {
    let name = companions.companions.first { $0.id == companionId }?.displayName(arabic: arabic)
      ?? (arabic ? "عام" : "General")
    return HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(text)
          .font(ArrabFont.system(size: 16))
          .foregroundStyle(theme.text)
        Text(name)
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.lavender)
      }
      Spacer(minLength: 8)
      Button {
        voices.removeFact(text, for: companionId)
      } label: {
        Image(systemName: "minus.circle.fill")
          .font(ArrabFont.system(size: 20))
          .foregroundStyle(theme.danger)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(L10n.t(.delete, arabic: arabic))
    }
    .padding(.vertical, 8)
  }

  private func addMemory() {
    let text = memoryDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    voices.addFact(text, for: companions.selected.id)
    memoryDraft = ""
  }

  private var planLabel: String {
    let plan = session.entitlements?.planId?.replacingOccurrences(of: "_", with: " ")
    if let plan, !plan.isEmpty { return plan.capitalized }
    switch session.studioRole {
    case .family: return arabic ? "عائلة" : "Family"
    case .organization: return arabic ? "منظمة" : "Organization"
    case .individual: return arabic ? "فردي" : "Individual"
    }
  }

  private var accountSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      if mode == .account {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 6) {
            Text(L10n.t(.account, arabic: arabic))
              .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(arabic ? "إدارة الملف والخطة والاستخدام والأمان." : "Manage profile, plan, usage, and security.")
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.muted)
          }
          Spacer()
          Button {
          } label: {
            Image(systemName: "arrow.clockwise")
              .font(ArrabFont.system(size: 16, weight: .medium))
              .foregroundStyle(theme.muted)
          }
          .buttonStyle(.plain)
        }
      }

      ArrabCard {
        VStack(alignment: .leading, spacing: 14) {
          HStack {
            Text(String(shownName.prefix(1)))
              .font(ArrabFont.system(size: 16, weight: .semibold))
              .frame(width: 44, height: 44)
              .background(theme.subtle)
              .clipShape(Circle())
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
              Text(shownName)
                .font(ArrabFont.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(session.account?.email ?? "preview@example.test")
                .font(ArrabFont.system(size: 13))
                .foregroundStyle(theme.muted)
            }
          }
          LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            accountPill("overview", arabic ? "نظرة عامة" : "Overview", "circle.grid.2x2")
            accountPill("profile", arabic ? "الملف" : "Profile", "person")
            accountPill("usage", L10n.t(.usage, arabic: arabic), "chart.bar")
            accountPill("plan", arabic ? "الخطة والفوترة" : "Plan and billing", "creditcard")
            accountPill("security", arabic ? "الأمان" : "Security", "shield")
          }
        }
      }

      if accountChip == "overview" || mode != .account {
        overviewCards
      } else if accountChip == "profile" {
        youGroup
      } else if accountChip == "security" {
        securityCards
      } else {
        ArrabCard {
          Text(accountChip == "plan" ? planLabel : L10n.t(.thisPeriod, arabic: arabic))
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.text)
        }
      }
    }
  }

  private func accountPill(_ id: String, _ title: String, _ icon: String) -> some View {
    let on = accountChip == id
    return Button { accountChip = id } label: {
      HStack(spacing: 6) {
        Image(systemName: icon).font(ArrabFont.system(size: 12, weight: .semibold))
        Text(title).font(ArrabFont.system(size: 13, weight: .semibold)).lineLimit(1)
      }
      .foregroundStyle(on ? theme.onPrimary : theme.text)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(on ? theme.primary : theme.card)
      .clipShape(Capsule())
      .overlay(Capsule().stroke(on ? Color.clear : theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private var overviewCards: some View {
    VStack(alignment: .leading, spacing: 16) {
      ArrabCard {
        VStack(alignment: .leading, spacing: 12) {
          HStack {
            Text(String(shownName.prefix(1)))
              .font(ArrabFont.system(size: 16, weight: .semibold))
              .frame(width: 44, height: 44)
              .background(theme.lavenderSoft)
              .clipShape(Circle())
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
              Text(shownName)
                .font(ArrabFont.system(size: 18, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(session.account?.email ?? "preview@example.test")
                .font(ArrabFont.system(size: 13))
                .foregroundStyle(theme.muted)
              Text(arabic ? "عضو منذ ٣ ربيع الآخر ١٤٤٨ هـ" : "Member since")
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
            }
          }
          HStack(spacing: 8) {
            Button { accountChip = "profile" } label: {
              Text(arabic ? "تعديل الملف" : "Edit profile")
                .font(ArrabFont.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .overlay(Capsule().stroke(theme.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            Button { accountChip = "plan" } label: {
              Text(arabic ? "إدارة الخطة" : "Manage plan")
                .font(ArrabFont.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.onPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(theme.primary)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
          }
        }
      }

      ArrabCard {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Text("active")
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.text)
              .padding(.horizontal, 10)
              .padding(.vertical, 6)
              .background(theme.subtle)
              .clipShape(Capsule())
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
              Text(arabic ? "الخطة الحالية" : "Current plan")
                .font(ArrabFont.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(arabic ? "العضوية النشطة لهذا الاستوديو." : "The active membership for this studio.")
                .font(ArrabFont.system(size: 13))
                .foregroundStyle(theme.muted)
            }
          }
          Text(session.entitlements?.planId?.isEmpty == false ? planLabel : "Pro")
            .font(ArrabFont.system(size: 28, weight: .semibold))
            .foregroundStyle(theme.text)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
      }
    }
  }

  private var securityCards: some View {
    VStack(alignment: .leading, spacing: 16) {
      ArrabCard {
        HStack(spacing: 12) {
          Circle()
            .fill(theme.subtle)
            .frame(width: 48, height: 48)
            .overlay {
              Text(initials)
                .font(ArrabFont.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
            }
          VStack(alignment: .leading, spacing: 4) {
            Text(session.account?.displayName ?? L10n.t(.previewAccount, arabic: arabic))
              .font(ArrabFont.system(size: 16, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(session.account?.email ?? "")
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.muted)
          }
        }
      }

      ManagedPrivacyCard()

      ArrabCard {
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Label("PC link", systemImage: "laptopcomputer.and.iphone")
              .foregroundStyle(theme.text)
            Spacer()
            Text(link.isLinked ? "On" : "Off")
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(link.isLinked ? theme.success : theme.muted)
          }
          if link.isLinked {
            Text(link.pcHostLabel)
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
          }
          Button("Manage PC connection") { showLink = true }
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.text)
        }
      }

      Toggle(isOn: $session.localeIsArabic) {
        Text(arabic ? L10n.t(.switchToEnglish, arabic: true) : L10n.t(.switchToArabic, arabic: false))
          .foregroundStyle(theme.text)
      }
      .tint(theme.lavender)

      Toggle(isOn: Binding(
        get: { themeStore.mode == .dark },
        set: { themeStore.mode = $0 ? .dark : .system }
      )) {
        Text(
          themeStore.mode == .dark
            ? L10n.t(.switchToLight, arabic: arabic)
            : L10n.t(.switchToDark, arabic: arabic)
        )
        .foregroundStyle(theme.text)
      }
      .tint(theme.lavender)

      Button {
        Task { await session.signOut() }
      } label: {
        Text("Sign out")
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
          .foregroundStyle(theme.danger)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
          .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .stroke(theme.line, lineWidth: 1)
          )
      }
      .buttonStyle(.plain)

      ArrabCard {
        LegalLinksView()
      }

      if mode == .account {
        ArrabCard {
          DeleteAccountSection()
        }
      }
    }
  }

  private var initials: String {
    let name = session.account?.displayName ?? session.account?.email ?? "A"
    let parts = name.split(separator: " ")
    if parts.count >= 2 {
      return String(parts[0].prefix(1) + parts[1].prefix(1)).uppercased()
    }
    return String(name.prefix(2)).uppercased()
  }
}

struct MemoryFact: Identifiable, Equatable {
  let id: String
  let text: String
  let textAr: String
  let meta: String
  let metaAr: String
}














