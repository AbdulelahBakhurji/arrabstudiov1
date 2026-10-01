import SwiftUI

enum CompanionLane: String, CaseIterable {
  case personal, studio, family, work
}

struct CompanionItem: Identifiable, Equatable {
  let id: String
  let name: String
  let nameAr: String
  let blurb: String
  let blurbAr: String
  let tint: Color
  let isGeneral: Bool
  let systemImage: String?
  let agentId: String?
  let badge: CompanionBadge?
  let pinned: Bool
  let maintenanceNote: String?
  var lane: CompanionLane = .personal
  var roles: [StudioRole] = [.individual]

  func displayName(arabic: Bool) -> String {
    if arabic {
      if Self.hasArabic(nameAr) { return nameAr }
      if let known = CompanionCatalog.item(matching: id, specialty: nil, name: name), Self.hasArabic(known.nameAr) {
        return known.nameAr
      }
    }
    let picked = arabic ? nameAr : name
    return picked.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? name : picked
  }

  func displayBlurb(arabic: Bool) -> String {
    if arabic {
      if Self.hasArabic(blurbAr) { return blurbAr }
      if let known = CompanionCatalog.item(matching: id, specialty: nil, name: name), Self.hasArabic(known.blurbAr) {
        return known.blurbAr
      }
    }
    let picked = arabic ? blurbAr : blurb
    return picked.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? blurb : picked
  }

  private static func hasArabic(_ text: String) -> Bool {
    text.unicodeScalars.contains { (0x0600...0x06FF).contains($0.value) }
  }
  func matches(_ role: StudioRole) -> Bool { isGeneral || roles.contains(role) }
}

enum CompanionCatalog {
  static let general = CompanionItem(
    id: "general",
    name: "General",
    nameAr: "عام",
    blurb: "Space for everything",
    blurbAr: "مساحة لكل شيء",
    tint: Color(hex: 0xC9BCFF),
    isGeneral: true,
    systemImage: "sparkle",
    agentId: nil,
    badge: nil,
    pinned: true,
    maintenanceNote: nil
  )

