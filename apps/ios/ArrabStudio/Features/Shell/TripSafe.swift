import SwiftUI
import UIKit

/// Details a companion may use to book. Named Safe, not credentials.
struct SafeProfile: Codable, Equatable {
  var homeCity = ""
  var fullName = ""
  var phone = ""
  var email = ""
  var passport = ""
  var travelers = ""
  var airlineLogin = ""
  var airlinePassword = ""
  var paymentName = ""
}

struct SafeItem: Codable, Identifiable, Equatable {
  var id = UUID().uuidString
  var name = ""
  var value = ""
  var hidden = true
  var slot: String? = nil
}

struct SavedTrip: Codable, Identifiable, Equatable {
  var id = UUID().uuidString
  var from = ""
  var to = ""
  var when = ""
  var people = 1
  var roundTrip = true
  var airline = ""
  var price = ""
  var created = Date()
}

@MainActor
final class SafeStore: ObservableObject {
  static let shared = SafeStore()
  static let marker = "[[arrab-safe]]"

  @Published var profile = SafeProfile()
  @Published var trips: [SavedTrip] = []
  @Published var items: [SafeItem] = []
  @Published var cloud = false
  @Published var notice = ""

  private let profileKey = "arrab.safe.profile"
  private let tripsKey = "arrab.safe.trips"
  private let cloudKey = "arrab.safe.cloud"
  private var document: SafeDocument {
    SafeDocument(profile: profile, trips: trips, items: items)
  }

  private struct SafeDocument: Codable {
    var profile: SafeProfile
    var trips: [SavedTrip]
    var items: [SafeItem]

    enum CodingKeys: String, CodingKey { case profile, trips, items }

    init(profile: SafeProfile, trips: [SavedTrip], items: [SafeItem]) {
      self.profile = profile
      self.trips = trips
      self.items = items
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      profile = try container.decodeIfPresent(SafeProfile.self, forKey: .profile) ?? SafeProfile()
      trips = try container.decodeIfPresent([SavedTrip].self, forKey: .trips) ?? []
      items = try container.decodeIfPresent([SafeItem].self, forKey: .items) ?? []
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(profile, forKey: .profile)
      try container.encode(trips, forKey: .trips)
      try container.encode(items, forKey: .items)
    }
  }

  private init() {
    cloud = UserDefaults.standard.bool(forKey: cloudKey)
    if let data = KeychainStore.string(forKey: profileKey)?.data(using: .utf8),
       let saved = try? JSONDecoder().decode(SafeDocument.self, from: data) {
      profile = saved.profile
      trips = saved.trips
      items = saved.items
      if items.isEmpty {
        items = Self.seeded(from: profile)
      }
    }
  }

  func reloadFromCloud() async {
    guard cloud else { return }
    guard let remote = try? await pull() else { return }
    profile = remote.profile
    trips = remote.trips
    items = remote.items.isEmpty ? Self.seeded(from: remote.profile) : remote.items
    writeLocal()
  }

  func setCloud(_ on: Bool) async {
    cloud = on
    UserDefaults.standard.set(on, forKey: cloudKey)
    if on {
      await save()
    } else {
      await forgetCloud()
      notice = ""
    }
  }

  func save() async {
    writeLocal()
    guard cloud else {
      notice = ""
      return
    }
    do {
      try await push()
      notice = ""
    } catch {
      notice = "cloud-failed"
    }
  }

  func rememberHome(_ city: String) {
    let trimmed = city.trimmingCharacters(in: .whitespacesAndNewlines)
    guard profile.homeCity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !trimmed.isEmpty else { return }
    profile.homeCity = trimmed
    if let index = items.firstIndex(where: { $0.slot == "home" }) {
      items[index].value = trimmed
    } else {
      items.insert(SafeItem(name: Self.defaultName("home", arabic: false), value: trimmed, hidden: false, slot: "home"), at: 0)
    }
    writeLocal()
  }

  func saveItem(id: String?, name: String, value: String) {
    let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, !body.isEmpty else { return }
    let matched = Self.slot(for: title)
    if let id, let index = items.firstIndex(where: { $0.id == id }) {
      let previous = items[index].slot
      if previous != matched { writeProfile(slot: previous, value: "") }
      items[index].name = title
      items[index].value = body
      items[index].slot = matched
      writeProfile(slot: matched, value: body)
    } else {
      items.insert(SafeItem(name: title, value: body, hidden: true, slot: matched), at: 0)
      writeProfile(slot: matched, value: body)
    }
    Task { await save() }
  }

