import LocalAuthentication
import SwiftUI
import UserNotifications

enum SettingsSection: String, Identifiable, Hashable {
  case profile, usage, plans, credit, appearance, intelligence, localModels, notifications, privacy, about

  var id: String { rawValue }

  var symbol: String {
    switch self {
    case .profile: return "person.crop.circle"
    case .usage: return "chart.bar"
    case .plans: return "creditcard"
    case .credit: return "plus.circle"
    case .appearance: return "circle.lefthalf.filled"
    case .intelligence: return "sparkles"
    case .localModels: return "cpu"
    case .notifications: return "bell"
    case .privacy: return "lock"
    case .about: return "info.circle"
    }
  }

  func title(arabic: Bool) -> String {
    switch self {
    case .profile: return arabic ? "الملف" : "Profile"
    case .usage: return L10n.t(.usage, arabic: arabic)
    case .plans: return arabic ? "الاشتراك" : "Subscription"
    case .credit: return arabic ? "إضافة رصيد" : "Add credit"
    case .appearance: return L10n.t(.appearance, arabic: arabic)
    case .intelligence: return L10n.t(.intelligence, arabic: arabic)
    case .localModels: return L10n.t(.localModels, arabic: arabic)
    case .notifications: return L10n.t(.notifications, arabic: arabic)
    case .privacy: return L10n.t(.privacy, arabic: arabic)
    case .about: return L10n.t(.about, arabic: arabic)
    }
  }

  func detail(arabic: Bool) -> String {
    switch self {
    case .profile: return arabic ? "الاسم والأسلوب واللغة" : "Name, tone, and language"
    case .usage: return arabic ? "النسبة وهذه الفترة" : "Percent and this period"
    case .plans: return arabic ? "الخطة والتجديد" : "Plan and renewal"
    case .credit: return arabic ? "مبلغ بالريال وباقات" : "An amount in SAR, and packs"
    case .appearance: return arabic ? "فاتح أو داكن" : "Light or dark"
    case .intelligence: return arabic ? "نموذج المحادثة وطريقة الرد" : "Chat model and how it replies"
    case .localModels: return arabic ? "جيما ولاما والمزيد" : "Gemma, Llama, and more"
    case .notifications: return arabic ? "ما يصلك" : "What reaches you"
    case .privacy: return arabic ? "القفل والحساب" : "Lock and account"
    case .about: return arabic ? "الإصدار والقانون" : "Version and legal"
    }
  }
}

