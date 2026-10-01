import Foundation

struct AccountPublic: Codable, Equatable {
  let id: String
  let email: String
  let displayName: String?
  var planId: String?
  var planName: String?
  var subscriptionStatus: String?
  var periodEnd: String?
}

struct AccountEntitlements: Codable, Equatable {
  let planId: String?
  let status: String?
  var planName: String?
  var subscriptionStatus: String?
  var tokenLimit: Double?
  var tokensUsed: Double?
  var tokensRemaining: Double?
  var overLimit: Bool?
  var periodEnd: String?
  var topUpTokens: Double?
  var pauseMode: String?
  var deepseekCreditHalalas: Double?
  var otherCreditHalalas: Double?
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
  let updatedAt: String?

  var sortStamp: String { updatedAt ?? createdAt ?? "" }
}

struct UsageSnapshot: Decodable, Equatable {
  struct Totals: Decodable, Equatable {
    var events: Int
    var inputTokens: Double?
    var outputTokens: Double?
  }

  struct AgentUse: Decodable, Equatable, Identifiable {
    var agentId: String?
    var inputTokens: Double
    var outputTokens: Double
    var events: Int
    var id: String { agentId ?? "unassigned" }
    var weight: Double { inputTokens + outputTokens }
  }

  struct ProviderUse: Decodable, Equatable, Identifiable {
    var providerId: String
    var inputTokens: Double
    var outputTokens: Double
    var events: Int
    var id: String { providerId }
    var weight: Double { inputTokens + outputTokens }
  }

  struct RecentUse: Decodable, Equatable, Identifiable {
    var id: String
    var model: String
    var createdAt: String
    var providerId: String?
    var inputTokens: Double?
    var outputTokens: Double?
    var weight: Double { (inputTokens ?? 0) + (outputTokens ?? 0) }
  }

  struct Entitlements: Decodable, Equatable {
    var planName: String?
    var tokenLimit: Double?
    var tokensUsed: Double
    var tokensRemaining: Double?
    var overLimit: Bool?
    var periodStart: String?
    var periodEnd: String?
    var usageLevel: String?
    var topUpTokens: Double?
  }

  var totals: Totals
  var byAgent: [AgentUse]
  var byProvider: [ProviderUse]?
  var recent: [RecentUse]
  var entitlements: Entitlements?
}

struct BillingAccountStatus: Decodable, Equatable {
  struct Seat: Decodable, Equatable {
    var planId: String?
    var subscriptionStatus: String?
    var periodStart: String?
    var periodEnd: String?
  }

  struct Rights: Decodable, Equatable {
    var planId: String?
    var planName: String?
    var subscriptionStatus: String?
    var pauseMode: String?
    var periodStart: String?
    var periodEnd: String?
    var overLimit: Bool?
    var canTopUp: Bool?
    var topUpTokens: Double?
    var deepseekCreditHalalas: Double?
    var otherCreditHalalas: Double?
  }

  var account: Seat?
  var entitlements: Rights?
}

struct BillingCatalog: Decodable, Equatable {
  struct Plan: Decodable, Equatable, Identifiable {
    var id: String
    var name: String
    var description: String
    var monthlyPriceHalalas: Int
    var features: [String]
    var badge: String?
    var highlight: Bool?
  }

  struct TopUp: Decodable, Equatable, Identifiable {
    var id: String
    var name: String
    var nameAr: String
    var tokens: Double
    var priceHalalas: Int
    var amountLabel: String?
  }

  var plans: [Plan]
  var topUps: [TopUp]?
}

struct CheckoutLink: Decodable, Equatable {
  var checkoutUrl: String
}

struct AiGatewayStatus: Decodable, Equatable {
  var configured: Bool
  var providers: [String]
  var defaultModel: String?
  var models: [String]?
}

struct ApiMeta: Decodable, Equatable {
  var name: String?
  var version: String?
  var persistence: String?
  var aiProviders: [String]?
}

struct DeskJob: Codable, Identifiable, Equatable {
  var id: String
  var companionId: String
  var companionName: String
  var title: String
  var brief: String
  var status: String
  var result: String?
  var resultHash: String?
  var approvedHash: String?
  var sensitive: Bool
  var channel: String?
  var recipient: String?
  var sentMessageId: String?
  var createdAt: String
  var updatedAt: String
}

struct CompanionDeskState: Codable, Equatable {
  var pace: String
  var lessons: [String]
  var jobs: [DeskJob]
  var spendCapSar: Int?
  var spentSarToday: Int?
  var spentDay: String?
  var quietStartHour: Int?
  var quietEndHour: Int?
  var runsToday: Int?
  var runsDay: String?
  var hijriToday: String?
  var shopHours: String?
  var messageList: [String]?
  var neverSay: String?
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

struct StartWebAuthResponse: Codable {
  let state: String
  let pollSecret: String?
  let authorizationUrl: String
  let expiresAt: String?
  let pollIntervalMs: Double?
}

struct PollWebAuthResponse: Codable {
  let status: String
  let account: AccountPublic?
  let entitlements: AccountEntitlements?
  let sessionToken: String?
  let message: String?
  let accountCreated: Bool?
}

struct ConnectorPublic: Codable, Identifiable, Equatable {
  let id: String
  let provider: String
  let status: String?
  let accountLabel: String?
  let scopes: [String]?
  let connectedAt: String?
  let lastVerifiedAt: String?
  let error: String?
}

struct ConnectorCatalogEntry: Codable, Equatable {
  let provider: String
  let available: Bool?
  let description: String?
}

struct ControlConnector: Codable, Identifiable, Equatable {
  var id: String { provider }
  let provider: String
  let status: String?
  let featured: Bool?
  let order: Double?
  let name: String?
  let nameAr: String?
  let description: String?
  let descriptionAr: String?
  let logoUrl: String?
}

struct ControlConnectorsResponse: Codable {
  let items: [ControlConnector]
}

struct StudioCompanionCard: Identifiable, Equatable, Hashable {
  let id: String
  let name: String
  let nameAr: String
  let blurb: String
  let blurbAr: String
  let badge: String
  let badgeAr: String
  let workspace: String
  let isMain: Bool
  let hue: Double

