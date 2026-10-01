import ActivityKit
import Foundation

/// Shared by the app and the widget extension. Both targets compile this file
/// so the Lock Screen card and the agent stay the same type.
struct AgentActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var phase: String
    var detail: String
    var endsAt: Date?
  }

  var companionName: String
}
