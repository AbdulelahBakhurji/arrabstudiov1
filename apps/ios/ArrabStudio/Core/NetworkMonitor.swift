import Foundation
import Network
import Combine

/// Live reachability for offline banners and send gating.
@MainActor
final class NetworkMonitor: ObservableObject {
  static let shared = NetworkMonitor()

  @Published private(set) var isOnline = true
  @Published private(set) var isExpensive = false
  @Published private(set) var pathStatus: String = "online"

  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "studio.arrab.network")

  private init() {
    monitor.pathUpdateHandler = { [weak self] path in
      Task { @MainActor in
        guard let self else { return }
        self.isOnline = path.status == .satisfied
        self.isExpensive = path.isExpensive || path.isConstrained
        self.pathStatus = path.status == .satisfied
          ? (path.isExpensive ? "cellular" : "online")
          : "offline"
      }
    }
    monitor.start(queue: queue)
  }
}
