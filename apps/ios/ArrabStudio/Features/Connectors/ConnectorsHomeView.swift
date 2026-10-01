import SwiftUI
import UIKit

struct ConnectorCardModel: Identifiable, Equatable {
  let id: String
  let provider: String
  let title: String
  let titleAr: String
  let body: String
  let bodyAr: String
  let systemImage: String
  let logoUrl: String?
  let featured: Bool
  let connected: Bool
  let connectionId: String?
  let statusLabel: String
}

@MainActor
final class ConnectorsViewModel: ObservableObject {
  @Published var cards: [ConnectorCardModel] = []
  @Published var isBusy = false
  @Published var error: String?
  @Published var selectedId: String?
  @Published var tokenCard: ConnectorCardModel?

  private let api = ArrabAPIClient.shared

  /// Browser sign-in. Matches the API OAuth routes.
  static let oauthProviders: Set<String> = [
    "gmail", "outlook", "github", "gitlab", "bitbucket", "linear", "slack", "notion",
    "whoop", "fitbit", "google_drive", "google_calendar", "figma",
  ]

  /// Token or app-password connect. Posted to POST /v1/connectors.
  static let tokenProviders: Set<String> = ["email", "ssh", "whatsapp", "finnhub"]

  private struct Known {
    let provider: String
    let title: String
    let titleAr: String
    let body: String
    let bodyAr: String
    let symbol: String
  }

  /// Fills anything the live catalog omits, with Gmail and Outlook as their own accounts.
  private static let known: [Known] = [
    Known(provider: "gmail", title: "Gmail", titleAr: "Gmail", body: "Sign in with Google. Companions can read and send mail.", bodyAr: "سجّل بجوجل. الرفاق يقرأون ويرسلون البريد.", symbol: "envelope.fill"),
    Known(provider: "outlook", title: "Outlook", titleAr: "Outlook", body: "Sign in with Microsoft. Companions can read and send mail.", bodyAr: "سجّل بمايكروسوفت. الرفاق يقرأون ويرسلون البريد.", symbol: "envelope.fill"),
    Known(provider: "email", title: "Email", titleAr: "البريد", body: "iCloud, Yahoo, or custom IMAP with an app password.", bodyAr: "iCloud أو Yahoo أو IMAP بكلمة مرور تطبيق.", symbol: "envelope"),
    Known(provider: "whatsapp", title: "WhatsApp", titleAr: "واتساب", body: "WhatsApp Business Cloud API for agent replies.", bodyAr: "واجهة واتساب للأعمال حتى يرد الرفاق.", symbol: "message.fill"),
    Known(provider: "github", title: "GitHub", titleAr: "GitHub", body: "Sign in on GitHub. Repos, commits, and pull requests.", bodyAr: "سجّل في GitHub. المستودعات والإيداع وطلبات الدمج.", symbol: "chevron.left.forwardslash.chevron.right"),
    Known(provider: "gitlab", title: "GitLab", titleAr: "GitLab", body: "Sign in on GitLab. Projects and repositories.", bodyAr: "سجّل في GitLab. المشاريع والمستودعات.", symbol: "square.stack.3d.up"),
    Known(provider: "bitbucket", title: "Bitbucket", titleAr: "Bitbucket", body: "Sign in on Bitbucket. Repos and workspaces.", bodyAr: "سجّل في Bitbucket. المستودعات ومساحات العمل.", symbol: "shippingbox"),
    Known(provider: "linear", title: "Linear", titleAr: "Linear", body: "Sign in on Linear. Issues and projects.", bodyAr: "سجّل في Linear. المهام والمشاريع.", symbol: "checklist"),
    Known(provider: "slack", title: "Slack", titleAr: "Slack", body: "Sign in on Slack. Channels and messages.", bodyAr: "سجّل في Slack. القنوات والرسائل.", symbol: "number"),
    Known(provider: "notion", title: "Notion", titleAr: "Notion", body: "Sign in on Notion. Pages and databases.", bodyAr: "سجّل في Notion. الصفحات وقواعد البيانات.", symbol: "doc.text"),
    Known(provider: "ssh", title: "SSH", titleAr: "SSH", body: "A remote host with a password or private key.", bodyAr: "جهاز بعيد بكلمة مرور أو مفتاح خاص.", symbol: "terminal"),
    Known(provider: "finnhub", title: "Finnhub", titleAr: "Finnhub", body: "Market quotes and company news with an API key.", bodyAr: "أسعار الأسواق وأخبار الشركات بمفتاح API.", symbol: "chart.line.uptrend.xyaxis"),
    Known(provider: "whoop", title: "WHOOP", titleAr: "WHOOP", body: "Sign in with WHOOP. Recovery, sleep, and strain.", bodyAr: "سجّل في WHOOP. التعافي والنوم والجهد.", symbol: "heart.fill"),
    Known(provider: "fitbit", title: "Fitbit", titleAr: "Fitbit", body: "Sign in with Fitbit. Activity, heart rate, and sleep.", bodyAr: "سجّل في Fitbit. النشاط والنبض والنوم.", symbol: "figure.walk"),
    Known(provider: "google_drive", title: "Google Drive", titleAr: "Google Drive", body: "Sign in with Google. Browse Drive files.", bodyAr: "سجّل بجوجل. تصفح ملفات Drive.", symbol: "externaldrive"),
    Known(provider: "google_calendar", title: "Google Calendar", titleAr: "تقويم Google", body: "Sign in with Google. Events and scheduling.", bodyAr: "سجّل بجوجل. الأحداث والجدولة.", symbol: "calendar"),
    Known(provider: "figma", title: "Figma", titleAr: "Figma", body: "Sign in with Figma. Designs and comments.", bodyAr: "سجّل في Figma. التصاميم والتعليقات.", symbol: "paintbrush"),
  ]