  func deleteItem(_ id: String) {
    guard let index = items.firstIndex(where: { $0.id == id }) else { return }
    writeProfile(slot: items[index].slot, value: "")
    items.remove(at: index)
    Task { await save() }
  }

  func revealItem(_ id: String) {
    guard let index = items.firstIndex(where: { $0.id == id }) else { return }
    items[index].hidden.toggle()
    writeLocal()
  }

  func addTrip(_ trip: SavedTrip) {
    trips.insert(trip, at: 0)
    writeLocal()
    if cloud { Task { try? await push() } }
  }

  private func writeProfile(slot: String?, value: String) {
    switch slot {
    case "home": profile.homeCity = value
    case "name": profile.fullName = value
    case "phone": profile.phone = value
    case "email": profile.email = value
    case "passport": profile.passport = value
    case "travelers": profile.travelers = value
    case "airline": profile.airlineLogin = value
    case "airlinePassword": profile.airlinePassword = value
    case "payment": profile.paymentName = value
    default: break
    }
  }

  private static func seeded(from profile: SafeProfile) -> [SafeItem] {
    let rows: [(String, String, Bool)] = [
      ("home", profile.homeCity, false),
      ("name", profile.fullName, false),
      ("phone", profile.phone, false),
      ("email", profile.email, false),
      ("passport", profile.passport, true),
      ("travelers", profile.travelers, false),
      ("airline", profile.airlineLogin, true),
      ("airlinePassword", profile.airlinePassword, true),
      ("payment", profile.paymentName, false),
    ]
    return rows.compactMap { slot, value, hidden in
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return nil }
      return SafeItem(name: defaultName(slot, arabic: false), value: trimmed, hidden: hidden, slot: slot)
    }
  }

  static func defaultName(_ slot: String, arabic: Bool) -> String {
    switch slot {
    case "home": return arabic ? "أين تسكن" : "Where you live"
    case "name": return arabic ? "الاسم الكامل" : "Full name"
    case "phone": return arabic ? "الجوال" : "Phone"
    case "email": return arabic ? "البريد" : "Email"
    case "passport": return arabic ? "جواز السفر" : "Passport"
    case "travelers": return arabic ? "المسافرون عادة" : "Usual travelers"
    case "airline": return arabic ? "دخول شركة الطيران" : "Airline login"
    case "airlinePassword": return arabic ? "كلمة دخول الطيران" : "Airline password"
    case "payment": return arabic ? "اسم وسيلة الدفع" : "Payment name"
    default: return ""
    }
  }

  static func isDefaultName(_ name: String, slot: String) -> Bool {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed == defaultName(slot, arabic: false) || trimmed == defaultName(slot, arabic: true)
  }

  static func slot(for name: String) -> String? {
    let slots = ["home", "name", "phone", "email", "passport", "travelers", "airline", "airlinePassword", "payment"]
    return slots.first { isDefaultName(name, slot: $0) }
  }

  private func writeLocal() {
    guard let data = try? JSONEncoder().encode(document),
          let text = String(data: data, encoding: .utf8) else { return }
    KeychainStore.set(text, forKey: profileKey)
    _ = tripsKey
  }

  private func pull() async throws -> SafeDocument? {
    let items = try await ArrabAPIClient.shared.listMemories()
    guard let raw = items.first(where: { $0.content.hasPrefix(Self.marker) })?.content else { return nil }
    let json = raw.replacingOccurrences(of: Self.marker, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = json.data(using: .utf8) else { return nil }
    return try JSONDecoder().decode(SafeDocument.self, from: data)
  }

  private func push() async throws {
    let items = try await ArrabAPIClient.shared.listMemories()
    for item in items where item.content.hasPrefix(Self.marker) {
      await ArrabAPIClient.shared.deleteMemory(item.id)
    }
    let data = try JSONEncoder().encode(document)
    let json = String(data: data, encoding: .utf8) ?? "{}"
    try await ArrabAPIClient.shared.createMemory(content: "\(Self.marker)\n\(json)")
  }

  private func forgetCloud() async {
    guard let items = try? await ArrabAPIClient.shared.listMemories() else { return }
    for item in items where item.content.hasPrefix(Self.marker) {
      await ArrabAPIClient.shared.deleteMemory(item.id)
    }
  }
}

