import SwiftUI

struct BrainHomeView: View {
  @Environment(\.adaptive) private var adaptive
  @State private var filter: BrainNode.Kind? = nil
  @State private var selected: BrainNode?
  @State private var nodes: [BrainNode] = BrainDemo.nodes
  @State private var links: [BrainLink] = BrainDemo.links
  @State private var autoLayout = true

  private var visible: [BrainNode] {
    guard let filter else { return nodes }
    return nodes.filter { $0.kind == filter }
  }

  private var stats: [(String, Int)] {
    [
      ("Projects", nodes.filter { $0.kind == .project }.count),
      ("Sessions", nodes.filter { $0.kind == .session }.count),
      ("Decisions", nodes.filter { $0.kind == .decision }.count),
      ("Files", nodes.filter { $0.kind == .file }.count),
      ("People", nodes.filter { $0.kind == .person }.count),
    ]
  }

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          header
          statsRow
          filters
          map
        }
        .padding(adaptive.gutter)
        .frame(maxWidth: adaptive.contentMaxWidth)
        .frame(maxWidth: .infinity)
      }
    }
    .background(ArrabTheme.bg)
    .sheet(item: $selected) { node in
      BrainNodeSheet(node: node, total: nodes.count)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("SOLO / BRAIN")
        .font(.system(size: 10, weight: .bold))
        .tracking(1.2)
        .foregroundStyle(ArrabTheme.muted)
      Text("Brain")
        .font(.system(size: adaptive.titleSize, weight: .semibold))
        .foregroundStyle(ArrabTheme.text)
      Text("Sessions land on a connected map — decisions, files, growth without re-briefing.")
        .font(.system(size: 13))
        .foregroundStyle(ArrabTheme.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var statsRow: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(stats, id: \.0) { item in
          VStack(alignment: .leading, spacing: 2) {
            Text(item.0.uppercased())
              .font(.system(size: 9, weight: .bold))
              .foregroundStyle(ArrabTheme.muted)
            Text("\(item.1)")
              .font(.system(size: 18, weight: .semibold))
              .foregroundStyle(ArrabTheme.text)
          }
          .padding(.horizontal, 12)
          .padding(.vertical, 10)
          .background(ArrabTheme.card)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(ArrabTheme.line, lineWidth: 1)
          )
        }
      }
    }
  }

  private var filters: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ArrabChip(title: "All", selected: filter == nil) { filter = nil }
        ForEach(BrainNode.Kind.allCases, id: \.self) { kind in
          ArrabChip(title: kind.rawValue.capitalized, selected: filter == kind) {
            filter = kind
          }
        }
        Spacer(minLength: 8)
        Toggle(isOn: $autoLayout) {
          Text("Auto")
            .font(.system(size: 11, weight: .medium))
        }
        .toggleStyle(.switch)
        .labelsHidden()
        Text("Auto-layout")
          .font(.system(size: 11))
          .foregroundStyle(ArrabTheme.muted)
      }
    }
  }

  private var map: some View {
    BrainMapCanvas(nodes: visible, links: links, autoLayout: autoLayout) { node in
      selected = node
    }
    .frame(height: adaptive.brainMapMinHeight)
    .background(Color(red: 0.07, green: 0.07, blue: 0.086))
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .stroke(ArrabTheme.line, lineWidth: 1)
    )
  }
}

struct BrainMapCanvas: View {
  let nodes: [BrainNode]
  let links: [BrainLink]
  let autoLayout: Bool
  var onSelect: (BrainNode) -> Void

  @State private var scale: CGFloat = 1
  @State private var offset: CGSize = .zero