  static let samples: [CompanionItem] = [
    general,
    make("layan", "Layan", "ليان", "Study plan — exams, courses, and focus blocks", "خطة الدراسة — الاختبارات والمقررات والتركيز", 0x6B4C9A, .personal, [.individual, .family]),
    make("joud", "Joud", "جود", "Daily choices — one clear option, not a list", "خيارات اليوم — خيار واضح واحد لا قائمة", 0x8B4C8B, .personal, [.individual, .family]),
    make("inbox", "Ghada", "غادة", "Inbox — triage, arrange, and careful replies", "البريد — الترتيب والردود والإرسال الحذر", 0x6A4C3A, .personal, [.individual, .organization]),
    make("ui-designer", "Nouf", "نوف", "UI design — layouts, screens, and live preview", "تصميم الواجهات — الشاشات والمعاينة المباشرة", 0x8B3A6A, .studio, [.individual, .organization]),
    make("razan", "Razan", "رزان", "+20% allowance", "+٢٠٪ مصروف", 0x8B5A3C, .family, [.individual, .family]),
    make("health", "Noura", "نورة", "Sleep, movement, and your health baseline", "النوم والحركة وخطّك الصحي", 0x2F6B4F, .personal, [.individual, .family]),
    make("relationships", "Reem", "ريم", "The people who matter", "من يهمّك ومتى تواصلت معهم", 0x8B4C6A, .personal, [.individual, .family]),
    make("sleep", "Lama", "لمى", "Rest, late nights, and recovery", "الراحة والسهر والتعافي", 0x5A4C8B, .personal, [.individual, .family]),
    make("money", "Faisal", "فيصل", "Spending, bills, and runway", "المصروف والفواتير والسيولة", 0x3A6B4F, .personal, [.individual]),
    make("parents", "Hind", "هند", "Parents’ visits, calls, and occasions", "صحة الوالدين والزيارات والمناسبات", 0x8B5A3C, .family, [.individual, .family]),
    make("career", "Fahad", "فهد", "Path, satisfaction, and burnout", "المسار والرضا والإرهاق", 0x3A5A8B, .work, [.individual, .organization]),
    make("chronicler", "Omar", "عمر", "Quietly gathers what you lived", "يجمع بهدوء ما عشته", 0x8B6A3A, .personal, [.individual]),
    make("work", "Turki", "تركي", "Tasks against the calendar", "المهام مقابل التقويم", 0x2F4C6B, .work, [.individual, .organization]),
    make("meetings", "Sara", "سارة", "Before and after the meeting", "قبل الاجتماع وبعده", 0x6A3A6A, .work, [.individual, .organization]),
    make("colleagues", "Khalid", "خالد", "Who is waiting on you at work", "من ينتظرك في العمل", 0x8B5A2A, .work, [.organization]),
    make("decision-guard", "Sultan", "سلطان", "Slows a rushed decision", "يبطئ قراراً متسرعاً", 0x3A3A6B, .personal, [.individual]),
    make("meaning", "Hessa", "حصة", "The practice you chose", "الممارسة التي اخترتها", 0x6B5A3A, .personal, [.individual, .family]),
    make("arrab-assistant", "Arrab Assistant", "مساعد عرّاب", "PC files, connectors, arrange anything", "ملفات الجهاز والموصلات وترتيب أي شيء", 0x6B4C9A, .studio, [.individual, .organization], systemImage: "sparkles"),
    make("web-design", "Web Design", "تصميم الويب", "Sites, pages, and live preview", "المواقع والصفحات والمعاينة", 0x2F6B5A, .studio, [.individual, .organization]),
    make("phone-design", "Phone Design", "تصميم الجوال", "Mobile screens and pocket layouts", "شاشات الجوال والتخطيطات", 0x8B3A5A, .studio, [.individual, .organization]),
    make("game-design", "Game Design", "تصميم الألعاب", "WebGL, Roblox, and playable files", "ألعاب وملفات جاهزة للتجربة", 0x3A6B8B, .studio, [.individual, .organization]),
    make("3d-modeling", "3D Modeling", "النمذجة ثلاثية الأبعاد", "Scenes, objects, and exports", "المشاهد والأجسام والتصدير", 0x4A5A8B, .studio, [.individual, .organization]),
    make("product-flow", "Product Flow", "تدفق المنتج", "Steps from idea to ship", "الخطوات من الفكرة إلى الإطلاق", 0x2F6A6B, .studio, [.organization]),
    make("brand-identity", "Brand", "الهوية", "Voice, palette, and visual direction", "الصوت والألوان والاتجاه البصري", 0x8B5A2F, .studio, [.individual, .organization]),
    make("copy-ux", "UX Copy", "نصوص التجربة", "Headlines, buttons, and empty states", "العناوين والأزرار والحالات الفارغة", 0x3A8B6A, .studio, [.individual, .organization]),
    make("markets-terminal", "Markets", "الأسواق", "Symbols across markets and crypto", "الرموز عبر الأسواق والعملات", 0x6B5A2F, .studio, [.organization]),
  ]

  private static func make(
    _ id: String,
    _ name: String,
    _ nameAr: String,
    _ blurb: String,
    _ blurbAr: String,
    _ hex: UInt32,
    _ lane: CompanionLane,
    _ roles: [StudioRole],
    systemImage: String? = nil
  ) -> CompanionItem {
    CompanionItem(
      id: id,
      name: name,
      nameAr: nameAr,
      blurb: blurb,
      blurbAr: blurbAr,
      tint: Color(hex: hex),
      isGeneral: false,
      systemImage: systemImage,
      agentId: nil,
      badge: nil,
      pinned: id == "arrab-assistant",
      maintenanceNote: nil,
      lane: lane,
      roles: roles
    )
  }