private enum SafeField: Hashable {
  case name, data
}

struct SafePane: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @ObservedObject private var store = SafeStore.shared
  @State private var composing = false
  @State private var editingID: String?
  @State private var draftName = ""
  @State private var draftValue = ""
  @State private var savedFlash = false
  @FocusState private var focused: SafeField?
  private var arabic: Bool { session.localeIsArabic }
  private var canSave: Bool {
    !draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !draftValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !savedFlash
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(L10n.t(.safeHint, arabic: arabic))
        .font(ArrabFont.system(size: 14))
        .foregroundStyle(theme.muted)
      Picker("", selection: Binding(
        get: { store.cloud },
        set: { on in Task { await store.setCloud(on) } }
      )) {
        Text(arabic ? "على هذا الآيفون" : "On this iPhone").tag(false)
        Text(arabic ? "في حساب عرّاب" : "In my Arrab account").tag(true)
      }
      .pickerStyle(.segmented)
      if store.notice == "cloud-failed" {
        Text(arabic ? "تعذّر الحفظ في الحساب. النسخة على هذا الآيفون محفوظة." : "Couldn't save to your account. The copy on this iPhone is kept.")
          .font(ArrabFont.system(size: 13))
          .foregroundStyle(theme.warn)
      }

      if composing {
        composer
      } else {
        addButton
      }

      ForEach(store.items) { item in
        itemRow(item)
      }

      if !store.trips.isEmpty {
        Text(arabic ? "الرحلات" : "Trips")
          .font(ArrabFont.system(size: 13, weight: .semibold))
          .foregroundStyle(theme.muted)
          .padding(.top, 6)
        ForEach(store.trips) { trip in
          ArrabCard(padding: 14) {
            VStack(alignment: .leading, spacing: 4) {
              Text("\(trip.from) → \(trip.to)")
                .font(ArrabFont.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
              Text(tripLine(trip))
                .font(ArrabFont.system(size: 12))
                .foregroundStyle(theme.muted)
            }
          }
        }
      }
    }
    .animation(.easeOut(duration: 0.2), value: composing)
    .task { await store.reloadFromCloud() }
  }

  private var addButton: some View {
    Button {
      editingID = nil
      draftName = ""
      draftValue = ""
      savedFlash = false
      composing = true
      focused = .name
    } label: {
      HStack(spacing: 12) {
        ZStack {
          Circle()
            .strokeBorder(theme.line, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
          Image(systemName: "plus")
            .font(ArrabFont.system(size: 18, weight: .semibold))
        }
        .frame(width: 44, height: 44)
        .foregroundStyle(theme.text)
        Text(L10n.t(.safeAdd, arabic: arabic))
          .font(ArrabFont.system(size: 16, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 4)
      .padding(.vertical, 4)
    }
    .buttonStyle(.plain)
  }

  private var composer: some View {
    ArrabCard(padding: 16) {
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          Text(editingID == nil ? L10n.t(.safeAdd, arabic: arabic) : L10n.t(.safeEdit, arabic: arabic))
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.text)
          Spacer()
          Button {
            closeComposer()
          } label: {
            Image(systemName: "xmark")
              .font(ArrabFont.system(size: 13, weight: .semibold))
              .foregroundStyle(theme.muted)
              .frame(width: 32, height: 32)
              .background(theme.subtle)
              .clipShape(Circle())
          }
          .buttonStyle(.plain)
        }
        entryField(.safeName, text: $draftName, field: .name)
        entryField(.safeData, text: $draftValue, field: .data)
        Text(arabic
          ? "لا يُحفظ رقم البطاقة."
          : "Card numbers are not stored.")
          .font(ArrabFont.system(size: 12))
          .foregroundStyle(theme.muted)
        Button {
          guard canSave else { return }
          store.saveItem(id: editingID, name: draftName, value: draftValue)
          savedFlash = true
          ArrabHaptics.success()
          focused = nil
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { closeComposer() }
        } label: {
          HStack(spacing: 8) {
            Image(systemName: savedFlash ? "checkmark" : "lock.fill")
              .font(ArrabFont.system(size: 16, weight: .semibold))
            Text(L10n.t(savedFlash ? .safeSaved : .safeSave, arabic: arabic))
              .font(ArrabFont.system(size: 17, weight: .semibold))
          }
          .foregroundStyle(canSave || savedFlash ? theme.onPrimary : theme.muted)
          .frame(maxWidth: .infinity)
          .frame(height: 54)
          .background(canSave || savedFlash ? theme.primary : theme.subtle)
          .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!canSave && !savedFlash)
      }
    }
    .onAppear {
      DispatchQueue.main.async {
        focused = editingID == nil ? .name : .data
      }
    }
  }

  private func entryField(_ title: L10n.Key, text: Binding<String>, field: SafeField) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(L10n.t(title, arabic: arabic))
        .font(ArrabFont.system(size: 12, weight: .semibold))
        .foregroundStyle(theme.muted)
      TextField(L10n.t(title, arabic: arabic), text: text, axis: field == .data ? .vertical : .horizontal)
        .lineLimit(field == .data ? 2...5 : 1...1)
        .font(ArrabFont.system(size: 16))
        .textFieldStyle(.plain)
        .focused($focused, equals: field)
        .submitLabel(field == .name ? .next : .done)
        .onSubmit {
          if field == .name {
            focused = .data
          } else if canSave {
            store.saveItem(id: editingID, name: draftName, value: draftValue)
            savedFlash = true
            ArrabHaptics.success()
            focused = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { closeComposer() }
          }
        }
        .padding(14)
        .background(theme.subtle)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .multilineTextAlignment(arabic ? .trailing : .leading)
    }
  }

  private func itemRow(_ item: SafeItem) -> some View {
    let title = displayName(item)
    return ArrabCard(padding: 14) {
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text(title)
            .font(ArrabFont.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.text)
            .lineLimit(1)
          Text(item.hidden ? "••••••••" : item.value)
            .font(ArrabFont.system(size: 14))
            .foregroundStyle(theme.muted)
            .lineLimit(2)
        }
        Spacer(minLength: 8)
        Button {
          store.revealItem(item.id)
        } label: {
          Image(systemName: item.hidden ? "eye" : "eye.slash")
            .font(ArrabFont.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.muted)
            .frame(width: 32, height: 32)
        }
        .buttonStyle(.plain)
      }
      .contentShape(Rectangle())
      .onTapGesture { beginEdit(item) }
    }
    .contextMenu {
      Button(L10n.t(.safeEdit, arabic: arabic)) { beginEdit(item) }
      Button(role: .destructive) {
        store.deleteItem(item.id)
      } label: {
        Text(L10n.t(.delete, arabic: arabic))
      }
    }
  }

  private func displayName(_ item: SafeItem) -> String {
    if let slot = item.slot, SafeStore.isDefaultName(item.name, slot: slot) {
      return SafeStore.defaultName(slot, arabic: arabic)
    }
    return item.name
  }

  private func beginEdit(_ item: SafeItem) {
    editingID = item.id
    draftName = displayName(item)
    draftValue = item.value
    savedFlash = false
    composing = true
    focused = .data
  }

  private func closeComposer() {
    composing = false
    editingID = nil
    draftName = ""
    draftValue = ""
    savedFlash = false
    focused = nil
  }

  private func tripLine(_ trip: SavedTrip) -> String {
    let way = trip.roundTrip ? (arabic ? "ذهاب وعودة" : "Round trip") : (arabic ? "ذهاب فقط" : "One way")
    let price = trip.price.isEmpty ? "" : " · \(trip.price)"
    let airline = trip.airline.isEmpty ? "" : " · \(trip.airline)"
    return "\(way) · \(trip.people) · \(trip.when)\(airline)\(price)"
  }
}