struct SettingsHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var themeStore: ThemeStore
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var notifyPrefs: NotificationPrefsStore
  @EnvironmentObject private var lock: AppLockStore
  @EnvironmentObject private var companions: CompanionSpaceStore
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.openURL) private var openURL
  @Environment(\.scenePhase) private var scenePhase

  @State private var openSection: SettingsSection?
  @State private var usage: UsageSnapshot?
  @State private var usageError = false
  @State private var usageScope = "all"
  @State private var billing: BillingAccountStatus?
  @State private var catalog: BillingCatalog?
  @State private var billingNote: String?
  @State private var buying: String?
  @State private var creditAmount = ""
  @State private var accountNameDraft = ""
  @State private var savingName = false
  @State private var nameNote: String?
  @State private var notifyAuth: UNAuthorizationStatus = .notDetermined
  @State private var refreshingUsage = false
  @State private var profileNote: String?
  @State private var savingProfile = false
  @ObservedObject private var cloudModels = CloudModelStore.shared

  private var arabic: Bool { session.localeIsArabic }
  private var wide: Bool { adaptive.isPhoneLandscape || adaptive.isPadLike }

  private var groups: [(String, [SettingsSection])] {
    [
      (arabic ? "الحساب" : "Account", [.profile, .usage, .plans, .credit]),
      (arabic ? "الاستوديو" : "Studio", [.appearance, .intelligence, .localModels, .notifications]),
      (arabic ? "النظام" : "System", [.privacy, .about]),
    ]
  }

  var body: some View {
    Group {
      if wide {
        HStack(spacing: 0) {
          listColumn
            .frame(width: adaptive.isPhoneLandscape ? 260 : 320)
            .background(theme.bg)
          Rectangle().fill(theme.line).frame(width: 1)
          detail(openSection ?? .profile)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        NavigationStack {
          listColumn
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $openSection) { section in
              detail(section)
            }
        }
      }
    }
    .background(theme.bg)
  }

  private var listColumn: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(alignment: .leading, spacing: 6) {
          Text(L10n.t(.settings, arabic: arabic))
            .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(L10n.t(.settingsSubtitle, arabic: arabic))
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
          LinearGradient(
            colors: [theme.lavender.opacity(0.28), theme.lavenderSoft.opacity(0.55), theme.card],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
            .stroke(theme.lavender.opacity(0.45), lineWidth: 1)
        )

        accountCard

        ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
          VStack(alignment: .leading, spacing: 8) {
            Text(group.0)
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.lavender)
              .padding(.horizontal, 4)
            VStack(spacing: 0) {
              ForEach(Array(group.1.enumerated()), id: \.element) { index, section in
                Button {
                  openSection = section
                } label: {
                  settingsRow(section, selected: wide && (openSection ?? .profile) == section)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if index < group.1.count - 1 {
                  Rectangle()
                    .fill(theme.line)
                    .frame(height: 1)
                    .padding(.leading, 64)
                }
              }
            }
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
            .overlay(
              RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
                .stroke(theme.line, lineWidth: 1)
            )
          }
        }

        Button {
          Task { await session.signOut() }
        } label: {
          HStack(spacing: 12) {
            Image(systemName: "rectangle.portrait.and.arrow.right")
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.danger)
              .frame(width: 36, height: 36)
              .background(theme.danger.opacity(0.12))
              .clipShape(Circle())
            Text(ManagedStrings.t(.signOut, arabic: arabic))
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.danger)
            Spacer(minLength: 8)
          }
          .padding(.horizontal, 14)
          .padding(.vertical, 12)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
          .overlay(
            RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
              .stroke(theme.line, lineWidth: 1)
          )
        }
        .buttonStyle(.plain)
        .padding(.top, 8)
      }
      .padding(adaptive.gutter)
      .padding(.bottom, 24)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(theme.bg)
    .task { await refreshAccount() }
  }

  private var accountCard: some View {
    let name = session.account?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
    let shown = (name?.isEmpty == false ? name : nil) ?? session.account?.email ?? (arabic ? "حسابك" : "Your account")
    let plan = session.entitlements?.planName ?? session.account?.planName ?? planTitle(session.entitlements?.planId ?? session.account?.planId)
    let pct = usagePercent(used: usage?.entitlements?.tokensUsed ?? session.entitlements?.tokensUsed ?? 0, limit: usage?.entitlements?.tokenLimit ?? session.entitlements?.tokenLimit)
    return Button {
      openSection = .profile
    } label: {
      HStack(spacing: 14) {
        Text(String(shown.prefix(1)).uppercased())
          .font(ArrabFont.system(size: 20, weight: .semibold))
          .foregroundStyle(theme.onPrimary)
          .frame(width: 52, height: 52)
          .background(theme.primary)
          .clipShape(Circle())
        VStack(alignment: .leading, spacing: 4) {
          Text(shown)
            .font(ArrabFont.system(size: 17, weight: .semibold))
            .foregroundStyle(theme.text)
            .lineLimit(1)
          Text(session.account?.email ?? "")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
            .lineLimit(1)
          HStack(spacing: 8) {
            Text(plan)
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.lavender)
            if let pct {
              Text("\(pct)%")
                .font(ArrabFont.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.muted)
            }
          }
        }
        Spacer(minLength: 8)
        Image(systemName: "chevron.forward")
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.muted)
          .flipsForRightToLeftLayoutDirection(true)
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(theme.line, lineWidth: 1)
      )
    }
    .buttonStyle(.plain)
  }

  private func refreshAccount() async {
    if let status = try? await ArrabAPIClient.shared.account() {
      session.account = status.account
      session.entitlements = status.entitlements
      if accountNameDraft.isEmpty {
        accountNameDraft = status.account?.displayName ?? ""
      }
    }
    await loadUsage()
    if catalog == nil { await loadBilling() }
  }

  private func tokenLabel(_ value: Double?) -> String {
    guard let value else { return "—" }
    if value >= 1_000_000 {
      let millions = value / 1_000_000
      return millions >= 10 ? "\(Int(millions.rounded()))M" : String(format: "%.1fM", millions)
    }
    if value >= 1_000 {
      return "\(Int((value / 1_000).rounded()))K"
    }
    return "\(Int(value.rounded()))"
  }

  private func settingsRow(_ section: SettingsSection, selected: Bool) -> some View {
    HStack(spacing: 12) {
      Image(systemName: section.symbol)
        .font(ArrabFont.system(size: 15, weight: .semibold))
        .foregroundStyle(theme.lavender)
        .frame(width: 36, height: 36)
        .background(theme.lavenderSoft)
        .clipShape(Circle())
        .overlay(Circle().stroke(selected ? theme.lavender : Color.clear, lineWidth: 1.5))
      VStack(alignment: .leading, spacing: 2) {
        Text(section.title(arabic: arabic))
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(section.detail(arabic: arabic))
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      Image(systemName: "chevron.forward")
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.lavender.opacity(0.85))
        .flipsForRightToLeftLayoutDirection(true)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .background(selected ? theme.lavenderSoft : Color.clear)
  }

  private func detail(_ section: SettingsSection) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 12) {
          Image(systemName: section.symbol)
            .font(ArrabFont.system(size: 18, weight: .semibold))
            .foregroundStyle(theme.lavender)
            .frame(width: 44, height: 44)
            .background(theme.lavenderSoft)
            .clipShape(Circle())
            .overlay(Circle().stroke(theme.lavender.opacity(0.7), lineWidth: 1.5))
          VStack(alignment: .leading, spacing: 3) {
            Text(section.title(arabic: arabic))
              .font(ArrabFont.system(size: 20, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(section.detail(arabic: arabic))
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.muted)
          }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
          LinearGradient(
            colors: [theme.lavenderSoft, theme.card],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
            .stroke(theme.lavender.opacity(0.35), lineWidth: 1)
        )

        switch section {
        case .profile: generalPanel
        case .usage: usagePanel
        case .plans: plansPanel
        case .credit: creditPanel
        case .appearance: appearancePanel
        case .intelligence: intelligencePanel
        case .localModels: LocalModelsPanel()
        case .notifications: notificationsPanel
        case .privacy: privacyPanel
        case .about: aboutPanel
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.isPadLike ? 720 : .infinity, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .navigationTitle(section.title(arabic: arabic))
    .navigationBarTitleDisplayMode(.inline)
    .toolbarBackground(theme.bg, for: .navigationBar)
    .toolbarBackground(.visible, for: .navigationBar)
  }

  private var usagePanel: some View {
    let entitlements = usage?.entitlements
    let pct = usagePercent(used: entitlements?.tokensUsed ?? 0, limit: entitlements?.tokenLimit)
    let level = entitlements?.overLimit == true ? "exhausted" : (entitlements?.usageLevel ?? levelFor(pct))
    return VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .center, spacing: 16) {
          usageRing(pct)
          VStack(alignment: .leading, spacing: 6) {
            Text(usageLevelTitle(level))
              .font(ArrabFont.system(size: 20, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(usagePaceLine(pct))
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.muted)
              .fixedSize(horizontal: false, vertical: true)
            if let end = periodLabel(entitlements?.periodEnd) {
              Text(arabic ? "يتجدد \(end)" : "Resets \(end)")
                .font(ArrabFont.system(size: 12, weight: .semibold))
                .foregroundStyle(usageLevelColor(level))
            }
          }
          Spacer(minLength: 0)
        }
        usageScale(pct)
        HStack(spacing: 8) {
          usageStat(arabic ? "المستخدم" : "Used", tokenLabel(entitlements?.tokensUsed))
          usageStat(arabic ? "الحد" : "Limit", tokenLabel(entitlements?.tokenLimit))
          usageStat(arabic ? "المتبقي" : "Left", tokenLabel(entitlements?.tokensRemaining))
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        LinearGradient(
          colors: [theme.lavender.opacity(0.28), theme.lavenderSoft, theme.card],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(theme.lavender.opacity(0.45), lineWidth: 1)
      )

      profileGroup(arabic ? "هذه الفترة" : "This period") {
        HStack {
          Text(arabic ? "الردود السحابية" : "Cloud replies")
            .foregroundStyle(theme.text)
          Spacer()
          Text("\(usage?.totals.events ?? 0)")
            .font(ArrabFont.system(size: 15, weight: .semibold))
            .foregroundStyle(theme.lavender)
        }
        if let input = usage?.totals.inputTokens {
          HStack {
            Text(arabic ? "رموز الدخول" : "Input tokens")
              .foregroundStyle(theme.text)
            Spacer()
            Text(tokenLabel(input))
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.lavender)
          }
        }
        if let output = usage?.totals.outputTokens {
          HStack {
            Text(arabic ? "رموز الخروج" : "Output tokens")
              .foregroundStyle(theme.text)
            Spacer()
            Text(tokenLabel(output))
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.lavender)
          }
        }
        if (entitlements?.topUpTokens ?? 0) > 0 {
          Text(arabic ? "الرصيد المضاف محسوب داخل النسبة." : "Added credit is included in the percent.")
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
        if usage == nil && !usageError {
          ProgressView().tint(theme.lavender)
        } else if usageError && usage == nil {
          Text(arabic ? "تعذّر قراءة الاستخدام من الحساب." : "Couldn’t read usage from your account.")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
          Button(refreshingUsage ? "…" : (arabic ? "إعادة المحاولة" : "Try again")) {
            Task { await reloadUsage() }
          }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.lavender)
          .disabled(refreshingUsage)
        } else if (usage?.totals.events ?? 0) == 0 {
          Text(arabic ? "ما فيه استخدام سحابي في هذه الفترة بعد." : "No cloud usage in this period yet.")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
        }
      }

      if let rows = usageShares, !rows.isEmpty {
        profileGroup(arabic ? "حصة الرفاق" : "Share by companion") {
          ForEach(rows, id: \.id) { row in
            usageBar(title: row.name, detail: arabic ? "\(row.events) رد" : "\(row.events) replies", percent: row.percent)
          }
        }
      }

      if let models = modelShares, !models.isEmpty {
        profileGroup(arabic ? "حصة النماذج" : "Share by model") {
          ForEach(models, id: \.id) { row in
            usageBar(title: row.name, detail: nil, percent: row.percent)
          }
        }
      }

      profileGroup(arabic ? "آخر النشاط" : "Recent activity") {
        HStack(spacing: 8) {
          usageChip("all", arabic ? "الكل" : "All")
          usageChip("arrab", "Arrab")
          usageChip("other", arabic ? "غيره" : "Other")
        }
        let recent = filteredRecent
        if recent.isEmpty {
          Text(arabic ? "ما فيه نشاط في هذا الخيار." : "Nothing in this view yet.")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
        } else {
          ForEach(recent) { item in
            HStack {
              Text(modelTitle(item.model))
                .font(ArrabFont.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.text)
                .lineLimit(1)
              Spacer()
              VStack(alignment: .trailing, spacing: 2) {
                Text(tokenLabel(item.weight))
                  .font(ArrabFont.system(size: 12, weight: .semibold))
                  .foregroundStyle(theme.lavender)
                Text(activityWhen(item.createdAt))
                  .font(ArrabFont.system(size: 12))
                  .foregroundStyle(theme.muted)
              }
            }
          }
        }
      }
    }
    .task {
      await loadUsage()
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(12))
        if Task.isCancelled { break }
        await loadUsage()
      }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        Task { await loadUsage() }
      }
    }
  }

  private func usageStat(_ title: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title)
        .font(ArrabFont.system(size: 11, weight: .semibold))
        .foregroundStyle(theme.muted)
      Text(value)
        .font(ArrabFont.system(size: 16, weight: .semibold))
        .foregroundStyle(theme.text)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .background(theme.card.opacity(0.72))
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
  }

  private func usageScale(_ pct: Int?) -> some View {
    let value = CGFloat(pct ?? 0) / 100
    return VStack(alignment: .leading, spacing: 6) {
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(theme.subtle)
          Capsule()
            .fill(theme.lavender)
            .frame(width: max(8, geo.size.width * value))
          Circle()
            .fill(theme.warn)
            .frame(width: 6, height: 6)
            .offset(x: geo.size.width * 0.8 - 3)
          Circle()
            .fill(theme.danger)
            .frame(width: 6, height: 6)
            .offset(x: geo.size.width * 0.95 - 3)
        }
      }
      .frame(height: 8)
      HStack {
        Text("0%")
        Spacer()
        Text("80%")
        Spacer()
        Text("100%")
      }
      .font(ArrabFont.system(size: 10, weight: .semibold))
      .foregroundStyle(theme.muted)
    }
  }

  private func usageBar(title: String, detail: String?, percent: Int) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(title)
          .font(ArrabFont.system(size: 14, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer()
        if let detail {
          Text(detail)
            .font(ArrabFont.system(size: 11))
            .foregroundStyle(theme.muted)
        }
        Text("\(percent)%")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.lavender)
      }
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(theme.subtle)
          Capsule()
            .fill(theme.lavender)
            .frame(width: geo.size.width * CGFloat(percent) / 100)
        }
      }
      .frame(height: 8)
    }
  }

  private func usageChip(_ id: String, _ title: String) -> some View {
    let on = usageScope == id
    return Button {
      usageScope = id
    } label: {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(on ? theme.onPrimary : theme.text)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(on ? theme.primary : theme.subtle)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private func usageRing(_ pct: Int?) -> some View {
    let value = pct ?? 0
    let color = value >= 100 ? theme.danger : value >= 80 ? theme.warn : theme.lavender
    return ZStack {
      Circle().stroke(theme.subtle, lineWidth: 8)
      Circle()
        .trim(from: 0, to: CGFloat(value) / 100)
        .stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
        .rotationEffect(.degrees(-90))
      Text(pct == nil ? "—" : "\(value)%")
        .font(ArrabFont.system(size: 16, weight: .semibold))
        .foregroundStyle(theme.text)
    }
    .frame(width: 84, height: 84)
  }

  private var usageShares: [(name: String, percent: Int, events: Int, id: String)]? {
    guard let rows = usage?.byAgent, !rows.isEmpty else { return nil }
    let total = rows.reduce(0) { $0 + $1.weight }
    guard total > 0 else { return nil }
    return rows.prefix(6).map { row in
      let percent = Int(((row.weight / total) * 100).rounded())
      return (name: companionName(row.agentId), percent: percent, events: row.events, id: row.id)
    }
  }

  private var modelShares: [(name: String, percent: Int, id: String)]? {
    guard let rows = usage?.byProvider, !rows.isEmpty else { return nil }
    let total = rows.reduce(0) { $0 + $1.weight }
    guard total > 0 else { return nil }
    return rows.prefix(4).map { row in
      let percent = Int(((row.weight / total) * 100).rounded())
      return (name: providerTitle(row.providerId), percent: percent, id: row.id)
    }
  }

  private var filteredRecent: [UsageSnapshot.RecentUse] {
    let rows = usage?.recent ?? []
    let picked: [UsageSnapshot.RecentUse]
    switch usageScope {
    case "arrab":
      picked = rows.filter { $0.model == AppSession.arrabModelId || $0.model.contains("deepseek-v4.1-flash") }
    case "other":
      picked = rows.filter { $0.model != AppSession.arrabModelId && !$0.model.contains("deepseek-v4.1-flash") }
    default:
      picked = rows
    }
    return Array(picked.prefix(6))
  }

  private func providerTitle(_ id: String) -> String {
    if id.isEmpty || id == "openrouter" { return arabic ? "سحابي" : "Cloud" }
    return id.replacingOccurrences(of: "-", with: " ").capitalized
  }

  private func daysLeftLabel(_ raw: String?) -> String {
    guard let raw, let date = ManagedRules.parseDate(raw) else { return "—" }
    let days = Calendar.current.dateComponents([.day], from: Date(), to: date).day ?? 0
    return "\(max(0, days))"
  }

  private func usagePaceLine(_ pct: Int?) -> String {
    guard let pct,
          let start = ManagedRules.parseDate(usage?.entitlements?.periodStart),
          let end = ManagedRules.parseDate(usage?.entitlements?.periodEnd),
          end > start else {
      return arabic ? "النسبة تُحدَّث من حسابك مباشرة." : "The percent updates live from your account."
    }
    let span = end.timeIntervalSince(start)
    let elapsed = min(100, max(0, Int((Date().timeIntervalSince(start) / span * 100).rounded())))
    if pct >= 100 {
      return arabic ? "النسبة اكتملت قبل نهاية الفترة." : "The percent is full before the period ends."
    }
    if pct > elapsed + 8 {
      return arabic ? "الاستخدام أسرع من سير الفترة." : "Usage is moving faster than the period."
    }
    if elapsed > pct + 8 {
      return arabic ? "الاستخدام أهدأ من سير الفترة." : "Usage is lighter than the period so far."
    }
    return arabic ? "الاستخدام يمشي مع الفترة." : "Usage is tracking the period."
  }

  private func activityWhen(_ raw: String) -> String {
    guard let date = ManagedRules.parseDate(raw) else { return periodLabel(raw) ?? "" }
    let day = date.formatted(date: .abbreviated, time: .omitted)
    let time = date.formatted(date: .omitted, time: .shortened)
    return "\(day) · \(time)"
  }

  private func companionName(_ id: String?) -> String {
    guard let id, !id.isEmpty else { return arabic ? "عام" : "General" }
    if let match = companions.companions.first(where: { $0.agentId == id || $0.id == id }) {
      return match.displayName(arabic: arabic)
    }
    return arabic ? "رفيق" : "Companion"
  }

  private func modelTitle(_ id: String) -> String {
    let raw = id.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty || raw == "auto" || raw == "arrab" || raw == "primary" { return "Arrab" }
    if raw == AppSession.arrabModelId || raw.hasSuffix("deepseek-v4.1-flash") { return "Arrab" }
    let tail = raw.split(separator: "/").last.map(String.init) ?? raw
    return tail.replacingOccurrences(of: "-", with: " ")
  }

  private func usagePercent(used: Double, limit: Double?) -> Int? {
    guard let limit, limit > 0 else { return nil }
    if used >= limit { return 100 }
    return min(100, max(0, Int((used / limit * 100).rounded())))
  }

  private func levelFor(_ pct: Int?) -> String {
    guard let pct else { return "ok" }
    if pct >= 100 { return "exhausted" }
    if pct >= 95 { return "critical" }
    if pct >= 80 { return "low" }
    return "ok"
  }

  private func usageLevelTitle(_ level: String) -> String {
    switch level {
    case "exhausted": return arabic ? "اكتملت الفترة" : "Full for this period"
    case "critical": return arabic ? "شبه مكتمل" : "Almost full"
    case "low": return arabic ? "اقترب الحد" : "Getting full"
    default: return arabic ? "ضمن الباقة" : "Within your plan"
    }
  }

  private func usageLevelColor(_ level: String) -> Color {
    switch level {
    case "exhausted": return theme.danger
    case "critical", "low": return theme.warn
    default: return theme.lavender
    }
  }

  private func periodLabel(_ raw: String?) -> String? {
    guard let raw, let date = ManagedRules.parseDate(raw) else { return nil }
    return date.formatted(date: .abbreviated, time: .omitted)
  }

  private func loadUsage() async {
    do {
      usage = try await ArrabAPIClient.shared.usage()
      usageError = false
    } catch {
      usageError = usage == nil
    }
  }

  private func reloadUsage() async {
    refreshingUsage = true
    defer { refreshingUsage = false }
    await loadUsage()
    if catalog == nil { await loadBilling() }
  }

  private var plansPanel: some View {
    let rights = billing?.entitlements
    let currentId = rights?.planId ?? billing?.account?.planId ?? session.entitlements?.planId
    let current = catalog?.plans.first { $0.id == currentId }
    let status = rights?.subscriptionStatus ?? billing?.account?.subscriptionStatus
    return VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(current?.name ?? planTitle(rights?.planName ?? currentId))
            .font(ArrabFont.system(size: 22, weight: .semibold))
            .foregroundStyle(theme.text)
          Spacer()
          Text(subscriptionStatusTitle(status, pause: rights?.pauseMode))
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.lavender)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(theme.lavenderSoft)
            .clipShape(Capsule())
        }
        Text(sarPrice(current?.monthlyPriceHalalas ?? 0) + (arabic ? " / شهر" : " / month"))
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.lavender)
        if let start = periodLabel(rights?.periodStart ?? billing?.account?.periodStart),
           let end = periodLabel(rights?.periodEnd ?? billing?.account?.periodEnd) {
          Text(arabic ? "من \(start) إلى \(end)" : "\(start) – \(end)")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
        }
        if let pause = rights?.pauseMode, pause == "payment_required" {
          Text(arabic ? "التجديد مستحق. أكمل الدفع لمتابعة المحادثة." : "Renewal is due. Complete payment to keep chatting.")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.warn)
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        LinearGradient(
          colors: [theme.lavender.opacity(0.22), theme.lavenderSoft, theme.card],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(theme.lavender.opacity(0.4), lineWidth: 1)
      )

      if let features = current?.features, !features.isEmpty {
        profileGroup(arabic ? "ما يشمله اشتراكك" : "Included in your plan") {
          ForEach(features, id: \.self) { feature in
            HStack(alignment: .top, spacing: 8) {
              Image(systemName: "checkmark")
                .font(ArrabFont.system(size: 12, weight: .bold))
                .foregroundStyle(theme.lavender)
              Text(planFeature(feature))
                .font(ArrabFont.system(size: 14))
                .foregroundStyle(theme.text)
            }
          }
        }
      }

      profileGroup(arabic ? "تغيير الخطة" : "Change plan") {
        if catalog == nil && billingNote == nil {
          ProgressView().tint(theme.lavender)
        }
        ForEach(catalog?.plans ?? []) { plan in
          let mine = plan.id == currentId
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
              Text(plan.name)
                .font(ArrabFont.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(planBlurb(plan))
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
                .lineLimit(2)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
              Text(sarPrice(plan.monthlyPriceHalalas))
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.lavender)
              if mine && rights?.pauseMode != "payment_required" {
                Text(arabic ? "الحالية" : "Current")
                  .font(ArrabFont.system(size: 12, weight: .semibold))
                  .foregroundStyle(theme.muted)
              } else {
                Button {
                  Task { await buyPlan(plan.id) }
                } label: {
                  Text(buying == plan.id ? "…" : (rights?.pauseMode == "payment_required" && mine ? (arabic ? "تجديد" : "Renew") : (arabic ? "اختيار" : "Choose")))
                    .font(ArrabFont.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.onPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(theme.primary)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(buying != nil)
              }
            }
          }
          .padding(.vertical, 4)
        }
        if let billingNote {
          Text(billingNote)
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
      }
    }
    .task { await watchBilling() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await loadBilling() } }
    }
  }

  private var creditPanel: some View {
    let blocked = billing?.entitlements?.pauseMode == "payment_required"
    return VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 6) {
        Text(arabic ? "إضافة رصيد" : "Add credit")
          .font(ArrabFont.system(size: 22, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(arabic ? "اكتب المبلغ بالريال. السعر لا يشمل الضريبة. ١٠٪ رصيد DeepSeek، ٦٠٪ لبقية النماذج، و٣٠٪ هامش عرّاب." : "Type the amount in SAR. The price does not include VAT. 10% becomes DeepSeek credit, 60% credit for other models, and 30% is Arrab’s margin.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
        if let rights = billing?.entitlements,
           (rights.deepseekCreditHalalas ?? 0) > 0 || (rights.otherCreditHalalas ?? 0) > 0 {
          Text(arabic
               ? "الرصيد: DeepSeek \(sarPrice(Int(rights.deepseekCreditHalalas ?? 0))) · النماذج الأخرى \(sarPrice(Int(rights.otherCreditHalalas ?? 0)))"
               : "Balance: DeepSeek \(sarPrice(Int(rights.deepseekCreditHalalas ?? 0))) · other models \(sarPrice(Int(rights.otherCreditHalalas ?? 0)))")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.lavender)
        }
        if blocked {
          Text(arabic ? "جدّد الاشتراك أولاً، ثم يمكن إضافة الرصيد." : "Renew the subscription first, then credit can be added.")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.warn)
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        LinearGradient(
          colors: [theme.lavender.opacity(0.22), theme.lavenderSoft, theme.card],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(theme.lavender.opacity(0.4), lineWidth: 1)
      )

      creditAmountCard(blocked: blocked)
      creditPacks
      if let billingNote {
        Text(billingNote)
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
      }
    }
    .task { await watchBilling() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await loadBilling() } }
    }
  }

  private func creditAmountCard(blocked: Bool) -> some View {
    let quote = creditQuote(creditAmount)
    return VStack(alignment: .leading, spacing: 12) {
      Text(arabic ? "المبلغ بالريال" : "Amount in SAR")
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.muted)
      TextField(arabic ? "مثال: 100" : "Example: 100", text: $creditAmount)
        .keyboardType(.decimalPad)
        .font(ArrabFont.system(size: 22, weight: .semibold))
        .foregroundStyle(theme.text)
      if let quote {
        VStack(alignment: .leading, spacing: 4) {
          Text(arabic ? "DeepSeek ١٠٪  \(sarPrice(quote.deep))" : "DeepSeek 10%  \(sarPrice(quote.deep))")
          Text(arabic ? "النماذج الأخرى ٦٠٪  \(sarPrice(quote.other))" : "Other models 60%  \(sarPrice(quote.other))")
          Text(arabic ? "هامش عرّاب ٣٠٪  \(sarPrice(quote.profit))" : "Arrab margin 30%  \(sarPrice(quote.profit))")
          Text(arabic ? "السعر لا يشمل الضريبة" : "VAT is not included")
            .foregroundStyle(theme.lavender)
        }
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.text)
      } else if !creditAmount.trimmingCharacters(in: .whitespaces).isEmpty {
        Text(arabic ? "المبلغ من ١ إلى ٥٬٠٠٠ ريال." : "Enter an amount from 1 to 5,000 SAR.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.warn)
      }
      Button {
        guard let quote else { return }
        Task { await buyCustomCredit(quote.sar) }
      } label: {
        Text(buying == "custom" ? "…" : (arabic ? "ادفع وأضف الرصيد" : "Pay and add credit"))
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(.white)
          .frame(maxWidth: .infinity)
          .frame(height: 48)
          .background(quote == nil || blocked ? theme.muted : theme.lavender)
          .clipShape(Capsule())
      }
      .buttonStyle(.plain)
      .disabled(quote == nil || blocked || buying != nil)
    }
    .padding(16)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(theme.line, lineWidth: 1)
    )
  }

  private func creditQuote(_ raw: String) -> (sar: Double, deep: Int, other: Int, profit: Int)? {
    let folded = raw
      .replacingOccurrences(of: "٠", with: "0")
      .replacingOccurrences(of: "١", with: "1")
      .replacingOccurrences(of: "٢", with: "2")
      .replacingOccurrences(of: "٣", with: "3")
      .replacingOccurrences(of: "٤", with: "4")
      .replacingOccurrences(of: "٥", with: "5")
      .replacingOccurrences(of: "٦", with: "6")
      .replacingOccurrences(of: "٧", with: "7")
      .replacingOccurrences(of: "٨", with: "8")
      .replacingOccurrences(of: "٩", with: "9")
      .replacingOccurrences(of: "٫", with: ".")
      .replacingOccurrences(of: ",", with: ".")
      .trimmingCharacters(in: .whitespaces)
    guard let sar = Double(folded), sar.isFinite else { return nil }
    let halalas = Int((sar * 100).rounded())
    guard halalas >= 100, halalas <= 500_000 else { return nil }
    let deep = halalas * 10 / 100
    let other = halalas * 60 / 100
    let profit = halalas - deep - other
    return (Double(halalas) / 100, deep, other, profit)
  }

  private func buyCustomCredit(_ amountSar: Double) async {
    buying = "custom"
    defer { buying = nil }
    do {
      let link = try await ArrabAPIClient.shared.checkoutCreditAmount(amountSar)
      if let url = URL(string: link.checkoutUrl) { openURL(url) }
    } catch {
      billingNote = arabic ? "تعذّر فتح الدفع." : "Couldn't open payment."
    }
  }

  @ViewBuilder
  private var creditPacks: some View {
    let blocked = billing?.entitlements?.pauseMode == "payment_required"
    let packs = catalog?.topUps ?? []
    if packs.isEmpty && catalog == nil {
      ProgressView().tint(theme.lavender)
    }
    ForEach(packs) { pack in
      creditRow(
        pack.id,
        arabic ? pack.nameAr : pack.name,
        pack.amountLabel ?? sarPrice(pack.priceHalalas),
        tokenLabel(pack.tokens) + (arabic ? " رمز لهذه الفترة" : " tokens this period"),
        enabled: !blocked
      )
    }
  }

  private func creditRow(_ pack: String, _ name: String, _ price: String, _ detail: String, enabled: Bool) -> some View {
    Button {
      Task { await buyCredit(pack) }
    } label: {
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          Text(name)
            .font(ArrabFont.system(size: 15, weight: .semibold))
            .foregroundStyle(enabled ? theme.text : theme.muted)
          Text(detail)
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
        Spacer()
        Text(buying == pack ? "…" : price)
          .font(ArrabFont.system(size: 14, weight: .semibold))
          .foregroundStyle(theme.lavender)
      }
      .padding(14)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(theme.line, lineWidth: 1)
      )
    }
    .buttonStyle(.plain)
    .disabled(!enabled || buying != nil)
  }

  private func watchBilling() async {
    await loadBilling()
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(20))
      if Task.isCancelled { break }
      await loadBilling()
    }
  }

  private func loadBilling() async {
    async let accountCall = ArrabAPIClient.shared.billingAccount()
    async let plansCall = ArrabAPIClient.shared.billingCatalog()
    do {
      billing = try await accountCall
      billingNote = nil
    } catch {
      if billing == nil {
        billingNote = arabic ? "تعذّر قراءة الاشتراك من الحساب." : "Couldn't read the subscription from your account."
      }
    }
    if let plans = try? await plansCall {
      catalog = plans
    }
  }

  private func buyPlan(_ id: String) async {
    buying = id
    defer { buying = nil }
    do {
      let link = try await ArrabAPIClient.shared.checkoutPlan(id)
      if link.checkoutUrl.isEmpty {
        await loadBilling()
        return
      }
      if let url = URL(string: link.checkoutUrl) { openURL(url) }
    } catch {
      billingNote = arabic ? "تعذّر فتح الدفع." : "Couldn't open payment."
    }
  }

  private func buyCredit(_ pack: String) async {
    buying = pack
    defer { buying = nil }
    do {
      let link = try await ArrabAPIClient.shared.checkoutCredit(pack)
      if let url = URL(string: link.checkoutUrl) { openURL(url) }
    } catch {
      billingNote = arabic ? "تعذّر فتح الدفع." : "Couldn't open payment."
    }
  }

  private func sarPrice(_ halalas: Int) -> String {
    if halalas <= 0 { return arabic ? "مجاني" : "Free" }
    let sar = halalas / 100
    let fraction = halalas % 100
    if fraction == 0 { return "SAR \(sar)" }
    return String(format: "SAR %d.%02d", sar, fraction)
  }

  private func subscriptionStatusTitle(_ status: String?, pause: String?) -> String {
    if pause == "payment_required" { return arabic ? "التجديد مستحق" : "Renewal due" }
    switch status {
    case "active": return arabic ? "نشط" : "Active"
    case "trialing": return arabic ? "تجريبي" : "Trial"
    case "past_due": return arabic ? "دفعة متأخرة" : "Past due"
    case "canceled": return arabic ? "ملغى" : "Canceled"
    default: return arabic ? "الحساب" : "Account"
    }
  }

  private func planBlurb(_ plan: BillingCatalog.Plan) -> String {
    if !arabic { return plan.description }
    switch plan.id {
    case "free": return "ابدأ الاستوديو وجرّب أول رفيق."
    case "pro": return "عمل يومي لمن يعيش داخل عرّاب."
    case "family_free": return "تجربة عائلية مجانية لمقاعد البيت."
    case "family": return "استوديو واحد مشترك للأسرة."
    case "family_plus": return "مساحة أكبر لبيت أثقل استخداماً."
    case "team": return "استوديو متعدد للفريق."
    case "unlimited": return "أكبر سعة شهرية للاستوديوهات."
    default: return plan.description
    }
  }

  private func planFeature(_ feature: String) -> String {
    guard arabic else { return feature }
    switch feature {
    case "1× included usage": return "استخدام مضمّن ١×"
    case "1 AI employee desk": return "مكتب رفيق واحد"
    case "Web workspace + macOS Studio": return "مساحة الويب واستوديو ماك"
    case "20× included usage": return "استخدام مضمّن ٢٠×"
    case "Unlimited employees & projects": return "رفاق ومشاريع بلا حد للعدد"
    case "Priority model routing": return "توجيه أولوية للنماذج"
    case "Desktop Studio + testing workspace": return "استوديو سطح المكتب ومساحة التجربة"
    case "1× shared household usage": return "استخدام منزلي مشترك ١×"
    case "Up to 6 family seats": return "حتى ٦ مقاعد للعائلة"
    case "Add parents, partners, and kids": return "أضف الوالدين والشريك والأبناء"
    case "PIN profiles + parental pause": return "ملفات برمز وإيقاف أبوي"
    case "macOS Studio on every home Mac": return "استوديو ماك على كل جهاز في البيت"
    case "40× shared household usage": return "استخدام منزلي مشترك ٤٠×"
    case "Shared companions & chat history": return "رفاق وسجل محادثات مشترك"
    case "Parental-friendly usage overview": return "نظرة استخدام تناسب ولي الأمر"
    case "80× shared household usage": return "استخدام منزلي مشترك ٨٠×"
    case "Up to 10 family seats": return "حتى ١٠ مقاعد للعائلة"
    case "Priority routing for every member": return "أولوية توجيه لكل فرد"
    case "Shared knowledge & memories": return "معرفة وذاكرة مشتركة"
    case "Priority household support": return "دعم أولوية للأسرة"
    case "100× studio usage": return "استخدام استوديو ١٠٠×"
    case "Shared goals, tasks, and memory": return "أهداف ومهام وذاكرة مشتركة"
    case "Team chat & cowork rooms": return "دردشة الفريق وغرف العمل"
    case "Usage controls per session": return "تحكم بالاستخدام لكل جلسة"
    case "Priority support": return "دعم بأولوية"
    case "500× studio usage": return "استخدام استوديو ٥٠٠×"
    case "Highest throughput routing": return "أعلى سرعة توجيه"
    case "Dedicated onboarding": return "تهيئة مخصصة"
    case "Custom workforce playbooks": return "أدلة عمل مخصصة"
    default: return feature
    }
  }

  private var generalPanel: some View {
    let accountName = session.account?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
    let headline = (accountName?.isEmpty == false ? accountName : nil) ?? session.account?.email ?? (arabic ? "حسابك" : "Your account")
    let plan = session.entitlements?.planName
      ?? session.account?.planName
      ?? planTitle(session.entitlements?.planId ?? session.account?.planId)
    let status = subscriptionStatusTitle(session.entitlements?.subscriptionStatus ?? session.account?.subscriptionStatus, pause: session.entitlements?.pauseMode)
    return VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 14) {
        Text(String(headline.prefix(1)).uppercased())
          .font(ArrabFont.system(size: 22, weight: .semibold))
          .foregroundStyle(theme.lavender)
          .frame(width: 64, height: 64)
          .background(theme.lavenderSoft)
          .clipShape(Circle())
          .overlay(Circle().stroke(theme.lavender, lineWidth: 1.5))
        VStack(alignment: .leading, spacing: 4) {
          Text(headline)
            .font(ArrabFont.system(size: 20, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(session.account?.email ?? "")
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
            .lineLimit(1)
          Text(plan)
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.lavender)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(theme.lavenderSoft)
            .clipShape(Capsule())
          Text(status)
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
        Spacer(minLength: 0)
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        LinearGradient(
          colors: [theme.lavender.opacity(0.22), theme.lavenderSoft, theme.card],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(theme.lavender.opacity(0.4), lineWidth: 1)
      )

      profileGroup(arabic ? "الحساب" : "Account") {
        settingsField(arabic ? "الاسم في الحساب" : "Account name", text: $accountNameDraft)
        Button {
          Task { await saveAccountName() }
        } label: {
          Text(savingName ? "…" : (nameNote ?? (arabic ? "حفظ الاسم" : "Save name")))
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(canSaveName ? theme.onPrimary : theme.muted)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(canSaveName ? theme.primary : theme.subtle)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!canSaveName)
        if let end = periodLabel(session.entitlements?.periodEnd ?? session.account?.periodEnd) {
          Text(arabic ? "تنتهي الفترة \(end)" : "Period ends \(end)")
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
      }

      profileGroup(arabic ? "كيف يعرفك الرفاق" : "How companions know you") {
        settingsField(arabic ? "الاسم الذي ينادونك به" : "Name they use", text: profileCallName)
        settingsField(arabic ? "عنك" : "About you", text: profileAbout)
        settingsField(arabic ? "تركيزك الحالي" : "Current focus", text: profileFocus)
        Text(arabic ? "طول الرد" : "Reply length")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
        settingsChips(
          [
            ("brief", arabic ? "قصير" : "Brief"),
            ("balanced", arabic ? "متوازن" : "Balanced"),
            ("full", arabic ? "مفصّل" : "Full"),
          ],
          selected: session.profilePrefs.reply
        ) { session.profilePrefs.reply = $0 }
        Text(arabic ? "الأسلوب" : "Tone")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
        settingsChips(
          [
            ("warm", arabic ? "دافئ" : "Warm"),
            ("direct", arabic ? "مباشر" : "Direct"),
            ("formal", arabic ? "مهذب" : "Formal"),
          ],
          selected: session.profilePrefs.tone
        ) { session.profilePrefs.tone = $0 }
        Button {
          Task { await saveProfileMemory() }
        } label: {
          Text(savingProfile ? "…" : (profileNote ?? (arabic ? "حفظ في الحساب" : "Save on the account")))
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(savingProfile ? theme.muted : theme.primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(savingProfile)
      }

      profileGroup(arabic ? "اللغة" : "Language") {
        Picker(arabic ? "اللغة" : "Language", selection: $session.localeIsArabic) {
          Text("English").tag(false)
          Text("العربية").tag(true)
        }
        .pickerStyle(.segmented)
        Text(arabic ? "لغة هذا الجوال. العربية تُجاب بلهجة سعودية بيضاء." : "Language on this iPhone. Arabic replies use a clear Saudi accent.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
      }
    }
    .task {
      await refreshAccount()
      await loadProfileMemory()
    }
  }

  private var canSaveName: Bool {
    let next = accountNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    let current = session.account?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !savingName && next.count >= 2 && next != current
  }

  private func saveAccountName() async {
    let next = accountNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard next.count >= 2 else { return }
    savingName = true
    nameNote = nil
    defer { savingName = false }
    do {
      let status = try await ArrabAPIClient.shared.updateDisplayName(next)
      session.account = status.account
      session.entitlements = status.entitlements
      accountNameDraft = status.account?.displayName ?? next
      nameNote = arabic ? "تم الحفظ" : "Saved"
    } catch {
      nameNote = arabic ? "تعذّر حفظ الاسم" : "Couldn't save the name"
    }
  }

  private let profileMarker = "[[arrab-profile]]"

  private func loadProfileMemory() async {
    guard let items = try? await ArrabAPIClient.shared.listMemories() else { return }
    guard let raw = items.first(where: { $0.content.hasPrefix(profileMarker) })?.content else { return }
    let json = raw.dropFirst(profileMarker.count).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = json.data(using: .utf8),
          let prefs = try? JSONDecoder().decode(ProfilePrefs.self, from: data) else { return }
    session.profilePrefs = prefs
  }

  private func saveProfileMemory() async {
    savingProfile = true
    profileNote = nil
    defer { savingProfile = false }
    guard let data = try? JSONEncoder().encode(session.profilePrefs),
          let json = String(data: data, encoding: .utf8) else {
      profileNote = arabic ? "تعذّر الحفظ" : "Couldn't save"
      return
    }
    let content = profileMarker + "\n" + json
    do {
      if let items = try? await ArrabAPIClient.shared.listMemories() {
        for item in items where item.content.hasPrefix(profileMarker) {
          await ArrabAPIClient.shared.deleteMemory(item.id)
        }
      }
      _ = try await ArrabAPIClient.shared.createMemory(content: content, agentId: nil)
      profileNote = arabic ? "حُفظ في الحساب" : "Saved on the account"
    } catch {
      profileNote = arabic ? "تعذّر الحفظ في الحساب" : "Couldn't save on the account"
    }
  }

  private var profileCallName: Binding<String> {
    Binding(get: { session.profilePrefs.callName }, set: { session.profilePrefs.callName = $0 })
  }

  private var profileAbout: Binding<String> {
    Binding(get: { session.profilePrefs.about }, set: { session.profilePrefs.about = $0 })
  }

  private var profileFocus: Binding<String> {
    Binding(get: { session.profilePrefs.focus }, set: { session.profilePrefs.focus = $0 })
  }

  private func profileGroup<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.lavender)
      content()
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
        .stroke(theme.line, lineWidth: 1)
    )
  }

  private func settingsField(_ title: String, text: Binding<String>) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.text)
      TextField(title, text: text)
        .font(ArrabFont.system(size: 16))
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .foregroundStyle(theme.text)
    }
  }

  private func settingsChips(_ items: [(String, String)], selected: String, choose: @escaping (String) -> Void) -> some View {
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

  private func planTitle(_ id: String?) -> String {
    switch id {
    case "pro": return "Pro"
    case "family", "family_plus", "family_free": return arabic ? "عائلة" : "Family"
    case "team", "unlimited", "scale": return arabic ? "مؤسسة" : "Organization"
    case "free", nil, "": return arabic ? "مجاني" : "Free"
    default: return id ?? (arabic ? "مجاني" : "Free")
    }
  }

  private var appearancePanel: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(arabic ? "المعاينة تتغير فوراً." : "The preview changes immediately.")
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        appearanceChoice(.system, arabic ? "الجهاز" : "System", "circle.lefthalf.filled")
        appearanceChoice(.light, arabic ? "فاتح" : "Light", "sun.max")
        appearanceChoice(.dark, arabic ? "داكن" : "Dark", "moon")
      }
      VStack(alignment: .leading, spacing: 8) {
        Text(arabic ? "عرّاب" : "Arrab")
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(arabic ? "هكذا تبدو البطاقات والنص في الاستوديو." : "This is how cards and text look in Studio.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
        Text(arabic ? "أول ذكاء اصطناعي عربي للشرق الأوسط" : "The first Arabic AI for the Middle East")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.lavender)
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
    }
  }

  private func appearanceChoice(_ mode: ThemeMode, _ title: String, _ symbol: String) -> some View {
    let on = themeStore.mode == mode
    return Button {
      themeStore.mode = mode
    } label: {
      VStack(spacing: 8) {
        Image(systemName: symbol)
          .font(ArrabFont.system(size: 18, weight: .semibold))
        Text(title)
          .font(ArrabFont.system(size: 13, weight: .semibold))
      }
      .foregroundStyle(on ? theme.onPrimary : theme.text)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 16)
      .background(on ? theme.primary : theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(on ? Color.clear : theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private var intelligencePanel: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(arabic ? "النماذج التي يرد بها الحساب. الصور تبقى على مسار الصور حتى لو اخترت عرّاب." : "The models your account can reply with. Photos stay on the photo path even when Arrab is selected.")
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      if cloudModels.loading && cloudModels.choices.isEmpty {
        ProgressView().tint(theme.lavender)
      } else if cloudModels.failed {
        Text(arabic ? "تعذّر قراءة النماذج من الحساب." : "Couldn’t read models from your account.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
        Button(arabic ? "إعادة المحاولة" : "Try again") {
          Task { await cloudModels.load() }
        }
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.lavender)
      }
      if cloudModels.configured == false {
        Text(arabic ? "الحساب غير مهيأ للرد بعد." : "This account is not set up to reply yet.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.warn)
      }
      ForEach(cloudModels.choices) { choice in
        let selected = cloudModelSelected(choice)
        Button {
          session.selectCloudModel(choice.id)
        } label: {
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
              HStack(spacing: 8) {
                Text(choice.title)
                  .font(ArrabFont.system(size: 15, weight: .semibold))
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
              .font(ArrabFont.system(size: 18))
              .foregroundStyle(selected ? theme.lavender : theme.line)
          }
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(Rectangle())
          .background(selected ? theme.subtle : theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
              .stroke(selected ? theme.lavender : theme.line, lineWidth: selected ? 1.5 : 1)
          )
        }
        .buttonStyle(.plain)
      }

      profileGroup(arabic ? "طريقة الرد" : "How it works") {
        settingsChips(
          [
            ("agent", arabic ? "شخص" : "Person"),
            ("plan", arabic ? "خطة" : "Plan"),
            ("search", arabic ? "بحث" : "Search"),
            ("think", arabic ? "تفكير" : "Think"),
            ("debug", arabic ? "فحص" : "Debug"),
          ],
          selected: session.sessionMode
        ) { session.sessionMode = $0 }
        Text(sessionModeHint)
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
      }

      profileGroup(L10n.t(.controlPlane, arabic: arabic)) {
        if let features = managed.config?.features {
          featureRow(arabic ? "الاستوديو" : "Studio", features["studio"] == true)
          featureRow(arabic ? "المكتبة" : "Library", features["brain"] == true)
          featureRow(arabic ? "الموصلات" : "Connectors", features["connectors"] == true)
          featureRow(arabic ? "التخفي" : "Incognito", features["incognito"] == true)
          Text(arabic ? "هذه الحالات من حساب التحكم." : "These states come from the control account.")
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        } else {
          Text(arabic ? "لم يصل حساب التحكم بعد." : "The control account has not arrived yet.")
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
      }
    }
    .task { await cloudModels.load() }
  }

  private var sessionModeHint: String {
    switch session.sessionMode {
    case "search":
      return arabic ? "كل رسالة تُبحث في الويب قبل الرد." : "Every message is looked up on the web before the reply."
    case "plan":
      return arabic ? "يظهر بجانب الكتابة. استخدمه عندما تريد خطة." : "Shown next to the composer. Use it when you want a plan."
    case "think":
      return arabic ? "يظهر بجانب الكتابة. نفس زر فكّر في المحادثة." : "Shown next to the composer. Same as Think in chat."
    case "debug":
      return arabic ? "يظهر بجانب الكتابة. نفس زر التصحيح في المحادثة." : "Shown next to the composer. Same as Debug in chat."
    default:
      return arabic ? "يرد وينفّذ: تذكير، بحث، ملفات، وصور." : "Replies and acts: reminders, search, files, and photos."
    }
  }

  private func cloudModelSelected(_ choice: ArrabModelChoice) -> Bool {
    if session.chattingOnDevice { return false }
    if choice.primary {
      return session.preferredModel.isEmpty
        || session.preferredModel == "arrab"
        || session.preferredModel == "auto"
        || session.preferredModel == "primary"
        || session.preferredModel == AppSession.arrabModelId
        || session.preferredModel == choice.id
    }
    return session.preferredModel == choice.id
  }

  private var notificationsPanel: some View {
    VStack(alignment: .leading, spacing: 12) {
      profileGroup(arabic ? "إذن الجوال" : "iPhone permission") {
        Text(notifyAuthTitle)
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(arabic ? "التذكير والمنبّه يبقيان حتى لو أغلقت قنوات التحكم." : "Reminders and alarms stay on even if a control channel is off.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
        Button(notifyAuth == .denied ? (arabic ? "افتح إعدادات الجوال" : "Open iPhone Settings") : (arabic ? "السماح بالإشعارات" : "Allow notifications")) {
          if notifyAuth == .denied {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
          } else {
            PushRegistration.askAfterSignIn()
          }
        }
        .font(ArrabFont.system(size: 14, weight: .semibold))
        .foregroundStyle(theme.onPrimary)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(theme.primary)
        .clipShape(Capsule())
      }
      .task { await refreshNotifyAuth() }
      profileGroup(arabic ? "قنوات التحكم" : "Control channels") {
        Toggle(isOn: $notifyPrefs.updates) {
          VStack(alignment: .leading, spacing: 2) {
            Text(L10n.t(.channelUpdates, arabic: arabic)).foregroundStyle(theme.text)
            Text(arabic ? "تحديثات التطبيق" : "App updates").font(ArrabFont.system(size: 12)).foregroundStyle(theme.muted)
          }
        }
        Toggle(isOn: $notifyPrefs.security) {
          VStack(alignment: .leading, spacing: 2) {
            Text(L10n.t(.channelSecurity, arabic: arabic)).foregroundStyle(theme.text)
            Text(arabic ? "تنبيهات الحساب" : "Account alerts").font(ArrabFont.system(size: 12)).foregroundStyle(theme.muted)
          }
        }
        Toggle(isOn: $notifyPrefs.companions) {
          VStack(alignment: .leading, spacing: 2) {
            Text(L10n.t(.channelCompanions, arabic: arabic)).foregroundStyle(theme.text)
            Text(arabic ? "موافقات الرفاق" : "Companion approvals").font(ArrabFont.system(size: 12)).foregroundStyle(theme.muted)
          }
        }
        Toggle(isOn: $notifyPrefs.general) {
          VStack(alignment: .leading, spacing: 2) {
            Text(L10n.t(.channelGeneral, arabic: arabic)).foregroundStyle(theme.text)
            Text(arabic ? "رسائل التحكم العامة" : "General control messages").font(ArrabFont.system(size: 12)).foregroundStyle(theme.muted)
          }
        }
        Text(arabic ? "هذه القنوات محفوظة على هذا الجوال." : "These channels are saved on this iPhone.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
      }
      .tint(theme.lavender)
      Text(arabic
        ? "\(managed.unreadCount) غير مقروء في صندوق التحكم"
        : "\(managed.unreadCount) unread in the control inbox")
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
    }
  }

  private var notifyAuthTitle: String {
    switch notifyAuth {
    case .authorized, .provisional, .ephemeral:
      return arabic ? "الإشعارات مسموحة" : "Notifications are allowed"
    case .denied:
      return arabic ? "الإشعارات موقوفة من إعدادات الجوال" : "Notifications are off in iPhone Settings"
    default:
      return arabic ? "لم يُطلب الإذن بعد" : "Permission has not been asked yet"
    }
  }

  private func refreshNotifyAuth() async {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    notifyAuth = settings.authorizationStatus
  }

  private var privacyPanel: some View {
    VStack(alignment: .leading, spacing: 12) {
      ManagedPrivacyCard()
      ArrabCard {
        Toggle(isOn: $lock.lockEnabled) {
          VStack(alignment: .leading, spacing: 4) {
            Text(arabic ? "قفل الاستوديو" : "Lock Studio")
              .foregroundStyle(theme.text)
            Text(lockDetail)
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
          }
        }
        .tint(theme.lavender)
        .onChange(of: lock.lockEnabled) { _, on in
          if on { lock.lockIfNeeded() } else { lock.unlock() }
        }
      }
      ArrabCard {
        Text(L10n.t(.incognitoBody, arabic: arabic))
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
      }
      ArrabCard {
        LegalLinksView()
      }
      ArrabCard {
        DeleteAccountSection()
      }
    }
  }

  private var lockDetail: String {
    let context = LAContext()
    var error: NSError?
    let can = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    if can && context.biometryType == .faceID {
      return arabic ? "يطلب Face ID عند العودة" : "Asks for Face ID when you return"
    }
    if can && context.biometryType == .touchID {
      return arabic ? "يطلب Touch ID عند العودة" : "Asks for Touch ID when you return"
    }
    return arabic ? "يطلب رمز الجوال عند العودة" : "Asks for the iPhone passcode when you return"
  }

  private var aboutPanel: some View {
    let plan = session.entitlements?.planName ?? session.account?.planName ?? planTitle(session.account?.planId)
    return VStack(alignment: .leading, spacing: 12) {
      ArrabCard {
        VStack(alignment: .leading, spacing: 8) {
          Text(arabic ? "عرّاب" : "Arrab")
            .font(ArrabFont.system(size: 22, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(arabic
            ? "أول ذكاء اصطناعي عربي للشرق الأوسط. المحادثة، الرفاق، والخزنة على حسابك."
            : "The first Arabic AI for the Middle East. Chat, companions, and Safe live on your account.")
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
          Text("Arrab Studio \(managed.appVersion)")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.text)
          if let configured = cloudModels.configured {
            Text(configured
              ? (arabic ? "الرد السحابي جاهز" : "Cloud replies are ready")
              : (arabic ? "الرد السحابي غير مهيأ" : "Cloud replies are not set up"))
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .foregroundStyle(configured ? theme.lavender : theme.warn)
          }
          if let email = session.account?.email, !email.isEmpty {
            Text(email)
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.muted)
          }
          Text(plan)
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.lavender)
          if managed.updateMode == .blocking {
            Text(L10n.t(.forcedUpdate, arabic: arabic)).foregroundStyle(theme.danger)
          } else if managed.updateMode == .soft {
            Text(L10n.t(.softUpdate, arabic: arabic)).foregroundStyle(theme.warn)
          }
          if managed.readOnly {
            Text(L10n.t(.readOnlyMode, arabic: arabic)).foregroundStyle(theme.warn)
          }
        }
      }
      ArrabCard {
        LegalLinksView()
      }
    }
    .task {
      await refreshAccount()
      await cloudModels.load()
    }
  }

  private func statusDot(_ title: String, ok: Bool) -> some View {
    HStack(spacing: 8) {
      Circle().fill(ok ? theme.success : theme.muted).frame(width: 8, height: 8)
      Text(title)
        .font(ArrabFont.system(size: 13, weight: .medium))
        .foregroundStyle(theme.text)
    }
    .frame(maxWidth: .infinity)
  }

  private func meterRow(title: String, used: Double?, cap: Double?) -> some View {
    let ratio = (used ?? 0) / max(cap ?? 1, 1)
    return VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(title).font(ArrabFont.system(size: 13, weight: .medium)).foregroundStyle(theme.text)
        Spacer()
        Text("\(Int(min(100, max(0, ratio * 100))))%")
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.muted)
      }
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(theme.subtle)
          Capsule()
            .fill(ratio >= 1 ? theme.danger : ratio >= 0.8 ? theme.warn : theme.lavender)
            .frame(width: geo.size.width * min(1, max(0, ratio)))
        }
      }
      .frame(height: 8)
    }
  }

  private func featureRow(_ name: String, _ on: Bool) -> some View {
    HStack {
      Text(name).foregroundStyle(theme.text)
      Spacer()
      Text(on ? L10n.t(.featureOn, arabic: arabic) : L10n.t(.featureOff, arabic: arabic))
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(on ? theme.success : theme.muted)
    }
  }
}

