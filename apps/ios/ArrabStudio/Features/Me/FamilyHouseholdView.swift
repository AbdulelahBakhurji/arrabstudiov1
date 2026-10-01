import SwiftUI

struct FamilySnapshot: Decodable {
  var available: Bool
  var planName: String?
  var seatsUsed: Int
  var seatLimit: Int
  var members: [FamilySeat]
  var activeMemberId: String?
  var seatLocked: Bool
  var usage: FamilyUsage?
  var recentGuidance: [FamilyNote]
}

struct FamilySeat: Decodable, Identifiable, Equatable {
  var id: String
  var displayName: String
  var role: String
  var ageTier: String?
  var email: String?
  var isOwner: Bool
  var isPaused: Bool
  var isManager: Bool
  var tokenAllowance: Int
  var tokensUsed: Int
  var tokensRemaining: Int
  var usagePercent: Double
}

struct FamilyUsage: Decodable {
  var unallocatedTokens: Int?
}

struct FamilyNote: Decodable, Identifiable {
  var id: String
  var companionId: String
  var childMemberId: String
  var authorName: String
  var content: String
}

struct FamilyCreateBody: Encodable {
  var displayName: String
  var role: String
  var ageTier: String?
  var email: String?
  var password: String?
}

struct FamilyGuideBody: Encodable {
  var companionId: String
  var childMemberId: String
  var authorMemberId: String
  var content: String
}

private enum FamilyPage: String, CaseIterable {
  case notices, members, guide, tokens, guardian
}