@MainActor
enum TripBooker {
  private struct City {
    var keys: [String]
    var code: String
    var en: String
    var ar: String
  }

  private struct Draft: Codable {
    var destination = ""
    var destinationCode = ""
    var origin = ""
    var originCode = ""
    var roundTrip: Bool?
    var people: Int?
    var depart = ""
    var ret = ""
    var step = "origin"
    var airline = ""
    var price = ""
  }

  private static let draftKey = "arrab.safe.trip"
  private static let cities: [City] = [
    City(keys: ["riyadh", "riyad", "الرياض"], code: "RUH", en: "Riyadh", ar: "الرياض"),
    City(keys: ["jeddah", "jedda", "jidda", "جدة", "جده"], code: "JED", en: "Jeddah", ar: "جدة"),
    City(keys: ["dammam", "الدمام"], code: "DMM", en: "Dammam", ar: "الدمام"),
    City(keys: ["medina", "madinah", "المدينة"], code: "MED", en: "Medina", ar: "المدينة"),
    City(keys: ["makkah", "mecca", "مكة", "مكه"], code: "JED", en: "Makkah", ar: "مكة"),
    City(keys: ["abha", "أبها", "ابها"], code: "AHB", en: "Abha", ar: "أبها"),
    City(keys: ["tabuk", "تبوك"], code: "TUU", en: "Tabuk", ar: "تبوك"),
    City(keys: ["taif", "الطائف"], code: "TIF", en: "Taif", ar: "الطائف"),
    City(keys: ["dubai", "دبي"], code: "DXB", en: "Dubai", ar: "دبي"),
    City(keys: ["cairo", "القاهرة", "القاهره"], code: "CAI", en: "Cairo", ar: "القاهرة"),
    City(keys: ["london", "لندن"], code: "LHR", en: "London", ar: "لندن"),
    City(keys: ["istanbul", "اسطنبول", "إسطنبول"], code: "IST", en: "Istanbul", ar: "إسطنبول"),
  ]

