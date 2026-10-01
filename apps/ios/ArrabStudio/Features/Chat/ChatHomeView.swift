import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers
#if canImport(ImagePlayground)
import ImagePlayground
#endif
#if canImport(FoundationModels)
import FoundationModels
#endif

struct ThinkingDots: View {
  var color: Color
  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<3, id: \.self) { _ in
        Circle()
          .fill(color)
          .frame(width: 6, height: 6)
          .opacity(0.85)
      }
    }
    .accessibilityHidden(true)
  }
}

/// Lets the stop control receive the touch instead of waiting out the scroll view.
struct ScrollTouchBridge: UIViewRepresentable {
  func makeUIView(context: Context) -> UIView {
    let view = UIView(frame: .zero)
    view.isUserInteractionEnabled = false
    view.backgroundColor = .clear
    return view
  }

  func updateUIView(_ uiView: UIView, context: Context) {
    DispatchQueue.main.async {
      var node: UIView? = uiView
      while let current = node {
        if let scroll = current as? UIScrollView {
          scroll.delaysContentTouches = false
          return
        }
        node = current.superview
      }
    }
  }
}

func stopControl(arabic: Bool, fill: Color, ink: Color, line: Color, action: @escaping () -> Void) -> some View {
  let title = arabic ? "إيقاف" : "Pause"
  return Button(action: action) {
    HStack(spacing: 6) {
      Image(systemName: "stop.fill")
        .font(ArrabFont.system(size: 11, weight: .bold))
      Text(title)
        .font(ArrabFont.system(size: 13, weight: .semibold))
    }
    .foregroundStyle(ink)
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .frame(minWidth: 96, minHeight: 44)
    .background(fill)
    .clipShape(Capsule())
    .overlay(Capsule().stroke(line, lineWidth: 1))
    .contentShape(Capsule())
  }
  .buttonStyle(.borderless)
}

enum ChatPurposeSuggestions {
  static func prompts(id: String, purpose: String, blurb: String, arabic: Bool) -> [String] {
    let owned = purpose.trimmingCharacters(in: .whitespacesAndNewlines)
    if !owned.isEmpty, !isSecret(owned) {
      return fromPurpose(owned, arabic: arabic)
    }
    if let known = catalog[id] {
      return arabic ? known.1 : known.0
    }
    let fallback = blurb.trimmingCharacters(in: .whitespacesAndNewlines)
    if !fallback.isEmpty { return fromPurpose(fallback, arabic: arabic) }
    return arabic
      ? ["وش نرتّب الحين؟", "ساعدني أبدأ بخطوة واحدة"]
      : ["What should we sort out?", "Help me start with one step"]
  }

  private static func fromPurpose(_ purpose: String, arabic: Bool) -> [String] {
    let short = String(purpose.prefix(42)).trimmingCharacters(in: .whitespacesAndNewlines)
    if arabic {
      return ["ساعدني في \(short)", "وش الخطوة الجاية في \(short)؟"]
    }
    return ["Help me with \(short)", "What's the next step for \(short)?"]
  }

  private static func isSecret(_ text: String) -> Bool {
    let lower = text.lowercased()
    return lower.hasPrefix("voice for ") || lower.hasPrefix("session mode:") || text.hasPrefix("أسلوب ")
  }

  private static let catalog: [String: ([String], [String])] = [
    "general": (
      ["Help me think this through", "What's the one thing to do now?"],
      ["خلّنا نفكّر بهالموضوع", "وش الشيء الواحد أسويه الحين؟"]
    ),
    "layan": (
      ["Plan my next exam", "Turn this course into focus blocks"],
      ["خطط لاختباري الجاي", "قسّم المقرر لفترات تركيز"]
    ),
    "joud": (
      ["Give me one clear choice", "Help me pick between these"],
      ["عطني خيار واحد واضح", "ساعدني أختار بين هالخيارات"]
    ),
    "inbox": (
      ["Triage what needs a reply", "Draft a careful reply"],
      ["رتّب اللي يحتاج رد", "اكتب رداً حذراً"]
    ),
    "ui-designer": (
      ["Sketch a layout for this screen", "Tighten this screen"],
      ["ارسم تخطيط لهالشاشة", "رتّب هالشاشة"]
    ),
    "razan": (
      ["What fits this week's allowance?", "Help me use the extra 20%"],
      ["وش يناسب مصروف هالأسبوع؟", "ساعدني أستخدم الزيادة"]
    ),
    "health": (
      ["How are sleep and movement?", "Set today's health baseline"],
      ["كيف النوم والحركة؟", "حدد خط اليوم الصحي"]
    ),
    "relationships": (
      ["Who should I reach out to?", "Who matters this week?"],
      ["مين أكلّمه؟", "مين المهم هالأسبوع؟"]
    ),
    "sleep": (
      ["I slept late — help me recover", "Plan tonight so I rest"],
      ["سهرت — ساعدني أتعافى", "خطط لليلتي عشان أرتاح"]
    ),
    "money": (
      ["Look at spending and bills", "How much runway do I have?"],
      ["راجع المصروف والفواتير", "كم السيولة المتبقية؟"]
    ),
    "parents": (
      ["When should I call or visit?", "What's coming up for my parents?"],
      ["متى أتصل أو أزور؟", "وش المناسبات الجاية للوالدين؟"]
    ),
    "career": (
      ["Am I still on a path I want?", "Help me spot burnout"],
      ["هل المسار ما زال يناسبني؟", "ساعدني ألاحظ الإرهاق"]
    ),
    "chronicler": (
      ["Record what happened today", "Gather what I lived this week"],
      ["سجّل اللي صار اليوم", "اجمع اللي عشته هالأسبوع"]
    ),
    "work": (
      ["Match today's tasks to the calendar", "Plan the work in front of me"],
      ["اربط مهام اليوم بالتقويم", "خطط للشغل اللي قدامي"]
    ),
    "meetings": (
      ["Prep me for the next meeting", "Write the follow-up"],
      ["جهّزني للاجتماع الجاي", "اكتب المتابعة بعد الاجتماع"]
    ),
    "colleagues": (
      ["Who is waiting on me?", "What do I owe the team?"],
      ["مين ينتظرني؟", "وش عليّ للفريق؟"]
    ),
    "decision-guard": (
      ["Slow this decision down", "What am I rushing?"],
      ["هدّئ هالقرار", "وش اللي مستعجل عليه؟"]
    ),
    "meaning": (
      ["Keep me with the practice I chose", "What does this practice ask today?"],
      ["ثبّتني على الممارسة اللي اخترتها", "وش تطلب هالممارسة اليوم؟"]
    ),
    "arrab-assistant": (
      ["Arrange this with my files", "Help me get this done"],
      ["رتّب هذا مع ملفاتي", "ساعدني أخلّص هالشغل"]
    ),
    "web-design": (
      ["Design a page I can preview", "Tighten this site layout"],
      ["صمم صفحة أقدر أشوفها", "رتّب تخطيط الموقع"]
    ),
    "phone-design": (
      ["Lay out this phone screen", "Make this fit a pocket"],
      ["رتّب شاشة الجوال", "خلّها تناسب الجيب"]
    ),
    "game-design": (
      ["Shape a playable idea", "What belongs in the first build?"],
      ["شكّل فكرة ألعبها", "وش لازم يكون في أول نسخة؟"]
    ),
    "3d-modeling": (
      ["Describe a scene I can export", "Help me model this object"],
      ["صف مشهداً أقدر أصدّره", "ساعدني أنمذج هالجسم"]
    ),
    "product-flow": (
      ["Take this idea through to ship", "What's the next step to launch?"],
      ["خذ الفكرة لين الإطلاق", "وش الخطوة الجاية للإطلاق؟"]
    ),
    "brand-identity": (
      ["Set the voice and look", "Does this match the brand?"],
      ["حدد الصوت والشكل", "هل هذا يناسب الهوية؟"]
    ),
    "copy-ux": (
      ["Write the headline and button", "Fix this empty state"],
      ["اكتب العنوان والزر", "أصلح حالة الفراغ"]
    ),
    "markets-terminal": (
      ["What should I watch today?", "Walk me through this symbol"],
      ["وش أراقب اليوم؟", "اشرح لي هالرمز"]
    ),
  ]
}

struct ChatHomeView: View {
  var embeddedInShell = false

  @Environment(\.adaptive) private var adaptive
  @Environment(\.arrab) private var theme
  @EnvironmentObject private var managed: ManagedClient
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @EnvironmentObject private var router: ShellRouter
  @EnvironmentObject private var network: NetworkMonitor
  @Environment(\.keyboardVisible) private var keyboardVisible
  @StateObject private var model = ChatViewModel()
  @ObservedObject private var voices = CompanionVoiceStore.shared
  @ObservedObject private var approvals = ApprovalInbox.shared
  @State private var showPlus = false
  @State private var showMemory = false
  @State private var selectedLineId: String?
  @State private var renaming = false
  @State private var renameDraft = ""
  @State private var showPlayground = false
  @State private var playgroundConcept = ""
  @State private var showChatList = false

  private var arabic: Bool { session.localeIsArabic }

