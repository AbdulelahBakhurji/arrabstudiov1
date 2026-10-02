import Foundation
import UIKit

private final class OnceResume: @unchecked Sendable {
  private let lock = NSLock()
  private var done = false
  func run(_ body: () -> Void) {
    lock.lock()
    if done {
      lock.unlock()
      return
    }
    done = true
    lock.unlock()
    body()
  }
}

/// Live chat request. Pause calls `cancel()` and the socket closes immediately.
final class ChatStream: @unchecked Sendable {
  private let lock = NSLock()
  private var task: URLSessionTask?
  private var session: URLSession?
  private var stopped = false
  private var userStop = false
  private var stalled = false
  private var progress = false
  private var answered = false

  func attach(_ task: URLSessionTask, session: URLSession? = nil) {
    lock.lock()
    let stopped = self.stopped
    self.task = task
    if let session { self.session = session }
    let live = self.session
    lock.unlock()
    if stopped {
      task.cancel()
      live?.invalidateAndCancel()
    }
  }

  func markProgress() {
    lock.lock()
    progress = true
    lock.unlock()
  }

  func markAnswer() {
    lock.lock()
    progress = true
    answered = true
    lock.unlock()
  }

  /// No answer yet. Ready frames and proxy pings must not keep the socket open.
  func stallIfNoAnswer() {
    lock.lock()
    if stopped || answered || userStop {
      lock.unlock()
      return
    }
    stalled = true
    let current = task
    lock.unlock()
    current?.cancel()
  }

  func stallIfQuiet() {
    stallIfNoAnswer()
  }

  func cancel() {
    lock.lock()
    userStop = true
    stopped = true
    let current = task
    let live = session
    lock.unlock()
    current?.cancel()
    live?.invalidateAndCancel()
  }

  var isStopped: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopped
  }

  var isUserStop: Bool {
    lock.lock()
    defer { lock.unlock() }
    return userStop
  }

  var didStall: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stalled
  }

  var hasAnswer: Bool {
    lock.lock()
    defer { lock.unlock() }
    return answered
  }
}

enum ArrabAPIError: LocalizedError {
  case badURL
  case http(Int, String)
  case decoding
  case unauthorized
  case empty

  var errorDescription: String? {
    switch self {
    case .badURL: return "Invalid API URL."
    case .http(_, let body): return Self.readable(body) ?? "The reply did not arrive."
    case .decoding: return "Could not read the server response."
    case .unauthorized: return "Sign in again — session expired."
    case .empty: return "Empty response."
    }
  }

  /// Server sentences win over status codes so a refusal is readable in the chat.
  static func readable(_ body: String) -> String? {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed == "message failed" || trimmed == "stream failed" { return nil }
    if let data = trimmed.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      let raw = json["message"] ?? (json["error"] as? [String: Any])?["message"] ?? json["error"]
      if let text = raw as? String {
        let sentence = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !sentence.isEmpty { return String(sentence.prefix(500)) }
      }
    }
    if trimmed.hasPrefix("{") { return nil }
    return String(trimmed.prefix(500))
  }

  static func staleSession(_ error: Error) -> Bool {
    guard case let ArrabAPIError.http(code, body) = error else { return false }
    if code == 401 { return true }
    let lower = body.lowercased()
    return lower.contains("session expired") || lower.contains("sign in again")
  }
}

@MainActor
final class ArrabAPIClient: ObservableObject {
  static let shared = ArrabAPIClient()

  /// Production default; Settings / PC Link can override (Keychain).
  @Published var baseURL: String {
    didSet { KeychainStore.set(baseURL, forKey: "apiBaseURL") }
  }

  private var sessionToken: String? {
    didSet {
      if let sessionToken {
        KeychainStore.set(sessionToken, forKey: "sessionToken")
      } else {
        KeychainStore.remove("sessionToken")
      }
    }
  }

