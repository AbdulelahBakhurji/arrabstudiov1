import SwiftUI
import UIKit

struct ActivityHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var items: [RemoteActivity] = []
  @State private var failed = false

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text(L10n.t(.activity, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        if items.isEmpty {
          ArrabCard {
            Text(failed ? (arabic ? "تعذر تحميل النشاط." : "Activity could not be loaded.") : L10n.t(.activityEmpty, arabic: arabic))
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.muted)
          }
        } else {
          ForEach(items) { item in
            ArrabCard(padding: 14) {
              VStack(alignment: .leading, spacing: 6) {
                Text(item.summary)
                  .font(ArrabFont.system(size: 15, weight: .medium))
                  .foregroundStyle(theme.text)
                Text(item.verb)
                  .font(ArrabFont.system(size: 12, weight: .semibold))
                  .foregroundStyle(theme.muted)
              }
            }
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      items = try await ArrabAPIClient.shared.activity()
      failed = false
    } catch {
      failed = items.isEmpty
    }
  }
}

struct WorkforceHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var people: [WorkforceSnapshot.Person] = []
  @State private var departments: [WorkforceSnapshot.Department] = []
  @State private var failed = false

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text(L10n.t(.workforce, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        if !departments.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
              ForEach(departments) { dept in
                Text(dept.name)
                  .font(ArrabFont.system(size: 13, weight: .semibold))
                  .foregroundStyle(theme.text)
                  .padding(.horizontal, 12)
                  .padding(.vertical, 8)
                  .background(theme.card)
                  .clipShape(Capsule())
                  .overlay(Capsule().stroke(theme.line, lineWidth: 1))
              }
            }
          }
        }
        if people.isEmpty {
          ArrabCard {
            Text(failed ? (arabic ? "تعذر تحميل الفريق." : "Workforce could not be loaded.") : L10n.t(.workforceEmpty, arabic: arabic))
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.muted)
          }
        } else {
          ForEach(people) { person in
            ArrabCard(padding: 14) {
              HStack(spacing: 12) {
                Text(String(person.displayName.prefix(1)))
                  .font(ArrabFont.system(size: 16, weight: .semibold))
                  .foregroundStyle(theme.onPrimary)
                  .frame(width: 40, height: 40)
                  .background(theme.primary)
                  .clipShape(Circle())
                VStack(alignment: .leading, spacing: 2) {
                  Text(person.displayName)
                    .font(ArrabFont.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.text)
                  Text(person.title ?? person.role)
                    .font(ArrabFont.system(size: 12))
                    .foregroundStyle(theme.muted)
                }
                Spacer()
                Text(person.status == "active" ? (arabic ? "نشط" : "Active") : person.status)
                  .font(ArrabFont.system(size: 12, weight: .semibold))
                  .foregroundStyle(theme.muted)
              }
            }
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      let snap = try await ArrabAPIClient.shared.workforce()
      people = snap.employees
      departments = snap.departments
      failed = false
    } catch {
      failed = people.isEmpty
    }
  }
}

struct WorkplaceHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var projects: [RemoteProject] = []
  @State private var failed = false

  private var arabic: Bool { session.localeIsArabic }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text(L10n.t(.workplace, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        if projects.isEmpty {
          ArrabCard {
            Text(failed ? (arabic ? "تعذر تحميل المشاريع." : "Projects could not be loaded.") : L10n.t(.workplaceEmpty, arabic: arabic))
              .font(ArrabFont.system(size: 14))
              .foregroundStyle(theme.muted)
          }
        } else {
          ForEach(projects) { project in
            ArrabCard {
              VStack(alignment: .leading, spacing: 6) {
                Text(project.name)
                  .font(ArrabFont.system(size: 16, weight: .semibold))
                  .foregroundStyle(theme.text)
                if let description = project.description, !description.isEmpty {
                  Text(description)
                    .font(ArrabFont.system(size: 13))
                    .foregroundStyle(theme.muted)
                }
                Text(project.status)
                  .font(ArrabFont.system(size: 12, weight: .semibold))
                  .foregroundStyle(theme.lavender)
              }
            }
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      projects = try await ArrabAPIClient.shared.projects()
      failed = false
    } catch {
      failed = projects.isEmpty
    }
  }
}

struct LibraryHomeView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.arrab) private var theme
  @Environment(\.adaptive) private var adaptive
  @State private var files: [URL] = []
  @State private var tab = 0

  private var arabic: Bool { session.localeIsArabic }
  private var photos: [URL] { files.filter(Self.isImage) }
  private var documents: [URL] { files.filter { !Self.isImage($0) } }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        Text(L10n.t(.library, arabic: arabic))
          .font(ArrabFont.system(size: adaptive.titleSize, weight: .semibold))
          .foregroundStyle(theme.text)
        Picker("", selection: $tab) {
          Text(L10n.t(.libraryFiles, arabic: arabic)).tag(0)
          Text(L10n.t(.safeTab, arabic: arabic)).tag(1)
        }
        .pickerStyle(.segmented)
        if tab == 1 {
          SafePane()
        } else {
          if files.isEmpty {
            ArrabCard {
              Text(L10n.t(.libraryEmpty, arabic: arabic))
                .font(ArrabFont.system(size: 14))
                .foregroundStyle(theme.muted)
            }
          }
          if !photos.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 10)], spacing: 10) {
              ForEach(photos, id: \.path) { url in
                ShareLink(item: url) {
                  photoTile(url)
                }
              }
            }
          }
          ForEach(documents, id: \.path) { url in
            ShareLink(item: url) {
              ArrabCard(padding: 14) {
                HStack(spacing: 12) {
                  Image(systemName: "doc")
                    .font(ArrabFont.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.lavender)
                  VStack(alignment: .leading, spacing: 4) {
                    Text(url.lastPathComponent)
                      .font(ArrabFont.system(size: 15, weight: .semibold))
                      .foregroundStyle(theme.text)
                      .lineLimit(1)
                    Text(L10n.t(.shareAction, arabic: arabic))
                      .font(ArrabFont.system(size: 12))
                      .foregroundStyle(theme.muted)
                  }
                  Spacer()
                }
              }
            }
          }
        }
      }
      .padding(adaptive.gutter)
      .frame(maxWidth: adaptive.contentMaxWidth)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .onAppear { files = PhoneCompanionTools.savedFiles() }
    .refreshable { files = PhoneCompanionTools.savedFiles() }
  }

  private func photoTile(_ url: URL) -> some View {
    ZStack {
      if let data = try? Data(contentsOf: url), let image = UIImage(data: data) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        theme.subtle
        Image(systemName: "photo")
          .foregroundStyle(theme.muted)
      }
    }
    .frame(height: 108)
    .frame(maxWidth: .infinity)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(theme.line, lineWidth: 1)
    )
  }

  private static func isImage(_ url: URL) -> Bool {
    ["png", "jpg", "jpeg", "heic", "gif", "webp"].contains(url.pathExtension.lowercased())
  }
}