  /// Match a live agent or English label back to the catalog face, so Arabic stays Arabic.
  static func item(matching id: String?, specialty: String?, name: String?) -> CompanionItem? {
    let keys = [id, specialty, name]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
      .filter { !$0.isEmpty }
    for key in keys {
      if let hit = samples.first(where: {
        $0.id == key || $0.name.lowercased() == key || $0.nameAr == key
      }) {
        return hit
      }
      if let alias = aliases[key], let hit = samples.first(where: { $0.id == alias }) {
        return hit
      }
    }
    return nil
  }

  private static let aliases: [String: String] = [
    "general": "general",
    "assistant": "arrab-assistant",
    "arrab assistant": "arrab-assistant",
    "arrab-assistant": "arrab-assistant",
    "web designer": "web-design",
    "web-designer": "web-design",
    "web design": "web-design",
    "phone designer": "phone-design",
    "phone-designer": "phone-design",
    "phone design": "phone-design",
    "game designer": "game-design",
    "game-designer": "game-design",
    "game design": "game-design",
    "3d modeler": "3d-modeling",
    "3d-modeler": "3d-modeling",
    "3d modeling": "3d-modeling",
    "3d-modeling": "3d-modeling",
    "copywriter": "copy-ux",
    "ux copy": "copy-ux",
    "copy-ux": "copy-ux",
    "brand": "brand-identity",
    "brand identity": "brand-identity",
    "markets": "markets-terminal",
    "markets terminal": "markets-terminal",
    "product flow": "product-flow",
    "noura": "health",
    "reem": "relationships",
    "lama": "sleep",
    "faisal": "money",
    "hind": "parents",
    "fahad": "career",
    "omar": "chronicler",
    "turki": "work",
    "sara": "meetings",
    "khalid": "colleagues",
    "sultan": "decision-guard",
    "hessa": "meaning",
    "layan": "layan",
    "study": "layan",
    "joud": "joud",
    "daily-decisions": "joud",
    "nouf": "ui-designer",
    "ui designer": "ui-designer",
    "ui-designer": "ui-designer",
    "ghada": "inbox",
    "inbox": "inbox",
    "البريد": "inbox",
    "razan": "razan",
  ]
}

private struct MadeCompanion: Codable {
  var id: String
  var name: String
  var purpose: String
  var agentId: String?
  var gender: String
  var portrait: String
  var advanced: String
  var connectors: [String]
  var place: String
  var voice: String

  init(id: String, name: String, purpose: String, agentId: String?, gender: String, portrait: String, advanced: String, connectors: [String], place: String = "", voice: String = "") {
    self.id = id
    self.name = name
    self.purpose = purpose
    self.agentId = agentId
    self.gender = gender
    self.portrait = portrait
    self.advanced = advanced
    self.connectors = connectors
    self.place = place
    self.voice = voice
  }

  init(from decoder: Decoder) throws {
    let box = try decoder.container(keyedBy: CodingKeys.self)
    id = try box.decode(String.self, forKey: .id)
    name = try box.decode(String.self, forKey: .name)
    purpose = try box.decodeIfPresent(String.self, forKey: .purpose) ?? ""
    agentId = try box.decodeIfPresent(String.self, forKey: .agentId)
    gender = try box.decodeIfPresent(String.self, forKey: .gender) ?? "woman"
    portrait = try box.decodeIfPresent(String.self, forKey: .portrait) ?? ""
    advanced = try box.decodeIfPresent(String.self, forKey: .advanced) ?? ""
    connectors = try box.decodeIfPresent([String].self, forKey: .connectors) ?? []
    place = try box.decodeIfPresent(String.self, forKey: .place) ?? ""
    voice = try box.decodeIfPresent(String.self, forKey: .voice) ?? ""
  }

  static func cardLine(place: String, purpose: String, arabic: Bool) -> String {
    switch place {
    case "shop":
      return arabic ? "يساعد في المحل. يسأل قبل الفلوس أو واتساب." : "Helps at the shop. Asks before money or WhatsApp."
    case "both":
      return arabic ? "يساعد في البيت والمحل. يسأل قبل الفلوس أو واتساب." : "Helps at home and the shop. Asks before money or WhatsApp."
    case "home":
      return arabic ? "يساعد في البيت. يسأل قبل الفلوس أو واتساب." : "Helps at home. Asks before money or WhatsApp."
    default:
      return purpose
    }
  }