  private var chatModeName: String {
    switch session.sessionMode {
    case "plan": return arabic ? "خطة" : "Plan"
    case "search": return arabic ? "بحث" : "Search"
    case "debug": return arabic ? "تصحيح" : "Debug"
    case "think": return arabic ? "فكّر" : "Think"
    default: return arabic ? "شخص" : "Person"
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      if !embeddedInShell {
        legacyHeader
        Divider().overlay(theme.line)
        chatRail
      } else if !keyboardVisible {
        roomTools
      }
      if !keyboardVisible && !FamilySeatStore.kidSafeActive {
        DeskWaitingCard()
      }
      Group {
        if model.lines.isEmpty && !model.isBusy {
          if keyboardVisible {
            Color.clear
          } else {
            Spacer(minLength: 12)
            welcomeCard
            connectionNote
            Spacer(minLength: 8)
          }
        } else {
          messages
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 0) {
        if keyboardVisible, let error = model.error, !error.isEmpty, model.lines.isEmpty {
          connectionNote
        }
        if !model.isBusy {
          suggestionRow
        }
        composer
        if embeddedInShell && adaptive.showSideRail && !keyboardVisible {
          composerFoot
        }
      }
      .background(embeddedInShell ? theme.card : theme.bg)
    }
    .background(embeddedInShell ? Color.clear : theme.bg)
    .task {
      await model.bootstrap()
      if let last = model.lastConversationToOpen() {
        if let companion = last.companionId, companions.selectedId != companion {
          model.suppressCompanionReset = true
          companions.selectedId = companion
        }
        if let companion = last.companionId {
          model.companionId = companion
        }
        await model.openChat(last.id)
      }
    }
    .onAppear {
      refreshVoice()
      model.modelId = session.resolvedModelId
      if let prompt = router.pendingPrompt {
        router.pendingPrompt = nil
        model.beginSend(prompt)
      }
    }
    .onChange(of: session.preferredModel) { _, _ in
      model.modelId = session.resolvedModelId
      model.localProfile = session.localModelId
    }
    .onChange(of: session.localModelId) { _, id in
      model.localProfile = id
    }
    .onChange(of: model.photoRequest) { _, prompt in
      guard let prompt, !prompt.isEmpty else { return }
      model.photoRequest = nil
      playgroundConcept = prompt
      if #available(iOS 18.1, *) {
        showPlayground = true
      } else if let url = PhoneCompanionTools.renderPoster(prompt: prompt) {
        model.latestFile = url
      }
    }
    .modifier(PhotoPlayground(show: $showPlayground, concept: playgroundConcept) { url in
      if let saved = PhoneCompanionTools.keepPhoto(at: url) {
        model.latestFile = saved
      }
    } onCancel: {
      if let url = PhoneCompanionTools.renderPoster(prompt: playgroundConcept) {
        model.latestFile = url
      }
    })
    .onChange(of: session.sessionMode) { _, mode in
      model.chatMode = mode
    }
    .onChange(of: companions.selectedId) { _, id in
      refreshVoice()
      model.companionId = id
      if model.suppressCompanionReset {
        model.suppressCompanionReset = false
        return
      }
      model.startFresh()
    }
    .onChange(of: router.focusConversationId) { _, id in
      guard let id else { return }
      let companion = router.focusCompanionId
      router.focusConversationId = nil
      router.focusCompanionId = nil
      if let companion, companions.selectedId != companion {
        model.suppressCompanionReset = true
        companions.selectedId = companion
      }
      if let companion { model.companionId = companion }
      Task { await model.openChat(id) }
    }
    .onChange(of: router.pendingDraft) { _, text in
      guard let text, !text.isEmpty else { return }
      router.pendingDraft = nil
      model.draft = text
    }
    .alert(arabic ? "إعادة تسمية" : "Rename", isPresented: $renaming) {
      TextField(L10n.t(.chat, arabic: arabic), text: $renameDraft)
        .font(ArrabFont.system(size: 16))
      Button(arabic ? "حفظ" : "Save") {
        model.renameActive(to: renameDraft)
      }
      Button(arabic ? "إلغاء" : "Cancel", role: .cancel) {}
    }
    .onChange(of: showMemory) { _, open in
      if !open { refreshVoice() }
    }
    .task { await approvals.refresh(arabic: arabic) }
    .sheet(isPresented: $showChatList) {
      chatListSheet
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
  }

  private func refreshVoice() {
      let label = companions.selected.displayName(arabic: arabic)
      model.title = label
      model.chatMode = session.sessionMode
      model.localProfile = session.localModelId
      model.companionId = companions.selected.id
      model.prefersArabic = arabic
  }

  private var chatRail: some View {
    HStack(spacing: 10) {
      Button {
        ArrabHaptics.light()
        showChatList = true
      } label: {
        Label(arabic ? "المحادثات" : "Chats", systemImage: "bubble.left.and.bubble.right")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(theme.card)
          .clipShape(Capsule())
          .overlay(Capsule().stroke(theme.line, lineWidth: 1))
      }
      .buttonStyle(.plain)
      Spacer(minLength: 8)
      Button {
        ArrabHaptics.light()
        showMemory = true
      } label: {
        Image(systemName: "slider.horizontal.3")
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
          .frame(width: 36, height: 36)
          .background(theme.card)
          .clipShape(Circle())
          .overlay(Circle().stroke(theme.line, lineWidth: 1))
      }
      .buttonStyle(.plain)
      .accessibilityLabel(L10n.t(.memoryTone, arabic: arabic))
    }
    .environment(\.layoutDirection, .leftToRight)
    .padding(.horizontal, adaptive.gutter)
    .padding(.top, 4)
    .padding(.bottom, 2)
  }

  private var companionChats: [Conversation] {
    model.chats.filter { model.owns($0.id) }
  }

  private var chatListSheet: some View {
    let person = companions.selected
    return VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 12) {
        CompanionFace(item: person, size: 40)
        VStack(alignment: .leading, spacing: 2) {
          Text(arabic ? "المحادثات" : "Chats")
            .font(ArrabFont.system(size: 20, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(person.displayName(arabic: arabic))
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
        }
        Spacer()
        Button(arabic ? "إغلاق" : "Close") { showChatList = false }
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      .padding(.horizontal, 20)
      .padding(.top, 18)
      .padding(.bottom, 14)

      Button {
        ArrabHaptics.light()
        selectedLineId = nil
        model.companionId = person.id
        model.startFresh()
        showChatList = false
      } label: {
        HStack(spacing: 10) {
          Image(systemName: "square.and.pencil")
            .font(ArrabFont.system(size: 16, weight: .semibold))
          Text(L10n.t(.newChatLabel, arabic: arabic))
            .font(ArrabFont.system(size: 16, weight: .semibold))
          Spacer()
        }
        .foregroundStyle(theme.onPrimary)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(theme.primary)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 20)
      .padding(.bottom, 16)

      if companionChats.isEmpty {
        Text(arabic ? "ما فيه محادثات مع \(person.displayName(arabic: true)) بعد." : "No chats with \(person.displayName(arabic: false)) yet.")
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)
          .padding(.horizontal, 20)
        Spacer()
      } else {
        ScrollView {
          VStack(spacing: 8) {
            ForEach(companionChats) { chat in
              Button {
                ArrabHaptics.light()
                selectedLineId = nil
                showChatList = false
                Task { await model.openChat(chat.id) }
              } label: {
                Text(model.displayTitle(chat))
                  .font(ArrabFont.system(size: 16, weight: .medium))
                  .foregroundStyle(theme.text)
                  .lineLimit(1)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .padding(.horizontal, 16)
                  .padding(.vertical, 14)
                  .background(theme.card)
                  .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
              }
              .buttonStyle(.plain)
              .contextMenu {
                Button {
                  model.renameTarget = chat.id
                  renameDraft = model.displayTitle(chat)
                  showChatList = false
                  renaming = true
                } label: {
                  Label(arabic ? "إعادة تسمية" : "Rename", systemImage: "pencil")
                }
                Button(role: .destructive) {
                  Task { await model.deleteChat(chat.id) }
                } label: {
                  Label(L10n.t(.delete, arabic: arabic), systemImage: "trash")
                }
              }
            }
          }
          .padding(.horizontal, 20)
          .padding(.bottom, 20)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(theme.bg)
    .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
  }

  private func presentShare(_ text: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let controller = UIActivityViewController(activityItems: [trimmed], applicationActivities: nil)
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    let window = scene?.windows.first { $0.isKeyWindow }
    guard var top = window?.rootViewController else { return }
    while let presented = top.presentedViewController { top = presented }
    if let pop = controller.popoverPresentationController {
      pop.sourceView = top.view
      pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
      pop.permittedArrowDirections = []
    }
    top.present(controller, animated: true)
  }

  private func chatAction(_ icon: String, _ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(title, systemImage: icon)
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.text)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(theme.card)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private var legacyHeader: some View {
    HStack {
      VStack(alignment: .leading, spacing: 2) {
        Text("ARRAB / CHAT")
          .font(ArrabFont.system(size: 10, weight: .bold))
          .tracking(1.2)
          .foregroundStyle(theme.muted)
        Text(model.title)
          .font(ArrabFont.system(size: 17, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      Spacer()
      if model.isBusy {
        ProgressView().tint(theme.muted).scaleEffect(0.8)
      }
      ManagedBellButton()
    }
    .padding(.horizontal, adaptive.gutter)
    .padding(.vertical, 12)
  }

  private var messages: some View {
      ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(model.lines) { line in
              if line.role == "assistant" && line.text.isEmpty && model.isBusy {
                thinkingRow
                  .id("\(line.id)-busy")
              } else if !line.text.isEmpty {
                bubble(line)
                  .id("\(line.id)-text")
              }
            }
          if let error = model.error, !error.isEmpty {
            Text(error)
              .font(ArrabFont.system(size: 13))
              .foregroundStyle(theme.warn)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          if let file = model.latestFile {
            ShareLink(item: file) {
              Label(file.lastPathComponent, systemImage: "doc")
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(theme.card)
                .clipShape(Capsule())
            }
          }
        }
        .padding(adaptive.gutter)
        .frame(maxWidth: adaptive.contentMaxWidth)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(ScrollTouchBridge())
      .onChange(of: model.lines.count) { _, _ in
        if let last = model.lines.last?.id {
          withAnimation { proxy.scrollTo(last, anchor: .bottom) }
        }
      }
      .onChange(of: model.lines.last?.text) { _, _ in
        if let last = model.lines.last?.id {
          proxy.scrollTo(last, anchor: .bottom)
        }
      }
    }
  }

  private var roomTools: some View {
    HStack(spacing: 18) {
      if adaptive.showSideRail {
        HStack(spacing: 6) {
          Image(systemName: companions.selected.isGeneral ? "sparkle" : (companions.selected.systemImage ?? "person"))
            .font(ArrabFont.system(size: 12, weight: .semibold))
          Text(companions.selected.isGeneral ? chatModeName : companions.selected.displayName(arabic: arabic))
            .font(ArrabFont.system(size: 14, weight: .semibold))
        }
        .foregroundStyle(theme.text)
        Spacer()
      }
      Button { router.openIncognito() } label: {
        iconButton("theatermasks", label: L10n.t(.incognito, arabic: arabic), circled: true)
      }
      .buttonStyle(.plain)
      Button {
        ArrabHaptics.light()
        model.startFresh()
      } label: {
        iconButton("square.and.pencil", label: L10n.t(.newChat, arabic: arabic))
      }
      .buttonStyle(.plain)
      Button { showChatList = true } label: {
        iconButton("clock", label: L10n.t(.history, arabic: arabic))
      }
      .buttonStyle(.plain)
      if !adaptive.showSideRail {
        Spacer()
      }
    }
    .padding(.horizontal, 18)
    .padding(.top, 16)
    .padding(.bottom, 4)
  }

  private var suggestionRow: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(companionSuggestions, id: \.self) { item in
          Button {
            model.beginSend(item)
          } label: {
            Text(item)
              .font(ArrabFont.system(size: 13, weight: .medium))
              .foregroundStyle(theme.text)
              .lineLimit(1)
              .padding(.horizontal, 14)
              .padding(.vertical, 10)
              .background(theme.subtle)
              .clipShape(Capsule())
              .overlay(Capsule().stroke(theme.line, lineWidth: 1))
          }
          .buttonStyle(.borderless)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
    }
  }

  private var companionSuggestions: [String] {
    let person = companions.selected
    return Array(ChatPurposeSuggestions.prompts(
      id: person.id,
      purpose: voices.voice(for: person.id).purpose,
      blurb: person.displayBlurb(arabic: arabic),
      arabic: arabic
    ).prefix(4))
  }

  private var connectionNote: some View {
    Group {
      if let error = model.error, !error.isEmpty {
        Text(error)
          .font(ArrabFont.system(size: 13, weight: .medium))
          .foregroundStyle(theme.warn)
          .multilineTextAlignment(.center)
          .frame(maxWidth: .infinity)
          .padding(.horizontal, 20)
          .padding(.bottom, 8)
      }
    }
  }

  private var composerFoot: some View {
    HStack {
      Text(L10n.t(.onYourPace, arabic: arabic))
      Spacer()
      Text(L10n.t(.enterHint, arabic: arabic))
    }
    .font(ArrabFont.system(size: 11))
    .foregroundStyle(theme.muted)
    .padding(.horizontal, adaptive.gutter)
    .padding(.bottom, 10)
  }

  private var welcomeCard: some View {
    VStack(spacing: 14) {
      if adaptive.showSideRail {
        ZStack {
          Circle()
            .fill(theme.lavenderSoft)
            .frame(width: 64, height: 64)
          if companions.selected.isGeneral {
            Image(systemName: "sparkle")
              .font(ArrabFont.system(size: 26, weight: .medium))
              .foregroundStyle(theme.text)
          } else {
            CompanionFace(item: companions.selected, size: 64)
          }
        }
        .padding(.top, 28)
      } else {
        Image("ArrabSymbol")
          .renderingMode(.template)
          .resizable()
          .scaledToFit()
          .frame(width: 36, height: 36)
          .foregroundStyle(theme.text)
          .accessibilityLabel("Arrab")
      }

      Text(L10n.t(.yourSpace, arabic: arabic))
        .font(ArrabFont.system(size: 13, weight: .medium))
        .foregroundStyle(theme.muted)

      Text(L10n.t(.whatsOnMind, arabic: arabic))
        .font(ArrabFont.system(size: adaptive.showSideRail ? 28 : 26, weight: .semibold))
        .foregroundStyle(theme.text)
        .multilineTextAlignment(.center)

      if adaptive.showSideRail {
        Text(L10n.t(.startIdeaHint, arabic: arabic))
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)
          .multilineTextAlignment(.center)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 20)
    .padding(.bottom, 12)
  }

  private func iconButton(_ system: String, label: String, circled: Bool = false) -> some View {
    Image(systemName: system)
      .font(ArrabFont.system(size: 14, weight: .medium))
      .foregroundStyle(theme.muted)
      .frame(width: circled ? 32 : 28, height: circled ? 32 : 28)
      .background(circled ? theme.subtle : Color.clear)
      .clipShape(Circle())
      .accessibilityLabel(label)
  }

  private var thinkingRow: some View {
    HStack(alignment: .center, spacing: 10) {
      CompanionFace(item: companions.selected, size: 36)
      VStack(alignment: .leading, spacing: 4) {
        Text(companions.selected.displayName(arabic: arabic))
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
        HStack(spacing: 8) {
          ThinkingDots(color: theme.lavender)
          Text(model.activity.isEmpty ? (arabic ? "يفكّر" : "Thinking") : model.activity)
            .font(ArrabFont.system(size: 13))
            .foregroundStyle(theme.muted)
        }
      }
      Spacer()
      stopControl(arabic: arabic, fill: theme.card, ink: theme.text, line: theme.line) {
        ArrabHaptics.light()
        model.pause()
      }
    }
    .padding(12)
    .background(theme.subtle)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }

  private func bubble(_ line: ChatLine) -> some View {
    let mine = line.role == "user"
    let streaming = !mine && model.isBusy && line.id == model.lines.last?.id
    let canRetry = !mine && !model.isBusy && line.id == model.lines.last(where: { $0.role == "assistant" })?.id
    return HStack(alignment: .top, spacing: 8) {
      if mine { Spacer(minLength: 36) }
      if !mine {
        CompanionFace(item: companions.selected, size: 28)
          .padding(.top, 2)
      }
      VStack(alignment: mine ? .trailing : .leading, spacing: 6) {
        if !mine {
          Text(companions.selected.displayName(arabic: arabic))
            .font(ArrabFont.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.muted)
        }
        Text(line.text)
          .font(ArrabFont.system(size: 15))
          .lineSpacing(arabic ? 5 : 3)
          .foregroundStyle(mine ? theme.onPrimary : theme.text)
          .padding(.horizontal, 14)
          .padding(.vertical, 11)
          .background(mine ? theme.primary : theme.subtle)
          .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
          .onTapGesture {
            selectedLineId = selectedLineId == line.id ? nil : line.id
          }
          .contextMenu {
            Button {
              UIPasteboard.general.string = line.text
              ArrabHaptics.success()
            } label: {
              Label(arabic ? "نسخ" : "Copy", systemImage: "doc.on.doc")
            }
            ShareLink(item: line.text) {
              Label(arabic ? "مشاركة" : "Share", systemImage: "square.and.arrow.up")
            }
            if canRetry {
              Button {
                model.regenerate()
              } label: {
                Label(arabic ? "إعادة" : "Try again", systemImage: "arrow.clockwise")
              }
            }
          }
        if selectedLineId == line.id {
          HStack(spacing: 8) {
            chatAction("doc.on.doc", L10n.t(.copyAction, arabic: arabic)) {
              UIPasteboard.general.string = line.text
              ArrabHaptics.success()
            }
            if mine {
              chatAction("pencil", L10n.t(.editAction, arabic: arabic)) {
                model.draft = line.text
                selectedLineId = nil
              }
            }
            chatAction("square.and.arrow.up", L10n.t(.shareAction, arabic: arabic)) {
              presentShare(line.text)
            }
          }
        }
        if streaming && line.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          ThinkingDots(color: theme.lavender)
        }
        if canRetry {
          Button {
            ArrabHaptics.light()
            model.regenerate()
          } label: {
            Label(arabic ? "إعادة" : "Try again", systemImage: "arrow.clockwise")
              .font(ArrabFont.system(size: 12, weight: .semibold))
              .foregroundStyle(theme.muted)
          }
          .buttonStyle(.plain)
        }
      }
      if !mine { Spacer(minLength: 36) }
    }
    .accessibilityLabel(mine ? (arabic ? "أنت" : "You") : companions.selected.displayName(arabic: arabic))
    .accessibilityValue(line.text)
  }

  private var sendBlocked: Bool {
    managed.sendBlocked
      || !(model.agentId.map(managed.isCompanionEnabled) ?? true)
      || !network.isOnline
  }

  private func approvalCard(_ item: PendingApproval) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(ManagedStrings.t(.approvalNoticeTitle, arabic: arabic))
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(theme.muted)
      Text(item.title)
        .font(ArrabFont.system(size: 15, weight: .semibold))
        .foregroundStyle(theme.text)
      Text(ManagedStrings.t(.approvalNoticeBody, arabic: arabic))
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        Button {
          Task { await approvals.decide(item, approved: true) }
        } label: {
          Text(ManagedStrings.t(.approve, arabic: arabic))
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.onPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(theme.primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        Button {
          Task { await approvals.decide(item, approved: false) }
        } label: {
          Text(ManagedStrings.t(.notNow, arabic: arabic))
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.text)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(theme.subtle)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(14)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
    .padding(.horizontal, adaptive.gutter)
    .padding(.top, 8)
  }

  private var composer: some View {
    VStack(spacing: 0) {
      if let id = model.agentId, !managed.isCompanionEnabled(id) {
        Text(ManagedStrings.t(.companionUnavailable, arabic: arabic))
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.warn)
          .padding(.top, 8)
      } else if managed.readOnly {
        Text(ManagedStrings.t(.readOnlySend, arabic: arabic))
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
          .padding(.top, 8)
      }
      if session.studioRole == .family && (session.familyGuard.blocksChat || FamilySeatStore.blocksNow()) {
        Text(L10n.t(.familyBlocked, arabic: arabic))
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.warn)
          .padding(.top, 8)
      }
      if let ask = approvals.pending.first {
        approvalCard(ask)
      }
      ManagedUsageMeter()
      ComposerBar(
        draft: $model.draft,
        placeholder: L10n.t(.writeMind, arabic: arabic),
        isBusy: model.isBusy,
        sendBlocked: sendBlocked || (session.studioRole == .family && (session.familyGuard.blocksChat || FamilySeatStore.blocksNow())),
        onSend: {
          ArrabHaptics.light()
          refreshVoice()
          model.chatMode = session.sessionMode
          model.beginSend()
        },
        onPause: {
          ArrabHaptics.light()
          model.pause()
        },
        onAttach: { showPlus = true }
      )
      .id(model.isBusy)
      .sheet(isPresented: $showPlus) {
        ComposerPlusSheet(
          draft: $model.draft,
          onMemory: { showMemory = true },
          onRead: { model.attachRead($0) },
          onWeb: { model.wantsWeb = true },
          onDeliverable: { model.deliverable = $0 }
        )
          .presentationDetents(adaptive.isPadLike ? [.fraction(0.72), .large] : [.medium, .large])
          .presentationDragIndicator(.visible)
      }
      .sheet(isPresented: $showMemory) {
        MemoryToneSheet()
          .presentationDetents(adaptive.isPadLike ? [.fraction(0.8), .large] : [.medium, .large])
          .presentationDragIndicator(.visible)
      }
      if !network.isOnline {
        Text(arabic ? "لا اتصال — أعد المحاولة عند العودة للإنترنت" : "Offline — reconnect to send")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.warn)
          .padding(.bottom, 6)
      }
    }
    .background(theme.bg.opacity(0.96))
  }
}

private enum PlusPage { case main, models, local, desk }

struct ComposerPlusSheet: View {
  @Binding var draft: String
  var onMemory: () -> Void = {}
  var onRead: (String) -> Void = { _ in }
  var onWeb: () -> Void = {}
  var onDeliverable: (String) -> Void = { _ in }
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var router: ShellRouter
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.dismiss) private var dismiss
  @State private var photo: PhotosPickerItem?
  @State private var showFiles = false
  @State private var page: PlusPage = .main
  @ObservedObject private var cloudModels = CloudModelStore.shared

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          switch page {
          case .local:
            LocalModelsPanel()
          case .desk:
            CompanionDeskPanel()
          case .models:
            modelsPage
          case .main:
            mainPage
          }
        }
        .padding(16)
        .frame(maxWidth: adaptive.isPadLike ? 720 : .infinity)
        .frame(maxWidth: .infinity)
      }
      .background(theme.bg)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(page == .main ? (arabic ? "إغلاق" : "Close") : (arabic ? "رجوع" : "Back")) {
            switch page {
            case .main: dismiss()
            case .local: page = .models
            case .models: page = .main
            case .desk: page = .main
            }
          }
        }
      }
    }
    .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
    .presentationCornerRadius(28)
    .onChange(of: photo) { _, item in
      guard let item else { return }
      Task {
        if let data = try? await item.loadTransferable(type: Data.self) {
          let text = PhoneCompanionTools.readPhoto(data, name: "photo")
          await MainActor.run {
            onRead(text)
            append(arabic ? "اقرأ هذه الصورة" : "Read this photo")
          }
        }
      }
    }
    .onChange(of: session.preferredModel) { _, value in
      if page == .local, value == "local:on-device" { dismiss() }
    }
    .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
      if case .success(let urls) = result, let url = urls.first {
        onRead(PhoneCompanionTools.readFile(at: url))
        append((arabic ? "اقرأ هذا الملف واشرحه: " : "Read this file and explain it: ") + url.lastPathComponent)
      }
    }
  }

  private var title: String {
    switch page {
    case .local: return L10n.t(.localModels, arabic: arabic)
    case .desk: return arabic ? "مكتب الرفيق" : "Companion desk"
    case .models: return arabic ? "اختر النموذج" : "Choose model"
    case .main: return L10n.t(.plusAdd, arabic: arabic)
    }
  }

  private var modelsPage: some View {
    VStack(alignment: .leading, spacing: 8) {
      if cloudModels.loading && cloudModels.choices.isEmpty {
        ProgressView().tint(theme.lavender)
      } else if cloudModels.failed {
        Text(arabic ? "تعذّر قراءة النماذج من الحساب." : "Couldn’t read models from your account.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
      }
      ForEach(cloudModels.choices) { choice in
        modelRow(choice)
      }
      row("cpu", L10n.t(.localModels, arabic: arabic), badge: session.preferredModel == "local:on-device" ? "✓" : nil) {
        page = .local
      }
    }
    .task { await cloudModels.load() }
  }

  private var mainPage: some View {
    VStack(alignment: .leading, spacing: 8) {
      row("sparkle", arabic ? "اختر النموذج" : "Choose model", badge: nil) {
        page = .models
      }
      row("laptopcomputer", arabic ? "مكتب الرفيق" : "Companion desk", badge: nil) {
        page = .desk
      }
      row("slider.horizontal.3", L10n.t(.memoryTone, arabic: arabic)) {
        dismiss()
        onMemory()
      }

      section(L10n.t(.plusAdd, arabic: arabic))
          PhotosPicker(selection: $photo, matching: .images) {
            labelRow("photo", L10n.t(.plusPhotos, arabic: arabic))
          }
          .buttonStyle(.plain)
          row("doc", L10n.t(.plusFiles, arabic: arabic)) { showFiles = true }
          row("globe", L10n.t(.plusWeb, arabic: arabic)) {
            onWeb()
            append(arabic ? "ابحث في الويب عن: " : "Search the web for: ")
          }

          section(L10n.t(.plusCreate, arabic: arabic))
          row("doc.richtext", L10n.t(.plusPdf, arabic: arabic)) {
            onDeliverable("PDF")
            append(arabic ? "أنشئ ملف PDF عن: " : "Create a professional PDF about: ")
          }
          row("doc.text", L10n.t(.plusWord, arabic: arabic)) {
            onDeliverable("Word document")
            append(arabic ? "أنشئ مستند Word عن: " : "Create a Word document about: ")
          }
          row("rectangle.on.rectangle", L10n.t(.plusSlides, arabic: arabic)) {
            onDeliverable("presentation")
            append(arabic ? "أنشئ عرضاً تقديمياً عن: " : "Create a presentation about: ")
          }
          row("photo.on.rectangle", L10n.t(.plusImage, arabic: arabic)) {
            onDeliverable("image")
            append(arabic ? "أنشئ صورة عن: " : "Create an image about: ")
          }

          section(arabic ? "المزيد" : "More")
          row("powerplug", L10n.t(.connectors, arabic: arabic)) {
            dismiss()
            router.go(.connectors)
          }
          row("gearshape", L10n.t(.settings, arabic: arabic)) {
            dismiss()
            router.go(.settings)
          }
    }
  }

  private func modelRow(_ choice: ArrabModelChoice) -> some View {
    let selected: Bool = {
      if session.chattingOnDevice { return false }
      if choice.primary {
        return session.preferredModel.isEmpty
          || session.preferredModel == "arrab"
          || session.preferredModel == AppSession.arrabModelId
          || session.preferredModel == choice.id
      }
      return session.preferredModel == choice.id
    }()
    return modelAction(
      choice.primary ? "sparkle" : "circle",
      choice.title,
      choice.detail(arabic: arabic),
      selected: selected
    ) {
      session.selectCloudModel(choice.id)
      dismiss()
    }
  }

  private func modelAction(
    _ icon: String,
    _ title: String,
    _ detail: String,
    selected: Bool,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .frame(width: 22)
          .foregroundStyle(theme.text)
        VStack(alignment: .leading, spacing: 2) {
          Text(title)
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.text)
          if !detail.isEmpty {
            Text(detail)
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
              .lineLimit(2)
          }
        }
        Spacer(minLength: 8)
        if selected {
          Image(systemName: "checkmark")
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.lavender)
        }
      }
      .padding(.vertical, 10)
      .padding(.horizontal, 4)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func section(_ title: String) -> some View {
    Text(title)
      .font(ArrabFont.system(size: 12, weight: .semibold))
      .foregroundStyle(theme.muted)
      .padding(.top, 8)
  }

  private func labelRow(_ icon: String, _ title: String) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .frame(width: 22)
        .foregroundStyle(theme.text)
      Text(title)
        .font(ArrabFont.system(size: 16, weight: .medium))
        .foregroundStyle(theme.text)
      Spacer()
    }
    .padding(.vertical, 12)
    .padding(.horizontal, 4)
    .contentShape(Rectangle())
  }

  private func row(_ icon: String, _ title: String, badge: String? = nil, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .frame(width: 22)
          .foregroundStyle(theme.text)
        Text(title)
          .font(ArrabFont.system(size: 16, weight: .medium))
          .foregroundStyle(theme.text)
        Spacer()
        if let badge {
          Text(badge).foregroundStyle(theme.lavender)
        }
      }
      .padding(.vertical, 12)
      .padding(.horizontal, 4)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func append(_ text: String) {
    if draft.isEmpty { draft = text } else { draft += "\n" + text }
    dismiss()
  }
}