  func reload() async {
    if cards.isEmpty { isBusy = true }
    defer { isBusy = false }
    async let mineResult = Self.load { try await self.api.connectors() }
    async let catalogResult = Self.load { try await self.api.connectorsCatalog() }
    async let controlResult = Self.load { try await self.api.controlConnectors() }
    let mine = await mineResult
    let catalog = await catalogResult
    let control = await controlResult
    if mine == nil && catalog == nil {
      error = "Couldn’t reach the Arrab API."
    } else {
      error = nil
    }
    cards = Self.merge(mine: mine ?? [], catalog: catalog ?? [], control: control ?? [])
    if selectedId == nil { selectedId = cards.first?.id }
  }

  func connect(_ card: ConnectorCardModel) async {
    if Self.tokenProviders.contains(card.provider) {
      tokenCard = card
      return
    }
    isBusy = true
    defer { isBusy = false }
    do {
      guard let url = try await api.startConnectorOAuth(provider: card.provider) else {
        error = "Sign-in didn’t return a link."
        return
      }
      await UIApplication.shared.open(url)
    } catch {
      self.error = error.localizedDescription
    }
  }

  func submitToken(
    _ card: ConnectorCardModel,
    token: String,
    label: String,
    config: [String: String]
  ) async throws {
    isBusy = true
    defer { isBusy = false }
    do {
      _ = try await api.connectConnector(
        provider: card.provider,
        token: token,
        label: label.isEmpty ? nil : label,
        config: config.isEmpty ? nil : config
      )
      tokenCard = nil
      error = nil
      await reload()
    } catch {
      self.error = error.localizedDescription
      throw error
    }
  }

