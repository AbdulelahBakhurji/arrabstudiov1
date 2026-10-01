import SwiftUI

struct CompanionStripView: View {
  var arabic: Bool
  var showsAdd = true
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var router: ShellRouter
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive

  private let frameOrder = ["layan", "razan", "health", "career"]

  private var others: [CompanionItem] {
    companions.companions
      .filter { item in
        !item.isGeneral
          && item.id != "incognito"
          && item.id.lowercased() != "custom"
          && session.addedCompanionIds.contains(item.id)
          && item.matches(session.studioRole)
          && !(FamilySeatStore.kidSafeActive && item.lane == .studio)
      }
      .sorted { a, b in
        let ia = frameOrder.firstIndex(of: a.id) ?? 99
        let ib = frameOrder.firstIndex(of: b.id) ?? 99
        return ia < ib
      }
  }

  private var general: CompanionItem {
    companions.companions.first { $0.isGeneral } ?? CompanionCatalog.general
  }

  private var faceSize: CGFloat { adaptive.showSideRail ? 56 : (adaptive.isPhoneLandscape ? 40 : 52) }
  private var columnWidth: CGFloat { adaptive.showSideRail ? 84 : 66 }

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(alignment: .top, spacing: adaptive.showSideRail ? 16 : 6) {
        faceButton(general)
        ForEach(others) { item in
          faceButton(item)
        }
        if showsAdd { addFace }
      }
      .padding(.horizontal, adaptive.showSideRail ? adaptive.gutter : 12)
    }
    .padding(.vertical, adaptive.isPhoneLandscape ? 2 : 4)
  }

  private func faceButton(_ item: CompanionItem) -> some View {
    let on = companions.selectedId == item.id && router.destination != .incognito
    return Button {
      companions.selectedId = item.id
      managed.activeCompanionId = item.agentId ?? item.id
      if router.destination == .incognito {
        router.go(.tab(.chat))
      }
    } label: {
      VStack(spacing: 6) {
        CompanionFace(item: item, size: faceSize, selected: on)
        Text(item.isGeneral ? modeName : item.displayName(arabic: arabic))
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text(stripLine(item))
          .font(ArrabFont.system(size: 10))
          .foregroundStyle(theme.muted)
          .lineLimit(2)
          .multilineTextAlignment(.center)
          .frame(width: columnWidth - 2, height: 28, alignment: .top)
      }
      .frame(width: columnWidth)
    }
    .buttonStyle(.plain)
  }

  private var modeName: String {
    switch session.sessionMode {
    case "plan": return arabic ? "خطة" : "Plan"
    case "search": return arabic ? "بحث" : "Search"
    case "debug": return arabic ? "تصحيح" : "Debug"
    case "think": return arabic ? "فكّر" : "Think"
    default: return arabic ? "شخص" : "Person"
    }
  }

  private func stripLine(_ item: CompanionItem) -> String {
    if arabic {
      switch item.id {
      case "general": return "مساحة لكل شيء"
      case "layan": return "٥ ساعات نوم"
      case "razan": return "+٢٠٪ مصروف"
      case "health": return "اختبار بعد ٩ أيام"
      case "career": return "٤ تمارين هذا الأسبوع"
      default: return item.displayBlurb(arabic: true)
      }
    }
    switch item.id {
      case "general": return "Space for everything"
      case "layan": return "5 hours of sleep"
      case "razan": return "+20% allowance"
      case "health": return "Exam in 9 days"
      case "career": return "4 workouts this week"
      default: return item.displayBlurb(arabic: false)
    }
  }

  private var incognitoFace: some View {
    let on = router.destination == .incognito
    return Button {
      router.openIncognito()
    } label: {
      VStack(spacing: 8) {
        ZStack {
          Circle()
            .fill(theme.subtle)
            .frame(width: faceSize, height: faceSize)
          Image(systemName: "eye.slash")
            .font(ArrabFont.system(size: 20, weight: .medium))
            .foregroundStyle(theme.text)
        }
        .overlay {
          if on {
            Circle()
              .strokeBorder(theme.lavender, lineWidth: 3)
          }
        }
        Text(L10n.t(.incognito, arabic: arabic))
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text(L10n.t(.passwordProtected, arabic: arabic))
          .font(ArrabFont.system(size: 11))
          .foregroundStyle(theme.muted)
          .lineLimit(2)
          .multilineTextAlignment(.center)
          .frame(width: 76)
      }
      .frame(width: 84)
    }
    .buttonStyle(.plain)
  }

  private var addFace: some View {
    Button {
      router.showCompanionPicker = true
    } label: {
      VStack(spacing: 6) {
        Circle()
          .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5]))
          .foregroundStyle(theme.line)
          .frame(width: faceSize, height: faceSize)
          .overlay {
            Image(systemName: "plus")
              .font(ArrabFont.system(size: 18, weight: .semibold))
              .foregroundStyle(theme.muted)
          }
        Text(L10n.t(.add, arabic: arabic))
          .font(ArrabFont.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text(L10n.t(.addCompanionHint, arabic: arabic))
          .font(ArrabFont.system(size: 10))
          .foregroundStyle(theme.muted)
          .lineLimit(2)
          .multilineTextAlignment(.center)
          .frame(width: columnWidth - 2, height: 28, alignment: .top)
      }
      .frame(width: columnWidth)
    }
    .buttonStyle(.plain)
  }
}