  func asItem() -> CompanionItem {
    CompanionItem(
      id: id,
      name: name,
      nameAr: name,
      blurb: Self.cardLine(place: place, purpose: purpose, arabic: false),
      blurbAr: Self.cardLine(place: place, purpose: purpose, arabic: true),
      tint: Color(hex: 0x5A4C8B),
      isGeneral: false,
      systemImage: nil,
      agentId: agentId,
      badge: nil,
      pinned: false,
      maintenanceNote: nil,
      lane: .personal,
      roles: [.individual, .family, .organization]
    )
  }
}

@MainActor
final class CompanionSpaceStore: ObservableObject {
  @Published var selectedId: String = CompanionCatalog.general.id
  @Published var companions: [CompanionItem] = CompanionCatalog.samples + CompanionSpaceStore.loadMade().map { $0.asItem() }

  var selected: CompanionItem {
    companions.first { $0.id == selectedId } ?? CompanionCatalog.general
  }

  func reload(from managed: ManagedClient) async {
    do {
      let agents = try await ArrabAPIClient.shared.agents()
      let filtered = managed.applyPolicy(to: agents)
      let policies = Dictionary(uniqueKeysWithValues: managed.policies().map { ($0.id, $0) })
      var items = CompanionCatalog.samples
      let hues: [Color] = [
        Color(hex: 0x6B4C9A), Color(hex: 0x8B5A3C), Color(hex: 0x2F6B4F),
        Color(hex: 0x8B3A3A), Color(hex: 0x3A5A8B), Color(hex: 0x6A3A6A),
      ]
      for (idx, agent) in filtered.enumerated() {
        let specialty = (agent.specialty ?? "").lowercased()
        let agentName = agent.name.lowercased()
        if Self.isRemovedCompanion(id: agent.id, name: agent.name, blurb: agent.role ?? agent.specialty ?? "") {
          continue
        }
        if specialty == "custom" || agentName == "custom" || specialty == "incognito" || agentName == "incognito" {
          continue
        }
        if let known = items.firstIndex(where: { item in
          item.id == agent.id
            || item.id == specialty
            || item.name.caseInsensitiveCompare(agent.name) == .orderedSame
            || CompanionCatalog.item(matching: agent.id, specialty: specialty, name: agent.name)?.id == item.id
        }) {
          let current = items[known]
          items[known] = CompanionItem(
            id: current.id,
            name: current.name,
            nameAr: current.nameAr,
            blurb: current.blurb,
            blurbAr: current.blurbAr,
            tint: current.tint,
            isGeneral: current.isGeneral,
            systemImage: current.systemImage,
            agentId: agent.id,
            badge: current.badge,
            pinned: current.pinned,
            maintenanceNote: current.maintenanceNote,
            lane: current.lane,
            roles: current.roles
          )
          continue
        }
        let policy = policies[agent.id] ?? policies[agent.specialty ?? ""]
        let knownCopy = CompanionCatalog.item(matching: agent.id, specialty: specialty, name: agent.name)
        items.append(
          CompanionItem(
            id: knownCopy?.id ?? agent.id,
            name: knownCopy?.name ?? agent.name,
            nameAr: knownCopy?.nameAr ?? agent.name,
            blurb: knownCopy?.blurb ?? agent.role ?? agent.specialty ?? "",
            blurbAr: knownCopy?.blurbAr ?? agent.role ?? agent.specialty ?? "",
            tint: hues[idx % hues.count],
            isGeneral: false,
            systemImage: nil,
            agentId: agent.id,
            badge: policy?.badge,
            pinned: policy?.pinned ?? false,
            maintenanceNote: policy?.maintenance,
            lane: knownCopy?.lane ?? .personal,
            roles: knownCopy?.roles ?? [.individual, .family, .organization]
          )
        )
      }
      for made in Self.loadMade() where !items.contains(where: { $0.id == made.id }) {
        items.append(made.asItem())
      }
      companions = items.filter { !Self.isRemovedCompanion(id: $0.id, name: $0.name, blurb: $0.blurb) }
      if !companions.contains(where: { $0.id == selectedId }) {
        selectedId = CompanionCatalog.general.id
      }
      managed.activeCompanionId = selected.agentId ?? selected.id
    } catch {
      companions = (CompanionCatalog.samples + Self.loadMade().map { $0.asItem() })
        .filter { !Self.isRemovedCompanion(id: $0.id, name: $0.name, blurb: $0.blurb) }
    }
  }