  func disconnect(_ card: ConnectorCardModel) async {
    guard let id = card.connectionId else { return }
    isBusy = true
    defer { isBusy = false }
    do {
      try await api.deleteConnector(id: id)
      await reload()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private static func load<T>(_ work: () async throws -> T) async -> T? {
    try? await work()
  }

  private static func firstBy<T>(_ items: [T], _ key: KeyPath<T, String>) -> [String: T] {
    var out: [String: T] = [:]
    for item in items { out[item[keyPath: key]] = item }
    return out
  }

  private static func merge(
    mine: [ConnectorPublic],
    catalog: [ConnectorCatalogEntry],
    control: [ControlConnector]
  ) -> [ConnectorCardModel] {
    let byProvider = Self.connectedByProvider(mine)
    let controlBy = Self.firstBy(control, \.provider)
    let catalogBy = Self.firstBy(catalog, \.provider)
    let knownBy = Self.firstBy(known, \.provider)
    let providers = Self.orderedProviders(catalog: catalog, control: control, catalogBy: catalogBy)

    return providers.map { provider in
      Self.card(
        provider: provider,
        meta: knownBy[provider],
        ctrl: controlBy[provider],
        conn: byProvider[provider],
        apiBody: catalogBy[provider]?.description
      )
    }
  }

  private static func connectedByProvider(_ mine: [ConnectorPublic]) -> [String: ConnectorPublic] {
    var out: [String: ConnectorPublic] = [:]
    for item in mine {
      let current = out[item.provider]
      if current == nil || Self.isLive(item) {
        out[item.provider] = item
      }
    }
    return out
  }

  private static func isLive(_ item: ConnectorPublic) -> Bool {
    item.status == nil || item.status == "connected" || item.status == "active"
  }

  private static func orderedProviders(
    catalog: [ConnectorCatalogEntry],
    control: [ControlConnector],
    catalogBy: [String: ConnectorCatalogEntry]
  ) -> [String] {
    var providers: [String] = []
    func add(_ provider: String) {
      let key = provider.trimmingCharacters(in: .whitespacesAndNewlines)
      if key.isEmpty || providers.contains(key) { return }
      providers.append(key)
    }
    add("gmail")
    add("outlook")
    add("email")
    for item in catalog { add(item.provider) }
    let ordered = control.sorted { ($0.order ?? 999) < ($1.order ?? 999) }
    for item in ordered {
      let hidden = (item.status ?? "published") == "hidden"
      if hidden && catalogBy[item.provider] == nil { continue }
      add(item.provider)
    }
    for item in known { add(item.provider) }
    return providers
  }

  private static func card(
    provider: String,
    meta: Known?,
    ctrl: ControlConnector?,
    conn: ConnectorPublic?,
    apiBody: String?
  ) -> ConnectorCardModel {
    let fallbackTitle = provider.replacingOccurrences(of: "_", with: " ").capitalized
    let title = ctrl?.name ?? meta?.title ?? fallbackTitle
    let titleAr = ctrl?.nameAr ?? meta?.titleAr ?? meta?.title ?? provider
    let body = ctrl?.description ?? apiBody ?? meta?.body ?? provider
    let bodyAr = ctrl?.descriptionAr ?? meta?.bodyAr ?? apiBody ?? meta?.body ?? provider
    return ConnectorCardModel(
      id: provider,
      provider: provider,
      title: title,
      titleAr: titleAr,
      body: body,
      bodyAr: bodyAr,
      systemImage: meta?.symbol ?? "cable.connector",
      logoUrl: ctrl?.logoUrl,
      featured: ctrl?.featured ?? false,
      connected: conn != nil && (conn.map(Self.isLive) ?? false),
      connectionId: conn?.id,
      statusLabel: conn?.accountLabel ?? ""
    )
  }
}

struct ConnectorsHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var model = ConnectorsViewModel()

  private var arabic: Bool { session.localeIsArabic }
  private var connectedCount: Int { model.cards.filter(\.connected).count }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 8) {
          Text(L10n.t(.connectors, arabic: arabic))
            .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(L10n.t(.connectorsBody, arabic: arabic))
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
          HStack(spacing: 6) {
            Image(systemName: "powerplug")
            Text(L10n.connectorsCount(connectedCount, arabic: arabic))
          }
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.muted)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(theme.subtle)
          .clipShape(Capsule())
        }

        if let error = model.error {
          Text(error)
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.warn)
        }

        LazyVGrid(
          columns: Array(
            repeating: GridItem(.flexible(), spacing: 12),
            count: adaptive.connectorColumns
          ),
          spacing: 12
        ) {
          ForEach(model.cards) { card in
            connectorCard(card)
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .overlay {
      if model.isBusy && model.cards.isEmpty {
        ProgressView().tint(theme.lavender)
      }
    }
    .task { await model.reload() }
    .refreshable { await model.reload() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await model.reload() } }
    }
    .sheet(item: $model.tokenCard) { card in
      ConnectorTokenSheet(card: card, arabic: arabic) { token, label, config in
        try await model.submitToken(card, token: token, label: label, config: config)
      }
    }
  }

  private func connectorCard(_ card: ConnectorCardModel) -> some View {
    let selected = model.selectedId == card.id
    return VStack(alignment: .leading, spacing: 12) {
        HStack {
          ZStack(alignment: .bottomLeading) {
            ConnectorGlyph(provider: card.provider, logoUrl: card.logoUrl, size: 48)
            if card.connected {
              Image(systemName: "checkmark.circle.fill")
                .font(ArrabFont.system(size: 16))
                .foregroundStyle(theme.lavender)
                .offset(x: -4, y: 4)
            }
          }
          Spacer()
          Text(card.connected ? L10n.t(.connectedState, arabic: arabic) : L10n.t(.available, arabic: arabic))
            .font(ArrabFont.system(size: 11, weight: .semibold))
            .foregroundStyle(theme.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(theme.subtle)
            .clipShape(Capsule())
        }
        Text(arabic ? card.titleAr : card.title)
          .font(ArrabFont.system(size: 17, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(arabic ? card.bodyAr : card.body)
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
        if !card.statusLabel.isEmpty {
          Text(card.statusLabel)
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.faint)
        }
        HStack {
          if card.connected {
            Button(L10n.t(.delete, arabic: arabic)) {
              Task { await model.disconnect(card) }
            }
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.danger)
          } else {
            Button(arabic ? "ربط" : "Connect") {
              Task { await model.connect(card) }
            }
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.lavender)
          }
          Spacer()
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: ArrabTheme.radiusCard, style: .continuous)
          .stroke(selected || card.featured ? theme.lavender : theme.line, lineWidth: selected ? 2 : 1)
      )
      .contentShape(Rectangle())
      .onTapGesture { model.selectedId = card.id }
  }
}

