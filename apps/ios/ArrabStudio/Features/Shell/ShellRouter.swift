import SwiftUI
import Combine

enum OrgTab: String, CaseIterable, Identifiable {
  case studio, chat, cowork
  var id: String { rawValue }
}

enum ShellDestination: Equatable {
  case tab(IndividualsTab)
  case me
  case account
  case companions
  case settings
  case connectors
  case sessions
  case incognito
  case studio
  case brain
  case roles
  case models
  case familyControl
  case activity
  case workforce
  case workplace
  case library
}

@MainActor
final class ShellRouter: ObservableObject {
  @Published var destination: ShellDestination = .tab(.chat)
  @Published var tab: IndividualsTab = .chat
  @Published var orgTab: OrgTab = .studio
  @Published var pendingPrompt: String?
  @Published var pendingDraft: String?
  @Published var showCompanionPicker = false
  @Published var incognitoActive = false
  @Published var focusConversationId: String?
  @Published var focusCompanionId: String?

  func go(_ dest: ShellDestination) {
    destination = dest
    if case let .tab(t) = dest { tab = t }
    if case .me = dest { tab = .me }
  }

  func openChat(conversationId: String? = nil, companionId: String? = nil) {
    focusConversationId = conversationId
    focusCompanionId = companionId
    go(.tab(.chat))
  }

  func openSessions() { go(.sessions) }

  func openIncognito() {
    incognitoActive = true
    go(.incognito)
  }
}