  func createCompanion(name: String, place: String, voice: String, gender: String, advanced: String, connectors: [String]) async -> CompanionItem {
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let chosenPlace = place == "shop" || place == "both" ? place : "home"
    let chosenVoice = voice == "clear" || voice == "english" ? voice : "gulf"
    let purpose = MadeCompanion.cardLine(place: chosenPlace, purpose: "", arabic: false)
    let id = "made-\(UUID().uuidString.prefix(8))"
    let portrait = Self.assignPortrait(gender: gender, purpose: purpose, excluding: id)
    var made = MadeCompanion(
      id: id,
      name: trimmedName,
      purpose: purpose,
      agentId: nil,
      gender: gender,
      portrait: portrait,
      advanced: advanced.trimmingCharacters(in: .whitespacesAndNewlines),
      connectors: connectors,
      place: chosenPlace,
      voice: chosenVoice
    )
    let instructions = Self.instructions(for: made)
    if let agent = try? await ArrabAPIClient.shared.createAgent(
      CreateAgentRequest(
        name: trimmedName,
        role: purpose,
        specialty: "custom",
        instructions: instructions,
        status: "active"
      )
    ) {
      made.agentId = agent.id
    }
    var stored = Self.loadMade()
    stored.append(made)
    Self.saveMade(stored)
    CompanionVoiceStore.shared.setPurpose(instructions, for: id)
    let item = made.asItem()
    companions.append(item)
    return item
  }

  func updateCompanion(id: String, place: String, voice: String, name: String, gender: String, advanced: String, connectors: [String]) -> CompanionItem? {
    var stored = Self.loadMade()
    guard let index = stored.firstIndex(where: { $0.id == id }) else { return nil }
    let chosenPlace = place == "shop" || place == "both" ? place : "home"
    let chosenVoice = voice == "clear" || voice == "english" ? voice : "gulf"
    stored[index].name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    stored[index].place = chosenPlace
    stored[index].voice = chosenVoice
    stored[index].purpose = MadeCompanion.cardLine(place: chosenPlace, purpose: stored[index].purpose, arabic: false)
    stored[index].gender = gender
    stored[index].advanced = advanced.trimmingCharacters(in: .whitespacesAndNewlines)
    stored[index].connectors = connectors
    if stored[index].portrait.isEmpty || Self.portraitTaken(stored[index].portrait, except: id) {
      stored[index].portrait = Self.assignPortrait(gender: gender, purpose: stored[index].purpose, excluding: id)
    }
    Self.saveMade(stored)
    CompanionVoiceStore.shared.setPurpose(Self.instructions(for: stored[index]), for: id)
    let item = stored[index].asItem()
    if let slot = companions.firstIndex(where: { $0.id == id }) {
      companions[slot] = item
    }
    return item
  }

  func deleteCompanion(id: String) {
    var stored = Self.loadMade()
    stored.removeAll { $0.id == id }
    Self.saveMade(stored)
    companions.removeAll { $0.id == id }
    if selectedId == id { selectedId = CompanionCatalog.general.id }
  }

  func madeRecord(_ id: String) -> (name: String, place: String, voice: String, gender: String, advanced: String, connectors: [String])? {
    guard let made = Self.loadMade().first(where: { $0.id == id }) else { return nil }
    return (made.name, made.place.isEmpty ? "home" : made.place, made.voice.isEmpty ? "gulf" : made.voice, made.gender, made.advanced, made.connectors)
  }

  static func storedPortrait(for id: String) -> String {
    loadMade().first { $0.id == id }?.portrait ?? ""
  }