struct PhoneModel: Identifiable {
  let id: String
  let name: String
  let nameAr: String
  let detail: String
  let detailAr: String
  let url: URL?

  func title(arabic: Bool) -> String { arabic ? nameAr : name }
  func subtitle(arabic: Bool) -> String { arabic ? detailAr : detail }
}

enum PhoneModelCatalog {
  static let entries: [PhoneModel] = [
    model("gemma3-1b", "Gemma 3 1B", "Gemma 3 ‏١ب", "~815 MB", "~٨١٥ م.ب", "https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf"),
    model("gemma3n-e2b", "Gemma 3n", "Gemma 3n", "~2.8 GB", "~٢٫٨ ج.ب", "https://huggingface.co/unsloth/gemma-3n-E2B-it-GGUF/resolve/main/gemma-3n-E2B-it-Q4_K_M.gguf"),
    model("gemma2-2b", "Gemma 2 2B", "Gemma 2 ‏٢ب", "~1.6 GB", "~١٫٦ ج.ب", "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf"),
    model("llama3.2-1b", "Llama 3.2 1B", "Llama 3.2 ‏١ب", "~1.3 GB", "~١٫٣ ج.ب", "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"),
    model("llama3.2-3b", "Llama 3.2 3B", "Llama 3.2 ‏٣ب", "~2.0 GB", "~٢ ج.ب", "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"),
    model("qwen3-0.6b", "Qwen 3 0.6B", "Qwen 3 ‏٠٫٦ب", "~522 MB", "~٥٢٢ م.ب", "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf"),
    model("qwen2.5-0.5b", "Qwen 2.5 0.5B", "Qwen 2.5 ‏٠٫٥ب", "~398 MB", "~٣٩٨ م.ب", "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"),
    model("qwen2.5-1.5b", "Qwen 2.5 1.5B", "Qwen 2.5 ‏١٫٥ب", "~986 MB", "~٩٨٦ م.ب", "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"),
    model("phi3-mini", "Phi-3.5 Mini", "Phi-3.5 Mini", "~2.3 GB", "~٢٫٣ ج.ب", "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf"),
  ]

