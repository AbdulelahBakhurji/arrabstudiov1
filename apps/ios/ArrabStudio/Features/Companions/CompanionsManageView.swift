import SwiftUI

struct CompanionsManageView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text(L10n.t(.manageCompanions, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(L10n.t(.controlPlane, arabic: arabic))
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)

        if visible.isEmpty {
          ArrabCard {
            Text(L10n.t(.noCompanionsPolicy, arabic: arabic))
              .foregroundStyle(theme.muted)
          }
        } else {
          ForEach(CompanionLane.allCases, id: \.self) { lane in
            let group = visible.filter { $0.lane == lane }
            if !group.isEmpty {
              Text(laneTitle(lane))
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.muted)
                .padding(.top, 4)
              ForEach(group) { item in
                companionRow(item)
              }
            }
          }
        }

        Button {
          Task { await companions.reload(from: managed) }
        } label: {
          Text(L10n.t(.syncNow, arabic: arabic))
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .foregroundStyle(theme.onPrimary)
            .background(theme.primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .task { await companions.reload(from: managed) }
  }

  private var visible: [CompanionItem] {
    companions.companions.filter { $0.matches(session.studioRole) }
  }

  private func laneTitle(_ lane: CompanionLane) -> String {
    switch lane {
    case .personal: return L10n.t(.lanePersonal, arabic: arabic)
    case .studio: return L10n.t(.laneStudio, arabic: arabic)
    case .family: return L10n.t(.laneFamily, arabic: arabic)
    case .work: return L10n.t(.laneWork, arabic: arabic)
    }
  }

  private func companionRow(_ item: CompanionItem) -> some View {
    ArrabCard {
      HStack(spacing: 12) {
        CompanionFace(item: item, size: 44, selected: companions.selectedId == item.id)
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Text(item.displayName(arabic: arabic))
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.text)
            if let badge = item.badge {
              Text(badgeLabel(badge))
                .font(ArrabFont.system(size: 10, weight: .bold))
                .foregroundStyle(theme.onPrimary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(theme.lavender)
                .clipShape(Capsule())
            }
            if item.pinned {
              Text(L10n.t(.companionPinned, arabic: arabic))
                .font(ArrabFont.system(size: 10, weight: .bold))
                .foregroundStyle(theme.muted)
            }
          }
          Text(item.displayBlurb(arabic: arabic))
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
            .lineLimit(2)
          HStack(spacing: 6) {
            let voice = CompanionVoiceStore.shared.voice(for: item.id)
            if let style = CompanionToneCatalog.match(voice.tone) {
              Text(L10n.t(style.title, arabic: arabic))
                .font(ArrabFont.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.lavender)
            }
            if !voice.facts.isEmpty {
              Text(arabic ? "\(voice.facts.count) ذاكرة" : "\(voice.facts.count) memories")
                .font(ArrabFont.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.muted)
            }
          }
          if let note = item.maintenanceNote, !note.isEmpty {
            Text(note)
              .font(ArrabFont.system(size: 11))
              .foregroundStyle(theme.warn)
          }
        }
        Spacer()
        Button {
          companions.selectedId = item.id
          router.openChat(companionId: item.agentId ?? item.id)
        } label: {
          Text(L10n.t(.chat, arabic: arabic))
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(theme.primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
  }

  private func badgeLabel(_ badge: CompanionBadge) -> String {
    switch badge {
    case .new: return L10n.t(.companionNew, arabic: arabic)
    case .beta: return L10n.t(.companionBeta, arabic: arabic)
    }
  }
}