struct MemoryToneSheet: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @Environment(\.dismiss) private var dismiss
  @ObservedObject private var voices = CompanionVoiceStore.shared

  @State private var tab = 0
  @State private var purpose = ""
  @State private var fact = ""
  @State private var tone = CompanionToneAxes()

  private var arabic: Bool { session.localeIsArabic }
  private var companionId: String { companions.selected.id }
  private var columns: Int { adaptive.isPadLike ? 3 : 2 }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        Picker("", selection: $tab) {
          Text(L10n.t(.knowsAboutYou, arabic: arabic)).tag(0)
          Text(L10n.t(.tone, arabic: arabic)).tag(1)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, adaptive.gutter)
        .padding(.top, 8)

        ScrollView {
          VStack(alignment: .leading, spacing: 14) {
            if tab == 0 { knows } else { tonePage }
          }
          .padding(adaptive.gutter)
          .frame(maxWidth: adaptive.isPadLike ? 840 : .infinity)
          .frame(maxWidth: .infinity)
        }
      }
      .background(theme.bg)
      .navigationTitle(companions.selected.displayName(arabic: arabic))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(arabic ? "إغلاق" : "Close") { dismiss() }
        }
      }
    }
    .environment(\.layoutDirection, arabic ? .rightToLeft : .leftToRight)
    .onAppear(perform: load)
    .onChange(of: companions.selectedId) { _, _ in load() }
  }

  private var knows: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(arabic ? "كل معلومة ومصدرها. أنت تختار ما يُشارك." : "Every fact and its source. You choose what companions can share.")
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      Text(L10n.t(.purpose, arabic: arabic))
        .font(ArrabFont.system(size: 14, weight: .semibold))
        .foregroundStyle(theme.text)
      TextEditor(text: $purpose)
        .font(ArrabFont.system(size: 16))
        .frame(minHeight: adaptive.isPadLike ? 140 : 110)
        .padding(8)
        .scrollContentBackground(.hidden)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(theme.lavender.opacity(0.7), lineWidth: 1))
        .onChange(of: purpose) { _, value in
          voices.setPurpose(value, for: companionId)
        }
      Text(L10n.t(.purposeHint, arabic: arabic))
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        TextField(L10n.t(.rememberPlaceholder, arabic: arabic), text: $fact)
          .font(ArrabFont.system(size: 16))
          .padding(12)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        Button(L10n.t(.add, arabic: arabic)) {
          voices.addFact(fact, for: companionId)
          fact = ""
        }
        .font(ArrabFont.system(size: 14, weight: .semibold))
        .foregroundStyle(theme.onPrimary)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(fact.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? theme.subtle : theme.primary)
        .clipShape(Capsule())
        .disabled(fact.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      let facts = voices.voice(for: companionId).facts
      if facts.isEmpty {
        Text(L10n.t(.knowsEmpty, arabic: arabic))
          .font(ArrabFont.system(size: 14))
          .foregroundStyle(theme.muted)
          .frame(maxWidth: .infinity)
          .padding(16)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      } else {
        ForEach(Array(facts.enumerated()), id: \.offset) { index, item in
          HStack {
            Text(item)
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.text)
            Spacer()
            Button {
              voices.removeFact(at: index, for: companionId)
            } label: {
              Image(systemName: "xmark")
                .font(ArrabFont.system(size: 12, weight: .bold))
                .foregroundStyle(theme.muted)
            }
            .buttonStyle(.plain)
          }
          .padding(12)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
      }
    }
  }

  private var tonePage: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(arabic ? "اختر أسلوباً أو عدّل كل محور. يمكنك أيضاً أن تقول في المحادثة: كن أصرح، أو اجعلها قصيرة." : "Pick a style or fine-tune each axis. You can also ask in chat (“be blunter”, “keep it short”).")
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      let matched = CompanionToneCatalog.match(tone)
      HStack {
        Text(L10n.t(.currentStyle, arabic: arabic).uppercased())
          .font(ArrabFont.system(size: 11, weight: .bold))
          .foregroundStyle(theme.muted)
        Text(matched.map { L10n.t($0.title, arabic: arabic) } ?? L10n.t(.customStyle, arabic: arabic))
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer()
      }
      .padding(12)
      .background(theme.subtle)
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
        ForEach(CompanionToneCatalog.chips) { chip in
          let on = matched?.id == chip.id
          Button {
            tone = chip.tone
            voices.setTone(tone, for: companionId)
          } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text(L10n.t(chip.title, arabic: arabic))
                .font(ArrabFont.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(L10n.t(chip.hint, arabic: arabic))
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
                .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(on ? theme.subtle : theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(on ? theme.lavender : theme.line, lineWidth: 1))
          }
          .buttonStyle(.plain)
        }
        VStack(alignment: .leading, spacing: 4) {
          Text(L10n.t(.customStyle, arabic: arabic))
            .font(ArrabFont.system(size: 15, weight: .semibold))
            .foregroundStyle(theme.text)
          Text(L10n.t(.customStyleHint, arabic: arabic))
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
            .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(matched == nil ? theme.subtle : theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(matched == nil ? theme.lavender : theme.line, lineWidth: 1))
      }

      VStack(alignment: .leading, spacing: 6) {
        Text(L10n.t(.replyPreview, arabic: arabic).uppercased())
          .font(ArrabFont.system(size: 11, weight: .bold))
          .foregroundStyle(theme.muted)
        Text("“\(CompanionToneCatalog.preview(tone, arabic: arabic))”")
          .font(ArrabFont.system(size: 15))
          .foregroundStyle(theme.text)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(theme.card)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

      axis(.bluntness, value: $tone.bluntness, low: L10n.t(.gentle, arabic: arabic), high: L10n.t(.blunt, arabic: arabic))
      axis(.humour, value: $tone.humour, low: arabic ? "جدي" : "Serious", high: arabic ? "خفيف" : "Playful")
      axis(.replyLength, value: $tone.replyLength, low: arabic ? "قصير" : "Short", high: arabic ? "طويل" : "Long")
      axis(.warmth, value: $tone.warmth, low: arabic ? "محايد" : "Cool", high: arabic ? "دافئ" : "Warm")
      axis(.formality, value: $tone.formality, low: arabic ? "عفوي" : "Casual", high: arabic ? "رسمي" : "Formal")
      axis(.criticism, value: $tone.criticism, low: arabic ? "لطيف" : "Soft", high: arabic ? "صريح" : "Candid")
      axis(.pace, value: $tone.pace, low: arabic ? "صبور" : "Patient", high: arabic ? "سريع" : "Brisk")
    }
  }

  private func axis(_ key: L10n.Key, value: Binding<Double>, low: String, high: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(L10n.t(key, arabic: arabic))
          .font(ArrabFont.system(size: 14, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer()
        Text("\(Int(value.wrappedValue.rounded()))")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.muted)
      }
      Slider(value: value, in: 0...100, step: 1) { editing in
        if !editing { voices.setTone(tone, for: companionId) }
      }
      .tint(theme.lavender)
      HStack {
        Text(low)
        Spacer()
        Text(high)
      }
      .font(ArrabFont.system(size: 11))
      .foregroundStyle(theme.muted)
    }
  }

  private func load() {
    let saved = voices.voice(for: companionId)
    purpose = Self.visiblePurpose(saved.purpose)
    tone = saved.tone
  }

  private static func visiblePurpose(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let secret = trimmed.range(
      of: #"^(you are|أنت|voice for|أسلوب)\b"#,
      options: [.regularExpression, .caseInsensitive]
    ) != nil
    return secret ? "" : trimmed
  }
}