  var body: some View {
    GeometryReader { geo in
      let laidOut = autoLayout ? Self.layout(nodes, in: geo.size) : nodes
      ZStack {
        ForEach(links) { link in
          if let a = laidOut.first(where: { $0.id == link.from }),
             let b = laidOut.first(where: { $0.id == link.to }) {
            Path { path in
              path.move(to: CGPoint(x: a.x, y: a.y))
              path.addLine(to: CGPoint(x: b.x, y: b.y))
            }
            .stroke(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .foregroundStyle(Color.white.opacity(0.18))
          }
        }
        ForEach(laidOut) { node in
          Button {
            onSelect(node)
          } label: {
            VStack(spacing: 4) {
              Circle()
                .fill(color(for: node.kind))
                .frame(width: 14, height: 14)
                .shadow(color: color(for: node.kind).opacity(0.55), radius: 6)
              Text(node.title)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(ArrabTheme.text)
                .lineLimit(1)
                .frame(maxWidth: 72)
            }
          }
          .buttonStyle(.plain)
          .position(x: node.x, y: node.y)
        }
      }
      .scaleEffect(scale)
      .offset(offset)
      .gesture(
        SimultaneousGesture(
          MagnificationGesture().onChanged { scale = max(0.6, min(2.4, $0)) },
          DragGesture().onChanged { offset = $0.translation }
        )
      )
    }
  }

  private func color(for kind: BrainNode.Kind) -> Color {
    switch kind {
    case .project: return ArrabTheme.nodeProject
    case .session: return ArrabTheme.nodeSession
    case .decision: return ArrabTheme.nodeDecision
    case .file: return ArrabTheme.nodeFile
    case .person: return ArrabTheme.nodePerson
    }
  }

  static func layout(_ nodes: [BrainNode], in size: CGSize) -> [BrainNode] {
    let cx = size.width / 2
    let cy = size.height / 2
    let r = min(size.width, size.height) * 0.34
    return nodes.enumerated().map { index, node in
      let angle = (Double(index) / Double(max(nodes.count, 1))) * .pi * 2
      var copy = node
      copy.x = cx + CGFloat(cos(angle)) * r
      copy.y = cy + CGFloat(sin(angle)) * r
      return copy
    }
  }
}

struct BrainNodeSheet: View {
  let node: BrainNode
  let total: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("NODE")
          .font(.system(size: 11, weight: .bold))
          .foregroundStyle(ArrabTheme.muted)
        Spacer()
        Text("\(total) nodes")
          .font(.system(size: 11))
          .foregroundStyle(ArrabTheme.muted)
      }
      Text(node.kind.rawValue.uppercased())
        .font(.system(size: 10, weight: .bold))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(ArrabTheme.subtle)
        .clipShape(Capsule())
        .foregroundStyle(ArrabTheme.text)
      Text(node.title)
        .font(.system(size: 20, weight: .semibold))
        .foregroundStyle(ArrabTheme.text)
      Text(node.summary)
        .font(.system(size: 14))
        .foregroundStyle(ArrabTheme.muted)
      Spacer()
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(ArrabTheme.bg)
  }
}

enum BrainDemo {
  static let nodes: [BrainNode] = [
    .init(id: "1", title: "Arrab Assistant", kind: .person, summary: "Main companion", x: 0, y: 0),
    .init(id: "2", title: "UI Designer", kind: .person, summary: "Web & phone UI", x: 0, y: 0),
    .init(id: "3", title: "New chat", kind: .session, summary: "Recent session", x: 0, y: 0),
    .init(id: "4", title: "speed-test", kind: .project, summary: "Project cluster", x: 0, y: 0),
    .init(id: "5", title: "Brand voice", kind: .decision, summary: "Tone principles", x: 0, y: 0),
    .init(id: "6", title: "report.pdf", kind: .file, summary: "Generated deliverable", x: 0, y: 0),
    .init(id: "7", title: "Coder", kind: .person, summary: "Implementation", x: 0, y: 0),
    .init(id: "8", title: "can you arrange…", kind: .session, summary: "Desk arrange ask", x: 0, y: 0),
  ]

  static let links: [BrainLink] = [
    .init(id: "l1", from: "1", to: "3"),
    .init(id: "l2", from: "1", to: "4"),
    .init(id: "l3", from: "2", to: "4"),
    .init(id: "l4", from: "3", to: "5"),
    .init(id: "l5", from: "4", to: "6"),
    .init(id: "l6", from: "7", to: "8"),
    .init(id: "l7", from: "1", to: "7"),
  ]
}
