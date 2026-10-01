import ActivityKit
import Foundation

/// Lock Screen and Dynamic Island card for the agent.
@MainActor
enum AgentLive {
  private static var reply: Activity<AgentActivityAttributes>?
  private static var countdown: Activity<AgentActivityAttributes>?
  private static var countdownToken = UUID()

  static func beginReply(companion: String, detail: String) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let name = companion.isEmpty ? "Arrab" : companion
    let state = AgentActivityAttributes.ContentState(phase: "reply", detail: detail, endsAt: nil)
    let content = ActivityContent(state: state, staleDate: nil)
    if let reply {
      Task { await reply.update(content) }
      return
    }
    reply = try? Activity.request(
      attributes: AgentActivityAttributes(companionName: name),
      content: content,
      pushType: nil
    )
  }

  static func endReply(summary: String? = nil) {
    guard let live = reply else { return }
    reply = nil
    let shown = summary?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "\n", with: " ")
    let detail = shown.map { String($0.prefix(80)) } ?? ""
    let state = AgentActivityAttributes.ContentState(phase: "done", detail: detail, endsAt: nil)
    let dismiss: ActivityUIDismissalPolicy = detail.isEmpty
      ? .immediate
      : .after(Date().addingTimeInterval(4))
    Task {
      await live.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: dismiss)
    }
  }

  /// Countdown while a reminder or alarm is waiting. Skipped when it is more than 8 hours away.
  static func showCountdown(companion: String, detail: String, endsAt: Date, alarm: Bool) {
    let wait = endsAt.timeIntervalSinceNow
    guard wait > 1, wait <= 8 * 60 * 60 else { return }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    if let existing = countdown?.content.state.endsAt, existing <= endsAt { return }
    let name = companion.isEmpty ? "Arrab" : companion
    let state = AgentActivityAttributes.ContentState(
      phase: alarm ? "alarm" : "reminder",
      detail: String(detail.prefix(80)),
      endsAt: endsAt
    )
    let content = ActivityContent(state: state, staleDate: endsAt)
    let token = UUID()
    countdownToken = token
    if countdown == nil {
      countdown = try? Activity.request(
        attributes: AgentActivityAttributes(companionName: name),
        content: content,
        pushType: nil
      )
    } else if let countdown {
      Task { await countdown.update(content) }
    }
    guard let live = countdown else { return }
    Task {
      try? await Task.sleep(for: .seconds(wait))
      guard countdownToken == token else { return }
      await live.end(
        ActivityContent(state: state, staleDate: nil),
        dismissalPolicy: .immediate
      )
      if countdown?.id == live.id { countdown = nil }
    }
  }

  static func endCountdown() {
    countdownToken = UUID()
    guard let live = countdown else { return }
    countdown = nil
    Task { await live.end(nil, dismissalPolicy: .immediate) }
  }
}
