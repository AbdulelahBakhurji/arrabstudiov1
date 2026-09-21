import SwiftUI

struct AuthView: View {
  @EnvironmentObject private var session: AppSession
  @EnvironmentObject private var link: PCLinkStore

  @State private var mode: Mode = .signIn
  @State private var email = ""
  @State private var password = ""
  @State private var name = ""
  @State private var showLink = false

  enum Mode { case signIn, create }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 8) {
          Text("ARRAB")
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .tracking(3)
            .foregroundStyle(Color.white.opacity(0.55))
          Text(mode == .signIn ? "Welcome back" : "Create your studio")
            .font(.system(size: 26, weight: .semibold))
            .foregroundStyle(Color.white)
          Text("Same account as desktop — chat, Studio, and Brain on your phone.")
            .font(.system(size: 14))
            .foregroundStyle(Color.white.opacity(0.55))
            .fixedSize(horizontal: false, vertical: true)
        }

        Picker("", selection: $mode) {
          Text("Sign in").tag(Mode.signIn)
          Text("Create").tag(Mode.create)
        }
        .pickerStyle(.segmented)

        VStack(spacing: 12) {
          if mode == .create {
            TextField("Display name", text: $name)
              .textFieldStyle(ArrabFieldStyle())
          }
          TextField("Email", text: $email)
            .textFieldStyle(ArrabFieldStyle())
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
          SecureField("Password", text: $password)
            .textFieldStyle(ArrabFieldStyle())
        }
        .padding(14)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

        if let error = session.error {
          Text(error)
            .font(.system(size: 13))
            .foregroundStyle(Color.red.opacity(0.9))
        }

        Button {
          Task {
            if mode == .signIn {
              await session.signIn(email: email, password: password)
            } else {
              await session.createAccount(email: email, password: password, name: name)
            }
          }
        } label: {
          HStack {
            if session.isBusy { ProgressView().tint(.black) }
            Text(mode == .signIn ? "Sign in" : "Create account")
              .font(.system(size: 15, weight: .semibold))
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
          .foregroundStyle(Color.black.opacity(0.88))
          .background(Color.white)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .disabled(session.isBusy || email.isEmpty || password.isEmpty)

        Button {
          showLink = true
        } label: {
          Label(
            link.isLinked ? "PC linked" : "Link to Mac / PC",
            systemImage: "laptopcomputer.and.iphone"
          )
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(Color.white)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
          .background(Color.white.opacity(0.08))
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
      }
      .padding(20)
      .frame(maxWidth: 520)
      .frame(maxWidth: .infinity)
    }
    .sheet(isPresented: $showLink) {
      LinkPCView()
        .environmentObject(link)
        .environmentObject(session)
        .presentationDetents([.medium, .large])
    }
  }
}

struct ArrabFieldStyle: TextFieldStyle {
  func _body(configuration: TextField<_Label>) -> some View {
    configuration
      .padding(12)
      .background(Color.black.opacity(0.35))
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(Color.white.opacity(0.12), lineWidth: 1)
      )
      .foregroundStyle(Color.white)
  }
}