@MainActor
enum ArrabVoice {
  static let marker = "[[arrab-voice]]"

  static func note(companionId: String, arabic: Bool, design: Bool) -> String {
    var lines: [String] = []
    if let data = UserDefaults.standard.data(forKey: "arrab.profile.prefs"),
       let prefs = try? JSONDecoder().decode(ProfilePrefs.self, from: data) {
      let line = prefs.promptLine(arabic: arabic)
      if !line.isEmpty { lines.append(line) }
    }
    let voice = CompanionVoiceStore.shared.voice(for: companionId)
    let purpose = voice.purpose.trimmingCharacters(in: .whitespacesAndNewlines)
    if !purpose.isEmpty, purpose.range(of: #"^(you are|أنت)\b"#, options: [.regularExpression, .caseInsensitive]) == nil {
      lines.append(purpose)
    }
    let tone = toneLine(voice.tone, arabic: arabic)
    if !tone.isEmpty { lines.append(tone) }
    for fact in voice.facts.prefix(8) {
      let trimmed = fact.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { lines.append(trimmed) }
    }
    if design {
      lines.append(arabic
        ? "يبني صفحات. عندما يطلب صفحة، أخرج index.html و styles.css و app.js كاملة."
        : "They build pages. When they ask for a page, include complete index.html, styles.css, and app.js.")
    }
    return lines.joined(separator: "\n")
  }