  private let urlSession: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 12
    config.timeoutIntervalForResource = 20
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }()

  /// Chat replies must not run on the main thread. A main-queue session
  /// holds the UI on “Replying” and the pause button never fires.
  private static let chatDelegateQueue: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.name = "arrab.chat"
    queue.qualityOfService = .userInitiated
    return queue
  }()

  private let chatSession: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 45
    config.timeoutIntervalForResource = 60
    config.waitsForConnectivity = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: config, delegate: nil, delegateQueue: ArrabAPIClient.chatDelegateQueue)
  }()

  init() {
    let stored = KeychainStore.string(forKey: "apiBaseURL")
    // The first builds stored the loopback default. Production sign-in lives on auth.arrabai.com.
    if let stored, stored != "http://127.0.0.1:8787", stored != "http://localhost:8787" {
      self.baseURL = stored
    } else {
      self.baseURL = "https://auth.arrabai.com"
    }
    self.sessionToken = KeychainStore.string(forKey: "sessionToken")
  }

  /// Resolves the deploy prefix from auth.arrabai.com and points API calls at it.
  func ensureLiveAuthBase() async throws {
    if trimmedBase.contains("://auth.arrabai.com/r/") || trimmedBase.contains("://api.arrabai.com/r/") {
      return
    }
    let prefix = try await Self.fetchAuthPrefix()
    baseURL = "https://auth.arrabai.com\(prefix)"
  }

  func setSessionToken(_ token: String?) {
    sessionToken = token
  }

  var hasSession: Bool { !(sessionToken ?? "").isEmpty }

  func signIn(email: String, password: String) async throws -> ConnectAccountResponse {
    let body = ["email": email, "password": password]
    let response: ConnectAccountResponse = try await request(
      "POST",
      path: "/v1/account/sign-in",
      body: body,
      authed: false
    )
    sessionToken = response.sessionToken
    return response
  }

  func connectAccount(email: String, password: String, displayName: String?) async throws -> ConnectAccountResponse {
    var body: [String: String] = ["email": email, "password": password]
    if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
    let response: ConnectAccountResponse = try await request(
      "POST",
      path: "/v1/account/connect",
      body: body,
      authed: false
    )
    sessionToken = response.sessionToken
    return response
  }

  func verifySession() async throws -> AccountStatusResponse {
    guard let token = sessionToken else { throw ArrabAPIError.unauthorized }
    return try await request(
      "POST",
      path: "/v1/account/session",
      body: ["sessionToken": token],
      authed: false
    )
  }

  func account() async throws -> AccountStatusResponse {
    try await request("GET", path: "/v1/account")
  }

  func updateDisplayName(_ name: String) async throws -> AccountStatusResponse {
    struct Body: Encodable { var displayName: String }
    return try await request("PATCH", path: "/v1/account", body: Body(displayName: name))
  }

  func usage() async throws -> UsageSnapshot {
    try await request("GET", path: "/v1/usage")
  }

  func aiStatus() async throws -> AiGatewayStatus {
    try await request("GET", path: "/v1/ai/status")
  }

  func meta() async throws -> ApiMeta {
    try await request("GET", path: "/v1/meta")
  }

  func companionDesk() async throws -> CompanionDeskState {
    try await request("GET", path: "/v1/desk")
  }

  func setDeskPace(_ pace: String) async throws -> CompanionDeskState {
    struct Body: Encodable { var pace: String }
    return try await request("PATCH", path: "/v1/desk", body: Body(pace: pace))
  }

  func updateDesk(spendCapSar: Int?, quietStartHour: Int?, quietEndHour: Int?, clearQuiet: Bool = false, shopHours: String? = nil, messageList: [String]? = nil, neverSay: String? = nil) async throws -> CompanionDeskState {
    struct Body: Encodable {
      var spendCapSar: Int?
      var quietStartHour: Int?
      var quietEndHour: Int?
      var clearQuiet: Bool
      var shopHours: String?
      var messageList: [String]?
      var neverSay: String?

      enum CodingKeys: String, CodingKey {
        case spendCapSar, quietStartHour, quietEndHour, shopHours, messageList, neverSay
      }

      func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(spendCapSar, forKey: .spendCapSar)
        if clearQuiet {
          try container.encodeNil(forKey: .quietStartHour)
          try container.encodeNil(forKey: .quietEndHour)
        } else {
          try container.encodeIfPresent(quietStartHour, forKey: .quietStartHour)
          try container.encodeIfPresent(quietEndHour, forKey: .quietEndHour)
        }
        try container.encodeIfPresent(shopHours, forKey: .shopHours)
        try container.encodeIfPresent(messageList, forKey: .messageList)
        try container.encodeIfPresent(neverSay, forKey: .neverSay)
      }
    }
    return try await request(
      "PATCH",
      path: "/v1/desk",
      body: Body(
        spendCapSar: spendCapSar,
        quietStartHour: quietStartHour,
        quietEndHour: quietEndHour,
        clearQuiet: clearQuiet,
        shopHours: shopHours,
        messageList: messageList,
        neverSay: neverSay
      )
    )
  }

  func killDesk() async throws -> CompanionDeskState {
    try await request("POST", path: "/v1/desk/kill")
  }

  func startDeskJob(title: String, brief: String, companionId: String, companionName: String, channel: String? = nil, recipient: String? = nil) async throws -> DeskJob {
    struct Body: Encodable {
      var title: String
      var brief: String
      var companionId: String
      var companionName: String
      var channel: String?
      var recipient: String?
    }
    return try await request(
      "POST",
      path: "/v1/desk/jobs",
      body: Body(title: title, brief: brief, companionId: companionId, companionName: companionName, channel: channel, recipient: recipient),
      timeout: 90
    )
  }

  func approveDeskJob(_ id: String, draftHash: String? = nil, amountSar: Int? = nil) async throws -> DeskJob {
    struct Body: Encodable {
      var draftHash: String?
      var amountSar: Int?
    }
    return try await request("POST", path: "/v1/desk/jobs/\(id)/approve", body: Body(draftHash: draftHash, amountSar: amountSar), timeout: 90)
  }

  func stopDeskJob(_ id: String) async throws -> DeskJob {
    try await request("POST", path: "/v1/desk/jobs/\(id)/stop")
  }

  func reviseDeskJob(_ id: String, note: String) async throws -> DeskJob {
    struct Body: Encodable { var note: String }
    return try await request("POST", path: "/v1/desk/jobs/\(id)/revise", body: Body(note: note))
  }

  func billingAccount() async throws -> BillingAccountStatus {
    try await request("GET", path: "/v1/account")
  }

  func billingCatalog() async throws -> BillingCatalog {
    try await request("GET", path: "/v1/billing/plans")
  }

  func checkoutPlan(_ planId: String) async throws -> CheckoutLink {
    try await request("POST", path: "/v1/billing/checkout", body: ["planId": planId])
  }

  func checkoutCredit(_ packId: String) async throws -> CheckoutLink {
    try await request("POST", path: "/v1/billing/top-up", body: ["packId": packId])
  }

  func checkoutCreditAmount(_ amountSar: Double) async throws -> CheckoutLink {
    struct Body: Encodable { var amountSar: Double }
    return try await request("POST", path: "/v1/billing/top-up", body: Body(amountSar: amountSar))
  }

  func deleteConversation(_ id: String) async {
    try? await requestEmpty("DELETE", path: "/v1/conversations/\(id)")
  }

  func listMemories() async throws -> [(id: String, content: String)] {
    struct Item: Codable { var id: String; var content: String }
    struct Box: Codable { var items: [Item] }
    let res: Box = try await request("GET", path: "/v1/memories")
    return res.items.map { ($0.id, $0.content) }
  }

  func createMemory(content: String) async throws {
    _ = try await createMemory(content: content, agentId: nil)
  }

  @discardableResult
  func createMemory(content: String, agentId: String?) async throws -> String {
    struct Body: Encodable { var content: String; var agentId: String? }
    struct Saved: Decodable { var id: String }
    let saved: Saved = try await request("POST", path: "/v1/memories", body: Body(content: content, agentId: agentId))
    return saved.id
  }

  func deleteMemory(_ id: String) async {
    try? await requestEmpty("DELETE", path: "/v1/memories/\(id)")
  }

  /// Photos always come from Gemini 3 Flash, even when chat is set to Arrab.
  func generatePhoto(prompt: String) async throws -> Data {
    struct Body: Encodable { var prompt: String }
    struct Box: Decodable { var image: String }
    let box: Box = try await request("POST", path: "/v1/images", body: Body(prompt: prompt), session: chatSession, timeout: 55)
    let raw = box.image
    let encoded = raw.split(separator: ",").last.map(String.init) ?? raw
    guard let data = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters), data.count > 32 else {
      throw ArrabAPIError.decoding
    }
    return data
  }

  func logout() async {
    _ = try? await requestEmpty("POST", path: "/v1/account/logout")
    sessionToken = nil
  }

  /// Apple Guideline 5.1.1(v) — account deletion from within the app.
  func deleteAccount() async throws {
    try await requestEmpty("POST", path: "/v1/account/disconnect")
    sessionToken = nil
  }

  func startWebAuth(returnTo: String? = "arrab://auth/complete") async throws -> StartWebAuthResponse {
    struct Body: Encodable {
      let returnTo: String?
    }
    return try await request(
      "POST",
      path: "/v1/account/auth/web/start",
      body: Body(returnTo: returnTo)
    )
  }

  func pollWebAuth(state: String, pollSecret: String) async throws -> PollWebAuthResponse {
    let s = state.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? state
    let p = pollSecret.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? pollSecret
    return try await request(
      "GET",
      path: "/v1/account/auth/web/poll?state=\(s)&pollSecret=\(p)",
      authed: false
    )
  }

  func health() async throws -> HealthResponse {
    try await request("GET", path: "/health", authed: false)
  }

  func connectors() async throws -> [ConnectorPublic] {
    let res: CollectionResponse<ConnectorPublic> = try await request("GET", path: "/v1/connectors")
    return res.items
  }

  func connectorsCatalog() async throws -> [ConnectorCatalogEntry] {
    let res: CollectionResponse<ConnectorCatalogEntry> = try await request(
      "GET",
      path: "/v1/connectors/catalog"
    )
    return res.items
  }

  func controlConnectors() async throws -> [ControlConnector] {
    let res: ControlConnectorsResponse = try await request("GET", path: "/erp/connectors")
    return res.items
  }

  func startConnectorOAuth(provider: String) async throws -> URL? {
    struct OAuthStart: Codable {
      let url: String?
      let state: String?
    }
    let path: String
    switch provider {
    case "gmail": path = "/v1/connectors/gmail/oauth/start"
    case "github": path = "/v1/connectors/github/oauth/start"
    case "outlook": path = "/v1/connectors/outlook/oauth/start"
    default: path = "/v1/connectors/\(provider)/oauth/start"
    }
    let res: OAuthStart = try await request("POST", path: path, body: EmptyJSON())
    guard let raw = res.url, let url = URL(string: raw) else { return nil }
    return url
  }

  func deleteConnector(id: String) async throws {
    try await requestEmpty("DELETE", path: "/v1/connectors/\(id)")
  }

  func connectConnector(
    provider: String,
    token: String,
    label: String?,
    config: [String: String]?
  ) async throws -> ConnectorPublic {
    struct Body: Encodable {
      var provider: String
      var token: String
      var label: String?
      var config: [String: String]?

      func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(provider, forKey: .provider)
        try container.encode(token, forKey: .token)
        if let label, !label.isEmpty { try container.encode(label, forKey: .label) }
        if let config, !config.isEmpty { try container.encode(config, forKey: .config) }
      }

      private enum CodingKeys: String, CodingKey {
        case provider, token, label, config
      }
    }
    return try await request(
      "POST",
      path: "/v1/connectors",
      body: Body(provider: provider, token: token, label: label, config: config)
    )
  }

  func agents() async throws -> [Agent] {
    let res: CollectionResponse<Agent> = try await request("GET", path: "/v1/agents")
    return res.items
  }

  func createAgent(_ body: CreateAgentRequest) async throws -> Agent {
    try await request("POST", path: "/v1/agents", body: body)
  }

  func tasks() async throws -> [RemoteTask] {
    let res: CollectionResponse<RemoteTask> = try await request("GET", path: "/v1/tasks")
    return res.items
  }

  func activity() async throws -> [RemoteActivity] {
    let res: CollectionResponse<RemoteActivity> = try await request("GET", path: "/v1/activity")
    return res.items
  }

  func projects() async throws -> [RemoteProject] {
    let res: CollectionResponse<RemoteProject> = try await request("GET", path: "/v1/projects")
    return res.items
  }

  func pendingApprovals() async throws -> [PendingApproval] {
    let res: CollectionResponse<PendingApproval> = try await request("GET", path: "/v1/approvals/pending")
    return res.items
  }

  func resolveApproval(id: String, status: String) async throws {
    struct Body: Encodable { let status: String }
    guard let url = absoluteURL(for: "/v1/approvals/\(id)/resolve") else { throw ArrabAPIError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 60
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    applyAuth(&req)
    req.httpBody = try JSONEncoder().encode(Body(status: status))
    let (_, response) = try await urlSession.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ArrabAPIError.http((response as? HTTPURLResponse)?.statusCode ?? 0, "approval failed")
    }
  }

  func workforce() async throws -> WorkforceSnapshot {
    try await request("GET", path: "/v1/org/workforce")
  }

  func conversations() async throws -> [Conversation] {
    let res: CollectionResponse<Conversation> = try await request("GET", path: "/v1/conversations")
    return res.items
  }

  func familySnapshot() async throws -> FamilySnapshot {
    try await request("GET", path: "/v1/family")
  }

  func createFamilyMember(_ body: FamilyCreateBody) async throws -> FamilySeat {
    try await request("POST", path: "/v1/family/members", body: body)
  }

  func updateFamilyMember(id: String, paused: Bool) async throws {
    struct Body: Encodable { var isPaused: Bool }
    struct Saved: Decodable {}
    let _: Saved = try await request("PATCH", path: "/v1/family/members/\(id)", body: Body(isPaused: paused))
  }

  func deleteFamilyMember(_ id: String) async throws {
    try await requestEmpty("DELETE", path: "/v1/family/members/\(id)")
  }

  func switchFamilyMember(_ id: String) async throws {
    struct Body: Encodable { var memberId: String }
    struct Saved: Decodable {}
    let _: Saved = try await request("POST", path: "/v1/family/switch", body: Body(memberId: id))
  }

  func grantFamilyTokens(memberId: String, tokens: Int) async throws -> FamilySnapshot {
    struct Body: Encodable { var memberId: String; var tokens: Int }
    return try await request("POST", path: "/v1/family/tokens/grant", body: Body(memberId: memberId, tokens: tokens))
  }

  func addFamilyGuidance(_ body: FamilyGuideBody) async throws {
    struct Saved: Decodable {}
    let _: Saved = try await request("POST", path: "/v1/family/guidance", body: body)
  }

  func conversation(_ id: String) async throws -> ConversationDetailResponse {
    try await request("GET", path: "/v1/conversations/\(id)")
  }

  func createConversation(agentId: String, title: String) async throws -> Conversation {
    try await request(
      "POST",
      path: "/v1/conversations",
      body: CreateConversationRequest(agentId: agentId, title: title)
    )
  }

  func sendMessage(conversationId: String, content: String, model: String? = nil) async throws -> Message {
    struct SendResponse: Codable {
      let assistantMessage: Message?
      let message: Message?
    }
    let res: SendResponse = try await request(
      "POST",
      path: "/v1/conversations/\(conversationId)/messages",
      body: SendMessageRequest(content: content, model: model)
    )
    if let assistantMessage = res.assistantMessage { return assistantMessage }
    if let message = res.message { return message }
    throw ArrabAPIError.empty
  }

  /// One reply request. Pause cancels the socket; the call does not sit on the main thread.
  /// The event stream stays open on heartbeats, so the phone uses this direct reply instead.
  func completeMessage(
    conversationId: String,
    content: String,
    model: String? = nil,
    stream: ChatStream,
    onTool: (@MainActor (String) -> Void)? = nil,
    onThinking: (@MainActor (String) -> Void)? = nil,
    onApproval: (@MainActor (String, String) -> Void)? = nil,
    onReplace: (@MainActor (String) -> Void)? = nil,
    onToken: (@MainActor (String) -> Void)? = nil
  ) async throws -> String {
    _ = (onTool, onThinking, onApproval, onReplace, onToken)
    return try await postReply(
      conversationId: conversationId,
      content: content,
      model: model,
      stream: stream,
      attempt: 0
    )
  }

  /// Starts the reply off the main-actor wait. The callback always runs on the main queue.
  func startReply(
    conversationId: String,
    content: String,
    model: String?,
    stream: ChatStream,
    attempt: Int = 0,
    done: @escaping (Result<String, Error>) -> Void
  ) {
    if stream.isUserStop {
      done(.failure(CancellationError()))
      return
    }
    guard let url = absoluteURL(for: "/v1/conversations/\(conversationId)/messages") else {
      done(.failure(ArrabAPIError.badURL))
      return
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 20
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    applyAuth(&req)
    do {
      req.httpBody = try JSONEncoder().encode(SendMessageRequest(content: content, model: model))
    } catch {
      done(.failure(error))
      return
    }
    ChatPoster.start(req, stream: stream) { [weak self] result in
      guard let self else {
        done(result)
        return
      }
      if attempt == 0, case .failure(let error) = result, ArrabAPIError.staleSession(error), !stream.isUserStop {
        self.setSessionToken(nil)
        self.startReply(
          conversationId: conversationId,
          content: content,
          model: model,
          stream: stream,
          attempt: 1,
          done: done
        )
        return
      }
      done(result)
    }
  }

  private func postReply(
    conversationId: String,
    content: String,
    model: String?,
    stream: ChatStream,
    attempt: Int
  ) async throws -> String {
    if stream.isUserStop || Task.isCancelled { throw CancellationError() }
    guard let url = absoluteURL(for: "/v1/conversations/\(conversationId)/messages") else {
      throw ArrabAPIError.badURL
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 40
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    applyAuth(&req)
    req.httpBody = try JSONEncoder().encode(SendMessageRequest(content: content, model: model))
    do {
      let text = try await ChatPoster.post(req, stream: stream)
      if stream.isUserStop || Task.isCancelled { throw CancellationError() }
      stream.markAnswer()
      return text
    } catch {
      if stream.isUserStop || Task.isCancelled { throw CancellationError() }
      if attempt == 0, ArrabAPIError.staleSession(error) {
        setSessionToken(nil)
        return try await postReply(
          conversationId: conversationId,
          content: content,
          model: model,
          stream: stream,
          attempt: 1
        )
      }
      throw error
    }
  }

  /// Streams SSE tokens off the main thread. Pause cancels `stream` immediately.
  /// If the stream stays quiet with no answer, one direct reply request replaces it.
  func streamMessage(
    conversationId: String,
    content: String,
    model: String? = nil,
    stream: ChatStream = ChatStream(),
    onTool: (@MainActor (String) -> Void)? = nil,
    onThinking: (@MainActor (String) -> Void)? = nil,
    onApproval: (@MainActor (String, String) -> Void)? = nil,
    onReplace: (@MainActor (String) -> Void)? = nil,
    onToken: @escaping @MainActor (String) -> Void,
    sessionRetry: Bool = true
  ) async throws -> String {
    if stream.isUserStop || Task.isCancelled { throw CancellationError() }
    guard let url = absoluteURL(for: "/v1/conversations/\(conversationId)/messages/stream") else {
      throw ArrabAPIError.badURL
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    applyAuth(&req)
    req.httpBody = try JSONEncoder().encode(SendMessageRequest(content: content, model: model))
    req.timeoutInterval = 60

    var reply = ""
    do {
      reply = try await Self.performStream(
        request: req,
        stream: stream,
        onTool: onTool,
        onThinking: onThinking,
        onApproval: onApproval,
        onReplace: onReplace,
        onToken: onToken
      )
    } catch {
      if stream.isUserStop || Task.isCancelled { throw CancellationError() }
      if sessionRetry, ArrabAPIError.staleSession(error) {
        setSessionToken(nil)
        return try await streamMessage(
          conversationId: conversationId,
          content: content,
          model: model,
          stream: stream,
          onTool: onTool,
          onThinking: onThinking,
          onApproval: onApproval,
          onReplace: onReplace,
          onToken: onToken,
          sessionRetry: false
        )
      }
      if error is ArrabAPIError { throw error }
      if stream.hasAnswer { return reply.isEmpty ? " " : reply }
      let timedOut = (error as? URLError)?.code == .timedOut
      if !stream.didStall && !timedOut { throw error }
    }
    if stream.isUserStop || Task.isCancelled { throw CancellationError() }
    if stream.hasAnswer || !reply.isEmpty { return reply.isEmpty ? " " : reply }

    // One lookup. A second full generation only if the server saved nothing.
    if let saved = await savedAssistantReply(conversationId: conversationId, stream: stream), !saved.isEmpty {
      if stream.isUserStop || Task.isCancelled { throw CancellationError() }
      stream.markAnswer()
      await onToken(saved)
      return saved
    }
    if stream.isUserStop || Task.isCancelled { throw CancellationError() }

    let fallback: String
    do {
      fallback = try await postChatMessage(
        conversationId: conversationId,
        content: content,
        model: model,
        stream: stream
      )
    } catch {
      if sessionRetry, ArrabAPIError.staleSession(error) {
        setSessionToken(nil)
        return try await streamMessage(
          conversationId: conversationId,
          content: content,
          model: model,
          stream: stream,
          onTool: onTool,
          onThinking: onThinking,
          onApproval: onApproval,
          onReplace: onReplace,
          onToken: onToken,
          sessionRetry: false
        )
      }
      throw error
    }
    if stream.isUserStop || Task.isCancelled { throw CancellationError() }
    await onToken(fallback)
    return fallback
  }

  /// Last assistant text after the latest user turn, if the stream never delivered it.
  private func savedAssistantReply(conversationId: String, stream: ChatStream) async -> String? {
    if stream.isUserStop || Task.isCancelled { return nil }
    guard let detail = try? await conversation(conversationId) else { return nil }
    guard let userAt = detail.messages.lastIndex(where: { $0.role == "user" || $0.role == "me" }) else {
      return nil
    }
    for message in detail.messages.dropFirst(userAt + 1).reversed() {
      guard message.role == "assistant" else { continue }
      let text = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty { return text }
    }
    return nil
  }

  private nonisolated static func performStream(
    request: URLRequest,
    stream: ChatStream,
    onTool: (@MainActor (String) -> Void)?,
    onThinking: (@MainActor (String) -> Void)?,
    onApproval: (@MainActor (String, String) -> Void)?,
    onReplace: (@MainActor (String) -> Void)?,
    onToken: @escaping @MainActor (String) -> Void
  ) async throws -> String {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 60
    config.timeoutIntervalForResource = 90
    config.waitsForConnectivity = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    let download = SSEDownload()
    let session = URLSession(configuration: config, delegate: download, delegateQueue: ArrabAPIClient.chatDelegateQueue)
    let task = session.dataTask(with: request)
    stream.attach(task, session: session)
    if stream.isUserStop {
      task.cancel()
      session.invalidateAndCancel()
      throw CancellationError()
    }
    task.resume()
    defer {
      task.cancel()
      session.finishTasksAndInvalidate()
    }
    let status = try await download.status()
    if stream.didStall || stream.isUserStop || Task.isCancelled {
      throw CancellationError()
    }
    if status == 401 { throw ArrabAPIError.unauthorized }
    if !(200..<300).contains(status) {
      var data = Data()
      for await chunk in download.chunks { data.append(chunk) }
      throw ArrabAPIError.http(status, String(data: data, encoding: .utf8) ?? "")
    }
    return try await readSSE(
      chunks: download.chunks,
      stream: stream,
      onTool: onTool,
      onThinking: onThinking,
      onApproval: onApproval,
      onReplace: onReplace,
      onToken: onToken,
      stop: { download.stop() }
    )
  }

  private func postChatMessage(
    conversationId: String,
    content: String,
    model: String?,
    stream: ChatStream
  ) async throws -> String {
    if stream.isUserStop || Task.isCancelled { throw CancellationError() }
    guard let url = absoluteURL(for: "/v1/conversations/\(conversationId)/messages") else {
      throw ArrabAPIError.badURL
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 90
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    applyAuth(&req)
    req.httpBody = try JSONEncoder().encode(SendMessageRequest(content: content, model: model))
    let (data, response) = try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(Data, URLResponse), Error>) in
        let gate = OnceResume()
        let task = self.chatSession.dataTask(with: req) { data, response, error in
          DispatchQueue.global(qos: .userInitiated).async {
            gate.run {
              if let error {
                cont.resume(throwing: error)
              } else if let data, let response {
                cont.resume(returning: (data, response))
              } else {
                cont.resume(throwing: ArrabAPIError.empty)
              }
            }
          }
        }
        stream.attach(task)
        task.resume()
      }
    } onCancel: {
      stream.cancel()
    }
    if stream.isUserStop || Task.isCancelled { throw CancellationError() }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      let text = String(data: data, encoding: .utf8) ?? ""
      throw ArrabAPIError.http((response as? HTTPURLResponse)?.statusCode ?? 0, text)
    }
    struct SendResponse: Codable {
      let assistantMessage: Message?
      let message: Message?
    }
    let res = try JSONDecoder().decode(SendResponse.self, from: data)
    if let text = res.assistantMessage?.content ?? res.message?.content, !text.isEmpty {
      stream.markAnswer()
      return text
    }
    throw ArrabAPIError.empty
  }

  private nonisolated static func readSSE(
    chunks: AsyncStream<Data>,
    stream: ChatStream,
    onTool: (@MainActor (String) -> Void)?,
    onThinking: (@MainActor (String) -> Void)?,
    onApproval: (@MainActor (String, String) -> Void)?,
    onReplace: (@MainActor (String) -> Void)?,
    onToken: @escaping @MainActor (String) -> Void,
    stop: @escaping () -> Void
  ) async throws -> String {
    var reply = ""
    var pending = ""
    var pendingBytes = Data()
    var closed = false
    func paint(_ text: String, replace: Bool) async {
      if replace {
        reply = text
        if let onReplace {
          await onReplace(text)
        } else {
          await onToken(text)
        }
      } else {
        reply += text
        await onToken(text)
      }
    }
    func take(_ block: String) async throws {
      if stream.isUserStop || stream.didStall || Task.isCancelled { throw CancellationError() }
      var event = "message"
      var dataBuf = ""
      for rawLine in block.components(separatedBy: "\n") {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("event:") {
          event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespacesAndNewlines)
        } else if line.hasPrefix("data:") {
          if !dataBuf.isEmpty { dataBuf += "\n" }
          dataBuf += String(line.dropFirst(5)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
      }
      let payload = dataBuf.trimmingCharacters(in: .whitespacesAndNewlines)
      if payload.isEmpty {
        if event == "ready" || block.contains(": ping") { stream.markProgress() }
        return
      }
      guard let raw = payload.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { return }
      if event == "ready" {
        stream.markProgress()
      } else if event == "token", let text = obj["text"] as? String, !text.isEmpty {
        stream.markAnswer()
        await paint(text, replace: false)
      } else if event == "replace", let text = obj["text"] as? String {
        stream.markAnswer()
        await paint(text, replace: true)
      } else if event == "thinking", let text = obj["text"] as? String, !text.isEmpty {
        stream.markProgress()
        if let onThinking { await onThinking(text) }
      } else if event == "tool_start", let tool = obj["name"] as? String {
        stream.markProgress()
        if let onTool { await onTool(tool) }
      } else if event == "approval",
                let approval = obj["approval"] as? [String: Any],
                let id = approval["id"] as? String,
                let detail = approval["detail"] as? String {
        stream.markProgress()
        if let onApproval { await onApproval(id, detail) }
      } else if event == "done" {
        let assistant = obj["assistantMessage"] as? [String: Any]
        let text = (assistant?["content"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !text.isEmpty {
          stream.markAnswer()
          await paint(text, replace: reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.count >= reply.count)
        } else if !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          stream.markAnswer()
        }
        closed = true
        stop()
      } else if event == "error" {
        let message = (obj["message"] as? String) ?? "Stream failed"
        throw ArrabAPIError.http(403, message)
      }
    }
    func absorb(_ chunk: Data) async throws {
      pendingBytes.append(chunk)
      let text: String
      if let whole = String(data: pendingBytes, encoding: .utf8) {
        text = whole
        pendingBytes.removeAll(keepingCapacity: true)
      } else {
        var end = pendingBytes.count
        var decoded = ""
        while end > 0 {
          if let prefix = String(data: pendingBytes.prefix(end), encoding: .utf8) {
            decoded = prefix
            pendingBytes.removeFirst(end)
            break
          }
          end -= 1
        }
        text = decoded
      }
      guard !text.isEmpty else { return }
      pending += text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
      let parts = pending.components(separatedBy: "\n\n")
      pending = parts.last ?? ""
      for block in parts.dropLast() where !block.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        try await take(block)
        if closed { return }
      }
    }
    do {
      for await chunk in chunks {
        if closed || stream.isUserStop || stream.didStall || Task.isCancelled {
          break
        }
        try await absorb(chunk)
        if closed { break }
      }
    } catch {
      if stream.didStall || stream.isUserStop || Task.isCancelled { throw CancellationError() }
      throw error
    }
    if !closed, !pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      try await take(pending)
    }
    if closed { stop() }
    return reply
  }

  func resolveTool(approvalId: String, toolResult: String, attestation: String) async throws -> String? {
    struct Body: Encodable {
      let status: String
      let toolResult: String
      let toolResultAttestation: String
    }
    struct Reply: Decodable {
      struct Continued: Decodable {
        struct Msg: Decodable { let content: String? }
        let assistantMessage: Msg?
      }
      let continued: Continued?
    }
    guard let url = absoluteURL(for: "/v1/approvals/\(approvalId)/resolve") else { throw ArrabAPIError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 180
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    applyAuth(&req)
    req.httpBody = try JSONEncoder().encode(Body(status: "approved", toolResult: toolResult, toolResultAttestation: attestation))
    let (data, response) = try await urlSession.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ArrabAPIError.http((response as? HTTPURLResponse)?.statusCode ?? 0, "tool resolve failed")
    }
    return try? JSONDecoder().decode(Reply.self, from: data).continued?.assistantMessage?.content
  }

  // MARK: - Managed client transport

  /// One attempt, no redirects, raw status. `nil` means the network failed — callers stay silent.
  func managedRequest(
    _ method: String,
    path: String,
    json: Data? = nil,
    timeout: TimeInterval = 12
  ) async -> (status: Int, body: Data)? {
    guard isSecureBase, let url = absoluteURL(for: path) else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.timeoutInterval = timeout
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if let json {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = json
    }
    applyAuth(&req)
    do {
      let (data, response) = try await managedSession.data(for: req)
      guard let http = response as? HTTPURLResponse else { return nil }
      return (http.statusCode, data)
    } catch {
      return nil
    }
  }

  /// Opens the live channel; `nil` on any failure or non-2xx (the caller backs off).
  func managedEvents(path: String) async -> URLSession.AsyncBytes? {
    guard isSecureBase, let url = absoluteURL(for: path) else { return nil }
    var req = URLRequest(url: url)
    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    req.timeoutInterval = 90
    applyAuth(&req)
    do {
      let (bytes, response) = try await eventsSession.bytes(for: req)
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        bytes.task.cancel()
        return nil
      }
      return bytes
    } catch {
      return nil
    }
  }

  private let eventsSession: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 90
    config.timeoutIntervalForResource = 60 * 60
    config.waitsForConnectivity = false
    return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
  }()

  /// HTTPS only; plain HTTP is allowed for a loopback dev API.
  var isSecureBase: Bool {
    guard let url = URL(string: trimmedBase), let scheme = url.scheme?.lowercased() else { return false }
    if scheme == "https" { return true }
    let host = url.host?.lowercased() ?? ""
    return scheme == "http" && (host == "127.0.0.1" || host == "localhost" || host == "::1")
  }

  private let managedSession: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 12
    config.timeoutIntervalForResource = 20
    config.waitsForConnectivity = false
    return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
  }()

  // MARK: - Internals

  private var trimmedBase: String {
    baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }

  /// Live auth serves `/r/<prefix>/account/…`, while the app speaks `/v1/account/…`.
  private var usesAuthRoutePrefix: Bool {
    trimmedBase.contains("/r/")
  }

  private func absoluteURL(for path: String) -> URL? {
    var resolved = path
    if usesAuthRoutePrefix, resolved.hasPrefix("/v1/") {
      resolved = String(resolved.dropFirst(3))
    }
    return URL(string: trimmedBase + resolved)
  }

  private static func fetchAuthPrefix() async throws -> String {
    guard let url = URL(string: "https://auth.arrabai.com/arrab-runtime.js") else {
      throw ArrabAPIError.badURL
    }
    let (data, response) = try await URLSession.shared.data(from: url)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let text = String(data: data, encoding: .utf8) else {
      throw ArrabAPIError.empty
    }
    let pattern = #"apiRoutePrefix:\s*"(/r/[^"]+)""#
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let range = Range(match.range(at: 1), in: text) else {
      throw ArrabAPIError.empty
    }
    return String(text[range])
  }

  /// Names this device in the user's device list (Settings → signed-in devices) and in diagnostics.
  private func applyClientInfo(_ req: inout URLRequest) {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    req.setValue("ios", forHTTPHeaderField: "X-Arrab-Platform")
    req.setValue(version, forHTTPHeaderField: "X-Arrab-App-Version")
    req.setValue(UIDevice.current.name.isEmpty ? "iPhone" : UIDevice.current.name, forHTTPHeaderField: "X-Arrab-Device-Name")
  }

  private func applyAuth(_ req: inout URLRequest) {
    if let token = sessionToken, !token.isEmpty {
      req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      req.setValue(token, forHTTPHeaderField: "X-Arrab-Account-Session")
    }
  }

  private func request<T: Decodable>(
    _ method: String,
    path: String,
    body: Encodable? = nil,
    authed: Bool = true,
    session: URLSession? = nil,
    timeout: TimeInterval? = nil
  ) async throws -> T {
    guard let url = absoluteURL(for: path) else { throw ArrabAPIError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if let timeout { req.timeoutInterval = timeout }
    applyClientInfo(&req)
    if authed { applyAuth(&req) }
    if let body {
      req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
    }
    let (data, response) = try await (session ?? urlSession).data(for: req)
    guard let http = response as? HTTPURLResponse else { throw ArrabAPIError.decoding }
    if http.statusCode == 401 { throw ArrabAPIError.unauthorized }
    guard (200..<300).contains(http.statusCode) else {
      let text = String(data: data, encoding: .utf8) ?? ""
      throw ArrabAPIError.http(http.statusCode, text)
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw ArrabAPIError.decoding
    }
  }

  private func requestEmpty(_ method: String, path: String) async throws {
    guard let url = absoluteURL(for: path) else { throw ArrabAPIError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = method
    applyAuth(&req)
    let (_, response) = try await urlSession.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ArrabAPIError.http((response as? HTTPURLResponse)?.statusCode ?? 0, "request failed")
    }
  }
}