struct ComposerBar: View {
  @Binding var draft: String
  var placeholder: String
  var isBusy: Bool
  var sendBlocked: Bool
  var onSend: () -> Void
  var onPause: (() -> Void)? = nil
  var onAttach: (() -> Void)? = nil

  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.keyboardVisible) private var keyboardVisible
  @FocusState private var focused: Bool
  @StateObject private var speech = SpeechDictation()

  private var modeChoices: [(String, String, String)] {
    let arabic = session.localeIsArabic
    return [
      ("agent", arabic ? "شخص" : "Person", "sparkle"),
      ("plan", arabic ? "خطة" : "Plan", "list.bullet.rectangle"),
      ("search", arabic ? "بحث" : "Search", "magnifyingglass"),
      ("debug", arabic ? "تصحيح" : "Debug", "ladybug"),
      ("think", arabic ? "فكّر" : "Think", "brain"),
    ]
  }

  private var activeMode: (String, String, String) {
    modeChoices.first { $0.0 == session.sessionMode } ?? modeChoices[0]
  }

  private var canSend: Bool {
    !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy && !sendBlocked
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      TextField(placeholder, text: $draft, axis: .vertical)
        .lineLimit(1...5)
        .focused($focused)
        .font(ArrabFont.system(size: 16))
        .foregroundStyle(theme.text)
        .multilineTextAlignment(session.localeIsArabic ? .trailing : .leading)

      if let notice = speech.notice, !speech.listening {
        Text(notice)
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.warn)
      }

      HStack(spacing: 10) {
        Button {
          onAttach?()
        } label: {
          Image(systemName: "plus")
            .font(ArrabFont.system(size: 16, weight: .medium))
            .foregroundStyle(theme.text.opacity(0.72))
            .frame(width: 36, height: 36)
            .background(theme.card)
            .clipShape(Circle())
        }
        .buttonStyle(.plain)

        Menu {
          ForEach(modeChoices, id: \.0) { choice in
            Button {
              ArrabHaptics.selection()
              session.sessionMode = choice.0
            } label: {
              Label(choice.1, systemImage: session.sessionMode == choice.0 ? "checkmark" : choice.2)
            }
          }
        } label: {
          HStack(spacing: 6) {
            Image(systemName: activeMode.2)
              .font(ArrabFont.system(size: 11, weight: .semibold))
            Text(activeMode.1)
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .lineLimit(1)
            Image(systemName: "chevron.down")
              .font(ArrabFont.system(size: 10, weight: .semibold))
          }
          .foregroundStyle(theme.text)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(theme.card)
          .clipShape(Capsule())
          .overlay(Capsule().stroke(theme.line, lineWidth: 1))
        }

        Spacer(minLength: 0)

        Button {
          ArrabHaptics.light()
          speech.toggle(arabic: session.localeIsArabic, current: draft) { draft = $0 }
        } label: {
          Image(systemName: speech.listening ? "mic.fill" : "mic")
            .font(ArrabFont.system(size: 15, weight: .medium))
            .foregroundStyle(speech.listening ? theme.onPrimary : theme.text)
            .frame(width: 36, height: 36)
            .background(speech.listening ? theme.primary : theme.card)
            .clipShape(Circle())
            .overlay(Circle().stroke(speech.listening ? Color.clear : theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(session.localeIsArabic ? (speech.listening ? "إيقاف" : "تحدّث") : (speech.listening ? "Stop" : "Speak"))

        if isBusy {
          stopControl(
            arabic: session.localeIsArabic,
            fill: theme.primary,
            ink: theme.onPrimary,
            line: Color.clear
          ) {
            onPause?()
          }
        } else {
          Button {
            speech.stop()
            onSend()
          } label: {
            Image(systemName: "arrow.up")
              .font(ArrabFont.system(size: 16, weight: .semibold))
              .foregroundStyle(canSend ? theme.onPrimary : theme.text.opacity(0.72))
              .frame(width: 40, height: 40)
              .background(canSend ? theme.primary : Color(hex: 0xD2D3DE))
              .clipShape(Circle())
          }
          .buttonStyle(.plain)
          .disabled(!canSend)
          .accessibilityLabel(session.localeIsArabic ? "إرسال" : "Send")
        }
      }
    }
    .padding(14)
    .background(theme.subtle)
    .clipShape(RoundedRectangle(cornerRadius: ArrabTheme.radiusComposer, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: ArrabTheme.radiusComposer, style: .continuous)
        .stroke(theme.line, lineWidth: 1)
    )
    .padding(.horizontal, adaptive.gutter)
    .padding(.top, keyboardVisible ? 6 : 10)
    .padding(.bottom, keyboardVisible ? 6 : 10)
    .onDisappear { speech.stop() }
  }
}