  static func usedMadePortraits() -> [String] {
    loadMade().map(\.portrait)
  }

  func previewPortrait(gender: String, purpose: String, editing: String?) -> String {
    Self.assignPortrait(gender: gender, purpose: purpose, excluding: editing ?? "preview")
  }

  private static func instructions(for made: MadeCompanion) -> String {
    if made.place.isEmpty {
      var lines = [made.purpose]
      if !made.advanced.isEmpty { lines.append(made.advanced) }
      if !made.connectors.isEmpty {
        lines.append("Connected tools: " + made.connectors.joined(separator: ", "))
      }
      return lines.filter { !$0.isEmpty }.joined(separator: "\n")
    }
    let voice: String
    switch made.voice {
    case "clear":
      voice = "When they write Arabic, speak clear Arabic that a Saudi reader follows easily. When they write English, answer in English."
    case "english":
      voice = "Answer in English unless they write in Arabic."
    default:
      voice = "When they write Arabic, speak Gulf Arabic, Najdi or light Hijazi, like Riyadh speech. When they write English, answer in English."
    }
    return [
      MadeCompanion.cardLine(place: made.place, purpose: made.purpose, arabic: false),
      voice,
      "Ask before spending money, sending WhatsApp, or publishing. Never pay, send, or publish on your own.",
      made.advanced,
      made.connectors.isEmpty ? "" : "Connected tools: " + made.connectors.joined(separator: ", "),
    ]
      .filter { !$0.isEmpty }
      .joined(separator: "\n")
  }

  private static func portraitTaken(_ name: String, except id: String) -> Bool {
    guard !name.isEmpty else { return true }
    let catalog = CompanionFace.reservedPortraits
    if catalog.contains(name) { return true }
    return loadMade().contains { $0.id != id && $0.portrait == name }
  }

  private static func isRemovedCompanion(id: String, name: String, blurb: String) -> Bool {
    let blob = "\(id) \(name) \(blurb)".lowercased()
    if id.lowercased() == "coder" || name.lowercased() == "coder" { return true }
    if blob.contains("help me code") || blob.contains("ساعدني في البرمجة") { return true }
    return false
  }

  private static func assignPortrait(gender: String, purpose: String, excluding id: String) -> String {
    let taken = Set(loadMade().filter { $0.id != id }.map(\.portrait)).union(CompanionFace.reservedPortraits)
    let preferred = CompanionFace.freshPhotos(gender: gender).filter { !taken.contains($0) }
    let otherGender = gender == "man" ? "woman" : "man"
    let spare = CompanionFace.freshPhotos(gender: otherGender).filter { !taken.contains($0) }
    let choices = preferred.isEmpty ? spare : preferred
    if let first = choices.first { return first }
    let shift = abs(purpose.lowercased().hashValue) % max(CompanionFace.freshPhotos(gender: gender).count, 1)
    return CompanionFace.freshPhotos(gender: gender)[shift]
  }

  private static let madeKey = "arrab.companions.made"

  private static func loadMade() -> [MadeCompanion] {
    guard let data = UserDefaults.standard.data(forKey: madeKey),
          let decoded = try? JSONDecoder().decode([MadeCompanion].self, from: data) else {
      return []
    }
    let cleaned = decoded.filter {
      $0.name.lowercased() != "custom" && !isRemovedCompanion(id: $0.id, name: $0.name, blurb: $0.purpose)
    }
    let repaired = repairPortraits(cleaned)
    let changed = cleaned.count != decoded.count || zip(cleaned, repaired).contains { $0.portrait != $1.portrait }
    if changed { saveMade(repaired) }
    return repaired
  }

  private static func repairPortraits(_ items: [MadeCompanion]) -> [MadeCompanion] {
    var seen = CompanionFace.reservedPortraits
    seen.insert("coder")
    var next = items
    for index in next.indices {
      let current = next[index].portrait
      if current.isEmpty || current == "coder" || seen.contains(current) {
        let preferred = CompanionFace.freshPhotos(gender: next[index].gender)
        let other = CompanionFace.freshPhotos(gender: next[index].gender == "man" ? "woman" : "man")
        next[index].portrait = (preferred + other).first { !seen.contains($0) } ?? preferred.first ?? "pool-05"
      }
      seen.insert(next[index].portrait)
    }
    return next
  }

