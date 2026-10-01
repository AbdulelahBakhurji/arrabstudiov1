import LocalAuthentication
import SwiftUI

struct AppLockGate: View {
  @EnvironmentObject private var lock: AppLockStore
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @State private var error: String?

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    VStack(spacing: 20) {
      ArrabMark(size: 48)
      Text(arabic ? "الاستوديو مقفل" : "Studio locked")
        .font(ArrabFont.system(size: 24, weight: .semibold))
        .foregroundStyle(theme.text)
      Text(arabic ? "افتح بـ Face ID أو رمز الجهاز." : "Unlock with Face ID or your device passcode.")
        .font(ArrabFont.system(size: 14))
        .foregroundStyle(theme.muted)
        .multilineTextAlignment(.center)

      if let error {
        Text(error)
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.danger)
      }

      Button {
        Task { await authenticate() }
      } label: {
        Label(arabic ? "فتح" : "Unlock", systemImage: "faceid")
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
          .foregroundStyle(theme.onPrimary)
          .background(theme.primary)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 32)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(theme.bg.ignoresSafeArea())
    .task { await authenticate() }
    .accessibilityElement(children: .contain)
  }

  private func authenticate() async {
    let context = LAContext()
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
      error = authError?.localizedDescription ?? "Biometrics unavailable"
      // Fail open if device has no auth configured — still meet Apple local-auth UX.
      lock.unlock()
      return
    }
    do {
      let ok = try await context.evaluatePolicy(
        .deviceOwnerAuthentication,
        localizedReason: arabic ? "افتح Arrab Studio" : "Unlock Arrab Studio"
      )
      if ok {
        ArrabHaptics.success()
        lock.unlock()
      }
    } catch {
      self.error = error.localizedDescription
      ArrabHaptics.error()
    }
  }
}

struct OfflineBanner: View {
  @EnvironmentObject private var network: NetworkMonitor
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme

  var body: some View {
    if !network.isOnline {
      HStack(spacing: 8) {
        Image(systemName: "wifi.slash")
        Text(session.localeIsArabic ? "لا اتصال — بعض الميزات متوقفة" : "You're offline — some features are paused")
          .font(ArrabFont.system(size: 13, weight: .semibold))
      }
      .foregroundStyle(theme.onPrimary)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 8)
      .background(theme.warn)
      .accessibilityAddTraits(.isStaticText)
    }
  }
}

struct LegalLinksView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.openURL) private var openURL

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      linkRow(arabic ? "سياسة الخصوصية" : "Privacy Policy", url: ArrabLegal.privacyURL)
      linkRow(arabic ? "شروط الاستخدام" : "Terms of Use", url: ArrabLegal.termsURL)
      linkRow(arabic ? "الدعم" : "Support", url: ArrabLegal.supportURL)
      Button {
        openURL(ArrabLegal.supportMailto)
      } label: {
        Label(ArrabLegal.supportEmail, systemImage: "envelope")
          .font(ArrabFont.system(size: 14, weight: .medium))
          .foregroundStyle(theme.lavender)
      }
      .buttonStyle(.plain)
    }
  }

  private func linkRow(_ title: String, url: URL) -> some View {
    Button {
      openURL(url)
    } label: {
      HStack {
        Text(title)
          .foregroundStyle(theme.text)
        Spacer()
        Image(systemName: "arrow.up.right")
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.muted)
      }
      .padding(.vertical, 6)
    }
    .buttonStyle(.plain)
  }
}

struct DeleteAccountSection: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @State private var confirm = false
  @State private var busy = false
  @State private var error: String?

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(arabic ? "حذف الحساب" : "Delete account")
        .font(ArrabFont.system(size: 16, weight: .semibold))
        .foregroundStyle(theme.text)
      Text(
        arabic
          ? "يحذف حسابك وبيانات الاستوديو المرتبطة به من خوادم Arrab. لا يمكن التراجع."
          : "Permanently deletes your Arrab account and associated studio data on Arrab servers. This cannot be undone."
      )
      .font(ArrabFont.system(size: 13))
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)

      if let error {
        Text(error).font(ArrabFont.system(size: 12)).foregroundStyle(theme.danger)
      }

      Button(role: .destructive) {
        confirm = true
      } label: {
        Text(arabic ? "حذف حسابي" : "Delete my account")
          .font(ArrabFont.system(size: 14, weight: .semibold))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
          .foregroundStyle(theme.danger)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(theme.danger.opacity(0.45), lineWidth: 1)
          )
      }
      .buttonStyle(.plain)
      .disabled(busy)
      .accessibilityHint(arabic ? "يتطلب تأكيداً" : "Requires confirmation")
    }
    .confirmationDialog(
      arabic ? "حذف الحساب نهائياً؟" : "Delete account permanently?",
      isPresented: $confirm,
      titleVisibility: .visible
    ) {
      Button(arabic ? "حذف نهائياً" : "Delete permanently", role: .destructive) {
        Task { await deleteAccount() }
      }
      Button(arabic ? "إلغاء" : "Cancel", role: .cancel) {}
    } message: {
      Text(
        arabic
          ? "ستُحذف بيانات الحساب من السحابة، ثم تسجيل الخروج من هذا الجهاز."
          : "Your cloud account data will be removed, then this device will sign out."
      )
    }
  }

  private func deleteAccount() async {
    busy = true
    defer { busy = false }
    do {
      try await ArrabAPIClient.shared.deleteAccount()
      ArrabHaptics.warning()
      await session.signOut()
    } catch {
      self.error = error.localizedDescription
      ArrabHaptics.error()
    }
  }
}