struct CompanionFace: View {
  let item: CompanionItem
  var size: CGFloat = 56
  var selected: Bool = false
  @Environment(\.arrab) private var theme

  var body: some View {
    ZStack {
      if item.isGeneral {
        Circle()
          .fill(Color(hex: 0xD7C8FF))
        Image(systemName: "sparkle")
          .font(ArrabFont.system(size: size * 0.42, weight: .medium))
          .foregroundStyle(Color(hex: 0x1C1C1E))
      } else {
        Image(Self.portrait(for: item.id) ?? Self.photos(gender: "woman")[0])
          .resizable()
          .scaledToFill()
          .frame(width: size, height: size)
          .clipShape(Circle())
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .overlay {
      if selected {
        Circle()
          .strokeBorder(theme.lavender, lineWidth: max(2.5, size * 0.055))
      }
    }
  }

  static let reservedPortraits: Set<String> = [
    "pool-04", "study", "pool-07", "inbox", "ui-designer", "kid-girl-1417-a", "pool-03",
    "saudi-copy-01", "sleep", "money", "pool-01", "pool-02", "work", "saudi-wellness-01",
    "pool-06", "pool-08", "saudi-shumagh-01", "saudi-hijab-01", "arrab-assistant",
    "web-designer", "phone-designer", "saudi-tech-01", "pool-11", "brand", "pool-09",
    "saudi-shumagh-02", "saudi-business-01", "trader", "pool-05", "pool-10", "pool-12",
    "saudi-woman-01",
  ]

  static func photos(gender: String) -> [String] {
    if gender == "man" {
      return ["trader", "focus", "saudi-training-01", "money", "pool-02", "work", "pool-06", "pool-08", "saudi-shumagh-01", "saudi-shumagh-02", "saudi-tech-01", "pool-11", "saudi-business-01", "kid-boy-1013-a", "kid-boy-1013-b", "kid-boy-1013-c", "kid-boy-1013-d", "kid-boy-1417-a", "kid-boy-1417-b", "kid-boy-1417-c", "kid-boy-1417-d", "kid-boy-69-a", "kid-boy-69-b", "kid-boy-69-c", "kid-boy-69-d"]
    }
    return ["pool-05", "pool-10", "pool-12", "saudi-woman-01", "kid-girl-1013-a", "training", "study", "inbox", "ui-designer", "pool-07", "pool-03", "pool-01", "sleep", "saudi-wellness-01", "saudi-hijab-01", "web-designer", "phone-designer", "kid-girl-1013-b", "kid-girl-1013-c", "kid-girl-1013-d", "kid-girl-1417-b", "kid-girl-1417-c", "kid-girl-1417-d", "kid-girl-69-a", "kid-girl-69-b", "kid-girl-69-c", "kid-girl-69-d"]
  }

  static func freshPhotos(gender: String) -> [String] {
    photos(gender: gender).filter { !reservedPortraits.contains($0) }
  }

  private static let extraKey = "arrab.companion.extraPortraits"

  static func freshPortrait(for id: String) -> String {
    let defaults = UserDefaults.standard
    var map = defaults.dictionary(forKey: extraKey) as? [String: String] ?? [:]
    let made = Set(CompanionSpaceStore.usedMadePortraits())
    if let saved = map[id], saved != "coder", !reservedPortraits.contains(saved), !made.contains(saved) {
      let others = Set(map.filter { $0.key != id }.map(\.value))
      if !others.contains(saved) { return saved }
    }
    var taken = reservedPortraits.union(made).union(map.filter { $0.key != id }.map(\.value))
    taken.insert("coder")
    let pool = freshPhotos(gender: "woman") + freshPhotos(gender: "man")
    let choice = pool.first { !taken.contains($0) } ?? freshPhotos(gender: "woman").first ?? "pool-05"
    map[id] = choice
    defaults.set(map, forKey: extraKey)
    return choice
  }

  static func portrait(for id: String) -> String? {
    switch id {
    case "general": return nil
    case "layan", "study": return "study"
    case "joud", "daily-decisions": return "pool-07"
    case "inbox": return "inbox"
    case "ui-designer", "designer", "ui designer": return "ui-designer"
    case "razan": return "kid-girl-1417-a"
    case "health": return "pool-03"
    case "relationships": return "saudi-copy-01"
    case "sleep": return "sleep"
    case "money": return "money"
    case "parents": return "pool-01"
    case "career": return "pool-02"
    case "work": return "work"
    case "meetings": return "saudi-wellness-01"
    case "colleagues": return "pool-06"
    case "chronicler": return "pool-08"
    case "decision-guard": return "saudi-shumagh-01"
    case "meaning": return "pool-12"
    case "arrab-assistant": return "arrab-assistant"
    case "web-design": return "pool-05"
    case "phone-design": return "pool-10"
    case "game-design": return "saudi-tech-01"
    case "3d-modeling": return "pool-11"
    case "brand-identity": return "trader"
    case "copy-ux": return "pool-09"
    case "markets-terminal": return "saudi-shumagh-02"
    case "product-flow", "paperwork": return "saudi-business-01"
    case "training": return "saudi-training-01"
    case "focus": return "focus"
    case "trader": return "trader"
    case "nouf": return "ui-designer"
    case "web-designer": return "pool-05"
    case "phone-designer": return "pool-10"
    case "game-designer", "game": return "saudi-tech-01"
    case "3d-modeler", "modeling": return "pool-11"
    case "financial-expert", "markets": return "saudi-shumagh-02"
    case "brand": return "trader"
    case "copywriter": return "pool-09"
    default:
      if id.hasPrefix("made-") {
        let saved = CompanionSpaceStore.storedPortrait(for: id)
        if !saved.isEmpty, saved != "coder", !reservedPortraits.contains(saved) { return saved }
      }
      return freshPortrait(for: id)
    }
  }

}

struct CompanionPickerSheet: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var managed: ManagedClient
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.dismiss) private var dismiss