/// Direct chat POST. Callbacks stay off the main thread so Pause can update the screen.
private enum ChatPoster {
  private static let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.name = "arrab.chat.post"
    queue.qualityOfService = .userInitiated
    return queue
  }()

  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 20
    config.timeoutIntervalForResource = 25
    config.waitsForConnectivity = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: config, delegate: nil, delegateQueue: queue)
  }()

  private struct ReplyBody: Decodable {
    struct Msg: Decodable { let content: String? }
    let assistantMessage: Msg?
    let message: Msg?
  }

  static func start(_ request: URLRequest, stream: ChatStream, done: @escaping (Result<String, Error>) -> Void) {
    if stream.isUserStop {
      DispatchQueue.main.async { done(.failure(CancellationError())) }
      return
    }
    let gate = OnceResume()
    let task = session.dataTask(with: request) { data, response, error in
      let result: Result<String, Error>
      if let error {
        result = .failure(error)
      } else if let data, let http = response as? HTTPURLResponse {
        if !(200..<300).contains(http.statusCode) {
          result = .failure(ArrabAPIError.http(http.statusCode, String(data: data, encoding: .utf8) ?? ""))
        } else if let body = try? JSONDecoder().decode(ReplyBody.self, from: data) {
          let text = (body.assistantMessage?.content ?? body.message?.content)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
          result = text.isEmpty ? .failure(ArrabAPIError.empty) : .success(text)
        } else {
          result = .failure(ArrabAPIError.decoding)
        }
      } else {
        result = .failure(ArrabAPIError.empty)
      }
      DispatchQueue.main.async {
        gate.run { done(result) }
      }
    }
    stream.attach(task)
    if stream.isUserStop {
      task.cancel()
      DispatchQueue.main.async {
        gate.run { done(.failure(CancellationError())) }
      }
      return
    }
    task.resume()
  }

  static func post(_ request: URLRequest, stream: ChatStream) async throws -> String {
    if stream.isUserStop { throw CancellationError() }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
        let gate = OnceResume()
        let task = session.dataTask(with: request) { data, response, error in
          DispatchQueue.global(qos: .userInitiated).async {
            gate.run {
              if let error {
                cont.resume(throwing: error)
                return
              }
              guard let data, let http = response as? HTTPURLResponse else {
                cont.resume(throwing: ArrabAPIError.empty)
                return
              }
              if !(200..<300).contains(http.statusCode) {
                cont.resume(throwing: ArrabAPIError.http(http.statusCode, String(data: data, encoding: .utf8) ?? ""))
                return
              }
              guard let body = try? JSONDecoder().decode(ReplyBody.self, from: data) else {
                cont.resume(throwing: ArrabAPIError.decoding)
                return
              }
              let text = (body.assistantMessage?.content ?? body.message?.content)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
              if text.isEmpty {
                cont.resume(throwing: ArrabAPIError.empty)
              } else {
                cont.resume(returning: text)
              }
            }
          }
        }
        stream.attach(task)
        if stream.isUserStop {
          task.cancel()
          gate.run { cont.resume(throwing: CancellationError()) }
          return
        }
        task.resume()
      }
    } onCancel: {
      stream.cancel()
    }
  }
}