struct FamilyControlView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @ObservedObject private var notices = FamilyNotices.shared
  @State private var noticeFilter = "all"

  @State private var snapshot: FamilySnapshot?
  @State private var page: FamilyPage = .members
  @State private var selectedId: String?
  @State private var error: String?
  @State private var busy = false
  @State private var adding = false
  @State private var wizardEmail = ""
  @State private var wizardInviting = false
  @State private var inviteEmail = ""
  @State private var grantText = ""
  @State private var guideText = ""
  @State private var guideCompanion = ""
  @State private var guideChild = ""

  private var arabic: Bool { session.localeIsArabic }
  private var selected: FamilySeat? { snapshot?.members.first { $0.id == selectedId } }
  private var children: [FamilySeat] { snapshot?.members.filter { $0.role == "child" } ?? [] }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: adaptive.isPadLike ? 18 : 14) {
        Text(L10n.t(.familyControl, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(L10n.t(.familyHousehold, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.isSmallPhone ? 13 : 14))
          .foregroundStyle(theme.muted)

        topActions
        if notices.unread > 0 {
          Button {
            page = .notices
          } label: {
            HStack(spacing: 10) {
              Image(systemName: "bell.badge.fill")
              Text(arabic ? "\(notices.unread) تنبيهات جديدة" : "\(notices.unread) new notices")
                .font(ArrabFont.system(size: 14, weight: .semibold))
              Spacer()
            }
            .foregroundStyle(theme.text)
            .padding(14)
            .background(theme.lavenderSoft)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
          }
          .buttonStyle(.plain)
        }

        if let error {
          Text(error)
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.warn)
        }

        if snapshot?.available == true {
          seatsLine
          pageChips
          switch page {
          case .notices: noticesPage
          case .members: membersPage
          case .guide: guidePage
          case .tokens: tokensPage
          case .guardian: guardianPage
          }
        } else if snapshot != nil {
          ArrabCard {
            Text(L10n.t(.familyUnavailable, arabic: arabic))
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.muted)
          }
          if page == .notices { noticesPage } else { guardianPage }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.isPadLike ? 860 : .infinity)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(theme.bg)
    .overlay { if busy && snapshot == nil { ProgressView().tint(theme.lavender) } }
    .task { await reload() }
    .refreshable { await reload() }
    .fullScreenCover(isPresented: $adding) {
      FamilySetupWizard(email: wizardEmail, inviting: wizardInviting) { body, prefs in
        await create(body, prefs: prefs)
      }
    }
  }

  private var topActions: some View {
    VStack(alignment: .leading, spacing: 12) {
      Button {
        wizardEmail = ""
        wizardInviting = false
        adding = true
      } label: {
        HStack(spacing: 12) {
          Image(systemName: "person.badge.plus")
            .font(ArrabFont.system(size: adaptive.isPadLike ? 22 : 18, weight: .semibold))
          VStack(alignment: .leading, spacing: 2) {
            Text(L10n.t(.familyCreatePerson, arabic: arabic))
              .font(ArrabFont.system(size: adaptive.isPadLike ? 17 : 15, weight: .semibold))
            Text(L10n.t(.familyCreateHint, arabic: arabic))
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.onPrimary.opacity(0.8))
              .lineLimit(2)
          }
          Spacer(minLength: 0)
        }
        .foregroundStyle(theme.onPrimary)
        .padding(adaptive.isSmallPhone ? 14 : 16)
        .background(theme.primary)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
      }
      .buttonStyle(.plain)

      VStack(alignment: .leading, spacing: 8) {
        Text(L10n.t(.familyInvite, arabic: arabic))
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(L10n.t(.familyInviteHint, arabic: arabic))
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
        HStack(spacing: 8) {
          TextField(L10n.t(.familyEmail, arabic: arabic), text: $inviteEmail)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
            .font(ArrabFont.system(size: 16))
            .padding(12)
            .background(theme.bg)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
          Button {
            wizardEmail = inviteEmail.trimmingCharacters(in: .whitespacesAndNewlines)
            wizardInviting = true
            adding = true
          } label: {
            Image(systemName: "paperplane.fill")
              .font(ArrabFont.system(size: 16, weight: .semibold))
              .foregroundStyle(inviteReady ? theme.onPrimary : theme.muted)
              .frame(width: 48, height: 48)
              .background(inviteReady ? theme.lavender : theme.line)
              .clipShape(Circle())
          }
          .buttonStyle(.plain)
          .disabled(!inviteReady)
          .accessibilityLabel(L10n.t(.familyInvite, arabic: arabic))
        }
      }
      .padding(adaptive.isSmallPhone ? 14 : 16)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(theme.line, lineWidth: 1))
    }
  }

  private var inviteReady: Bool {
    inviteEmail.trimmingCharacters(in: .whitespacesAndNewlines).contains("@")
  }

  private var seatsLine: some View {
    HStack {
      Text(L10n.t(.familySeats, arabic: arabic))
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.muted)
      Spacer()
      Text("\(snapshot?.seatsUsed ?? 0) / \(snapshot?.seatLimit ?? 0)")
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.text)
      if let name = snapshot?.planName, !name.isEmpty {
        Text(name)
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.lavender)
      }
    }
  }

  private var pageChips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        chip(.notices, L10n.t(.familyNotices, arabic: arabic), badge: notices.unread)
        chip(.members, L10n.t(.familyMembers, arabic: arabic))
        chip(.guide, L10n.t(.familyGuide, arabic: arabic))
        chip(.tokens, L10n.t(.familyTokens, arabic: arabic))
        chip(.guardian, L10n.t(.familyControl, arabic: arabic))
      }
    }
  }

  private func chip(_ id: FamilyPage, _ title: String, badge: Int = 0) -> some View {
    let on = page == id
    return Button {
      page = id
    } label: {
      HStack(spacing: 6) {
        Text(title)
        if badge > 0 {
          Text("\(badge)")
            .font(ArrabFont.system(size: 11, weight: .bold))
            .foregroundStyle(on ? theme.primary : theme.onPrimary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(on ? theme.onPrimary : theme.lavender)
            .clipShape(Capsule())
        }
      }
      .font(ArrabFont.system(size: adaptive.isSmallPhone ? 12 : 13, weight: .semibold))
      .foregroundStyle(on ? theme.onPrimary : theme.text)
      .padding(.horizontal, adaptive.isPadLike ? 16 : 12)
      .padding(.vertical, adaptive.isSmallPhone ? 8 : 10)
      .background(on ? theme.primary : theme.card)
      .clipShape(Capsule())
      .overlay(Capsule().stroke(on ? Color.clear : theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private var noticesPage: some View {
    let shown = notices.items.filter { item in
      if noticeFilter == "care" { return notices.isCare(item.kind) }
      if noticeFilter == "house" { return !notices.isCare(item.kind) }
      return true
    }
    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        noticeChip("all", L10n.t(.familyNoticeAll, arabic: arabic))
        noticeChip("care", L10n.t(.familyNoticeCare, arabic: arabic))
        noticeChip("house", L10n.t(.familyNoticeHouse, arabic: arabic))
        Spacer()
        if !notices.items.isEmpty {
          Button(L10n.t(.familyNoticeClear, arabic: arabic)) { notices.clear() }
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.muted)
        }
      }
      if shown.isEmpty {
        Text(L10n.t(.familyNoticesEmpty, arabic: arabic))
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)
          .padding(.vertical, 12)
      }
      ForEach(shown) { item in
        Button {
          notices.markRead(item.id)
        } label: {
          HStack(alignment: .top, spacing: 10) {
            Circle()
              .fill(item.read ? Color.clear : theme.lavender)
              .frame(width: 8, height: 8)
              .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
              Text(notices.title(item, arabic: arabic))
                .font(ArrabFont.system(size: adaptive.isPadLike ? 16 : 15, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(notices.body(item, arabic: arabic))
                .font(ArrabFont.system(size: 13))
                .foregroundStyle(theme.muted)
                .multilineTextAlignment(arabic ? .trailing : .leading)
              Text(item.at.formatted(date: .abbreviated, time: .shortened))
                .font(ArrabFont.system(size: 11))
                .foregroundStyle(theme.muted)
            }
            Spacer(minLength: 0)
          }
          .padding(14)
          .background(item.read ? theme.card : theme.lavenderSoft.opacity(0.45))
          .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu {
          Button(arabic ? "حذف" : "Delete") { notices.remove(item.id) }
        }
      }
      if !shown.isEmpty {
        Button(arabic ? "تعليم الكل كمقروء" : "Mark all read") { notices.markAllRead() }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.lavender)
      }
    }
  }

  private func noticeChip(_ id: String, _ title: String) -> some View {
    let on = noticeFilter == id
    return Button { noticeFilter = id } label: {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(on ? theme.onPrimary : theme.text)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(on ? theme.primary : theme.subtle)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private var membersPage: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(snapshot?.members ?? []) { member in
        memberCard(member)
      }
      Button {
        adding = true
      } label: {
        Text(L10n.t(.familyAdd, arabic: arabic))
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

  private func memberCard(_ member: FamilySeat) -> some View {
    let on = selectedId == member.id || snapshot?.activeMemberId == member.id
    return ArrabCard {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 12) {
          Text(String(member.displayName.prefix(1)))
            .font(ArrabFont.system(size: adaptive.isPadLike ? 18 : 16, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .frame(width: face, height: face)
            .background(theme.lavender)
            .clipShape(Circle())
          VStack(alignment: .leading, spacing: 3) {
            Text(member.displayName)
              .font(ArrabFont.system(size: adaptive.isPadLike ? 17 : 15, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(meta(member))
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
            if let email = member.email, !email.isEmpty {
              Text(email)
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
                .lineLimit(1)
            }
            if let prefs = FamilySeatStore.load(member.id), prefs.bedtimeOn {
              Text("\(L10n.t(.familyBedtime, arabic: arabic)) \(String(format: "%02d:00", prefs.bedtime))")
                .font(ArrabFont.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.lavender)
            }
          }
          Spacer()
          if snapshot?.activeMemberId == member.id {
            Image(systemName: "checkmark.circle.fill")
              .foregroundStyle(theme.lavender)
          }
        }
        ProgressView(value: min(max(member.usagePercent, 0), 100), total: 100)
          .tint(theme.lavender)
        if selectedId == member.id {
          HStack(spacing: 8) {
            action(member.isPaused ? L10n.t(.familyResume, arabic: arabic) : L10n.t(.familyPause, arabic: arabic)) {
              await setPaused(member, !member.isPaused)
            }
            if snapshot?.seatLocked != true {
              action(L10n.t(.familySwitch, arabic: arabic)) {
                await switchSeat(member)
              }
            }
            if !member.isOwner {
              action(L10n.t(.delete, arabic: arabic)) {
                await remove(member)
              }
            }
          }
        }
      }
    }
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(on ? theme.lavender : Color.clear, lineWidth: 1.5)
    )
    .onTapGesture { selectedId = member.id }
  }

  private var guidePage: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(L10n.t(.familyGuideHint, arabic: arabic))
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      if children.isEmpty {
        Text(arabic ? "أضف طفلاً أولاً." : "Add a child first.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
      } else {
        pickerRow(arabic ? "الطفل" : "Child", selection: $guideChild, options: children.map { ($0.id, $0.displayName) })
        pickerRow(arabic ? "الرفيق" : "Companion", selection: $guideCompanion, options: companionOptions)
        TextField(L10n.t(.familyGuide, arabic: arabic), text: $guideText, axis: .vertical)
          .lineLimit(2...4)
          .font(ArrabFont.system(size: 15))
          .padding(12)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        Button {
          Task { await saveGuide() }
        } label: {
          Text(L10n.t(.safeSave, arabic: arabic))
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(theme.primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(guideText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || guideChild.isEmpty || guideCompanion.isEmpty)
      }
      ForEach(snapshot?.recentGuidance ?? []) { note in
        ArrabCard {
          VStack(alignment: .leading, spacing: 4) {
            Text(note.authorName)
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.muted)
            Text(note.content)
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.text)
          }
        }
      }
    }
  }

  private var tokensPage: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let pool = snapshot?.usage?.unallocatedTokens {
        Text(arabic ? "المتاح للبيت: \(pool)" : "Household pool: \(pool)")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
      }
      if let member = selected ?? snapshot?.members.first {
        Text(member.displayName)
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(arabic
          ? "المستخدم \(member.tokensUsed) من \(member.tokenAllowance)"
          : "Used \(member.tokensUsed) of \(member.tokenAllowance)")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
        TextField(L10n.t(.familyTokens, arabic: arabic), text: $grantText)
          .keyboardType(.numberPad)
          .font(ArrabFont.system(size: 16))
          .padding(12)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        Button {
          Task { await grant(member) }
        } label: {
          Text(L10n.t(.familyGrant, arabic: arabic))
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

  private var guardianPage: some View {
    VStack(alignment: .leading, spacing: 12) {
      ArrabCard {
        Toggle(isOn: quiet) {
          VStack(alignment: .leading, spacing: 4) {
            Text(L10n.t(.quietHours, arabic: arabic))
              .foregroundStyle(theme.text)
            Text(String(format: "%02d:00 – %02d:00", session.familyGuard.quietStart, session.familyGuard.quietEnd))
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
          }
        }
        .tint(theme.lavender)
      }
      ArrabCard {
        Toggle(isOn: approval) {
          VStack(alignment: .leading, spacing: 4) {
            Text(L10n.t(.approvalRequired, arabic: arabic))
              .foregroundStyle(theme.text)
            Text(L10n.t(.approvalBody, arabic: arabic))
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
          }
        }
        .tint(theme.lavender)
      }
      Text(L10n.t(.boundary, arabic: arabic))
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        boundaryButton("open", .boundaryOpen)
        boundaryButton("guided", .boundaryGuided)
        boundaryButton("strict", .boundaryStrict)
      }
    }
  }

  private var face: CGFloat { adaptive.isPadLike ? 44 : (adaptive.isSmallPhone ? 34 : 38) }

  private var companionOptions: [(String, String)] {
    companions.companions.map { ($0.id, $0.displayName(arabic: arabic)) }
  }

  private func meta(_ member: FamilySeat) -> String {
    var parts = [roleName(member.role)]
    if let age = ageName(member.ageTier) { parts.append(age) }
    if member.isPaused { parts.append(L10n.t(.familyPause, arabic: arabic)) }
    return parts.joined(separator: " · ")
  }

  private func roleName(_ role: String) -> String {
    switch role {
    case "parent": return L10n.t(.familyParent, arabic: arabic)
    case "partner": return L10n.t(.familyPartner, arabic: arabic)
    case "child": return L10n.t(.familyChild, arabic: arabic)
    default: return role
    }
  }

  private func ageName(_ tier: String?) -> String? {
    switch tier {
    case "tier_6_9": return L10n.t(.familyAge69, arabic: arabic)
    case "tier_10_13": return L10n.t(.familyAge1013, arabic: arabic)
    case "tier_14_17": return L10n.t(.familyAge1417, arabic: arabic)
    default: return nil
    }
  }

  private func action(_ title: String, run: @escaping () async -> Void) -> some View {
    Button {
      Task { await run() }
    } label: {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.text)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(theme.subtle)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private func pickerRow(_ title: String, selection: Binding<String>, options: [(String, String)]) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.muted)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(options, id: \.0) { option in
            let on = selection.wrappedValue == option.0
            Button { selection.wrappedValue = option.0 } label: {
              Text(option.1)
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(on ? theme.onPrimary : theme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(on ? theme.primary : theme.card)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }

  private var quiet: Binding<Bool> {
    Binding(
      get: { session.familyGuard.quietHours },
        set: { value in
          var next = session.familyGuard
          next.quietHours = value
          session.familyGuard = next
          let window = String(format: "%02d:00", next.quietStart)
          notices.post(kind: value ? "quietOn" : "quietOff", detail: window, arabic: arabic)
          Task { await notices.scheduleQuiet(start: next.quietStart, enabled: value, arabic: arabic) }
        }
    )
  }

  private var approval: Binding<Bool> {
    Binding(
      get: { session.familyGuard.approvalRequired },
        set: { value in
          var next = session.familyGuard
          next.approvalRequired = value
          session.familyGuard = next
          notices.post(kind: value ? "approvalOn" : "approvalOff", arabic: arabic)
        }
    )
  }

  private func boundaryButton(_ id: String, _ key: L10n.Key) -> some View {
    let selected = session.familyGuard.boundary == id
    return Button {
      var next = session.familyGuard
      next.boundary = id
      session.familyGuard = next
      notices.post(kind: "boundary", detail: L10n.t(key, arabic: arabic), arabic: arabic)
    } label: {
      Text(L10n.t(key, arabic: arabic))
        .font(ArrabFont.system(size: adaptive.isSmallPhone ? 12 : 13, weight: .semibold))
        .foregroundStyle(selected ? theme.onPrimary : theme.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, adaptive.isSmallPhone ? 10 : 12)
        .background(selected ? theme.primary : theme.card)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private func reload() async {
    busy = true
    defer { busy = false }
    do {
      let next = try await ArrabAPIClient.shared.familySnapshot()
      snapshot = next
      if selectedId == nil { selectedId = next.activeMemberId ?? next.members.first?.id }
      if let active = next.activeMemberId { FamilySeatStore.setActive(active) }
      if guideChild.isEmpty { guideChild = next.members.first { $0.role == "child" }?.id ?? "" }
      if guideCompanion.isEmpty { guideCompanion = companions.companions.first?.id ?? "" }
      for member in next.members {
        if let prefs = FamilySeatStore.load(member.id), prefs.bedtimeOn, !member.isPaused {
          await notices.scheduleBedtime(id: member.id, name: member.displayName, hour: prefs.bedtime, arabic: arabic)
        }
      }
      await notices.scheduleQuiet(start: session.familyGuard.quietStart, enabled: session.familyGuard.quietHours, arabic: arabic)
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func create(_ body: FamilyCreateBody, prefs: FamilySeatStore.Prefs?) async -> (FamilySeat?, String?) {
    do {
      let seat = try await ArrabAPIClient.shared.createFamilyMember(body)
      if let prefs {
        FamilySeatStore.save(seat.id, prefs)
        await notices.scheduleBedtime(id: seat.id, name: seat.displayName, hour: prefs.bedtime, arabic: arabic)
        notices.post(kind: "bedtime", name: seat.displayName, detail: String(format: "%02d:00", prefs.bedtime), arabic: arabic)
      }
      notices.post(kind: "member", name: seat.displayName, arabic: arabic)
      await reload()
      return (seat, nil)
    } catch {
      return (nil, error.localizedDescription)
    }
  }

  private func setPaused(_ member: FamilySeat, _ paused: Bool) async {
    do {
      try await ArrabAPIClient.shared.updateFamilyMember(id: member.id, paused: paused)
      notices.post(kind: paused ? "pause" : "resume", name: member.displayName, arabic: arabic)
      if paused {
        notices.cancelBedtime(id: member.id)
      } else if let prefs = FamilySeatStore.load(member.id), prefs.bedtimeOn {
        await notices.scheduleBedtime(id: member.id, name: member.displayName, hour: prefs.bedtime, arabic: arabic)
      }
      await reload()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func switchSeat(_ member: FamilySeat) async {
    do {
      try await ArrabAPIClient.shared.switchFamilyMember(member.id)
      FamilySeatStore.setActive(member.id)
      notices.post(kind: "switch", name: member.displayName, arabic: arabic)
      await reload()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func remove(_ member: FamilySeat) async {
    do {
      try await ArrabAPIClient.shared.deleteFamilyMember(member.id)
      notices.cancelBedtime(id: member.id)
      if selectedId == member.id { selectedId = nil }
      await reload()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func grant(_ member: FamilySeat) async {
    let tokens = Int(grantText.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
    guard tokens > 0 else { return }
    do {
      snapshot = try await ArrabAPIClient.shared.grantFamilyTokens(memberId: member.id, tokens: tokens)
      notices.post(kind: "tokens", name: member.displayName, detail: "\(tokens)", arabic: arabic)
      grantText = ""
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func saveGuide() async {
    let text = guideText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !guideChild.isEmpty, !guideCompanion.isEmpty else { return }
    let author = snapshot?.members.first { $0.isManager }?.id ?? snapshot?.activeMemberId ?? ""
    guard !author.isEmpty else { return }
    do {
      try await ArrabAPIClient.shared.addFamilyGuidance(
        FamilyGuideBody(companionId: guideCompanion, childMemberId: guideChild, authorMemberId: author, content: text)
      )
      guideText = ""
      let child = snapshot?.members.first { $0.id == guideChild }?.displayName ?? ""
      notices.post(kind: "guidance", name: child, arabic: arabic)
      await reload()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

enum FamilySeatStore {
  struct Prefs: Codable, Equatable {
    var bedtime: Int
    var bedtimeOn: Bool
    var kidSafe: Bool
    var oversight: String
  }

  private static let activeKey = "arrab.family.activeSeat"

  static func save(_ id: String, _ prefs: Prefs) {
    guard let data = try? JSONEncoder().encode(prefs) else { return }
    UserDefaults.standard.set(data, forKey: key(id))
  }

  static func load(_ id: String) -> Prefs? {
    guard let data = UserDefaults.standard.data(forKey: key(id)) else { return nil }
    return try? JSONDecoder().decode(Prefs.self, from: data)
  }

  static func setActive(_ id: String?) {
    UserDefaults.standard.set(id, forKey: activeKey)
  }

  static var kidSafeActive: Bool {
    guard let id = UserDefaults.standard.string(forKey: activeKey), let prefs = load(id) else { return false }
    return prefs.kidSafe
  }

  static func blocksNow() -> Bool {
    guard let id = UserDefaults.standard.string(forKey: activeKey),
          let prefs = load(id), prefs.bedtimeOn else { return false }
    let hour = Calendar.current.component(.hour, from: Date())
    let end = 7
    if prefs.bedtime == end { return true }
    if prefs.bedtime < end { return hour >= prefs.bedtime && hour < end }
    return hour >= prefs.bedtime || hour < end
  }

  private static func key(_ id: String) -> String { "arrab.family.seat.\(id)" }
}

private struct FamilySetupWizard: View {
  var email: String
  var inviting: Bool
  var onSave: (FamilyCreateBody, FamilySeatStore.Prefs?) async -> (FamilySeat?, String?)

  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.dismiss) private var dismiss

  @State private var step = 0
  @State private var kind = ""
  @State private var name = ""
  @State private var age = "tier_10_13"
  @State private var mail = ""
  @State private var password = ""
  @State private var showPassword = false
  @State private var bedtime = 21
  @State private var kidSafe = true
  @State private var oversight = "coach"
  @State private var error: String?
  @State private var busy = false
  @State private var made: FamilySeat?

  private var arabic: Bool { session.localeIsArabic }
  private var child: Bool { kind == "child" }
  private var steps: Int { child ? 4 : 3 }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Button(L10n.t(.familyBack, arabic: arabic)) {
          if step == 0 || made != nil { dismiss() } else { step -= 1 }
        }
        .font(ArrabFont.system(size: 15, weight: .semibold))
        .foregroundStyle(theme.text)
        Spacer()
        Button {
          dismiss()
        } label: {
          Image(systemName: "xmark")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.text)
            .frame(width: 34, height: 34)
            .background(theme.card)
            .clipShape(Circle())
            .overlay(Circle().stroke(theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, adaptive.gutter)
      .padding(.top, 12)

      if made == nil {
        ProgressView(value: Double(step + 1), total: Double(steps))
          .tint(theme.lavender)
          .padding(.horizontal, adaptive.gutter)
          .padding(.top, 16)
      }

      ScrollView {
        VStack(alignment: .leading, spacing: adaptive.isPadLike ? 18 : 14) {
          Text(title)
            .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(lead)
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
          stage
          if let error {
            Text(error).font(ArrabFont.system(size: 13)).foregroundStyle(theme.warn)
          }
        }
        .padding(adaptive.gutter)
        .frame(maxWidth: adaptive.isPadLike ? 640 : .infinity)
        .frame(maxWidth: .infinity, alignment: .leading)
      }

      if made == nil {
        Button {
          Task { await advance() }
        } label: {
          Text(step == steps - 1 ? L10n.t(.safeSave, arabic: arabic) : L10n.t(.familyNext, arabic: arabic))
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .frame(maxWidth: adaptive.isPadLike ? 640 : .infinity)
            .padding(.vertical, 14)
            .background(canAdvance && !busy ? theme.primary : theme.line)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!canAdvance || busy)
        .padding(.horizontal, adaptive.gutter)
        .padding(.bottom, 16)
      }
    }
    .background(theme.bg.ignoresSafeArea())
    .onAppear {
      mail = email
      if kind.isEmpty { kind = inviting ? "" : "" }
      bedtime = bedtimeFor(age)
    }
  }

  private var title: String {
    if made != nil { return L10n.t(.familyReady, arabic: arabic) }
    if step == 0 { return L10n.t(.familyWho, arabic: arabic) }
    if step == 1 { return L10n.t(.familyName, arabic: arabic) }
    if step == 2 { return L10n.t(.familyJoin, arabic: arabic) }
    return L10n.t(.familyBedtime, arabic: arabic)
  }

  private var lead: String {
    if made != nil { return L10n.t(.familyInviteHint, arabic: arabic) }
    if step == 0 { return inviting ? L10n.t(.familyInviteHint, arabic: arabic) : L10n.t(.familyCreateHint, arabic: arabic) }
    if child && step == 3 { return L10n.t(.familyChildHint, arabic: arabic) }
    return L10n.t(.familyHousehold, arabic: arabic)
  }

  @ViewBuilder private var stage: some View {
    VStack(alignment: .leading, spacing: 12) {
      if let made {
        doneCard(made)
      } else if step == 0 {
      choice("partner", L10n.t(.familyAdult, arabic: arabic), L10n.t(.familyAdultHint, arabic: arabic), "person.2")
      choice("child", L10n.t(.familyChild, arabic: arabic), L10n.t(.familyChildHint, arabic: arabic), "figure.2")
    } else if step == 1 {
      field(L10n.t(.familyName, arabic: arabic), text: $name)
      if child {
        HStack(spacing: 8) {
          ageChip("tier_6_9", L10n.t(.familyAge69, arabic: arabic), 20)
          ageChip("tier_10_13", L10n.t(.familyAge1013, arabic: arabic), 21)
          ageChip("tier_14_17", L10n.t(.familyAge1417, arabic: arabic), 22)
        }
      }
    } else if step == 2 {
      field(L10n.t(.familyEmail, arabic: arabic), text: $mail, email: true)
      HStack(spacing: 8) {
        if showPassword {
          TextField(L10n.t(.familyPassword, arabic: arabic), text: $password)
            .font(ArrabFont.system(size: 16))
        } else {
          SecureField(L10n.t(.familyPassword, arabic: arabic), text: $password)
            .font(ArrabFont.system(size: 16))
        }
        Button {
          showPassword.toggle()
        } label: {
          Image(systemName: showPassword ? "eye.slash" : "eye")
            .foregroundStyle(theme.muted)
        }
        .buttonStyle(.plain)
      }
      .padding(12)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      Button(arabic ? "اقترح كلمة" : "Suggest a password") {
        password = suggestedPassword()
        showPassword = true
      }
      .font(ArrabFont.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.lavender)
    } else {
      Text(L10n.t(.familyBedtime, arabic: arabic))
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        ForEach([20, 21, 22], id: \.self) { hour in
          let on = bedtime == hour
          Button {
            bedtime = hour
          } label: {
            Text(String(format: "%02d:00", hour))
              .font(ArrabFont.system(size: 14, weight: .semibold))
              .foregroundStyle(on ? theme.onPrimary : theme.text)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 12)
              .background(on ? theme.primary : theme.card)
              .clipShape(Capsule())
          }
          .buttonStyle(.plain)
        }
      }
      choiceFlag(kidSafe, L10n.t(.familyKidSafe, arabic: arabic)) { kidSafe = true }
      choiceFlag(!kidSafe, L10n.t(.familyAllAccess, arabic: arabic)) { kidSafe = false }
      choiceFlag(oversight == "coach", L10n.t(.familyCoach, arabic: arabic)) { oversight = "coach" }
      choiceFlag(oversight == "full", L10n.t(.familyWatch, arabic: arabic)) { oversight = "full" }
    }
    }
  }

  private func doneCard(_ seat: FamilySeat) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(seat.displayName)
        .font(ArrabFont.system(size: 22, weight: .semibold))
        .foregroundStyle(theme.text)
      Text(mail)
        .font(ArrabFont.system(size: 15))
        .foregroundStyle(theme.muted)
      ShareLink(item: inviteText(seat)) {
        Text(L10n.t(.familyShare, arabic: arabic))
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.onPrimary)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
          .background(theme.primary)
          .clipShape(Capsule())
      }
      Button(arabic ? "تم" : "Done") { dismiss() }
        .font(ArrabFont.system(size: 15, weight: .semibold))
        .foregroundStyle(theme.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
    .padding(16)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
  }

  private func choice(_ id: String, _ title: String, _ hint: String, _ symbol: String) -> some View {
    let on = kind == id
    return Button { kind = id } label: {
      HStack(spacing: 14) {
        Image(systemName: symbol)
          .font(ArrabFont.system(size: 22))
          .frame(width: adaptive.isPadLike ? 52 : 44, height: adaptive.isPadLike ? 52 : 44)
          .background(on ? theme.primary : theme.subtle)
          .foregroundStyle(on ? theme.onPrimary : theme.text)
          .clipShape(Circle())
        VStack(alignment: .leading, spacing: 3) {
          Text(title)
            .font(ArrabFont.system(size: 16, weight: .semibold))
          Text(hint)
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
            .multilineTextAlignment(.leading)
        }
        Spacer(minLength: 0)
        if on {
          Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.lavender)
        }
      }
      .foregroundStyle(theme.text)
      .padding(14)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(on ? theme.lavender : theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private func choiceFlag(_ on: Bool, _ title: String, _ tap: @escaping () -> Void) -> some View {
    Button(action: tap) {
      HStack {
        Text(title)
          .font(ArrabFont.system(size: 15, weight: .semibold))
        Spacer()
        if on { Image(systemName: "checkmark").font(ArrabFont.system(size: 13, weight: .bold)) }
      }
      .foregroundStyle(on ? theme.onPrimary : theme.text)
      .padding(14)
      .background(on ? theme.primary : theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
    .buttonStyle(.plain)
  }

  private func field(_ title: String, text: Binding<String>, email: Bool = false) -> some View {
    TextField(title, text: text)
      .textInputAutocapitalization(email ? .never : .words)
      .keyboardType(email ? .emailAddress : .default)
      .font(ArrabFont.system(size: 16))
      .padding(14)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }

  private func ageChip(_ id: String, _ title: String, _ hour: Int) -> some View {
    let on = age == id
    return Button {
      age = id
      bedtime = hour
    } label: {
      Text(title)
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(on ? theme.onPrimary : theme.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(on ? theme.lavender : theme.card)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private var canAdvance: Bool {
    if step == 0 { return !kind.isEmpty }
    if step == 1 { return !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    if step == 2 { return mail.contains("@") && password.count >= 8 }
    return true
  }

  private func advance() async {
    if step < steps - 1 {
      step += 1
      return
    }
    busy = true
    defer { busy = false }
    let prefs = child
      ? FamilySeatStore.Prefs(bedtime: bedtime, bedtimeOn: true, kidSafe: kidSafe, oversight: oversight)
      : nil
    let body = FamilyCreateBody(
      displayName: name.trimmingCharacters(in: .whitespacesAndNewlines),
      role: child ? "child" : "partner",
      ageTier: child ? age : nil,
      email: mail.trimmingCharacters(in: .whitespacesAndNewlines),
      password: password
    )
    let (seat, message) = await onSave(body, prefs)
    if let seat {
      made = seat
      error = nil
    } else {
      error = message
    }
  }

  private func bedtimeFor(_ tier: String) -> Int {
    switch tier {
    case "tier_6_9": return 20
    case "tier_14_17": return 22
    default: return 21
    }
  }

  private func suggestedPassword() -> String {
    let letters = Array("abcdefghjkmnpqrstuvwxyz")
    let digits = Array("23456789")
    let word = String((0..<5).map { _ in letters.randomElement() ?? "a" })
    let tail = String((0..<3).map { _ in digits.randomElement() ?? "2" })
    return word + tail
  }

  private func inviteText(_ seat: FamilySeat) -> String {
    if arabic {
      return "مقعد في عراب\nالاسم: \(seat.displayName)\nالبريد: \(mail)\nكلمة المرور: \(password)"
    }
    return "Arrab family seat\nName: \(seat.displayName)\nEmail: \(mail)\nPassword: \(password)"
  }
}
