import Foundation

struct AccountPublic: Codable, Equatable {
  let id: String
  let email: String
  let displayName: String?
}

struct AccountEntitlements: Codable, Equatable {
  let planId: String?
  let status: String?
}

struct ConnectAccountResponse: Codable {
  let account: AccountPublic
  let entitlements: AccountEntitlements?
  let sessionToken: String
}

struct AccountStatusResponse: Codable {
  let account: AccountPublic?
  let entitlements: AccountEntitlements?
  let signedIn: Bool?
}

struct Conversation: Codable, Identifiable, Equatable {
  let id: String
  let title: String?
  let agentId: String?
  let createdAt: String?
}

struct Agent: Codable, Identifiable, Equatable {
  let id: String
  let name: String
  let role: String?
  let specialty: String?
  let status: String?
}

struct Message: Codable, Identifiable, Equatable {
  let id: String
  let conversationId: String?
  let role: String
  let content: String
  let createdAt: String?
}

struct ConversationDetailResponse: Codable {
  let conversation: Conversation
  let messages: [Message]
}

struct CollectionResponse<T: Codable>: Codable {
  let items: [T]
}

struct CreateConversationRequest: Codable {
  let agentId: String
  let title: String?
}

struct CreateAgentRequest: Codable {
  let name: String
  let role: String
  let specialty: String?
  let instructions: String?
  let status: String
}

struct SendMessageRequest: Codable {
  let content: String
  let model: String?
}

struct HealthResponse: Codable {
  let ok: Bool?
  let status: String?
}

struct StudioCompanionCard: Identifiable, Equatable, Hashable {
  let id: String
  let name: String
  let blurb: String
  let badge: String
  let workspace: String
  let isMain: Bool
  let hue: Double
}

enum StudioCatalog {
  static let companions: [StudioCompanionCard] = [
    .init(
      id: "arrab-assistant",
      name: "Arrab Assistant",
      blurb: "Your main agent — PC files, connectors, arrange anything.",
      badge: "PC DESK",
      workspace: "arrab-assistant",
      isMain: true,
      hue: 270
    ),
    .init(
      id: "web-designer",
      name: "Web Designer",
      blurb: "Sites & pages — live preview, code, and export.",
      badge: "WEB PREVIEW",
      workspace: "ui-designer",
      isMain: false,
      hue: 150
    ),
    .init(
      id: "phone-designer",
      name: "Phone Designer",
      blurb: "Mobile screens — frame preview and device QR.",
      badge: "PHONE PREVIEW",
      workspace: "ui-designer",
      isMain: false,
      hue: 320
    ),
    .init(
      id: "brand",
      name: "Brand",
      blurb: "Voice, palette, and visual direction.",
      badge: "WORK ROOM",
      workspace: "default",
      isMain: false,
      hue: 28
    ),
    .init(
      id: "copywriter",
      name: "Copywriter",
      blurb: "Headlines, sections, and microcopy.",
      badge: "WORK ROOM",
      workspace: "default",
      isMain: false,
      hue: 168
    ),
  ]
}

struct BrainNode: Identifiable, Equatable {
  enum Kind: String, CaseIterable {
    case project, session, decision, file, person

    var color: String {
      switch self {
      case .project: return "project"
      case .session: return "session"
      case .decision: return "decision"
      case .file: return "file"
      case .person: return "person"
      }
    }
  }

  let id: String
  let title: String
  let kind: Kind
  let summary: String
  var x: CGFloat
  var y: CGFloat
}

struct BrainLink: Identifiable, Equatable {
  let id: String
  let from: String
  let to: String
}