  static func sync(agentId: String, companionId: String, arabic: Bool, design: Bool) async {
    let body = note(companionId: companionId, arabic: arabic, design: design)
    guard !body.isEmpty else { return }
    let content = marker + "\n" + body
    if let items = try? await ArrabAPIClient.shared.listMemories() {
      for item in items where item.content.hasPrefix(marker) {
        await ArrabAPIClient.shared.deleteMemory(item.id)
      }
    }
    _ = try? await ArrabAPIClient.shared.createMemory(content: content, agentId: agentId)
  }

  private static func toneLine(_ tone: CompanionToneAxes, arabic: Bool) -> String {
    var bits: [String] = []
    if tone.replyLength <= 33 { bits.append(arabic ? "ردود قصيرة" : "short replies") }
    else if tone.replyLength >= 66 { bits.append(arabic ? "ردود أوضح" : "fuller replies") }
    if tone.warmth >= 66 { bits.append(arabic ? "دافئ" : "warm") }
    if tone.formality >= 66 { bits.append(arabic ? "مهذب" : "formal") }
    else if tone.formality <= 25 { bits.append(arabic ? "عفوي" : "casual") }
    if tone.bluntness >= 66 { bits.append(arabic ? "مباشر" : "direct") }
    if tone.humour >= 66 { bits.append(arabic ? "خفيف" : "light") }
    if bits.isEmpty { return "" }
    return (arabic ? "الأسلوب: " : "Tone: ") + bits.joined(separator: arabic ? "، " : ", ")
  }
}

enum OnDeviceChat {
  static func ready() -> Bool {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      return SystemLanguageModel.default.availability == .available
    }
    #endif
    return false
  }

  static func reply(_ prompt: String, profile: String, saudi: Bool) async throws -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      let model = SystemLanguageModel.default
      guard model.availability == .available else {
        throw ArrabAPIError.http(0, "On-device model is not ready on this iPhone.")
      }
      var instructions: String
      switch profile {
      case "gemma-3":
        instructions = "You are Gemma 3, Google's on-device model in Arrab. Answer in the user's language. Be clear and useful."
      case "gemma-3n":
        instructions = "You are Gemma 3n, Google's compact on-device model in Arrab. Answer in the user's language. Keep the reply short."
      case "gemma-2":
        instructions = "You are Gemma 2, Google's on-device model in Arrab. Answer in the user's language. Be practical and a little more detailed."
      default:
        instructions = "You are Arrab, a calm companion. Answer in the user's language. Be brief."
      }
      if saudi {
        instructions += " When the user writes Arabic, reply in white Saudi colloquial (لهجة سعودية بيضاء), natural and warm, like Riyadh speech. Use وش، الحين، كذا، طيب، يالله، خلاص. Do not answer in formal فصحى unless they wrote formally."
      }
      if let data = UserDefaults.standard.data(forKey: "arrab.profile.prefs"),
         let prefs = try? JSONDecoder().decode(ProfilePrefs.self, from: data) {
        let line = prefs.promptLine(arabic: saudi)
        if !line.isEmpty { instructions += " " + line }
      }
      let voice = await ArrabVoice.note(companionId: UserDefaults.standard.string(forKey: "arrab.chat.companion") ?? "general", arabic: saudi, design: false)
      if !voice.isEmpty { instructions += " " + voice }
      let session = LanguageModelSession(instructions: instructions)
      let response = try await session.respond(to: prompt)
      return response.content
    }
    #endif
    throw ArrabAPIError.http(0, "On-device model needs a newer iPhone system.")
  }
}

private struct PhotoPlayground: ViewModifier {
  @Binding var show: Bool
  var concept: String
  var onSaved: (URL) -> Void
  var onCancel: () -> Void

  func body(content: Content) -> some View {
    if #available(iOS 18.1, *) {
      content.imagePlaygroundSheet(
        isPresented: $show,
        concept: concept,
        onCompletion: { url in
          onSaved(url)
        },
        onCancellation: onCancel
      )
    } else {
      content
    }
  }
}

private final class ApprovalBox {
  var value: (id: String, detail: String)?
}

private enum ChatOwnerStore {
  private static let key = "arrab.chat.owners"

  static func load() -> [String: String] {
    UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]
  }

  static func save(_ map: [String: String]) {
    UserDefaults.standard.set(map, forKey: key)
  }
}

private enum ChatTitleStore {
  private static let key = "arrab.chat.titles"

  static func load() -> [String: String] {
    UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]
  }

  static func save(_ map: [String: String]) {
    UserDefaults.standard.set(map, forKey: key)
  }
}

struct ChatLine: Identifiable, Equatable {
  let id: String
  let role: String
  var text: String
}

@MainActor
final class ChatViewModel: ObservableObject {
  @Published var lines: [ChatLine] = []
  @Published var draft = ""
  @Published var title = "Arrab"
  @Published var isBusy = false
  @Published var error: String?
  var modelId: String = AppSession.arrabModelId
  var chatMode: String = "agent"
  var prefersArabic = false
  var wantsWeb = false
  var deliverable: String?
  var pendingRead: String?
  var localProfile = ""
  var wantsDesignFiles = false
  var companionId = "general"
  var suppressCompanionReset = false
  var renameTarget: String?
  private var owners = ChatOwnerStore.load()
  @Published var photoRequest: String?
  @Published var activity = ""
  @Published var latestFile: URL?
  @Published var chats: [Conversation] = []
  @Published var activeChatId: String?
  private var currentSend: Task<Void, Never>?
  private var halted = false
  private var stream: ChatStream?
  private var generation = 0
  private var titleOverrides = ChatTitleStore.load()

  private let api = ArrabAPIClient.shared
  private var conversationId: String?
  @Published private(set) var agentId: String?

  func owns(_ id: String) -> Bool {
    owners[id] == companionId
  }

  func lastConversationToOpen() -> (id: String, companionId: String?)? {
    guard lines.isEmpty, !isBusy else { return nil }
    let saved = UserDefaults.standard.string(forKey: Self.lastChatKey)
    if let saved, chats.contains(where: { $0.id == saved }) {
      let companion = owners[saved] ?? UserDefaults.standard.string(forKey: Self.lastCompanionKey)
      return (saved, companion)
    }
    let owned = chats
      .filter { owners[$0.id] != nil }
      .sorted { $0.sortStamp > $1.sortStamp }
    guard let newest = owned.first else { return nil }
    return (newest.id, owners[newest.id])
  }

  private func rememberConversation(_ id: String) {
    UserDefaults.standard.set(id, forKey: Self.lastChatKey)
    if let companion = owners[id] {
      UserDefaults.standard.set(companion, forKey: Self.lastCompanionKey)
    }
  }

  private static let lastChatKey = "arrab.chat.lastId"
  private static let lastCompanionKey = "arrab.chat.lastCompanion"

  var activeTitle: String {
    guard let id = activeChatId, let chat = chats.first(where: { $0.id == id }) else {
      return prefersArabic ? "محادثة" : "Chat"
    }
    return displayTitle(chat)
  }

  func displayTitle(_ chat: Conversation) -> String {
    if let custom = titleOverrides[chat.id]?.trimmingCharacters(in: .whitespacesAndNewlines), !custom.isEmpty {
      return custom
    }
    let raw = chat.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if raw.isEmpty { return prefersArabic ? "محادثة" : "Chat" }
    return raw
  }

  func renameActive(to title: String) {
    let id = renameTarget ?? activeChatId
    renameTarget = nil
    guard let id else { return }
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    titleOverrides[id] = trimmed
    ChatTitleStore.save(titleOverrides)
    chats = chats
  }