  @State private var query = ""
  @State private var creating = false
  @State private var editingId: String?
  @State private var draftName = ""
  @State private var place = "home"
  @State private var voice = "gulf"
  @State private var gender = "woman"
  @State private var advanced = ""
  @State private var showAdvanced = false
  @State private var connectors: Set<String> = []
  @State private var saving = false
  private var arabic: Bool { session.localeIsArabic }

  private var created: [CompanionItem] {
    companions.companions.filter { $0.id.hasPrefix("made-") }
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          if creating {
            createSteps
          } else {
            catalogList
          }
        }
        .padding(16)
      }
      .background(theme.bg)
      .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
      .navigationTitle(creating ? L10n.t(.createCompanion, arabic: arabic) : L10n.t(.chooseCompanion, arabic: arabic))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(creating ? (arabic ? "رجوع" : "Back") : (arabic ? "إغلاق" : "Close")) {
            if creating {
              creating = false
              editingId = nil
            } else {
              dismiss()
            }
          }
        }
        if !creating {
          ToolbarItem(placement: .topBarTrailing) {
            Button {
              beginCreate()
            } label: {
              Image(systemName: "plus")
                .font(ArrabFont.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.text)
            }
            .accessibilityLabel(L10n.t(.createCompanion, arabic: arabic))
          }
        }
      }
    }
    .environment(\.layoutDirection, .leftToRight)
  }

  private var catalogList: some View {
    VStack(alignment: .leading, spacing: 18) {
      TextField(L10n.t(.searchSessions, arabic: arabic), text: $query)
        .font(ArrabFont.system(size: 16))
        .textFieldStyle(.plain)
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

      if !created.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        Text(L10n.t(.createdCompanions, arabic: arabic))
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.muted)
        ForEach(created) { item in
          createdRow(item)
        }
      }

      if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        Button { choose(CompanionCatalog.general) } label: {
          HStack(spacing: 12) {
            CompanionFace(item: CompanionCatalog.general, size: 48, selected: companions.selectedId == "general")
            VStack(alignment: .leading, spacing: 3) {
              Text(CompanionCatalog.general.displayName(arabic: arabic))
                .font(ArrabFont.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(CompanionCatalog.general.displayBlurb(arabic: arabic))
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
            }
            Spacer()
          }
          .padding(12)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
      }

      ForEach(CompanionLane.allCases, id: \.self) { lane in
        let group = filtered.filter { $0.lane == lane }
        if !group.isEmpty {
          Text(laneTitle(lane))
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.muted)
          ForEach(group) { item in
            Button {
              choose(item)
            } label: {
              HStack(spacing: 12) {
                CompanionFace(item: item, size: 48, selected: companions.selectedId == item.id)
                VStack(alignment: .leading, spacing: 3) {
                  Text(item.displayName(arabic: arabic))
                    .font(ArrabFont.system(size: 16, weight: .semibold))
                    .foregroundStyle(theme.text)
                  Text(item.displayBlurb(arabic: arabic))
                    .font(ArrabFont.system(size: 12))
                    .foregroundStyle(theme.muted)
                    .lineLimit(2)
                }
                Spacer()
                if companions.selectedId == item.id {
                  Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(theme.lavender)
                }
              }
              .padding(12)
              .background(theme.card)
              .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
          }
        }
      }

      Button {
        beginCreate()
      } label: {
        HStack(spacing: 12) {
          Circle()
            .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5]))
            .frame(width: 48, height: 48)
            .overlay {
              Image(systemName: "plus")
                .font(ArrabFont.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(theme.muted)
          VStack(alignment: .leading, spacing: 3) {
            Text(L10n.t(.createCompanion, arabic: arabic))
              .font(ArrabFont.system(size: 16, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(L10n.t(.createHint, arabic: arabic))
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
          }
          Spacer()
        }
        .padding(12)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
      .buttonStyle(.plain)
    }
  }

  private func createdRow(_ item: CompanionItem) -> some View {
    Button { choose(item) } label: {
      HStack(spacing: 12) {
        CompanionFace(item: item, size: 48, selected: companions.selectedId == item.id)
        VStack(alignment: .leading, spacing: 3) {
          Text(item.displayName(arabic: arabic))
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(item.displayBlurb(arabic: arabic))
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
            .lineLimit(2)
        }
        Spacer()
      }
      .padding(12)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
    .buttonStyle(.plain)
    .contextMenu {
      Button {
        beginEdit(item)
      } label: {
        Label(arabic ? "تعديل" : "Edit", systemImage: "pencil")
      }
      Button(role: .destructive) {
        companions.deleteCompanion(id: item.id)
        session.forgetCompanion(item.id)
      } label: {
        Label(L10n.t(.delete, arabic: arabic), systemImage: "trash")
      }
    }
  }

  private var createSteps: some View {
    let preview = companions.previewPortrait(gender: gender, purpose: place, editing: editingId)
    let wide = adaptive.isPhoneLandscape || adaptive.isPadLike
    return VStack(alignment: .leading, spacing: wide ? 12 : 18) {
      Text(L10n.t(.createCompanion, arabic: arabic))
        .font(ArrabFont.system(size: wide ? 20 : 26, weight: .semibold))
        .foregroundStyle(theme.text)
      Text(L10n.t(.createHint, arabic: arabic))
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)

      if wide {
        HStack(alignment: .top, spacing: 20) {
          portraitPreview(preview)
            .frame(width: 120)
          stepBody
        }
      } else {
        HStack {
          Spacer()
          portraitPreview(preview)
          Spacer()
        }
        stepBody
      }

      Button {
        Task { await finishCreate() }
      } label: {
        Text(editingId == nil ? L10n.t(.createCompanion, arabic: arabic) : (arabic ? "حفظ" : "Save"))
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .frame(maxWidth: .infinity)
          .padding(.vertical, wide ? 12 : 14)
          .foregroundStyle(theme.onPrimary)
          .background(canAdvance ? theme.primary : theme.subtle)
          .clipShape(Capsule())
      }
      .buttonStyle(.plain)
      .disabled(!canAdvance || saving)
    }
    .frame(maxWidth: adaptive.isPadLike ? 720 : .infinity)
  }

  @ViewBuilder
  private var stepBody: some View {
    field(arabic ? "الاسم" : "Name", text: $draftName)
    Text(arabic ? "وين يساعد؟" : "Where do they help?")
      .font(ArrabFont.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.muted)
    HStack(spacing: 8) {
      choiceChip(arabic ? "البيت" : "Home", on: place == "home") { place = "home" }
      choiceChip(arabic ? "المحل" : "Shop", on: place == "shop") { place = "shop" }
      choiceChip(arabic ? "الاثنين" : "Both", on: place == "both") { place = "both" }
    }
    Text(arabic ? "كيف يتكلم؟" : "How do they speak?")
      .font(ArrabFont.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.muted)
    HStack(spacing: 8) {
      choiceChip(arabic ? "خليجي" : "Gulf", on: voice == "gulf") { voice = "gulf" }
      choiceChip(arabic ? "واضح" : "Clear", on: voice == "clear") { voice = "clear" }
      choiceChip(arabic ? "إنجليزي" : "English", on: voice == "english") { voice = "english" }
    }
    Text(arabic ? "يسأل قبل الفلوس وواتساب والنشر. ما يدفع ولا يرسل لحاله." : "They ask before money, WhatsApp, or publishing. They do not pay or send on their own.")
      .font(ArrabFont.system(size: 12))
      .foregroundStyle(theme.muted)
    HStack(spacing: 8) {
      choiceChip(L10n.t(.genderWoman, arabic: arabic), on: gender == "woman") { gender = "woman" }
      choiceChip(L10n.t(.genderMan, arabic: arabic), on: gender == "man") { gender = "man" }
    }
    Button {
      showAdvanced.toggle()
    } label: {
      Text(arabic ? "ملاحظة إضافية" : "Extra note")
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.lavender)
    }
    .buttonStyle(.plain)
    if showAdvanced {
      field(arabic ? "شيء تعرفه عنهم" : "Something you want them to know", text: $advanced)
    }
  }


  private func choiceChip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(ArrabFont.system(size: 14, weight: .semibold))
        .foregroundStyle(on ? theme.onPrimary : theme.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(on ? theme.primary : theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(theme.line, lineWidth: on ? 0 : 1))
    }
    .buttonStyle(.plain)
  }

  private func field(_ placeholder: String, text: Binding<String>) -> some View {
    TextField(placeholder, text: text, axis: .vertical)
      .font(ArrabFont.system(size: 16))
      .lineLimit(1...4)
      .padding(14)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .foregroundStyle(theme.text)
  }

  private func portraitPreview(_ name: String) -> some View {
    let side: CGFloat = adaptive.isPhoneLandscape ? 96 : 88
    let asset = name.isEmpty ? CompanionFace.photos(gender: gender)[0] : name
    return Image(asset)
      .resizable()
      .scaledToFill()
      .frame(width: side, height: side)
      .clipShape(Circle())
      .overlay(Circle().strokeBorder(theme.lavender, lineWidth: 2.5))
  }

  private var canAdvance: Bool {
    !draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func beginCreate() {
    editingId = nil
    draftName = ""
    place = "home"
    voice = "gulf"
    gender = "woman"
    advanced = ""
    connectors = []
    showAdvanced = false
    creating = true
  }

  private func beginEdit(_ item: CompanionItem) {
    let record = companions.madeRecord(item.id)
    editingId = item.id
    draftName = record?.name ?? item.name
    place = record?.place ?? "home"
    voice = record?.voice ?? "gulf"
    gender = record?.gender ?? "woman"
    advanced = record?.advanced ?? ""
    connectors = Set(record?.connectors ?? [])
    showAdvanced = !advanced.isEmpty
    creating = true
  }

  private func finishCreate() async {
    saving = true
    defer { saving = false }
    if let editingId {
      if let item = companions.updateCompanion(
        id: editingId,
        place: place,
        voice: voice,
        name: draftName,
        gender: gender,
        advanced: advanced,
        connectors: Array(connectors).sorted()
      ) {
        choose(item)
      }
      return
    }
    let item = await companions.createCompanion(
      name: draftName,
      place: place,
      voice: voice,
      gender: gender,
      advanced: advanced,
      connectors: Array(connectors).sorted()
    )
    choose(item)
  }

  private func choose(_ item: CompanionItem) {
    session.rememberCompanion(item.id)
    companions.selectedId = item.id
    managed.activeCompanionId = item.agentId ?? item.id
    dismiss()
  }

  private var filtered: [CompanionItem] {
    companions.companions.filter { item in
      guard item.matches(session.studioRole) else { return false }
      if item.isGeneral || item.id == "incognito" || item.id.lowercased() == "custom" || item.name.lowercased() == "custom" {
        return false
      }
      let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
      if q.isEmpty { return true }
      return item.displayName(arabic: arabic).localizedCaseInsensitiveContains(q)
        || item.displayBlurb(arabic: arabic).localizedCaseInsensitiveContains(q)
    }
  }

  private func laneTitle(_ lane: CompanionLane) -> String {
    switch lane {
    case .personal: return L10n.t(.lanePersonal, arabic: arabic)
    case .studio: return L10n.t(.laneStudio, arabic: arabic)
    case .family: return L10n.t(.laneFamily, arabic: arabic)
    case .work: return L10n.t(.laneWork, arabic: arabic)
    }
  }
}

