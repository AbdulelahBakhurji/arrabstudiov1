import SwiftUI

struct LinkPCView: View {
  @EnvironmentObject private var link: PCLinkStore
  @EnvironmentObject private var session: AppSession
  @Environment(\.dismiss) private var dismiss
  @State private var apiURL = ""
  @State private var pairCode = ""
  @State private var healthNote = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Connect this iPhone to Arrab Studio on your Mac or PC. Same API account — desk tools stay on the computer.")
            .font(.system(size: 14))
            .foregroundStyle(ArrabTheme.muted)

          ArrabCard {
            VStack(alignment: .leading, spacing: 10) {
              Text("1 · Paste LAN / API URL")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ArrabTheme.text)
              TextField("http://192.168.1.20:8787", text: $apiURL)
                .textFieldStyle(ArrabFieldStyle())
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
              Button("Connect URL") {
                link.connect(apiBase: apiURL)
                session.updateAPIBase(apiURL)
              }
              .font(.system(size: 14, weight: .semibold))
            }
          }

          ArrabCard {
            VStack(alignment: .leading, spacing: 10) {
              Text("2 · Pair code from desktop")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ArrabTheme.text)
              TextField("ABCD-1234", text: $pairCode)
                .textFieldStyle(ArrabFieldStyle())
                .textInputAutocapitalization(.characters)
              Button("Save code") {
                link.applyPairCode(pairCode)
              }
              .font(.system(size: 14, weight: .semibold))
            }
          }

          ArrabCard {
            VStack(alignment: .leading, spacing: 8) {
              Text("Deep link")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ArrabTheme.text)
              Text("From desktop, open:\narrab://link?api=http://YOUR_LAN:8787&token=SESSION")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(ArrabTheme.muted)
            }
          }

          if !link.lastMessage.isEmpty {
            Text(link.lastMessage)
              .font(.system(size: 13))
              .foregroundStyle(ArrabTheme.success)
          }
          if !healthNote.isEmpty {
            Text(healthNote)
              .font(.system(size: 13))
              .foregroundStyle(ArrabTheme.muted)
          }

          Button("Test connection") {
            Task {
              do {
                _ = try await ArrabAPIClient.shared.health()
                healthNote = "API reachable."
              } catch {
                healthNote = error.localizedDescription
              }
            }
          }
          .font(.system(size: 14, weight: .semibold))

          if link.isLinked {
            Button("Disconnect PC link") {
              link.disconnect()
            }
            .foregroundStyle(ArrabTheme.danger)
          }
        }
        .padding(16)
      }
      .background(ArrabTheme.bg)
      .navigationTitle("Link PC")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
      .onAppear {
        apiURL = link.pcHostLabel.isEmpty ? ArrabAPIClient.shared.baseURL : link.pcHostLabel
        pairCode = link.pendingPairCode
      }
    }
  }
}