  func bootstrap() async {
    do {
      try await api.ensureLiveAuthBase()
      var agents = try await api.agents()
      if agents.isEmpty {
        let created = try await api.createAgent(
          CreateAgentRequest(
            name: "Arrab Assistant",
            role: "Assistant",
            specialty: "arrab-assistant",
            instructions: "You are Arrab Assistant on iOS. Be concise and helpful. Match the operator language.",
            status: "active"
          )
        )
        agents = [created]
      }
      let listed = ManagedClient.shared.applyPolicy(to: agents)
      let pool = listed.isEmpty ? agents : listed
      let agent = pool.first { $0.specialty == "arrab-assistant" } ?? pool[0]
      agentId = agent.id
      UserDefaults.standard.set(agent.id, forKey: "arrab.chat.agentId")
      ManagedClient.shared.activeScreen = "chat"
      ManagedClient.shared.activeCompanionId = agent.id
      if title == "Arrab" { title = agent.name }
      let listedChats = try await api.conversations()
      let visible = listedChats.filter { ($0.title ?? "") != "arrab-incognito" }
      if !UserDefaults.standard.bool(forKey: "arrab.chats.wiped") {
        for chat in visible {
          await api.deleteConversation(chat.id)
        }
        chats = []
        owners = [:]
        ChatOwnerStore.save(owners)
        UserDefaults.standard.set(true, forKey: "arrab.chats.wiped")
        startFresh()
      } else {
        chats = visible
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  func openChat(_ id: String) async {
    do {
      let detail = try await api.conversation(id)
      conversationId = id
      activeChatId = id
      rememberConversation(id)
      lines = detail.messages.compactMap { message in
        let text = Self.publicText(message.content)
        guard !text.isEmpty else { return nil }
        let role = message.role == "user" || message.role == "me" ? "user" : "assistant"
        return ChatLine(id: message.id, role: role, text: text)
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  func transcript(for id: String?) async -> String {
    let source: [ChatLine]
    if let id, id != conversationId {
      let detail = try? await api.conversation(id)
      source = (detail?.messages ?? []).compactMap { message in
        let text = Self.publicText(message.content)
        guard !text.isEmpty else { return nil }
        let role = message.role == "user" || message.role == "me" ? "user" : "assistant"
        return ChatLine(id: message.id, role: role, text: text)
      }
    } else {
      source = lines
    }
    return source.map { line in
      let who = line.role == "user" ? (prefersArabic ? "أنت" : "You") : title
      return "\(who): \(line.text)"
    }.joined(separator: "\n\n")
  }

  func startFresh() {
    pause()
    lines = []
    draft = ""
    error = nil
    latestFile = nil
    conversationId = nil
    activeChatId = nil
  }

  func deleteChat(_ id: String) async {
    await api.deleteConversation(id)
    titleOverrides[id] = nil
    ChatTitleStore.save(titleOverrides)
    owners[id] = nil
    ChatOwnerStore.save(owners)
    chats.removeAll { $0.id == id }
    if conversationId == id || activeChatId == id {
      startFresh()
    }
  }

  static func serverMessage(_ body: String) -> String? {
    guard let data = body.data(using: .utf8),
          let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
    let raw = json["message"] ?? (json["error"] as? [String: Any])?["message"] ?? json["error"]
    guard let text = raw as? String, !text.isEmpty else { return nil }
    return String(text.prefix(280))
  }

  func beginSend(_ override: String? = nil) {
    if isBusy {
      pause()
      return
    }
    stream?.cancel()
    currentSend?.cancel()
    halted = false
    generation += 1
    let gen = generation
    let stream = ChatStream()
    self.stream = stream
    currentSend = Task { await send(override, generation: gen, stream: stream) }
  }

  func pause() {
    halted = true
    generation += 1
    let live = stream
    stream = nil
    live?.cancel()
    currentSend?.cancel()
    currentSend = nil
    activity = ""
    isBusy = false
    AgentLive.endReply()
    // Keep whatever already arrived. Only mark empty bubbles as paused.
    if let idx = lines.lastIndex(where: { $0.role == "assistant" }) {
      let text = lines[idx].text.trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty {
        var next = lines
        next[idx].text = prefersArabic ? "متوقف" : "Paused"
        lines = next
      }
    }
  }

  private func reveal(_ token: String, replyId: String, generation gen: Int, replace: Bool = false) {
    guard !halted, generation == gen else { return }
    guard let idx = lines.firstIndex(where: { $0.id == replyId }) else { return }
    if replace {
      lines[idx].text = token
    } else if !token.isEmpty {
      lines[idx].text += token
    }
    if !lines[idx].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { activity = "" }
  }

  func regenerate() {
    guard !isBusy, let text = lines.last(where: { $0.role == "user" })?.text, !text.isEmpty else { return }
    if lines.last?.role == "assistant" { lines.removeLast() }
    if lines.last?.role == "user" { lines.removeLast() }
    beginSend(text)
  }

  static func cloudModel(_ id: String) -> String {
    switch id {
    case "", "auto", "arrab", "primary", "local:on-device":
      return AppSession.arrabModelId
    default:
      return id
    }
  }

  private func latestAssistantReply() async -> String? {
    guard let conversationId else { return nil }
    guard let detail = try? await api.conversation(conversationId) else { return nil }
    guard let userAt = detail.messages.lastIndex(where: { $0.role == "user" || $0.role == "me" }) else { return nil }
    for message in detail.messages.dropFirst(userAt + 1).reversed() {
      guard message.role == "assistant" else { continue }
      let shown = Self.publicText(message.content)
      if !shown.isEmpty { return shown }
    }
    return nil
  }

  static func publicText(_ raw: String) -> String {
    var text = raw
    if let start = text.range(of: "[[arrab-private]]"),
       let end = text.range(of: "[[/arrab-private]]"),
       start.upperBound <= end.lowerBound {
      text.removeSubrange(start.lowerBound..<end.upperBound)
    }
    text = text.replacingOccurrences(
      of: #"\[\[suggest_mode:[^\]]+\]\]"#,
      with: "",
      options: .regularExpression
    )
    let secret = text.hasPrefix("Voice for ")
      || text.hasPrefix("أسلوب ")
      || text.hasPrefix("Session mode:")
    if secret, let split = text.range(of: "\n\n", options: .backwards) {
      text = String(text[split.upperBound...])
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func attachRead(_ text: String) {
    pendingRead = text
  }

  func send(_ override: String? = nil, generation gen: Int, stream: ChatStream) async {
    let text = (override ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !isBusy, generation == gen, !stream.isStopped else { return }
    let managed = ManagedClient.shared
    if managed.sendBlocked || !(agentId.map(managed.isCompanionEnabled) ?? true) {
      error = managed.serverLimitMessage
        ?? (prefersArabic ? "الإرسال متوقف الآن." : "Sending is paused right now.")
      return
    }
    draft = ""
    guard generation == gen, !stream.isStopped else { return }
    error = nil
    isBusy = true
    UserDefaults.standard.set(companionId, forKey: "arrab.chat.companion")
    let userId = UUID().uuidString
    lines.append(ChatLine(id: userId, role: "user", text: text))
    let replyId = UUID().uuidString
    lines.append(ChatLine(id: replyId, role: "assistant", text: ""))
    var handedOff = false
    defer {
      if !handedOff, generation == gen {
        AgentLive.endReply()
        isBusy = false
        activity = ""
        if let idx = lines.firstIndex(where: { $0.id == replyId }),
           lines[idx].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          var next = lines
          next[idx].text = prefersArabic ? "لم يصل رد. حاول مرة أخرى." : "No reply arrived. Try again."
          lines = next
        }
      }
    }
    if TripBooker.wants(text) {
      let arabic = prefersArabic || AgentAlerts.containsArabic(text)
      let note = await TripBooker.reply(text, history: lines, arabic: arabic)
      if generation != gen || stream.isStopped { return }
      writeReply(note, replyId: replyId)
      isBusy = false
      activity = ""
      handedOff = true
      return
    }
    if let command = AgentAlerts.parse(text) {
      let arabic = prefersArabic || AgentAlerts.containsArabic(text)
      let note = await AgentAlerts.commit(command, companion: title, arabic: arabic)
      if generation != gen || stream.isStopped { return }
      writeReply(note, replyId: replyId)
      isBusy = false
      activity = ""
      handedOff = true
      return
    }
    AgentLive.beginReply(companion: title, detail: prefersArabic ? "يرد الآن" : "Replying")
    var extras: [String] = []
    if let query = PhoneCompanionTools.searchQuery(in: text, forced: wantsWeb || chatMode == "search") {
      activity = PhoneCompanionTools.activity(for: "web_search", arabic: prefersArabic)
      let found = await PhoneCompanionTools.searchWeb(query)
      if generation != gen || stream.isStopped { return }
      if !found.isEmpty { extras.append(found) }
    }
    wantsWeb = false
    if let read = pendingRead {
      extras.append(read)
      pendingRead = nil
      activity = PhoneCompanionTools.activity(for: "read_file", arabic: prefersArabic)
    }
    let photo = Self.photoSubject(text, kind: deliverable)
    if photo != nil { deliverable = nil }
    if let photo {
      activity = prefersArabic ? "ينشئ صورة" : "Creating a photo"
      if let url = await PhoneCompanionTools.makePhoto(prompt: photo) {
        if generation != gen || stream.isStopped { return }
        latestFile = url
        extras.append("A photo was saved on this iPhone as \(url.lastPathComponent). It is in Library. Tell the user it is ready.")
      } else {
        if let url = PhoneCompanionTools.renderPoster(prompt: photo) {
          latestFile = url
        }
        photoRequest = photo
        extras.append("A photo was saved on this iPhone and is in Library. The photo creator may also open so the user can make a richer image.")
      }
    }
    if let kind = deliverable {
      extras.append("The operator wants a real \(kind) file saved on this iPhone. Call generate_pdf, generate_docx, generate_presentation, generate_image, or export_csv with the full content. Do not only describe the file.")
      deliverable = nil
    }
    if generation != gen || stream.isStopped { return }
    // Voice and profile stay on the companion. Stuffing them into the user
    // message looks like a prompt injection and the safety check then stops every reply.
    let outbound = extras.isEmpty ? text : "\(text)\n\n\(extras.joined(separator: "\n\n"))"
    if modelId == "local:on-device" {
      activity = prefersArabic ? "يرد على الجهاز" : "Replying on this iPhone"
      do {
        let reply = try await OnDeviceChat.reply(outbound, profile: localProfile, saudi: prefersArabic)
        if halted || generation != gen || stream.isStopped { return }
        writeReply(reply, replyId: replyId)
        handedOff = true
        isBusy = false
        activity = ""
        AgentLive.endReply()
        return
      } catch {
        if halted || generation != gen || stream.isStopped { return }
        let note = prefersArabic
          ? "النموذج على الجهاز غير جاهز على هذا الجوال."
          : "The on-device model is not ready on this iPhone."
        writeReply(note, replyId: replyId)
        handedOff = true
        isBusy = false
        activity = ""
        AgentLive.endReply()
        return
      }
    }

    do {
      try await api.ensureLiveAuthBase()
      if generation != gen || stream.isStopped { return }
      let replyModel = Self.cloudModel(modelId)
      if agentId == nil, let cached = UserDefaults.standard.string(forKey: "arrab.chat.agentId"), !cached.isEmpty {
        agentId = cached
      }
      if agentId == nil { await bootstrap() }
      if halted || generation != gen || stream.isStopped { return }
      if conversationId == nil {
        guard let agentId else {
          throw ArrabAPIError.http(
            0,
            self.error ?? (prefersArabic ? "تعذر الاتصال. حاول مرة أخرى." : "Could not reach Arrab. Try again.")
          )
        }
        let convo = try await api.createConversation(agentId: agentId, title: String(text.prefix(48)))
        if halted || generation != gen || stream.isStopped { return }
        conversationId = convo.id
        activeChatId = convo.id
        owners[convo.id] = companionId
        ChatOwnerStore.save(owners)
        rememberConversation(convo.id)
      }
      guard let conversationId else { throw ArrabAPIError.empty }
      if halted || generation != gen || stream.isStopped { return }
      if let agentId {
        await ArrabVoice.sync(agentId: agentId, companionId: companionId, arabic: prefersArabic, design: wantsDesignFiles)
      }
      activity = prefersArabic ? "يرد الآن" : "Replying"
      handedOff = true
      api.startReply(
        conversationId: conversationId,
        content: outbound,
        model: replyModel,
        stream: stream
      ) { [weak self] result in
        self?.completeSend(result, gen: gen, replyId: replyId, stream: stream)
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 22) { [weak self] in
        guard let self, self.generation == gen, self.isBusy else { return }
        stream.cancel()
        AgentLive.endReply()
        self.isBusy = false
        self.activity = ""
        guard let idx = self.lines.firstIndex(where: { $0.id == replyId }),
              self.lines[idx].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        var next = self.lines
        next[idx].text = self.prefersArabic ? "لم يصل رد. حاول مرة أخرى." : "No reply arrived. Try again."
        self.lines = next
      }
      return
    } catch {
      if generation != gen || stream.isStopped || stream.isUserStop { return }
      if case let ArrabAPIError.http(code, body) = error, code == 402 || code == 429 {
        managed.serverLimitMessage = Self.serverMessage(body)
      }
      if error is CancellationError { return }
      if let urlError = error as? URLError, urlError.code == .cancelled { return }
      if let idx = lines.firstIndex(where: { $0.id == replyId }), lines[idx].text.isEmpty {
        if let saved = await latestAssistantReply(), !saved.isEmpty {
          lines[idx].text = saved
        } else {
          lines[idx].text = managed.serverLimitMessage ?? error.localizedDescription
        }
      }
    }
  }

  private func completeSend(_ result: Result<String, Error>, gen: Int, replyId: String, stream: ChatStream) {
    guard generation == gen, !halted, !stream.isUserStop else { return }
    isBusy = false
    activity = ""
    let managed = ManagedClient.shared
    switch result {
    case .success(let raw):
      let shown = Self.publicText(raw)
      AgentLive.endReply(summary: shown)
      writeReply(shown.isEmpty
        ? (prefersArabic ? "لم يصل رد. حاول مرة أخرى." : "No reply arrived. Try again.")
        : shown, replyId: replyId)
      managed.serverLimitMessage = nil
      let api = api
      Task { @MainActor in
        if let listed = try? await api.conversations() {
          self.chats = listed.filter { ($0.title ?? "") != "arrab-incognito" }
        }
      }
    case .failure(let error):
      AgentLive.endReply()
      if error is CancellationError { 
        writeReply(prefersArabic ? "لم يصل رد. حاول مرة أخرى." : "No reply arrived. Try again.", replyId: replyId)
        return
      }
      if let urlError = error as? URLError, urlError.code == .cancelled {
        writeReply(prefersArabic ? "لم يصل رد. حاول مرة أخرى." : "No reply arrived. Try again.", replyId: replyId)
        return
      }
      if case let ArrabAPIError.http(code, body) = error, code == 402 || code == 429 {
        managed.serverLimitMessage = Self.serverMessage(body)
      }
      let message = managed.serverLimitMessage ?? error.localizedDescription
      writeReply(message, replyId: replyId)
    }
  }

  private func writeReply(_ text: String, replyId: String) {
    guard let idx = lines.firstIndex(where: { $0.id == replyId }) else { return }
    var next = lines
    next[idx].text = text
    lines = next
  }

  static func photoSubject(_ text: String, kind: String?) -> String? {
    var body = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let lower = body.lowercased()
    if lower.hasPrefix("read this photo") || lower.hasPrefix("read this image") || body.hasPrefix("اقرأ هذه الصورة") {
      return nil
    }
    let prefixes = [
      "create an image about:",
      "create an image about",
      "create a photo about:",
      "create a photo about",
      "create an image / cover about:",
      "أنشئ صورة عن:",
      "أنشئ صورة عن",
    ]
    var matched = kind == "image"
    for prefix in prefixes {
      if lower.hasPrefix(prefix.lowercased()) {
        body = String(body.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        matched = true
        break
      }
    }
    if !matched {
      let hints = [
        "create a photo", "create an image", "create a picture",
        "generate a photo", "generate an image", "generate a picture",
        "make a photo", "make an image", "make a picture", "make me a photo", "make me an image",
        "draw a ", "draw me",
        "أنشئ صورة", "انشئ صورة", "سوي صورة", "سو صورة", "اصنع صورة", "ارسم",
        "صمم صورة", "طلع صورة", "أبي صورة", "ابي صورة", "أبغى صورة", "ابغى صورة",
        "صورة عن", "صورة ل",
      ]
      matched = hints.contains { hint in
        hint.allSatisfy(\.isASCII) ? lower.contains(hint) : body.contains(hint)
      }
    }
    guard matched else { return nil }
    let prompt = body.isEmpty ? text.trimmingCharacters(in: .whitespacesAndNewlines) : body
    guard prompt.count >= 2 else { return nil }
    return String(prompt.prefix(1000))
  }

  private func finishTool(_ approval: (id: String, detail: String), replyId: String) async {
    guard let data = approval.detail.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let tool = obj["toolName"] as? String else { return }
    activity = PhoneCompanionTools.activity(for: tool, arabic: prefersArabic)
    let args = Self.stringArgs(obj["arguments"])
    let ran: (result: String, file: URL?)
    if tool == "generate_image" {
      let prompt = args["prompt"] ?? args["content"] ?? args["title"] ?? ""
      if let url = await PhoneCompanionTools.makePhoto(prompt: prompt) ?? PhoneCompanionTools.renderPoster(prompt: prompt) {
        ran = ("GENERATED photo \(url.lastPathComponent) on this iPhone. It is in Library.", url)
      } else {
        ran = ("FAILED generate_image: prompt is required.", nil)
      }
    } else {
      ran = PhoneCompanionTools.run(tool: tool, args: args)
    }
    if let file = ran.file { latestFile = file }
    let token = (obj["resultToken"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard token.count >= 16 else {
      if let idx = lines.firstIndex(where: { $0.id == replyId }), lines[idx].text.isEmpty {
        lines[idx].text = ran.result
      }
      return
    }
    let attestation = PhoneCompanionTools.attest(token: token, result: ran.result)
    if let continued = try? await api.resolveTool(approvalId: approval.id, toolResult: ran.result, attestation: attestation),
       let idx = lines.firstIndex(where: { $0.id == replyId }) {
      let shown = Self.publicText(continued)
      if !shown.isEmpty { lines[idx].text = shown }
    } else if let idx = lines.firstIndex(where: { $0.id == replyId }), lines[idx].text.isEmpty {
      lines[idx].text = ran.result
    }
  }

  private static func stringArgs(_ raw: Any?) -> [String: String] {
    guard let dict = raw as? [String: Any] else { return [:] }
    var out: [String: String] = [:]
    for (key, value) in dict {
      if let text = value as? String { out[key] = text }
      else if let number = value as? NSNumber { out[key] = number.stringValue }
    }
    return out
  }

}

struct DeskWaitingCard: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @State private var desk: CompanionDeskState?
  @State private var amounts: [String: String] = [:]
  @State private var busy = false
  @State private var error: String?

  private var arabic: Bool { session.localeIsArabic }

  private var waiting: [DeskJob] {
    (desk?.jobs ?? []).filter { $0.status == "needs_you" }
  }

  var body: some View {
    Group {
      if !waiting.isEmpty || error != nil {
        card
      }
    }
    .task { await load() }
  }

  private var card: some View {
    VStack(alignment: .leading, spacing: 10) {
        Text(arabic ? "بانتظار موافقتك" : "Waiting for your yes")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
        if let hijri = desk?.hijriToday, !hijri.isEmpty {
          Text(arabic
            ? "\(hijri) · المصروف \(desk?.spentSarToday ?? 0) من \(desk?.spendCapSar ?? 500) ريال"
            : "\(hijri) · spent \(desk?.spentSarToday ?? 0) of \(desk?.spendCapSar ?? 500) SAR")
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
        if let hours = desk?.shopHours, !hours.isEmpty {
          Text(arabic ? "ساعات المحل \(hours)" : "Shop hours \(hours)")
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.muted)
        }
        ForEach(Array(waiting.prefix(2))) { job in
          VStack(alignment: .leading, spacing: 6) {
            Text(job.title)
              .font(ArrabFont.system(size: 15, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(line(job))
              .font(ArrabFont.system(size: 12))
              .foregroundStyle(theme.muted)
            if let result = job.result, !result.isEmpty {
              Text(result)
                .font(ArrabFont.system(size: 13))
                .foregroundStyle(theme.text)
                .lineLimit(4)
            }
            if job.resultHash != nil, needsAmount(job) {
              TextField(arabic ? "المبلغ بالريال" : "Amount in SAR", text: Binding(
                get: { amounts[job.id] ?? "" },
                set: { amounts[job.id] = $0 }
              ))
              .font(ArrabFont.system(size: 14))
              .keyboardType(.numberPad)
              .padding(10)
              .background(theme.subtle)
              .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            HStack(spacing: 8) {
              Button(label(job)) { Task { await approve(job) } }
                .font(ArrabFont.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.onPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(theme.primary)
                .clipShape(Capsule())
                .disabled(busy || (job.resultHash != nil && needsAmount(job) && (Int(amounts[job.id] ?? "") ?? 0) <= 0))
              Button(arabic ? "إيقاف" : "Stop") {
                Task {
                  _ = try? await ArrabAPIClient.shared.stopDeskJob(job.id)
                  await load()
                }
              }
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .foregroundStyle(theme.text)
            }
          }
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(theme.card)
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
        }
        if let error {
          Text(error)
            .font(ArrabFont.system(size: 12))
            .foregroundStyle(theme.warn)
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 12)
  }

  private func line(_ job: DeskJob) -> String {
    var text = job.companionName
    if job.channel == "whatsapp", let recipient = job.recipient, !recipient.isEmpty {
      text += arabic ? " · واتساب \(recipient)" : " · WhatsApp \(recipient)"
    }
    if job.channel == "computer" { text += arabic ? " · هذا الجهاز" : " · This computer" }
    if job.sensitive { text += arabic ? " · يحتاج موافقة" : " · Needs approval" }
    return text
  }

  private func label(_ job: DeskJob) -> String {
    if job.resultHash != nil && job.channel == "computer" { return arabic ? "على الماك" : "On this Mac" }
    if job.resultHash != nil && job.channel == "whatsapp" { return arabic ? "أرسل" : "Send" }
    if job.resultHash != nil { return arabic ? "أعتمد" : "Release" }
    return arabic ? "موافقة" : "Approve"
  }

  private func needsAmount(_ job: DeskJob) -> Bool {
    let text = "\(job.title)\n\(job.brief)"
    return text.range(of: #"\b(pay|payment|invoice|transfer|wire)\b|ادفع|فاتورة|حوّل|حول"#, options: .regularExpression) != nil
  }

  private func load() async {
    desk = try? await ArrabAPIClient.shared.companionDesk()
  }

  private func approve(_ job: DeskJob) async {
    if job.channel == "computer", job.resultHash != nil {
      error = arabic
        ? "هذا الأمر يشتغل على الماك من تطبيق أعراب، مو من الجوال."
        : "This command runs on your Mac in Arrab Studio, not from the phone."
      return
    }
    busy = true
    error = nil
    defer { busy = false }
    let amount = Int(amounts[job.id] ?? "")
    do {
      _ = try await ArrabAPIClient.shared.approveDeskJob(
        job.id,
        draftHash: job.resultHash,
        amountSar: job.resultHash != nil && needsAmount(job) ? amount : nil
      )
      await load()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

struct CompanionDeskPanel: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var companions: CompanionSpaceStore
  @Environment(\.arrab) private var theme
  @State private var desk: CompanionDeskState?
  @State private var title = ""
  @State private var brief = ""
  @State private var whatsapp = false
  @State private var computer = false
  @State private var phone = ""
  @State private var notes: [String: String] = [:]
  @State private var amounts: [String: String] = [:]
  @State private var cap = "500"
  @State private var quietStart = ""
  @State private var quietEnd = ""
  @State private var shopHours = ""
  @State private var messageList = ""
  @State private var neverSay = ""
  @State private var busy = false
  @State private var error: String?

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(arabic
        ? "الرفيق يكمل العمل بعد ما تطلع. الموافقة لهذي المسودة فقط، وضمن السقف اليومي."
        : "The companion keeps working after you leave. A yes applies only to this draft, inside your daily cap.")
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      if let hijri = desk?.hijriToday, !hijri.isEmpty {
        Text(hijri)
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      Text(arabic
        ? "المصروف اليوم \(desk?.spentSarToday ?? 0) من \(desk?.spendCapSar ?? 500) ريال"
        : "Spent today \(desk?.spentSarToday ?? 0) of \(desk?.spendCapSar ?? 500) SAR")
        .font(ArrabFont.system(size: 13))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        paceButton("allow", arabic ? "اسمح" : "Allow")
        paceButton("ask", arabic ? "اسأل" : "Ask")
        paceButton("never", arabic ? "لا" : "Never")
      }
      TextField(arabic ? "سقف اليوم بالريال" : "Daily cap in SAR", text: $cap)
        .font(ArrabFont.system(size: 15))
        .keyboardType(.numberPad)
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      Text(arabic
        ? "إيقاف مسائي بتوقيت الرياض. حطه على المغرب إذا تبي الهدوء بعد الغروب. الساعة اختيارك، مو حساب وقت صلاة."
        : "Evening hold in Riyadh time. Set it to your Maghrib if you want quiet after sunset. It is the hour you choose, not a calculated prayer time.")
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
      HStack(spacing: 8) {
        TextField(arabic ? "من" : "From", text: $quietStart)
          .font(ArrabFont.system(size: 15))
          .keyboardType(.numberPad)
          .padding(12)
          .background(theme.subtle)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        TextField(arabic ? "إلى" : "Until", text: $quietEnd)
          .font(ArrabFont.system(size: 15))
          .keyboardType(.numberPad)
          .padding(12)
          .background(theme.subtle)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
      Text(arabic ? "ساعات المحل. اكتبها بنفسك، المكتب ما يخترعها." : "Shop hours. Write them yourself. The desk will not invent them.")
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
      TextField(arabic ? "مثلاً ٤ إلى نص الليل" : "For example, 4 to midnight", text: $shopHours)
        .font(ArrabFont.system(size: 15))
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      Text(arabic ? "مين نقدر نراسل. أرقام مع المفتاح، مفصولة بفاصلة." : "Who may be messaged. Numbers with the country code, separated by commas.")
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
      TextField(arabic ? "9665…" : "9665…", text: $messageList)
        .font(ArrabFont.system(size: 15))
        .keyboardType(.numbersAndPunctuation)
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      TextField(arabic ? "لا يقول" : "Never say", text: $neverSay)
        .font(ArrabFont.system(size: 15))
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      HStack(spacing: 8) {
        Button(arabic ? "احفظ الحدود" : "Save limits") { Task { await saveLimits(clearQuiet: false) } }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.onPrimary)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(theme.primary)
          .clipShape(Capsule())
        Button(arabic ? "ألغِ الإيقاف" : "Clear hold") { Task { await saveLimits(clearQuiet: true) } }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
        Button(arabic ? "أوقف المكتب" : "Stop the desk") { Task { await kill() } }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.warn)
      }
      TextField(arabic ? "ماذا ينهي؟" : "What should they finish?", text: $title)
        .font(ArrabFont.system(size: 16))
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      HStack(spacing: 8) {
        Button {
          whatsapp.toggle()
          if whatsapp { computer = false }
        } label: {
          Text(arabic ? "واتساب" : "WhatsApp")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(whatsapp ? theme.onPrimary : theme.text)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(whatsapp ? theme.primary : theme.subtle)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        Button {
          computer.toggle()
          if computer { whatsapp = false }
        } label: {
          Text(arabic ? "هذا الجهاز" : "This computer")
            .font(ArrabFont.system(size: 13, weight: .semibold))
            .foregroundStyle(computer ? theme.onPrimary : theme.text)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(computer ? theme.primary : theme.subtle)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
      if computer {
        Text(arabic
          ? "أمر واحد يشتغل على هذا الماك بعد ما تعتمد السطر نفسه. مسح القرص يبقى ممنوع."
          : "One command runs on this Mac after you release that exact line. Wiping the disk stays blocked.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
      }
      if whatsapp {
        Text(arabic
          ? "الرسالة ما تطلع إلا بعد ما تعتمد هالمسودة."
          : "The message leaves only after you release this draft.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
        TextField(arabic ? "الرقم مع مفتاح الدولة" : "Number with country code", text: $phone)
          .font(ArrabFont.system(size: 15))
          .keyboardType(.phonePad)
          .padding(12)
          .background(theme.subtle)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
      TextField(arabic ? "التفاصيل" : "Details", text: $brief, axis: .vertical)
        .lineLimit(3...6)
        .font(ArrabFont.system(size: 15))
        .padding(12)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      Button {
        Task { await start() }
      } label: {
        Text(busy ? (arabic ? "يعمل…" : "Working…") : (arabic ? "اتركه على المكتب" : "Leave it on the desk"))
          .font(ArrabFont.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.onPrimary)
          .frame(maxWidth: .infinity)
          .frame(height: 46)
          .background(title.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 ? theme.muted : theme.primary)
          .clipShape(Capsule())
      }
      .buttonStyle(.plain)
      .disabled(busy || title.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 || (whatsapp && phone.filter(\.isNumber).count < 8))
      if let error {
        Text(error).font(ArrabFont.system(size: 12)).foregroundStyle(theme.warn)
      }
      if desk?.jobs.isEmpty != false {
        Text(arabic ? "المكتب فاضي." : "Nothing is on the desk yet.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.muted)
      }
      ForEach(desk?.jobs ?? []) { job in
        deskCard(job)
      }
    }
    .task { await load() }
  }

  private func paceButton(_ pace: String, _ label: String) -> some View {
    let on = desk?.pace == pace
    return Button {
      Task {
        desk = try? await ArrabAPIClient.shared.setDeskPace(pace)
      }
    } label: {
      Text(label)
        .font(ArrabFont.system(size: 13, weight: .semibold))
        .foregroundStyle(on ? theme.onPrimary : theme.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(on ? theme.primary : theme.subtle)
        .clipShape(Capsule())
    }
    .buttonStyle(.plain)
  }

  private func deskCard(_ job: DeskJob) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(job.title).font(ArrabFont.system(size: 15, weight: .semibold)).foregroundStyle(theme.text)
      Text(statusLine(job))
        .font(ArrabFont.system(size: 12))
        .foregroundStyle(theme.muted)
      if let result = job.result, !result.isEmpty {
        Text(result).font(ArrabFont.system(size: 13)).foregroundStyle(theme.text)
      }
      if job.status == "needs_you", job.resultHash != nil {
        Text(arabic ? "هالموافقة لهذي المسودة فقط." : "This yes is only for this draft.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
      }
      if job.status == "needs_you", job.resultHash != nil, needsAmount(job) {
        TextField(arabic ? "المبلغ بالريال" : "Amount in SAR", text: Binding(
          get: { amounts[job.id] ?? "" },
          set: { amounts[job.id] = $0 }
        ))
        .font(ArrabFont.system(size: 14))
        .keyboardType(.numberPad)
        .padding(10)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
      if job.status == "needs_you" {
        Button(approveLabel(job)) { Task { await approve(job) } }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.onPrimary)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(theme.primary)
          .clipShape(Capsule())
          .disabled(job.resultHash != nil && needsAmount(job) && (Int(amounts[job.id] ?? "") ?? 0) <= 0)
      }
      if job.status != "stopped" && job.status != "done" {
        Button(arabic ? "إيقاف" : "Stop") { Task { _ = try? await ArrabAPIClient.shared.stopDeskJob(job.id); await load() } }
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      TextField(arabic ? "ماذا يتغير المرة الجاية؟" : "What should change next time?", text: Binding(
        get: { notes[job.id] ?? "" },
        set: { notes[job.id] = $0 }
      ))
      .font(ArrabFont.system(size: 14))
      .padding(10)
      .background(theme.subtle)
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      Button(arabic ? "احفظ التصحيح" : "Save correction") {
        Task {
          let note = notes[job.id] ?? ""
          _ = try? await ArrabAPIClient.shared.reviseDeskJob(job.id, note: note)
          notes[job.id] = ""
          await load()
        }
      }
      .font(ArrabFont.system(size: 13, weight: .semibold))
      .foregroundStyle(theme.lavender)
      .disabled((notes[job.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(theme.line, lineWidth: 1))
  }

  private func statusLine(_ job: DeskJob) -> String {
    let status: String
    switch job.status {
    case "needs_you": status = arabic ? "بانتظارك" : "Waiting for you"
    case "running": status = arabic ? "يعمل" : "Working"
    case "done": status = arabic ? "جاهز" : "Ready"
    default: status = arabic ? "متوقف" : "Stopped"
    }
    var line = "\(job.companionName) · \(status)"
    if job.channel == "whatsapp", let recipient = job.recipient, !recipient.isEmpty {
      line += " · \(arabic ? "واتساب" : "WhatsApp") \(recipient)"
    }
    if job.channel == "computer" { line += arabic ? " · هذا الجهاز" : " · This computer" }
    if job.sentMessageId != nil { line += arabic ? " · انرسلت" : " · Sent" }
    if job.sensitive { line += arabic ? " · يحتاج موافقة" : " · Needs approval" }
    return line
  }

  private func load() async {
    desk = try? await ArrabAPIClient.shared.companionDesk()
    if let desk {
      cap = String(desk.spendCapSar ?? 500)
      quietStart = desk.quietStartHour.map { String($0) } ?? ""
      quietEnd = desk.quietEndHour.map { String($0) } ?? ""
      shopHours = desk.shopHours ?? ""
      messageList = (desk.messageList ?? []).joined(separator: ", ")
      neverSay = desk.neverSay ?? ""
    }
  }

  private func saveLimits(clearQuiet: Bool) async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      if clearQuiet {
        quietStart = ""
        quietEnd = ""
      }
      desk = try await ArrabAPIClient.shared.updateDesk(
        spendCapSar: Int(cap),
        quietStartHour: Int(quietStart),
        quietEndHour: Int(quietEnd),
        clearQuiet: clearQuiet,
        shopHours: shopHours,
        messageList: messageList
          .components(separatedBy: CharacterSet(charactersIn: ",،\n"))
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty },
        neverSay: neverSay
      )
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func kill() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      desk = try await ArrabAPIClient.shared.killDesk()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func start() async {
    if FamilySeatStore.blocksNow() {
      error = arabic ? "الهدوء أو النوم يمنع المكتب الآن." : "Quiet hours or bedtime block the desk right now."
      return
    }
    busy = true
    error = nil
    defer { busy = false }
    let person = companions.selected
    do {
      _ = try await ArrabAPIClient.shared.startDeskJob(
        title: title.trimmingCharacters(in: .whitespacesAndNewlines),
        brief: brief.trimmingCharacters(in: .whitespacesAndNewlines),
        companionId: person.agentId ?? person.id,
        companionName: person.displayName(arabic: arabic),
        channel: computer ? "computer" : (whatsapp ? "whatsapp" : nil),
        recipient: whatsapp ? phone : nil
      )
      title = ""
      brief = ""
      phone = ""
      whatsapp = false
      computer = false
      await load()
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func needsAmount(_ job: DeskJob) -> Bool {
    let text = "\(job.title)\n\(job.brief)"
    return text.range(of: #"\b(pay|payment|invoice|transfer|wire)\b|ادفع|فاتورة|حوّل|حول"#, options: .regularExpression) != nil
  }

  private func approveLabel(_ job: DeskJob) -> String {
    if job.resultHash != nil && job.channel == "computer" { return arabic ? "على الماك" : "On this Mac" }
    if job.resultHash != nil && job.channel == "whatsapp" { return arabic ? "أرسل" : "Send" }
    if job.resultHash != nil { return arabic ? "أعتمد" : "Release" }
    return arabic ? "موافقة" : "Approve"
  }

  private func approve(_ job: DeskJob) async {
    if job.channel == "computer", job.resultHash != nil {
      error = arabic
        ? "هذا الأمر يشتغل على الماك من تطبيق أعراب، مو من الجوال."
        : "This command runs on your Mac in Arrab Studio, not from the phone."
      return
    }
    busy = true
    defer { busy = false }
    let amount = Int(amounts[job.id] ?? "")
    do {
      _ = try await ArrabAPIClient.shared.approveDeskJob(
        job.id,
        draftHash: job.resultHash,
        amountSar: job.resultHash != nil && needsAmount(job) ? amount : nil
      )
      await load()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