  static func wants(_ text: String) -> Bool {
    loadDraft() != nil || isBooking(text)
  }

  static func reply(_ text: String, history: [ChatLine], arabic: Bool) async -> String {
    let folded = digits(text)
    if !isBooking(folded), let done = finishIfApproved(folded, arabic: arabic) { return done }
    if !isBooking(folded), loadDraft()?.step == "approve" {
      return arabic ? "أكمّل الحجز؟ نعم أو لا." : "Should I proceed? Yes or no."
    }
    if isCancel(folded), loadDraft() != nil, !isBooking(folded) {
      clearDraft()
      return arabic ? "وقفت الحجز. ما تم شيء." : "Stopped. Nothing was booked."
    }
    var draft = loadDraft() ?? Draft()
    if isBooking(folded) || draft.destination.isEmpty {
      draft = Draft()
      applyBooking(folded, history: history, into: &draft, arabic: arabic)
    } else {
      applyAnswer(folded, into: &draft)
    }
    if draft.origin.isEmpty {
      let known = knownOrigin(history: history, arabic: arabic)
      draft.origin = known.name
      draft.originCode = known.code
      if !known.name.isEmpty { SafeStore.shared.rememberHome(known.name) }
    }
    let next = nextQuestion(draft, arabic: arabic)
    if let next {
      draft.step = next.step
      save(draft)
      return next.text
    }
    AgentLive.beginReply(companion: "Arrab", detail: arabic ? "يبحث عن رحلات" : "Searching flights")
    let offer = await search(draft, arabic: arabic)
    AgentLive.endReply(summary: offer.spoken)
    draft.step = "approve"
    draft.airline = offer.airline
    draft.price = offer.price
    save(draft)
    return offer.spoken
  }

  private static func applyAnswer(_ text: String, into draft: inout Draft) {
    switch draft.step {
    case "destination":
      if let city = city(in: text) {
        draft.destination = city.en
        draft.destinationCode = city.code
      }
    case "origin":
      if let city = city(in: text) {
        draft.origin = city.en
        draft.originCode = city.code
        SafeStore.shared.rememberHome(city.en)
      }
    case "kind":
      if let round = tripKind(text) { draft.roundTrip = round }
    case "people":
      if let count = people(text) { draft.people = count }
    case "depart":
      if let day = date(in: text, after: Date()) { draft.depart = iso(day) }
    case "return":
      let after = date(from: draft.depart) ?? Date()
      if let day = date(in: text, after: after) { draft.ret = iso(day) }
    case "approve":
      break
    default:
      break
    }
  }

  private static func applyBooking(_ text: String, history: [ChatLine], into draft: inout Draft, arabic: Bool) {
    if let city = destination(in: text) {
      draft.destination = arabic ? city.ar : city.en
      draft.destinationCode = city.code
    }
    if let from = originPhrase(in: text) {
      draft.origin = from.en
      draft.originCode = from.code
    }
    draft.roundTrip = tripKind(text)
    draft.people = people(text)
    if let day = date(in: text, after: Date()) { draft.depart = iso(day) }
  }

