import ActivityKit
import SwiftUI
import WidgetKit

struct AgentLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AgentActivityAttributes.self) { context in
      lockScreen(context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.attributes.companionName, systemImage: icon(context.state.phase))
            .font(ArrabFont.system(size: 17, weight: .semibold))
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          countdown(context.state.endsAt)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.detail)
            .font(ArrabFont.system(size: 15))
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      } compactLeading: {
        Image(systemName: icon(context.state.phase))
      } compactTrailing: {
        if let ends = context.state.endsAt, ends > Date() {
          Text(timerInterval: Date.now...ends, countsDown: true)
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .frame(maxWidth: 52)
        } else {
          Image(systemName: icon(context.state.phase))
        }
      } minimal: {
        Image(systemName: icon(context.state.phase))
      }
    }
  }

  private func lockScreen(_ context: ActivityViewContext<AgentActivityAttributes>) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon(context.state.phase))
        .font(ArrabFont.system(size: 22, weight: .semibold))
        .foregroundStyle(Color(hex: 0xC9BCFF))
        .frame(width: 36, height: 36)
      VStack(alignment: .leading, spacing: 2) {
        Text(context.attributes.companionName)
          .font(ArrabFont.system(size: 17, weight: .semibold))
          .foregroundStyle(Color(hex: 0xF4F3FB))
          .lineLimit(1)
        Text(context.state.detail)
          .font(ArrabFont.system(size: 15))
          .foregroundStyle(Color(hex: 0xB0ADBF))
          .lineLimit(2)
      }
      Spacer(minLength: 8)
      countdown(context.state.endsAt)
        .font(ArrabFont.system(size: 20, weight: .semibold))
        .foregroundStyle(Color(hex: 0xF4F3FB))
    }
    .padding(16)
    .activityBackgroundTint(Color(hex: 0x17171F))
  }

  @ViewBuilder
  private func countdown(_ ends: Date?) -> some View {
    if let ends, ends > Date() {
      Text(timerInterval: Date.now...ends, countsDown: true)
        .font(ArrabFont.system(size: 20, weight: .semibold))
        .multilineTextAlignment(.trailing)
    }
  }

  private func icon(_ phase: String) -> String {
    switch phase {
    case "alarm": return "alarm.fill"
    case "reminder": return "bell.fill"
    case "done": return "checkmark.circle.fill"
    default: return "sparkles"
    }
  }
}

@main
struct AgentWidgetBundle: WidgetBundle {
  var body: some Widget {
    AgentLiveActivity()
  }
}

private extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}