struct ConnectorGlyph: View {
  let provider: String
  var logoUrl: String?
  var size: CGFloat = 40

  private var assetName: String { "connector-\(provider)" }

  var body: some View {
    ZStack {
      if let logoUrl, let url = URL(string: logoUrl), logoUrl.hasPrefix("http") {
        AsyncImage(url: url) { phase in
          if case .success(let image) = phase {
            image.resizable().scaledToFit()
          } else if case .failure = phase {
            local
          } else {
            ProgressView()
          }
        }
      } else {
        local
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
  }

  @ViewBuilder private var local: some View {
    if UIImage(named: assetName) != nil {
      Image(assetName)
        .resizable()
        .scaledToFit()
    } else {
      ConnectorDrawnMark(provider: provider)
    }
  }
}

struct ConnectorDrawnMark: View {
  let provider: String

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(fill)
      symbol
        .foregroundStyle(.white)
    }
  }

  private var fill: Color {
    switch provider {
    case "gmail", "email": return Color(hex: 0xEA4335)
    case "outlook": return Color(hex: 0x0A66C2)
    case "github": return Color(hex: 0x24292F)
    case "gitlab": return Color(hex: 0xFC6D26)
    case "bitbucket": return Color(hex: 0x2684FF)
    case "linear": return Color(hex: 0x5E6AD2)
    case "slack": return Color(hex: 0xE01E5A)
    case "notion": return Color(hex: 0x111111)
    case "whatsapp": return Color(hex: 0x25D366)
    case "ssh": return Color(hex: 0x15151B)
    case "finnhub": return Color(hex: 0x0E1A2B)
    case "whoop": return Color(hex: 0x111111)
    case "fitbit": return Color(hex: 0x00B0B9)
    case "google_drive": return Color(hex: 0x34A853)
    case "google_calendar": return Color(hex: 0x4285F4)
    case "figma": return Color(hex: 0xF24E1E)
    default: return Color(hex: 0x756096)
    }
  }