  private static func nextQuestion(_ draft: Draft, arabic: Bool) -> (step: String, text: String)? {
    let place = draft.destination.isEmpty ? (arabic ? "وجهتك" : "your destination") : draft.destination
    if draft.destination.isEmpty {
      return ("destination", arabic ? "إلى أي مدينة؟" : "Which city should I book?")
    }
    if draft.origin.isEmpty {
      return ("origin", arabic ? "من أي مدينة تطير؟" : "Which city are you flying from?")
    }
    if draft.roundTrip == nil {
      let from = arabic ? "من \(draft.origin)" : "from \(draft.origin)"
      return ("kind", arabic
        ? "رحلتك إلى \(place) \(from). ذهاب وعودة ولا ذهاب فقط؟"
        : "Your trip to \(place) is \(from). Round trip or one way?")
    }
    if draft.people == nil {
      return ("people", arabic ? "كم شخص؟" : "How many people?")
    }
    if draft.depart.isEmpty {
      return ("depart", arabic ? "متى الذهاب؟" : "When do you leave?")
    }
    if draft.roundTrip == true, draft.ret.isEmpty {
      return ("return", arabic ? "ومتى العودة؟" : "And when do you come back?")
    }
    if draft.step == "approve" {
      return nil
    }
    return nil
  }

  private static func search(_ draft: Draft, arabic: Bool) async -> (airline: String, price: String, spoken: String) {
    let query = [
      "cheap flights",
      draft.origin,
      "to",
      draft.destination,
      draft.depart,
      draft.ret,
      "SAR airline",
    ].filter { !$0.isEmpty }.joined(separator: " ")
    let found = await PhoneCompanionTools.searchWeb(query)
    let offer = cheapest(in: found)
    let way = draft.roundTrip == true
      ? (arabic ? "ذهاب وعودة" : "round trip")
      : (arabic ? "ذهاب فقط" : "one way")
    let people = draft.people ?? 1
    if let offer {
      let price = "\(offer.amount) SAR"
      let spoken = arabic
        ? "شفت في \(offer.airline) السعر \(offer.amount) ريال، \(way) لـ \(people) من \(draft.origin) إلى \(draft.destination). أكمل؟"
        : "I saw \(offer.airline) at \(offer.amount) SAR, \(way) for \(people) from \(draft.origin) to \(draft.destination). Should I proceed?"
      return (offer.airline, price, spoken)
    }
    let spoken = arabic
      ? "ما لقيت سعر مباشر الآن من \(draft.origin) إلى \(draft.destination). أفتح صفحة البحث وأكمّل؟"
      : "I couldn't read a live fare from \(draft.origin) to \(draft.destination). Should I open the search and continue?"
    return ("", "", spoken)
  }

  static func finishIfApproved(_ text: String, arabic: Bool) -> String? {
    guard let draft = loadDraft(), draft.step == "approve" else { return nil }
    let folded = digits(text)
    if isNo(folded) {
      clearDraft()
      return arabic ? "تمام، ما كملت الحجز." : "All right, I didn't continue the booking."
    }
    guard isYes(folded) else { return nil }
    let url = searchURL(draft)
    if let url { UIApplication.shared.open(url) }
    let profile = SafeStore.shared.profile
    SafeStore.shared.addTrip(SavedTrip(
      from: draft.origin,
      to: draft.destination,
      when: draft.ret.isEmpty ? draft.depart : "\(draft.depart) → \(draft.ret)",
      people: draft.people ?? 1,
      roundTrip: draft.roundTrip ?? true,
      airline: draft.airline,
      price: draft.price
    ))
    clearDraft()
    let pay = profile.paymentName.isEmpty
      ? (arabic ? "الدفع يتم في صفحة شركة الطيران." : "Payment happens on the airline page.")
      : (arabic ? "وسيلة الدفع المحفوظة: \(profile.paymentName). الدفع يتم في صفحة الشركة." : "Saved payment name: \(profile.paymentName). You pay on the airline page.")
    let login = profile.airlineLogin.isEmpty
      ? ""
      : (arabic ? " دخول الطيران محفوظ في الخزنة." : " Your airline login is in Safe.")
    let named = profile.fullName.isEmpty
      ? ""
      : (arabic ? " باسم \(profile.fullName)." : " under \(profile.fullName).")
    return arabic
      ? "فتحت الرحلة.\(named) \(pay)\(login) التفاصيل في المكتبة ← الخزنة."
      : "I opened the fare.\(named) \(pay)\(login) The trip is in Library → Safe."
  }

