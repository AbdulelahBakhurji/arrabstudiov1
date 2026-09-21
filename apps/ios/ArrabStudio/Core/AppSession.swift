import Foundation
import Combine

@MainActor
final class AppSession: ObservableObject {
  @Published var account: AccountPublic?
  @Published var isBusy = false
  @Published var error: String?
  @Published var localeIsArabic = false

  private let api = ArrabAPIClient.shared

  var isSignedIn: Bool { account != nil && api.hasSession }

  init() {
    // Never block first paint. Restore session in the background.
    Task { await restoreIfNeeded() }
  }

  private func restoreIfNeeded() async {
    guard api.hasSession else { return }
    do {
      let status = try await api.verifySession()
      if let account = status.account {
        self.account = account
      } else {
        self.account = try await api.account().account
      }
    } catch {
      api.setSessionToken(nil)
      account = nil
    }
  }

  func signIn(email: String, password: String) async {
    isBusy = true
    error = nil
    defer { isBusy = false }
    do {
      let res = try await api.signIn(email: email, password: password)
      account = res.account
    } catch {
      self.error = error.localizedDescription
    }
  }

  func createAccount(email: String, password: String, name: String) async {
    isBusy = true
    error = nil
    defer { isBusy = false }
    do {
      let res = try await api.connectAccount(email: email, password: password, displayName: name)
      account = res.account
    } catch {
      self.error = error.localizedDescription
    }
  }

  func applySessionToken(_ token: String) {
    api.setSessionToken(token)
    Task { await restoreIfNeeded() }
  }

  func signOut() async {
    await api.logout()
    account = nil
  }

  func updateAPIBase(_ url: String) {
    api.baseURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
