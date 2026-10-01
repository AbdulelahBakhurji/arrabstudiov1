import SwiftUI

private func text(_ key: ManagedStrings.Key, _ arabic: Bool) -> String {
  ManagedStrings.t(key, arabic: arabic)
}

private func backAtLabel(_ until: String?, arabic: Bool) -> String? {
  guard let date = ManagedRules.parseDate(until), date > Date() else { return nil }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: arabic ? "ar" : "en")
  formatter.dateFormat = "HH:mm"
  return text(.backAt, arabic).replacingOccurrences(of: "{time}", with: formatter.string(from: date))
}

/// Full-screen gate when the app is below `minVersion` (or a blocking force_update).
struct BlockingUpdateView: View {
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var session: AppSession

  var body: some View {
    let ar = session.localeIsArabic
    VStack(spacing: 14) {
      Image(systemName: "arrow.down.app.fill")
        .font(ArrabFont.system(size: 34, weight: .semibold))
        .foregroundStyle(ArrabTheme.danger)
      Text(text(.blockingTitle, ar))
        .font(ArrabFont.system(size: 20, weight: .semibold))
        .foregroundStyle(ArrabTheme.text)
      Text(managed.maintenance?.message?.text(arabic: ar) ?? text(.blockingBody, ar))
        .font(ArrabFont.system(size: 14))
        .foregroundStyle(ArrabTheme.muted)
        .multilineTextAlignment(.center)
      VStack(spacing: 8) {
        Button(text(.updateNow, ar)) { managed.openStore() }
          .buttonStyle(ManagedButtonStyle(primary: true))
        Button(text(.readChats, ar)) { managed.blockingCollapsed = true }
          .buttonStyle(ManagedButtonStyle(primary: false))
        Button(text(.signOut, ar)) { Task { await session.signOut() } }
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(ArrabTheme.muted)
      }
      .padding(.top, 6)
    }
    .padding(28)
    .frame(maxWidth: 420)
    .background(RoundedRectangle(cornerRadius: 22).fill(ArrabTheme.card))
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ArrabTheme.bg.opacity(0.94).ignoresSafeArea())
    .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
  }
}

/// Top-of-screen strip: collapsed blocking bar, read-only/message banner, or soft update.
struct ManagedBanner: View {
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var session: AppSession

  var body: some View {
    let ar = session.localeIsArabic
    Group {
      if managed.updateMode == .blocking {
        row(text(.updateRequiredBar, ar), color: ArrabTheme.danger) {
          Button(text(.updateNow, ar)) { managed.openStore() }.buttonStyle(ManagedPillStyle())
        }
      } else if let m = managed.maintenance, m.readOnly || m.message != nil {
        let message = m.message?.text(arabic: ar) ?? text(.readOnlyDefault, ar)
        let when = backAtLabel(m.until, arabic: ar).map { " · \($0)" } ?? ""
        row(message + when, color: color(for: m.severity)) { EmptyView() }
      } else if managed.showSoftBanner {
        row(text(.softTitle, ar), color: ArrabTheme.accent) {
          HStack(spacing: 8) {
            Button(text(.later, ar)) { managed.dismissSoftUpdate() }
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(ArrabTheme.muted)
            Button(text(.updateNow, ar)) { managed.openStore() }.buttonStyle(ManagedPillStyle())
          }
        }
      }
    }
    .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
  }

  private func color(for severity: MaintenanceSeverity) -> Color {
    switch severity {
    case .critical: return ArrabTheme.danger
    case .warning: return ArrabTheme.warn
    case .info: return ArrabTheme.accent
    }
  }

  private func row<Action: View>(_ message: String, color: Color, @ViewBuilder action: () -> Action) -> some View {
    HStack(spacing: 10) {
      Text(message)
        .font(ArrabFont.system(size: 12.5))
        .foregroundStyle(ArrabTheme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
      action()
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
    .background(RoundedRectangle(cornerRadius: 12).fill(color.opacity(0.16)))
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(color.opacity(0.4), lineWidth: 1))
    .padding(.horizontal, 12)
    .padding(.top, 6)
  }
}

/// Bell with unread dot; opens the in-app notification center.
struct ManagedBellButton: View {
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var session: AppSession
  @State private var open = false

  var body: some View {
    Button { open = true } label: {
      Image(systemName: "bell")
        .font(ArrabFont.system(size: 16, weight: .semibold))
        .foregroundStyle(ArrabTheme.text)
        .padding(10)
        .background(Circle().fill(ArrabTheme.card))
        .overlay(alignment: .topTrailing) {
          if managed.unreadCount > 0 {
            Circle().fill(ArrabTheme.warn).frame(width: 8, height: 8).offset(x: -6, y: 6)
          }
        }
    }
    .accessibilityLabel(text(.notifications, session.localeIsArabic))
    .sheet(isPresented: $open) {
      ManagedNotificationCenter()
        .environmentObject(managed)
        .environmentObject(session)
    }
  }
}

struct ManagedNotificationCenter: View {
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var session: AppSession
  @Environment(\.dismiss) private var close