  private static func searchURL(_ draft: Draft) -> URL? {
    var query = "Flights from \(draft.origin) to \(draft.destination)"
    if !draft.depart.isEmpty { query += " on \(draft.depart)" }
    if draft.roundTrip == true, !draft.ret.isEmpty { query += " returning \(draft.ret)" }
    if draft.roundTrip == false { query += " one way" }
    var parts = URLComponents(string: "https://www.google.com/travel/flights")
    parts?.queryItems = [URLQueryItem(name: "q", value: query)]
    return parts?.url
  }

  private static func cheapest(in text: String) -> (airline: String, amount: Int)? {
    let airlines = [
      "Saudia", "Saudi Arabian", "flynas", "flyadeal", "Nile Air", "Emirates",
      "Qatar Airways", "Turkish", "الخطوط السعودية", "طيران ناس", "طيران أديل",
    ]
    var best: (airline: String, amount: Int)?
    for raw in text.components(separatedBy: .newlines) {
      let line = raw
      guard let amount = price(in: line) else { continue }
      let airline = airlines.first { line.localizedCaseInsensitiveContains($0) } ?? "the listed fare"
      if best == nil || amount < best!.amount { best = (airline, amount) }
    }
    if best == nil, let amount = price(in: text) {
      let airline = airlines.first { text.localizedCaseInsensitiveContains($0) } ?? "the listed fare"
      best = (airline, amount)
    }
    return best
  }

