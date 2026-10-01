import SwiftUI

struct RolesHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text(L10n.t(.roles, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(L10n.t(.rolesSubtitle, arabic: arabic))
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)

        roleCard(session.studioRole)

        Text(L10n.t(.companionsInRole, arabic: arabic))
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.muted)
          .padding(.top, 4)

        ForEach(visible) { item in
          Button {
            companions.selectedId = item.id
            router.openChat(companionId: item.agentId ?? item.id)
          } label: {
            HStack(spacing: 12) {
              Circle()
                .fill(item.isGeneral ? theme.lavender : item.tint)
                .frame(width: 36, height: 36)
                .overlay {
                  Text(String(item.displayName(arabic: arabic).prefix(1)))
                    .font(ArrabFont.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                }
              VStack(alignment: .leading, spacing: 2) {
                Text(item.displayName(arabic: arabic))
                  .font(ArrabFont.system(size: 15, weight: .semibold))
                  .foregroundStyle(theme.text)
                Text(item.displayBlurb(arabic: arabic))
                  .font(ArrabFont.system(size: 12))
                  .foregroundStyle(theme.muted)
                  .lineLimit(1)
              }
              Spacer()
              Image(systemName: "chevron.forward")
                .font(ArrabFont.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.muted)
            }
            .padding(12)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
          }
          .buttonStyle(.plain)
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
  }

  private var visible: [CompanionItem] {
    companions.companions.filter { $0.matches(session.studioRole) }
  }

  private func roleCard(_ role: StudioRole) -> some View {
    let selected = session.studioRole == role
    return VStack(alignment: .leading, spacing: 8) {
      HStack {
        Image(systemName: icon(role))
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(title(role))
          .font(ArrabFont.system(size: 17, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer()
        if selected {
          Image(systemName: "checkmark.circle.fill")
            .foregroundStyle(theme.lavender)
        }
      }
      Text(body(role))
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
        .multilineTextAlignment(.leading)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(selected ? theme.subtle : theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(selected ? theme.lavender : theme.line, lineWidth: selected ? 1.5 : 1)
    )
  }

  private func icon(_ role: StudioRole) -> String {
    switch role {
    case .individual: return "person"
    case .family: return "house"
    case .organization: return "building.2"
    }
  }

  private func title(_ role: StudioRole) -> String {
    switch role {
    case .individual: return L10n.t(.individuals, arabic: arabic)
    case .family: return L10n.t(.family, arabic: arabic)
    case .organization: return L10n.t(.organizations, arabic: arabic)
    }
  }

  private func body(_ role: StudioRole) -> String {
    switch role {
    case .individual: return L10n.t(.roleIndividualBody, arabic: arabic)
    case .family: return L10n.t(.roleFamilyBody, arabic: arabic)
    case .organization: return L10n.t(.roleOrganizationBody, arabic: arabic)
    }
  }
}
