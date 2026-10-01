import SwiftUI

struct StudioHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.adaptive) private var adaptive
  @State private var selected: StudioCompanionCard?

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 6) {
          Text("ARRAB / STUDIO")
            .font(ArrabFont.system(size: 10, weight: .bold))
            .tracking(1.2)
            .foregroundStyle(ArrabTheme.muted)
          Text(L10n.t(.studio, arabic: arabic))
            .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
            .foregroundStyle(ArrabTheme.text)
          Text(arabic ? "ابدأ بمساعد عرّاب — أو اختر الويب والجوال والرفاق المتخصصين." : "Start with Arrab Assistant — or pick web, phone, and specialist companions.")
            .font(ArrabFont.system(size: 13.5))
            .foregroundStyle(ArrabTheme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }

        VStack(spacing: 12) {
          ForEach(StudioCatalog.companions) { item in
            companionCard(item)
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(ArrabTheme.bg)
    .fullScreenCover(item: $selected) { item in
      if item.workspace == "ui-designer" {
        DesignStudioView(companion: item)
      } else {
        NavigationStack {
          StudioCompanionChatView(companion: item)
        }
      }
    }
  }

  private func companionCard(_ item: StudioCompanionCard) -> some View {
    let symbol = studioMode(item)
    return ArrabCard(padding: 16) {
      VStack(alignment: .leading, spacing: 14) {
        if item.isMain {
          Text(arabic ? "المساعد الرئيسي" : "MAIN")
            .font(ArrabFont.system(size: 10, weight: .bold))
            .tracking(0.6)
            .foregroundStyle(ArrabTheme.onPrimary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(ArrabTheme.primary)
            .clipShape(Capsule())
        }
        HStack(alignment: .top, spacing: 14) {
          StudioPortrait(id: item.id, size: item.isMain ? 76 : 68)
          VStack(alignment: .leading, spacing: 5) {
            Text(purposeTag(item))
              .font(ArrabFont.system(size: 11, weight: .semibold))
              .foregroundStyle(ArrabTheme.muted)
            Text(item.title(arabic: arabic))
              .font(ArrabFont.system(size: 18, weight: .semibold))
              .foregroundStyle(ArrabTheme.text)
            Text(item.subtitle(arabic: arabic))
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(ArrabTheme.muted)
              .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
              Image(systemName: symbol)
                .font(ArrabFont.system(size: 11, weight: .semibold))
              Text(item.mark(arabic: arabic))
                .font(ArrabFont.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(ArrabTheme.text)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(ArrabTheme.subtle)
            .clipShape(Capsule())
          }
        }
        Button {
          selected = item
        } label: {
          Text(arabic ? "افتح" : "Open")
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .foregroundStyle(ArrabTheme.onPrimary)
            .background(ArrabTheme.primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
  }

  private func purposeTag(_ item: StudioCompanionCard) -> String {
    switch item.id {
    case "web-designer": return arabic ? "تصميم الويب" : "Web design"
    case "phone-designer": return arabic ? "تصميم الجوال" : "Phone design"
    case "game-designer": return arabic ? "تصميم الألعاب" : "Game design"
    case "3d-modeler": return arabic ? "النمذجة ثلاثية الأبعاد" : "3D modeling"
    case "markets-terminal": return arabic ? "الأسواق" : "Markets"
    case "brand": return arabic ? "الهوية" : "Brand"
    case "copywriter": return arabic ? "كتابة النصوص" : "Copy"
    default: return arabic ? "المساعد" : "Assistant"
    }
  }

  private func studioMode(_ item: StudioCompanionCard) -> String {
    switch item.id {
    case "phone-designer": return "iphone"
    case "web-designer": return "eye"
    case "game-designer", "3d-modeler": return "cube"
    case "markets-terminal": return "chart.line.uptrend.xyaxis"
    case "arrab-assistant": return "folder"
    default: return "sparkles"
    }
  }
}

struct StudioPortrait: View {
  let id: String
  var size: CGFloat = 64

  var body: some View {
    Image(CompanionFace.portrait(for: id) ?? "arrab-assistant")
      .resizable()
      .scaledToFill()
      .frame(width: size, height: size)
      .clipShape(Circle())
      .overlay(Circle().stroke(ArrabTheme.line, lineWidth: 1))
  }
}

struct StudioCompanionChatView: View {
  let companion: StudioCompanionCard
  @EnvironmentObject private var session: AppSession
  @Environment(\.dismiss) private var dismiss
  @Environment(\.adaptive) private var adaptive
  @StateObject private var model = ChatViewModel()
  @State private var draft = ""

  private var arabic: Bool { session.localeIsArabic }

  private var suggestions: [String] {
    if arabic {
      switch companion.id {
      case "brand":
        return ["اكتب ثلاثة مبادئ للصوت", "اقترح لوحة ألوان", "اختر خطين متناسقين"]
      case "copywriter":
        return ["اكتب العنوان الرئيسي", "اكتب أزرار الدعوة", "اكتب نص الحالة الفارغة"]
      case "web-designer":
        return ["صفحة هبوط حديثة", "معرض أعمال", "تسعير بثلاث خطط"]
      case "phone-designer":
        return ["شاشة دخول للجوال", "بطاقة منتج للجوال", "شريط تبويب سفلي"]
      default:
        return ["ابحث في الويب عن…", "أنشئ تقريراً قصيراً PDF", "رتّب البريد المهم"]
      }
    }
    switch companion.id {
    case "brand":
      return ["Write three voice principles", "Propose a color palette", "Pick type pairing"]
    case "copywriter":
      return ["Draft the primary headline", "Write primary CTAs", "Write empty-state copy"]
    case "web-designer":
      return ["Modern landing page", "Portfolio gallery", "Pricing with 3 plans"]
    case "phone-designer":
      return ["Design a mobile login", "Product card for phone", "Bottom tab bar"]
    default:
      return ["Search the web for…", "Generate a short PDF report", "Triage important mail"]
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Button { dismiss() } label: {
          Image(systemName: "chevron.left")
            .foregroundStyle(ArrabTheme.text)
        }
        Text(companion.title(arabic: arabic))
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(ArrabTheme.text)
        Spacer()
      }
      .padding(adaptive.gutter)

      ScrollView {
        if model.lines.isEmpty {
          VStack(spacing: 12) {
            StudioPortrait(id: companion.id, size: 76)
            Text(arabic ? "ماذا ننجز؟" : "What should we get done?")
              .font(ArrabFont.system(size: 20, weight: .semibold))
              .foregroundStyle(ArrabTheme.text)
            Text(companion.subtitle(arabic: arabic))
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(ArrabTheme.muted)
              .multilineTextAlignment(.center)
            ForEach(suggestions, id: \.self) { item in
              Button {
                model.beginSend(item)
              } label: {
                Text(item)
                  .font(ArrabFont.system(size: 13))
                  .foregroundStyle(ArrabTheme.text)
                  .padding(12)
                  .frame(maxWidth: .infinity)
                  .background(ArrabTheme.subtle)
                  .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
              }
              .buttonStyle(.plain)
            }
          }
          .padding(adaptive.gutter)
        } else {
          LazyVStack(alignment: .leading, spacing: 8) {
            ForEach(model.lines) { line in
              HStack {
                if line.role == "user" { Spacer(minLength: 36) }
                Text(line.text)
                  .font(ArrabFont.system(size: 14))
                  .padding(10)
                  .background(line.role == "user" ? ArrabTheme.primary : ArrabTheme.subtle)
                  .foregroundStyle(line.role == "user" ? ArrabTheme.onPrimary : ArrabTheme.text)
                  .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                if line.role != "user" { Spacer(minLength: 36) }
              }
            }
          }
          .padding(adaptive.gutter)
        }
      }

      HStack(spacing: 8) {
        TextField(arabic ? "راسل هذا الرفيق…" : "Message this studio companion…", text: $draft, axis: .vertical)
          .font(ArrabFont.system(size: 16))
          .lineLimit(1...4)
          .padding(12)
          .background(ArrabTheme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        Button {
          let text = draft
          draft = ""
          model.beginSend(text)
        } label: {
          Image(systemName: "arrow.up")
            .frame(width: 40, height: 40)
            .background(ArrabTheme.primary)
            .foregroundStyle(ArrabTheme.onPrimary)
            .clipShape(Circle())
        }
        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
      }
      .padding(adaptive.gutter)
    }
    .background(ArrabTheme.bg.ignoresSafeArea())
    .task {
      model.modelId = session.resolvedModelId
      model.prefersArabic = arabic
      model.companionId = companion.id
      model.title = companion.title(arabic: arabic)
      await model.bootstrap()
    }
  }
}

struct OrgStudioHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 10) {
          Text(L10n.t(.orgMode, arabic: arabic))
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
          HStack(spacing: 8) {
            ArrabMark(size: 28)
            Text("Arrab")
              .font(ArrabFont.system(size: 28, weight: .semibold))
              .foregroundStyle(theme.text)
            Spacer()
          }
          Text(L10n.t(.runStudio, arabic: arabic))
            .font(ArrabFont.system(size: 28, weight: .semibold))
            .foregroundStyle(theme.text)
            .frame(maxWidth: .infinity, alignment: .leading)
          Text(L10n.t(.runStudioBody, arabic: arabic))
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
          Button {
            router.orgTab = .chat
          } label: {
            HStack(spacing: 8) {
              Text(L10n.t(.startChat, arabic: arabic))
              Image(systemName: "arrow.left")
            }
            .font(ArrabFont.system(size: 15, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(theme.primary)
            .clipShape(Capsule())
          }
          .buttonStyle(.plain)
          .frame(maxWidth: .infinity, alignment: .leading)
          Button {
            router.orgTab = .cowork
          } label: {
            Text(L10n.t(.openCowork, arabic: arabic))
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.text)
              .padding(.horizontal, 18)
              .padding(.vertical, 12)
              .overlay(Capsule().stroke(theme.line, lineWidth: 1))
          }
          .buttonStyle(.plain)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

        ArrabCard {
          HStack {
            Text(L10n.t(.setGoal, arabic: arabic))
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .overlay(Capsule().stroke(theme.line, lineWidth: 1))
            Spacer()
            VStack(alignment: .leading, spacing: 4) {
              Text(L10n.t(.weekGoal, arabic: arabic))
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
              Text(L10n.t(.weekGoalBody, arabic: arabic))
                .font(ArrabFont.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
            }
          }
        }

        VStack(alignment: .leading, spacing: 8) {
          Text(L10n.t(.yourPeople, arabic: arabic))
            .font(ArrabFont.system(size: 18, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(L10n.t(.pressAnyone, arabic: arabic))
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 14) {
            ForEach(people) { item in
              Button {
                companions.selectedId = item.id
                router.orgTab = .chat
              } label: {
                VStack(spacing: 6) {
                  CompanionFace(item: item, size: 48)
                  Text(item.displayName(arabic: arabic))
                    .font(ArrabFont.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                }
                .frame(width: 72)
              }
              .buttonStyle(.plain)
            }
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
  }

  private var people: [CompanionItem] {
    companions.companions.filter { $0.matches(.organization) && !$0.isGeneral }
  }
}

struct OrgChatHomeView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var chatting = false

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    if chatting {
      ChatHomeView(embeddedInShell: true)
    } else {
      promptList
    }
  }

  private var promptList: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text(L10n.t(.orgChatNew, arabic: arabic))
          .font(ArrabFont.system(size: 20, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(companionsLabel)
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)

        prompt(.orgBuild, .orgBuildBody)
        prompt(.orgSearch, .orgSearchBody)
        prompt(.orgWrite, .orgWriteBody)
        prompt(.orgDo, .orgDoBody)
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
  }

  private var companionsLabel: String {
    arabic ? "مساعد تجريبي" : "Trial assistant"
  }

  private func prompt(_ title: L10n.Key, _ body: L10n.Key) -> some View {
    Button {
      router.pendingPrompt = L10n.t(title, arabic: arabic)
      chatting = true
    } label: {
      VStack(alignment: .leading, spacing: 6) {
        Text(L10n.t(title, arabic: arabic))
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(theme.text)
        Text(L10n.t(body, arabic: arabic))
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .stroke(theme.line, lineWidth: 1)
      )
    }
    .buttonStyle(.plain)
  }
}