  private static func price(in text: String) -> Int? {
    guard let regex = try? NSRegularExpression(pattern: #"(?i)(\d{2,5})\s*(?:SAR|ر\.?\s*س|ريال)|(?:SAR|ريال)\s*(\d{2,5})"#) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    var lowest: Int?
    for match in regex.matches(in: text, options: [], range: range) {
      for index in 1..<match.numberOfRanges {
        let hit = match.range(at: index)
        guard hit.location != NSNotFound, let swift = Range(hit, in: text), let value = Int(text[swift]) else { continue }
        guard (40...20000).contains(value) else { continue }
        if lowest == nil || value < lowest! { lowest = value }
      }
    }
    return lowest
  }

  private static func knownOrigin(history: [ChatLine], arabic: Bool) -> (name: String, code: String) {
    let saved = SafeStore.shared.profile.homeCity.trimmingCharacters(in: .whitespacesAndNewlines)
    if let city = city(in: saved) {
      return (arabic ? city.ar : city.en, city.code)
    }
    if !saved.isEmpty { return (saved, "") }
    for line in history.reversed() where line.role == "user" {
      let text = line.text
      if text.range(of: #"(?i)i live in|i'm from|i am from|أسكن|اساكن|ساكن في|أسكن في"#, options: .regularExpression) != nil,
         let city = city(in: text) {
        return (arabic ? city.ar : city.en, city.code)
      }
    }
    return ("", "")
  }

  private static func isBooking(_ text: String) -> Bool {
    text.range(
      of: #"(?i)(book|reserve)\s+(me\s+)?(a\s+)?(trip|flight|ticket)|احجز|أبي رحلة|ابي رحلة|بغيت رحلة|ودي رحلة|رحلة إلى|رحلة الى"#,
      options: .regularExpression
    ) != nil
  }

  private static func destination(in text: String) -> City? {
    guard let regex = try? NSRegularExpression(pattern: #"(?i)(?:to|إلى|الى|رحلة)\s+([^\n,]+?)(?:\s+(?:from|من)\b|$)"#),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let swift = Range(match.range(at: 1), in: text) else { return nil }
    return city(in: String(text[swift]))
  }

  private static func originPhrase(in text: String) -> City? {
    guard let range = text.range(of: #"(?i)(?:from|من)\s+(\S+)"#, options: .regularExpression) else { return nil }
    return city(in: String(text[range]))
  }

  private static func city(in text: String) -> City? {
    let folded = text.lowercased()
    return cities.first { item in item.keys.contains { folded.contains($0) } }
  }

  private static func tripKind(_ text: String) -> Bool? {
    let folded = text.lowercased()
    if folded.range(of: #"one[\s-]?way|ذهاب فقط|ذهاب بس"#, options: .regularExpression) != nil { return false }
    if folded.range(of: #"round|return|two[\s-]?way|ذهاب وعودة|ذهاب واياب|رايح جاي"#, options: .regularExpression) != nil { return true }
    return nil
  }

  private static func people(_ text: String) -> Int? {
    let words: [(String, Int)] = [
      ("واحد", 1), ("شخص واحد", 1), ("one", 1), ("شخصين", 2), ("اثنين", 2), ("two", 2),
      ("ثلاثة", 3), ("ثلاث", 3), ("three", 3), ("أربعة", 4), ("اربعه", 4), ("four", 4),
      ("خمسة", 5), ("خمسه", 5), ("five", 5),
    ]
    let folded = text.lowercased()
    if let hit = words.first(where: { folded.contains($0.0) }) { return hit.1 }
    guard let regex = try? NSRegularExpression(pattern: #"(\d+)"#) else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    guard let match = regex.firstMatch(in: text, options: [], range: range),
          let swift = Range(match.range(at: 1), in: text),
          let count = Int(text[swift]),
          (1...9).contains(count) else { return nil }
    return count
  }

  private static func date(in text: String, after floor: Date) -> Date? {
    let folded = text.lowercased()
    let calendar = Calendar.current
    if folded.contains("tomorrow") || folded.contains("غدا") || folded.contains("بكرة") || folded.contains("بكره") {
      return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: Date()))
    }
    if folded.contains("next week") || folded.contains("بعد أسبوع") || folded.contains("بعد اسبوع") || folded.contains("الأسبوع الجاي") {
      return calendar.date(byAdding: .day, value: 7, to: Date())
    }
    if let regex = try? NSRegularExpression(pattern: #"(?i)(?:in|after|بعد)\s+(\d+)\s*(?:days|day|يوم|ايام|أيام)"#),
       let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
       let swift = Range(match.range(at: 1), in: text),
       let days = Int(text[swift]) {
      return calendar.date(byAdding: .day, value: days, to: floor)
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    for format in ["yyyy-MM-dd", "d MMM yyyy", "d MMMM", "MMM d"] {
      formatter.dateFormat = format
      if let parsed = formatter.date(from: folded) {
        var result = parsed
        if format == "d MMMM" || format == "MMM d" {
          var parts = calendar.dateComponents([.month, .day], from: parsed)
          parts.year = calendar.component(.year, from: Date())
          result = calendar.date(from: parts) ?? parsed
          if result < floor { parts.year = (parts.year ?? 2026) + 1; result = calendar.date(from: parts) ?? result }
        }
        if result >= calendar.startOfDay(for: floor) || calendar.isDate(result, inSameDayAs: floor) { return result }
      }
    }
    return nil
  }

  private static func date(from isoDay: String) -> Date? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.date(from: isoDay)
  }

  private static func iso(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  private static func isYes(_ text: String) -> Bool {
    text.range(of: #"(?i)^\s*(yes|yeah|yep|ok|okay|proceed|book it|continue|نعم|ايوه|أيوه|اي|تمام|موافق|كمل|كمّل|احجز)\s*\.?\s*$"#, options: .regularExpression) != nil
  }

  private static func isNo(_ text: String) -> Bool {
    text.range(of: #"(?i)^\s*(no|nope|stop|cancel|لا|لأ|وقف|الغي|ألغي)\s*\.?\s*$"#, options: .regularExpression) != nil
  }

  private static func isCancel(_ text: String) -> Bool {
    isNo(text)
  }

  private static func digits(_ raw: String) -> String {
    let map: [Character: Character] = [
      "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
      "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    ]
    return String(raw.map { map[$0] ?? $0 })
  }

  private static func loadDraft() -> Draft? {
    guard let data = UserDefaults.standard.data(forKey: draftKey) else { return nil }
    return try? JSONDecoder().decode(Draft.self, from: data)
  }

  private static func save(_ draft: Draft) {
    if let data = try? JSONEncoder().encode(draft) {
      UserDefaults.standard.set(data, forKey: draftKey)
    }
  }

  private static func clearDraft() {
    UserDefaults.standard.removeObject(forKey: draftKey)
  }
}
