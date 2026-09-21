import SwiftUI

struct MeHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var link: PCLinkStore
  @Environment(\.adaptive) private var adaptive
  @State private var showLink = false
  @State private var apiURL = ArrabAPIClient.shared.baseURL

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 6) {
          Text("ARRAB / ME")
            .font(.system(size: 10, weight: .bold))
            .tracking(1.2)
            .foregroundStyle(ArrabTheme.muted)
          Text("Me")
            .font(.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(ArrabTheme.text)
        }

        ArrabCard {
          HStack(spacing: 12) {
            Circle()
              .fill(ArrabTheme.subtle)
              .frame(width: 48, height: 48)
              .overlay {
                Text(initials)
                  .font(.system(size: 16, weight: .semibold))
                  .foregroundStyle(ArrabTheme.text)
              }
            VStack(alignment: .leading, spacing: 4) {
              Text(session.account?.displayName ?? "Arrab operator")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(ArrabTheme.text)
              Text(session.account?.email ?? "")
                .font(.system(size: 13))
                .foregroundStyle(ArrabTheme.muted)
            }
          }
        }

        ArrabCard {
          VStack(alignment: .leading, spacing: 10) {
            Text("API")
              .font(.system(size: 12, weight: .bold))
              .foregroundStyle(ArrabTheme.muted)
            TextField("https://api.arrab.studio", text: $apiURL)
              .textFieldStyle(ArrabFieldStyle())
              .textInputAutocapitalization(.never)
              .keyboardType(.URL)
            Button("Save API URL") {
              session.updateAPIBase(apiURL)
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(ArrabTheme.text)
          }
        }

        ArrabCard {
          VStack(alignment: .leading, spacing: 10) {
            HStack {
              Label("PC link", systemImage: "laptopcomputer.and.iphone")
                .foregroundStyle(ArrabTheme.text)
              Spacer()
              Text(link.isLinked ? "On" : "Off")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(link.isLinked ? ArrabTheme.success : ArrabTheme.muted)
            }
            if link.isLinked {
              Text(link.pcHostLabel)
                .font(.system(size: 12))
                .foregroundStyle(ArrabTheme.muted)
            }
            Button("Manage PC connection") { showLink = true }
              .font(.system(size: 14, weight: .semibold))
              .foregroundStyle(ArrabTheme.text)
          }
        }

        Toggle(isOn: $session.localeIsArabic) {
          Text("Arabic UI labels")
            .foregroundStyle(ArrabTheme.text)
        }
        .tint(ArrabTheme.accent)
        .padding(.horizontal, 4)

        Button {
          Task { await session.signOut() }
        } label: {
          Text("Sign out")
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(ArrabTheme.danger)
            .background(ArrabTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
              RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(ArrabTheme.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(ArrabTheme.bg)
    .sheet(isPresented: $showLink) {
      LinkPCView()
        .environmentObject(link)
        .environmentObject(session)
        .presentationDetents([.medium, .large])
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