  private static func saveMade(_ items: [MadeCompanion]) {
    if let data = try? JSONEncoder().encode(items) {
      UserDefaults.standard.set(data, forKey: madeKey)
    }
  }
}

struct CompanionToneAxes: Codable, Equatable {
  var bluntness: Double = 45
  var humour: Double = 40
  var replyLength: Double = 35
  var warmth: Double = 55
  var formality: Double = 35
  var criticism: Double = 40
  var pace: Double = 45
}

struct CompanionVoice: Codable, Equatable {
  var purpose: String = ""
  var facts: [String] = []
  var tone: CompanionToneAxes = CompanionToneAxes()
}

struct ToneStyleChip: Identifiable {
  let id: String
  let title: L10n.Key
  let hint: L10n.Key
  let tone: CompanionToneAxes
}

enum CompanionToneCatalog {
  static let chips: [ToneStyleChip] = [
    ToneStyleChip(id: "direct", title: .toneDirect, hint: .toneDirectHint, tone: .init(bluntness: 78, humour: 30, replyLength: 20, warmth: 40, formality: 45, criticism: 70, pace: 72)),
    ToneStyleChip(id: "measured", title: .toneMeasured, hint: .toneMeasuredHint, tone: .init(bluntness: 32, humour: 45, replyLength: 55, warmth: 60, formality: 40, criticism: 35, pace: 40)),
    ToneStyleChip(id: "coach", title: .toneCoach, hint: .toneCoachHint, tone: .init(bluntness: 72, humour: 28, replyLength: 48, warmth: 62, formality: 40, criticism: 68, pace: 65)),
    ToneStyleChip(id: "friend", title: .toneFriend, hint: .toneFriendHint, tone: .init(bluntness: 38, humour: 72, replyLength: 50, warmth: 82, formality: 18, criticism: 30, pace: 48)),
    ToneStyleChip(id: "pro", title: .tonePro, hint: .toneProHint, tone: .init(bluntness: 58, humour: 12, replyLength: 62, warmth: 35, formality: 78, criticism: 55, pace: 58)),
    ToneStyleChip(id: "quiet", title: .toneQuiet, hint: .toneQuietHint, tone: .init(bluntness: 22, humour: 12, replyLength: 18, warmth: 48, formality: 30, criticism: 22, pace: 28)),
  ]

  static func match(_ tone: CompanionToneAxes) -> ToneStyleChip? {
    chips.first { chip in
      same(chip.tone.bluntness, tone.bluntness)
        && same(chip.tone.humour, tone.humour)
        && same(chip.tone.replyLength, tone.replyLength)
        && same(chip.tone.warmth, tone.warmth)
        && same(chip.tone.formality, tone.formality)
        && same(chip.tone.criticism, tone.criticism)
        && same(chip.tone.pace, tone.pace)
    }
  }

  private static func same(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.5 }

  static func preview(_ tone: CompanionToneAxes, arabic: Bool) -> String {
    if tone.replyLength <= 33 {
      if tone.bluntness > 66 {
        return arabic ? "ابدأ بالمهمة الأصعب. عشر دقائق تكفي للانطلاق." : "Start with the hardest task. Ten minutes is enough to begin."
      }
      return arabic ? "خذ نفساً. ما أصغر خطوة تناسبك الآن؟" : "Breathe. What's the smallest step that fits right now?"
    }
    if tone.humour > 66 && tone.warmth > 66 {
      return arabic ? "الأسبوع كان ثقيلاً، صح؟ خلّنا نختار خطوة واحدة واضحة ونكمّل منها." : "Rough week, huh? Let's pick one clear move and ride that instead of juggling five."
    }
    if tone.formality > 66 {
      return arabic ? "أقترح ترتيب الأولويات كالتالي: أنجز العنصر الحرج أولاً، ثم راجع الباقي." : "I recommend this order: finish the critical item first, then review the remainder."
    }
    return arabic ? "واضح أن الضغط مرتفع. نحدد هدفاً واحداً لليوم ونؤجّل الباقي بهدوء." : "Pressure is high. Let's lock one goal for today and park the rest calmly."
  }
}