  @ViewBuilder private var symbol: some View {
    switch provider {
    case "outlook":
      Text("O")
        .font(ArrabFont.system(size: 18, weight: .bold, design: .rounded))
    case "figma":
      HStack(spacing: -4) {
        Circle().fill(Color(hex: 0xF24E1E)).frame(width: 10, height: 10)
        Circle().fill(Color(hex: 0xA259FF)).frame(width: 10, height: 10)
        Circle().fill(Color(hex: 0x1ABCFE)).frame(width: 10, height: 10)
      }
    case "fitbit":
      HStack(spacing: 3) {
        Circle().frame(width: 5, height: 5)
        VStack(spacing: 3) {
          Circle().frame(width: 5, height: 5)
          Circle().frame(width: 5, height: 5)
        }
        Circle().frame(width: 5, height: 5)
      }
    default:
      Image(systemName: icon)
        .font(ArrabFont.system(size: 16, weight: .bold))
    }
  }

  private var icon: String {
    switch provider {
    case "gmail": return "envelope.fill"
    case "email": return "envelope"
    case "github": return "chevron.left.forwardslash.chevron.right"
    case "gitlab": return "square.stack.3d.up.fill"
    case "bitbucket": return "shippingbox.fill"
    case "linear": return "checklist"
    case "slack": return "number"
    case "notion": return "doc.text.fill"
    case "whatsapp": return "message.fill"
    case "figma": return "paintbrush.fill"
    case "ssh": return "terminal.fill"
    case "finnhub": return "chart.line.uptrend.xyaxis"
    case "whoop": return "waveform.path.ecg"
    case "google_drive": return "externaldrive.fill"
    case "google_calendar": return "calendar"
    default: return "cable.connector"
    }
  }
}

struct ConnectorTokenSheet: View {
  let card: ConnectorCardModel
  let arabic: Bool
  let submit: (String, String, [String: String]) async throws -> Void

