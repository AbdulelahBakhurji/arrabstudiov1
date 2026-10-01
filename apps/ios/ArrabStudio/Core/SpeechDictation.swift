import AVFoundation
import Speech
import SwiftUI

/// Listens once, then writes the spoken words into a text field. Does not send.
@MainActor
final class SpeechDictation: ObservableObject {
  @Published var listening = false
  @Published var notice: String?

  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var base = ""
  private var write: ((String) -> Void)?
  private var stopping = false
  private var tapped = false
  private var startID = UUID()
  private var heard = false

  func toggle(arabic: Bool, current: String, write: @escaping (String) -> Void) {
    if listening {
      stop()
      return
    }
    notice = nil
    base = current
    self.write = write
    let id = UUID()
    startID = id
    let locale = Locale(identifier: arabic ? "ar-SA" : "en-US")
    guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
      notice = arabic ? "التعرف على الكلام غير متاح الآن" : "Speech recognition is unavailable right now"
      return
    }
    SFSpeechRecognizer.requestAuthorization { status in
      Task { @MainActor in
        guard self.startID == id else { return }
        guard status == .authorized else {
          self.notice = arabic ? "اسمح بالتعرف على الكلام من الإعدادات" : "Allow speech recognition in Settings"
          return
        }
        AVAudioApplication.requestRecordPermission { allowed in
          Task { @MainActor in
            guard self.startID == id else { return }
            guard allowed else {
              self.notice = arabic ? "اسمح بالميكروفون من الإعدادات" : "Allow the microphone in Settings"
              return
            }
            self.begin(recognizer: recognizer, arabic: arabic)
          }
        }
      }
    }
  }

  func stop() {
    startID = UUID()
    releaseAudio()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func releaseAudio() {
    stopping = true
    listening = false
    request?.endAudio()
    if tapped {
      engine.inputNode.removeTap(onBus: 0)
      tapped = false
    }
    if engine.isRunning { engine.stop() }
    task?.cancel()
    task = nil
    request = nil
  }

  private func begin(recognizer: SFSpeechRecognizer, arabic: Bool) {
    releaseAudio()
    stopping = false
    heard = false
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: .duckOthers)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
      let request = SFSpeechAudioBufferRecognitionRequest()
      request.shouldReportPartialResults = true
      request.taskHint = .dictation
      request.addsPunctuation = true
      self.request = request
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0 else {
        notice = arabic ? "الميكروفون غير جاهز" : "The microphone is not ready"
        return
      }
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
      }
      tapped = true
      engine.prepare()
      try engine.start()
      listening = true
      task = recognizer.recognitionTask(with: request) { [weak self] result, error in
        let spoken = result?.bestTranscription.formattedString
        let finished = result?.isFinal ?? false
        Task { @MainActor in
          guard let self else { return }
          if let spoken, !spoken.isEmpty {
            self.heard = true
            self.apply(spoken)
          }
          if finished || (error != nil && !self.stopping) {
            let missed = !self.heard
            self.stop()
            if missed && error != nil {
              self.notice = arabic ? "لم أسمع كلامًا واضحًا" : "I didn't catch clear speech"
            }
          }
        }
      }
    } catch {
      stop()
      notice = arabic ? "تعذر تشغيل الميكروفون" : "The microphone could not start"
    }
  }

  private func apply(_ spoken: String) {
    let prefix = base.trimmingCharacters(in: .whitespacesAndNewlines)
    let next = prefix.isEmpty ? spoken : prefix + " " + spoken
    write?(next)
  }
}