struct ConnectorBrand: Identifiable {
  let id: String
  let title: String
  let titleAr: String
  static let all: [ConnectorBrand] = [
    ConnectorBrand(id: "gmail", title: "Gmail", titleAr: "Gmail"),
    ConnectorBrand(id: "outlook", title: "Outlook", titleAr: "Outlook"),
    ConnectorBrand(id: "email", title: "Email", titleAr: "البريد"),
    ConnectorBrand(id: "whatsapp", title: "WhatsApp", titleAr: "واتساب"),
    ConnectorBrand(id: "github", title: "GitHub", titleAr: "GitHub"),
    ConnectorBrand(id: "gitlab", title: "GitLab", titleAr: "GitLab"),
    ConnectorBrand(id: "bitbucket", title: "Bitbucket", titleAr: "Bitbucket"),
    ConnectorBrand(id: "linear", title: "Linear", titleAr: "Linear"),
    ConnectorBrand(id: "slack", title: "Slack", titleAr: "Slack"),
    ConnectorBrand(id: "notion", title: "Notion", titleAr: "Notion"),
    ConnectorBrand(id: "ssh", title: "SSH", titleAr: "SSH"),
    ConnectorBrand(id: "finnhub", title: "Finnhub", titleAr: "Finnhub"),
    ConnectorBrand(id: "whoop", title: "WHOOP", titleAr: "WHOOP"),
    ConnectorBrand(id: "fitbit", title: "Fitbit", titleAr: "Fitbit"),
    ConnectorBrand(id: "google_drive", title: "Google Drive", titleAr: "Google Drive"),
    ConnectorBrand(id: "google_calendar", title: "Google Calendar", titleAr: "تقويم Google"),
    ConnectorBrand(id: "figma", title: "Figma", titleAr: "Figma"),
  ]
}