  private static func model(_ id: String, _ name: String, _ nameAr: String, _ detail: String, _ detailAr: String, _ url: String) -> PhoneModel {
    PhoneModel(id: id, name: name, nameAr: nameAr, detail: detail, detailAr: detailAr, url: URL(string: url))
  }
}

@MainActor
final class PhoneModelStore: ObservableObject {
  static let shared = PhoneModelStore()
  @Published var progress: [String: Double] = [:]
  @Published var ready: Set<String> = []
  private var tasks: [String: URLSessionDownloadTask] = [:]

  private init() {
    let folder = Self.folder
    let names = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    ready = Set(names.map { $0.deletingPathExtension().lastPathComponent })
  }

  static var folder: URL {
    let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("local-models", isDirectory: true)
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  func download(_ model: PhoneModel) {
    guard let url = model.url, tasks[model.id] == nil else { return }
    progress[model.id] = 0
    let task = URLSession.shared.downloadTask(with: url) { [weak self] location, _, _ in
      guard let location else { return }
      let dest = Self.folder.appendingPathComponent("\(model.id).gguf")
      try? FileManager.default.removeItem(at: dest)
      try? FileManager.default.moveItem(at: location, to: dest)
      Task { @MainActor in
        self?.tasks[model.id] = nil
        self?.progress[model.id] = nil
        self?.ready.insert(model.id)
      }
    }
    tasks[model.id] = task
    task.resume()
    observe(task, id: model.id)
  }

  func cancel(_ id: String) {
    tasks[id]?.cancel()
    tasks[id] = nil
    progress[id] = nil
  }

  func remove(_ id: String) {
    cancel(id)
    let dest = Self.folder.appendingPathComponent("\(id).gguf")
    try? FileManager.default.removeItem(at: dest)
    ready.remove(id)
  }

  func byteCount(_ id: String) -> Int64? {
    let dest = Self.folder.appendingPathComponent("\(id).gguf")
    guard let size = try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64 else { return nil }
    return size
  }

  private func observe(_ task: URLSessionDownloadTask, id: String) {
    Task {
      while task.state == .running {
        let fraction = task.countOfBytesExpectedToReceive > 0
          ? Double(task.countOfBytesReceived) / Double(task.countOfBytesExpectedToReceive)
          : 0
        await MainActor.run { self.progress[id] = fraction }
        try? await Task.sleep(nanoseconds: 400_000_000)
      }
    }
  }
}

struct LocalModelsPanel: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @ObservedObject private var store = PhoneModelStore.shared
  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Text(arabic ? "جيما، لاما، والمزيد على هذا الجوال" : "Gemma, Llama, and more on this iPhone")
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(arabic ? "نزّل النموذج ليبقى محفوظاً هنا." : "Download a model to keep it here.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))

      ForEach(PhoneModelCatalog.entries) { model in
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            VStack(alignment: .leading, spacing: 3) {
              Text(model.title(arabic: arabic))
                .font(ArrabFont.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(fileDetail(model))
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
            }
            Spacer()
            if store.ready.contains(model.id) {
              Button(arabic ? "حذف" : "Delete") { store.remove(model.id) }
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.danger)
            } else if store.progress[model.id] != nil {
              Button(arabic ? "إيقاف" : "Stop") { store.cancel(model.id) }
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
            } else {
              Button(L10n.t(.downloadModel, arabic: arabic)) { store.download(model) }
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.onPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(theme.primary)
                .clipShape(Capsule())
            }
          }
          if let fraction = store.progress[model.id] {
            ProgressView(value: fraction).tint(theme.lavender)
          }
        }
        .padding(14)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
      }
    }
  }

  private func fileDetail(_ model: PhoneModel) -> String {
    if let bytes = store.byteCount(model.id) {
      let mb = Double(bytes) / 1_048_576
      let size = mb >= 1000 ? String(format: "%.1f GB", mb / 1024) : String(format: "%.0f MB", mb)
      return arabic ? "محفوظ · \(size)" : "Saved · \(size)"
    }
    return model.subtitle(arabic: arabic)
  }
}
