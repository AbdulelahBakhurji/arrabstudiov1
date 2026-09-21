import SwiftUI

@main
struct ArrabStudioApp: App {
  @StateObject private var session = AppSession()
  @StateObject private var link = PCLinkStore()

  var body: some Scene {
    WindowGroup {
      // Hard background so we never ship a transparent/black void.
      ZStack {
        Color(red: 0.07, green: 0.07, blue: 0.09).ignoresSafeArea()
        RootView()
          .environmentObject(session)
          .environmentObject(link)
      }
      .preferredColorScheme(.dark)
      .onOpenURL { url in
        link.handleDeepLink(url)
        if let token = link.consumedSessionToken() {
          session.applySessionToken(token)
        }
      }
    }
  }
}