  var body: some View {
    let ar = session.localeIsArabic
    NavigationStack {
      List {
        if managed.inbox.isEmpty {
          Text(text(.notificationsEmpty, ar)).foregroundStyle(ArrabTheme.muted)
        }
        ForEach(managed.inbox) { item in
          Button {
            managed.open(item)
            close()
          } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text(item.notification.title.text(arabic: ar))
                .font(ArrabFont.system(size: 14, weight: item.read ? .regular : .semibold))
              if let body = item.notification.body {
                Text(body.text(arabic: ar)).font(ArrabFont.system(size: 13)).foregroundStyle(ArrabTheme.muted)
              }
              Text(item.receivedAt, style: .relative).font(ArrabFont.system(size: 11)).foregroundStyle(ArrabTheme.muted)
            }
          }
          .swipeActions {
            Button(text(.dismiss, ar), role: .destructive) { managed.dismiss(item) }
          }
        }
      }
      .navigationTitle(text(.notifications, ar))
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button(text(.markAllRead, ar)) { managed.markRead(nil) }.disabled(managed.unreadCount == 0)
        }
      }
    }
    .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
  }
}

/// Composer meter: quiet below 80%, warning at 80/95%, a full card at 100%.
struct ManagedUsageMeter: View {
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.openURL) private var openURL

  var body: some View {
    let ar = session.localeIsArabic
    let status = ManagedRules.limitLevel(managed.config?.limits)
    if managed.serverLimitMessage != nil || status.level == .blocked {
      limitCard(arabic: ar, resetsAt: managed.config?.limits?.resetsAt)
        .onAppear { UsageNotice.postIfNeeded(resetsAt: managed.config?.limits?.resetsAt, arabic: ar) }
    } else if status.level >= .warn80 {
      let pct = String(Int((status.ratio * 100).rounded(.down)))
      Text(text(.usageWarn, ar).replacingOccurrences(of: "{pct}", with: pct))
        .font(ArrabFont.system(size: 12, weight: .medium))
        .foregroundStyle(theme.warn)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
    }
  }

  private func limitCard(arabic: Bool, resetsAt: String?) -> some View {
    let resets = ManagedRules.parseDate(resetsAt)
      .map { $0.formatted(date: .abbreviated, time: .omitted) } ?? "—"
    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        Text("100%")
          .font(ArrabFont.system(size: 13, weight: .bold))
          .foregroundStyle(theme.onPrimary)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(theme.danger)
          .clipShape(Capsule())
        Text(text(.usageFullTitle, arabic))
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      Text(text(.usageFullBody, arabic))
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
      Text(text(.usageBlocked, arabic).replacingOccurrences(of: "{time}", with: resets))
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        planButton(text(.addCredit, arabic), intent: "usage", primary: true)
        planButton(text(.managePlan, arabic), intent: "renew", primary: false)
      }
    }
    .padding(14)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
    .padding(.horizontal, 14)
    .padding(.vertical, 6)
  }

  private func planButton(_ title: String, intent: String, primary: Bool) -> some View {
    Button {
      var parts = URLComponents(string: "https://studio.arrabai.com/plans")
      parts?.queryItems = [
        URLQueryItem(name: "intent", value: intent),
        URLQueryItem(name: "source", value: "ios"),
      ]
      if let url = parts?.url { openURL(url) }
    } label: {
      Text(title)
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(primary ? theme.onPrimary : theme.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(primary ? theme.primary : theme.subtle)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}

enum UsageNotice {
  static func postIfNeeded(resetsAt: String?, arabic: Bool) {
    let stamp = resetsAt ?? "period"
    let key = "arrab.usage.notice.\(stamp)"
    guard !UserDefaults.standard.bool(forKey: key) else { return }
    UserDefaults.standard.set(true, forKey: key)
    let notice = ClientNotification(
      id: "usage-\(stamp)",
      title: LocalizedText(en: "Usage is full", ar: "اكتمل الاستخدام"),
      body: LocalizedText(
        en: "You’ve used 100% of this period.",
        ar: "استخدمت ١٠٠٪ من هذه الفترة."
      ),
      kind: .warning,
      deepLink: "arrab://settings",
      native: true,
      inApp: true,
      expiresAt: nil
    )
    PushRegistration.postLocal(notice, arabic: arabic)
  }
}

@MainActor
final class ApprovalInbox: ObservableObject {
  static let shared = ApprovalInbox()
  @Published var pending: [PendingApproval] = []
  private var seen: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "arrab.approvals.seen") ?? [])

  func refresh(arabic: Bool) async {
    guard let items = try? await ArrabAPIClient.shared.pendingApprovals() else { return }
    let waiting = items.filter { $0.status == "pending" && Self.needsPerson($0) }
    pending = waiting
    let prefs = NotificationPrefsStore()
    guard prefs.companions else { return }
    for item in waiting.prefix(3) where !seen.contains(item.id) {
      seen.insert(item.id)
      let notice = ClientNotification(
        id: "approval-\(item.id)",
        title: LocalizedText(en: "Approval needed", ar: "يلزم موافقة"),
        body: LocalizedText(en: item.title, ar: item.title),
        kind: .companion,
        deepLink: "arrab://chat",
        native: true,
        inApp: true,
        expiresAt: nil
      )
      PushRegistration.postLocal(notice, arabic: arabic)
    }
    UserDefaults.standard.set(Array(seen), forKey: "arrab.approvals.seen")
  }

  func decide(_ item: PendingApproval, approved: Bool) async {
    if approved, let detail = item.detail, let ran = Self.localTool(detail) {
      if let token = ran.token {
        _ = try? await ArrabAPIClient.shared.resolveTool(
          approvalId: item.id,
          toolResult: ran.result,
          attestation: PhoneCompanionTools.attest(token: token, result: ran.result)
        )
      }
    } else {
      try? await ArrabAPIClient.shared.resolveApproval(id: item.id, status: approved ? "approved" : "rejected")
    }
    pending.removeAll { $0.id == item.id }
  }

  private static func needsPerson(_ item: PendingApproval) -> Bool {
    guard item.kind == "call_tool", let detail = item.detail,
          let tool = toolName(detail) else { return true }
    let automatic: Set<String> = [
      "generate_pdf", "generate_docx", "generate_presentation", "generate_image",
      "export_csv", "preview_html", "write_file",
    ]
    return !automatic.contains(tool)
  }

  private static func toolName(_ detail: String) -> String? {
    guard let data = detail.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return obj["toolName"] as? String
  }

  private static func localTool(_ detail: String) -> (result: String, token: String?)? {
    guard let data = detail.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let tool = obj["toolName"] as? String else { return nil }
    var args: [String: String] = [:]
    if let raw = obj["arguments"] as? [String: Any] {
      for (key, value) in raw {
        if let text = value as? String { args[key] = text }
      }
    }
    let ran = PhoneCompanionTools.run(tool: tool, args: args)
    let token = (obj["resultToken"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return (ran.result, (token?.count ?? 0) >= 16 ? token : nil)
  }
}

/// Settings → Privacy disclosure (required wording).
struct ManagedPrivacyCard: View {
  @EnvironmentObject private var session: AppSession

  var body: some View {
    let ar = session.localeIsArabic
    ArrabCard {
      VStack(alignment: .leading, spacing: 6) {
        Text(text(.privacyTitle, ar))
          .font(ArrabFont.system(size: 12, weight: .bold))
          .foregroundStyle(ArrabTheme.muted)
        Text(text(.privacyDisclosure, ar))
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(ArrabTheme.text)
      }
    }
    .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
  }
}

/// Everything Arrab Control can put on top of the app: gate, message and consent prompts.
struct ManagedOverlayModifier: ViewModifier {
  @ObservedObject var managed: ManagedClient
  let arabic: Bool

  func body(content: Content) -> some View {
    content
      .overlay {
        if managed.updateMode == .blocking && !managed.blockingCollapsed {
          BlockingUpdateView()
        }
      }
      .alert(
        managed.message?.title.text(arabic: arabic) ?? "",
        isPresented: Binding(get: { managed.message != nil }, set: { if !$0 { managed.message = nil } })
      ) {
        Button(text(.ok, arabic)) { managed.message = nil }
      } message: {
        Text(managed.message?.body?.text(arabic: arabic) ?? "")
      }
      .alert(
        text(.logsTitle, arabic),
        isPresented: Binding(
          get: { managed.logsConsentPending },
          set: { if !$0 && managed.logsConsentPending { managed.answerLogsConsent(false) } }
        )
      ) {
        Button(text(.logsShare, arabic)) { managed.answerLogsConsent(true) }
        Button(text(.logsDecline, arabic), role: .cancel) { managed.answerLogsConsent(false) }
      } message: {
        Text(text(.logsBody, arabic))
      }
  }
}

struct ManagedButtonStyle: ButtonStyle {
  let primary: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(ArrabFont.system(size: 15, weight: .semibold))
      .foregroundStyle(primary ? ArrabTheme.onPrimary : ArrabTheme.text)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
      .background(RoundedRectangle(cornerRadius: 12).fill(primary ? ArrabTheme.primary : ArrabTheme.subtle))
      .opacity(configuration.isPressed ? 0.8 : 1)
  }
}

struct ManagedPillStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(ArrabFont.system(size: 12, weight: .semibold))
      .foregroundStyle(ArrabTheme.onPrimary)
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(Capsule().fill(ArrabTheme.primary))
      .opacity(configuration.isPressed ? 0.8 : 1)
  }
}