@MainActor
final class CompanionVoiceStore: ObservableObject {
  static let shared = CompanionVoiceStore()
  @Published private var voices: [String: CompanionVoice] = [:]
  private let key = "arrab.companion.voices"

  private init() {
    if let data = UserDefaults.standard.data(forKey: key),
       let decoded = try? JSONDecoder().decode([String: CompanionVoice].self, from: data) {
      voices = decoded
    }
  }

  func remembered() -> [(id: String, text: String)] {
    voices.flatMap { id, voice in
      voice.facts.map { (id, $0) }
    }
  }

  func voice(for id: String) -> CompanionVoice {
    voices[id] ?? CompanionVoice()
  }

  func setPurpose(_ text: String, for id: String) {
    var next = voice(for: id)
    next.purpose = text
    voices[id] = next
    persist()
  }

  func addFact(_ text: String, for id: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    var next = voice(for: id)
    next.facts.append(trimmed)
    voices[id] = next
    persist()
  }

  func removeFact(_ text: String, for id: String) {
    var next = voice(for: id)
    if let index = next.facts.firstIndex(of: text) {
      next.facts.remove(at: index)
      voices[id] = next
      persist()
    }
  }

  func removeFact(at index: Int, for id: String) {
    var next = voice(for: id)
    guard next.facts.indices.contains(index) else { return }
    next.facts.remove(at: index)
    voices[id] = next
    persist()
  }

  func setTone(_ tone: CompanionToneAxes, for id: String) {
    var next = voice(for: id)
    next.tone = tone
    voices[id] = next
    persist()
  }

  func prompt(for id: String, name: String, arabic: Bool) -> String {
    let voice = voice(for: id)
    let tone = voice.tone
    let style = CompanionToneCatalog.match(tone)
    let styleName = style.map { L10n.t($0.title, arabic: arabic) } ?? L10n.t(.customStyle, arabic: arabic)
    var lines = [
      arabic
        ? "أسلوب \(name). تكلم بلهجة سعودية بيضاء، طبيعية مثل كلام الرياض: وش، الحين، كذا، طيب، يالله."
        : "Voice for \(name). Sound like this companion.",
      arabic ? "الأسلوب: \(styleName)." : "Style: \(styleName).",
      band(tone.bluntness, high: arabic ? "كن واضح، وابدأ بالمهم على طول." : "Be direct. Lead with the point.",
           mid: arabic ? "كن صريح، بس بلطف." : "Be honest and clear, without harshness.",
           low: arabic ? "خفّف الكلام، ولا تقسى." : "Be careful and kind. Soften hard truths."),
      band(tone.replyLength, high: arabic ? "جاوب كامل إذا الموضوع يبي تفصيل." : "Give a full answer when it helps.",
           mid: arabic ? "من سطرين لأربعة، باختصار." : "Default to 2–4 short sentences.",
           low: arabic ? "سطر أو سطرين، إلا إذا طلبوا زيادة." : "Keep replies to 1–2 short lines unless they ask for more."),
    ]
    let purpose = voice.purpose.trimmingCharacters(in: .whitespacesAndNewlines)
    if !purpose.isEmpty {
      lines.append((arabic ? "الغرض: " : "Purpose: ") + purpose)
    }
    if !voice.facts.isEmpty {
      lines.append(arabic ? "تذكّر:" : "Remember:")
      lines.append(contentsOf: voice.facts.map { "- \($0)" })
    }
    return lines.joined(separator: "\n")
  }

  private func band(_ value: Double, high: String, mid: String, low: String) -> String {
    if value > 66 { return high }
    if value > 33 { return mid }
    return low
  }

  private func persist() {
    if let data = try? JSONEncoder().encode(voices) {
      UserDefaults.standard.set(data, forKey: key)
    }
  }
}