  @Environment(\.arrab) private var theme
  @Environment(\.dismiss) private var dismiss
  @State private var token = ""
  @State private var localError: String?
  @State private var address = ""
  @State private var preset = "icloud"
  @State private var imapHost = "imap.mail.me.com"
  @State private var smtpHost = "smtp.mail.me.com"
  @State private var host = ""
  @State private var port = "22"
  @State private var username = ""
  @State private var phoneId = ""
  @State private var wabaId = ""
  @State private var busy = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(arabic ? card.bodyAr : card.body)
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
        }
        if let localError {
          Text(localError)
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.warn)
        }
        fields
      }
      .navigationTitle(arabic ? card.titleAr : card.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(arabic ? "إلغاء" : "Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(arabic ? "ربط" : "Connect") {
            Task { await send() }
          }
          .disabled(!canSend || busy)
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  @ViewBuilder private var fields: some View {
    switch card.provider {
    case "email":
      Section(arabic ? "الحساب" : "Account") {
        TextField(arabic ? "البريد" : "Email address", text: $address)
          .font(ArrabFont.system(size: 16))
          .textInputAutocapitalization(.never)
          .keyboardType(.emailAddress)
        Picker(arabic ? "الخدمة" : "Service", selection: $preset) {
          Text("iCloud").tag("icloud")
          Text("Yahoo").tag("yahoo")
          Text(arabic ? "مخصص" : "Custom").tag("custom")
        }
        if preset == "custom" {
          TextField("IMAP", text: $imapHost)
            .font(ArrabFont.system(size: 16))
            .textInputAutocapitalization(.never)
          TextField("SMTP", text: $smtpHost)
            .font(ArrabFont.system(size: 16))
            .textInputAutocapitalization(.never)
        }
        SecureField(arabic ? "كلمة مرور التطبيق" : "App password", text: $token)
          .font(ArrabFont.system(size: 16))
      }
    case "ssh":
      Section(arabic ? "الجهاز" : "Host") {
        TextField(arabic ? "العنوان" : "Host", text: $host)
          .font(ArrabFont.system(size: 16))
          .textInputAutocapitalization(.never)
        TextField(arabic ? "المنفذ" : "Port", text: $port)
          .font(ArrabFont.system(size: 16))
          .keyboardType(.numberPad)
        TextField(arabic ? "المستخدم" : "Username", text: $username)
          .font(ArrabFont.system(size: 16))
          .textInputAutocapitalization(.never)
        SecureField(arabic ? "كلمة المرور أو المفتاح" : "Password or private key", text: $token)
          .font(ArrabFont.system(size: 16))
      }
    case "whatsapp":
      Section("WhatsApp") {
        TextField("Phone number ID", text: $phoneId)
          .font(ArrabFont.system(size: 16))
          .textInputAutocapitalization(.never)
        TextField("WABA ID", text: $wabaId)
          .font(ArrabFont.system(size: 16))
          .textInputAutocapitalization(.never)
        SecureField(arabic ? "رمز الوصول" : "Access token", text: $token)
          .font(ArrabFont.system(size: 16))
      }
    default:
      Section(arabic ? "المفتاح" : "Key") {
        SecureField(arabic ? "رمز الوصول" : "Access token", text: $token)
          .font(ArrabFont.system(size: 16))
      }
    }
  }

  private var canSend: Bool {
    switch card.provider {
    case "email": return address.contains("@") && token.count >= 4
    case "ssh": return !host.isEmpty && !username.isEmpty && token.count >= 4
    case "whatsapp": return !phoneId.isEmpty && !wabaId.isEmpty && token.count >= 8
    default: return token.count >= 8
    }
  }

  private func send() async {
    busy = true
    defer { busy = false }
    var config: [String: String] = [:]
    var label = ""
    switch card.provider {
    case "email":
      let hosts = emailHosts
      config = [
        "address": address.trimmingCharacters(in: .whitespacesAndNewlines),
        "preset": preset,
        "imapHost": hosts.imap,
        "smtpHost": hosts.smtp,
        "imapPort": "993",
        "smtpPort": "587",
      ]
      label = address.trimmingCharacters(in: .whitespacesAndNewlines)
    case "ssh":
      let key = token.contains("BEGIN")
      config = [
        "host": host.trimmingCharacters(in: .whitespacesAndNewlines),
        "port": port.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "22" : port,
        "username": username.trimmingCharacters(in: .whitespacesAndNewlines),
        "authMode": key ? "key" : "password",
      ]
      if key { config["privateKey"] = token }
      label = "\(username.trimmingCharacters(in: .whitespacesAndNewlines))@\(host.trimmingCharacters(in: .whitespacesAndNewlines))"
    case "whatsapp":
      config = [
        "phone_number_id": phoneId.trimmingCharacters(in: .whitespacesAndNewlines),
        "waba_id": wabaId.trimmingCharacters(in: .whitespacesAndNewlines),
      ]
      label = "WhatsApp \(phoneId.trimmingCharacters(in: .whitespacesAndNewlines))"
    default:
      break
    }
    do {
      try await submit(token.trimmingCharacters(in: .whitespacesAndNewlines), label, config)
    } catch {
      localError = error.localizedDescription
    }
  }

  private var emailHosts: (imap: String, smtp: String) {
    switch preset {
    case "yahoo": return ("imap.mail.yahoo.com", "smtp.mail.yahoo.com")
    case "custom": return (imapHost.trimmingCharacters(in: .whitespacesAndNewlines), smtpHost.trimmingCharacters(in: .whitespacesAndNewlines))
    default: return ("imap.mail.me.com", "smtp.mail.me.com")
    }
  }
}