  func title(arabic: Bool) -> String { arabic ? nameAr : name }
  func subtitle(arabic: Bool) -> String { arabic ? blurbAr : blurb }
  func mark(arabic: Bool) -> String { arabic ? badgeAr : badge }
}

enum StudioCatalog {
  static let companions: [StudioCompanionCard] = [
    .init(
      id: "arrab-assistant",
      name: "Arrab Assistant",
      nameAr: "مساعد عراب",
      blurb: "Your main agent — PC files, every connector, arrange anything",
      blurbAr: "وكيلك الرئيسي — ملفات الجهاز وكل الموصلات وترتيب أي شيء",
      badge: "PC desk",
      badgeAr: "مكتب الملفات",
      workspace: "arrab-assistant",
      isMain: true,
      hue: 258
    ),
    .init(
      id: "web-designer",
      name: "Nouf",
      nameAr: "نوف",
      blurb: "Sites & pages — live web preview, code, and export",
      blurbAr: "مواقع وصفحات — معاينة ويب حية وكود وتصدير",
      badge: "Web preview",
      badgeAr: "معاينة ويب",
      workspace: "ui-designer",
      isMain: false,
      hue: 268
    ),
    .init(
      id: "phone-designer",
      name: "Lina",
      nameAr: "لينا",
      blurb: "Mobile screens — phone frame preview and device QR",
      blurbAr: "شاشات جوال — معاينة إطار الهاتف ورمز للجهاز",
      badge: "Phone preview",
      badgeAr: "معاينة جوال",
      workspace: "ui-designer",
      isMain: false,
      hue: 336
    ),
    .init(
      id: "game-designer",
      name: "Majed",
      nameAr: "ماجد",
      blurb: "Any game — WebGL, Roblox, open folder, AI creates workspace files",
      blurbAr: "أي لعبة — WebGL وروبلوكس وفتح مجلد والذكاء ينشئ ملفات مساحة العمل",
      badge: "Game studio",
      badgeAr: "استوديو الألعاب",
      workspace: "game",
      isMain: false,
      hue: 168
    ),
    .init(
      id: "3d-modeler",
      name: "Rami",
      nameAr: "رامي",
      blurb: "Advanced 3D modeling — meshes, materials, shading, studio lights",
      blurbAr: "نمذجة ثلاثية متقدمة — شبكات ومواد وتظليل وإضاءة استوديو",
      badge: "Advanced 3D modeling",
      badgeAr: "نمذجة ثلاثية متقدمة",
      workspace: "model",
      isMain: false,
      hue: 24
    ),
    .init(
      id: "markets-terminal",
      name: "Faisal",
      nameAr: "فيصل",
      blurb: "Financial expert — search any symbol across NASDAQ, TASI, crypto & more",
      blurbAr: "خبير مالي — ابحث عن أي رمز عبر ناسداك وتاسي والعملات المشفرة والمزيد",
      badge: "Markets terminal",
      badgeAr: "طرفية الأسواق",
      workspace: "markets-terminal",
      isMain: false,
      hue: 38
    ),
    .init(
      id: "brand",
      name: "Nawaf",
      nameAr: "نواف",
      blurb: "Voice, palette, and visual direction",
      blurbAr: "الصوت والألوان والتوجيه البصري",
      badge: "Work room",
      badgeAr: "غرفة عمل",
      workspace: "default",
      isMain: false,
      hue: 28
    ),
    .init(
      id: "copywriter",
      name: "Dana",
      nameAr: "دانة",
      blurb: "Headlines, sections, and microcopy",
      blurbAr: "العناوين والأقسام والنصوص القصيرة",
      badge: "Work room",
      badgeAr: "غرفة عمل",
      workspace: "default",
      isMain: false,
      hue: 188
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

struct RemoteTask: Codable, Identifiable {
  let id: String
  let title: String
  let status: String
}

struct RemoteActivity: Codable, Identifiable {
  let id: String
  let summary: String
  let verb: String
  let createdAt: String
}

struct PendingApproval: Codable, Identifiable {
  let id: String
  let title: String
  let kind: String
  let status: String
  let detail: String?
}

struct RemoteProject: Codable, Identifiable {
  let id: String
  let name: String
  let description: String?
  let status: String
}

struct WorkforceSnapshot: Codable {
  struct Person: Codable, Identifiable {
    let id: String
    let displayName: String
    let email: String
    let title: String?
    let role: String
    let status: String
  }

  struct Department: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
  }

  let employees: [Person]
  let departments: [Department]
}
