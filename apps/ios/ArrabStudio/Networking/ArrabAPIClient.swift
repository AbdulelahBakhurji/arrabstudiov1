import Foundation

enum ArrabAPIError: LocalizedError {
  case badURL
  case http(Int, String)
  case decoding
  case unauthorized
  case empty

  var errorDescription: String? {
    switch self {
    case .badURL: return "Invalid API URL."
    case .http(let code, let body): return "API \(code): \(body.prefix(180))"
    case .decoding: return "Could not read the server response."
    case .unauthorized: return "Sign in again — session expired."
    case .empty: return "Empty response."
    }
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

  init() {
    self.baseURL = KeychainStore.string(forKey: "apiBaseURL")
      ?? "http://127.0.0.1:8787"
    self.sessionToken = KeychainStore.string(forKey: "sessionToken")
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

  func logout() async {
    _ = try? await requestEmpty("POST", path: "/v1/account/logout")
    sessionToken = nil
  }

  func health() async throws -> HealthResponse {
    try await request("GET", path: "/health", authed: false)
  }

  func agents() async throws -> [Agent] {
    let res: CollectionResponse<Agent> = try await request("GET", path: "/v1/agents")
    return res.items
  }

  func createAgent(_ body: CreateAgentRequest) async throws -> Agent {
    try await request("POST", path: "/v1/agents", body: body)
  }

  func conversations() async throws -> [Conversation] {
    let res: CollectionResponse<Conversation> = try await request("GET", path: "/v1/conversations")
    return res.items
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

  func sendMessage(conversationId: String, content: String) async throws -> Message {
    struct SendResponse: Codable {
      let assistantMessage: Message?
      let message: Message?
    }
    let res: SendResponse = try await request(
      "POST",
      path: "/v1/conversations/\(conversationId)/messages",
      body: SendMessageRequest(content: content, model: nil)
    )
    if let assistantMessage = res.assistantMessage { return assistantMessage }
    if let message = res.message { return message }
    throw ArrabAPIError.empty
  }

  /// Streams SSE tokens; falls back to non-stream send on failure.
  func streamMessage(
    conversationId: String,
    content: String,
    onToken: @escaping @MainActor (String) -> Void
  ) async throws -> String {
    guard let url = URL(string: trimmedBase + "/v1/conversations/\(conversationId)/messages/stream") else {
      throw ArrabAPIError.badURL
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    applyAuth(&req)
    req.httpBody = try JSONEncoder().encode(SendMessageRequest(content: content, model: nil))
    req.timeoutInterval = 180

    do {
      let (bytes, response) = try await urlSession.bytes(for: req)
      guard let http = response as? HTTPURLResponse else { throw ArrabAPIError.decoding }
      if http.statusCode == 401 { throw ArrabAPIError.unauthorized }
      guard (200..<300).contains(http.statusCode) else {
        throw ArrabAPIError.http(http.statusCode, "stream failed")
      }

      var reply = ""
      var event = "message"
      var dataBuf = ""
      for try await line in bytes.lines {
        if line.hasPrefix("event:") {
          event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
          dataBuf += String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
        } else if line.isEmpty {
          defer {
            event = "message"
            dataBuf = ""
          }
          guard !dataBuf.isEmpty, let raw = dataBuf.data(using: .utf8) else { continue }
          if event == "token",
             let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
             let text = obj["text"] as? String {
            reply += text
            onToken(text)
          }
        }
      }
      if reply.isEmpty {
        let fallback = try await sendMessage(conversationId: conversationId, content: content)
        onToken(fallback.content)
        return fallback.content
      }
      return reply
    } catch {
      let fallback = try await sendMessage(conversationId: conversationId, content: content)
      onToken(fallback.content)
      return fallback.content
    }
  }

  // MARK: - Internals

  private var trimmedBase: String {
    baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
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
    authed: Bool = true
  ) async throws -> T {
    guard let url = URL(string: trimmedBase + path) else { throw ArrabAPIError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if authed { applyAuth(&req) }
    if let body {
      req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
    }
    let (data, response) = try await urlSession.data(for: req)
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
    guard let url = URL(string: trimmedBase + path) else { throw ArrabAPIError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = method
    applyAuth(&req)
    let (_, response) = try await urlSession.data(for: req)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ArrabAPIError.http((response as? HTTPURLResponse)?.statusCode ?? 0, "request failed")
    }
  }
}

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