/// Delivers chat bytes as they arrive. `URLSession.bytes` was holding the body until the socket died, so Thinking never cleared.
private final class SSEDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: AsyncStream<Data>.Continuation?
  private var statusWaiter: CheckedContinuation<Int, Error>?
  private var statusCode: Int?
  private var failed: Error?

  let chunks: AsyncStream<Data>

  override init() {
    var continuation: AsyncStream<Data>.Continuation!
    chunks = AsyncStream { continuation = $0 }
    self.continuation = continuation
    super.init()
  }

  func status() async throws -> Int {
    lock.lock()
    if let statusCode {
      lock.unlock()
      return statusCode
    }
    if let failed {
      lock.unlock()
      throw failed
    }
    lock.unlock()
    return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Int, Error>) in
      lock.lock()
      if let statusCode {
        lock.unlock()
        cont.resume(returning: statusCode)
        return
      }
      if let failed {
        lock.unlock()
        cont.resume(throwing: failed)
        return
      }
      statusWaiter = cont
      lock.unlock()
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
    lock.lock()
    statusCode = code
    let waiter = statusWaiter
    statusWaiter = nil
    lock.unlock()
    waiter?.resume(returning: code)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    continuation?.yield(data)
  }

  /// Stop waiting for the socket. The reply is already on screen.
  func stop() {
    lock.lock()
    let cont = continuation
    continuation = nil
    lock.unlock()
    cont?.finish()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let waiter = statusWaiter
    statusWaiter = nil
    if statusCode == nil {
      statusCode = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    }
    let code = statusCode ?? 0
    if let error { failed = error }
    lock.unlock()
    if let waiter {
      if let error, code == 0 {
        waiter.resume(throwing: error)
      } else {
        waiter.resume(returning: code)
      }
    }
    continuation?.finish()
  }
}

/// The server never gets to move the app to another base URL.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

private struct EmptyJSON: Encodable {}

private struct AnyEncodable: Encodable {
  private let encodeFunc: (Encoder) throws -> Void
  init(_ value: Encodable) {
    self.encodeFunc = { encoder in
      try value.encode(to: encoder)
    }
  }
  func encode(to encoder: Encoder) throws {
    try encodeFunc(encoder)
  }
}
