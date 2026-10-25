import Foundation
import AVFoundation
import Observation

/// Streams the headset microphone to Destina's `/api/audio` bridge, which
/// forwards it to Deepgram and stores only the final transcript text.
///
/// The wire contract is the server's: a one-use ticket in the first text
/// frame, then binary `linear16` PCM at 16 kHz mono, the same format the Tina
/// adapter sends. The server replies `ready` before any audio is accepted.
///
/// Recording needs everyone's agreement, so nothing here starts without the
/// Game Master confirming consent. Never log the ticket or the URL.
@MainActor @Observable
final class LiveAudioCapture {
    enum State: Equatable {
        case idle
        case starting
        case listening
        case failed(String)
    }

    private(set) var state: State = .idle
    /// Rises while audio is flowing, so the panel can show that the
    /// microphone is actually picking something up rather than just connected.
    private(set) var level: Float = 0

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var networking: URLSession?
    @ObservationIgnored private var streamer: PCMStreamer?
    @ObservationIgnored private var runID = UUID()

    var isActive: Bool { state == .listening || state == .starting }

    /// 16 kHz mono signed 16-bit little endian, as the server's `linear16`
    /// ticket format declares to Deepgram.
    private static let wireFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true
    )

    // MARK: - Lifecycle

    func start(ticket: AudioTicket, base: URL) async {
        guard !isActive else { return }
        runID = UUID()
        let id = runID
        state = .starting

        guard await requestPermission() else {
            state = .failed("Microphone access was denied. Allow it in Settings, then try again.")
            return
        }
        guard id == runID else { return }

        guard let url = DestinaConfiguration.audioURL(base: base, path: ticket.path) else {
            state = .failed("The server address is not valid for audio.")
            return
        }

        let settings = URLSessionConfiguration.ephemeral
        settings.httpCookieStorage = nil
        settings.urlCache = nil
        let session = URLSession(configuration: settings)
        networking = session
        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()

        // The first frame must be the ticket. The server closes the socket if
        // it does not arrive within five seconds.
        do {
            try await task.send(.string(#"{"type":"auth","token":"\#(ticket.token)"}"#))
        } catch {
            finish(with: "Could not reach the transcription service.", id: id)
            return
        }
        listen(on: task, id: id)
    }

    func stop(reason: String? = nil) {
        runID = UUID()
        streamer?.invalidate()
        streamer = nil
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        engine = nil
        if let socket {
            // Tell the server before closing so it reports a clean pause
            // rather than a dropped connection.
            socket.send(.string(#"{"type":"stop"}"#)) { _ in
                socket.cancel(with: .normalClosure, reason: nil)
            }
        }
        socket = nil
        networking?.invalidateAndCancel()
        networking = nil
        level = 0
        deactivateSession()
        state = reason.map { .failed($0) } ?? .idle
    }

    private func finish(with message: String, id: UUID) {
        guard id == runID else { return }
        stop(reason: message)
    }

    // MARK: - Server messages

    private func listen(on task: URLSessionWebSocketTask, id: UUID) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, id == self.runID else { return }
                switch result {
                case .failure:
                    self.finish(with: "Listening stopped. The connection closed.", id: id)
                case .success(let message):
                    guard case .string(let text) = message else {
                        self.listen(on: task, id: id)
                        return
                    }
                    self.handle(text, task: task, id: id)
                    self.listen(on: task, id: id)
                }
            }
        }
    }

    private func handle(_ text: String, task: URLSessionWebSocketTask, id: UUID) {
        struct Message: Decodable { let type: String; let message: String? }
        guard let decoded = try? JSONDecoder().decode(Message.self, from: Data(text.utf8)) else { return }
        switch decoded.type {
        case "ready":
            guard state == .starting else { return }
            do {
                try beginCapture(task: task, id: id)
                state = .listening
                print("[audio] listening")
            } catch {
                finish(with: "The microphone could not be started.", id: id)
            }
        case "error":
            finish(with: decoded.message ?? "Listening stopped.", id: id)
        default:
            break // transcript.updated: the feed poll already picks it up.
        }
    }

    // MARK: - Capture

    private func beginCapture(task: URLSessionWebSocketTask, id: UUID) throws {
        guard let wireFormat = Self.wireFormat else {
            throw CaptureError.unsupported
        }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .spokenAudio, options: [.allowBluetooth])
        try session.setActive(true)

        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0,
              let converter = AVAudioConverter(from: inputFormat, to: wireFormat) else {
            throw CaptureError.unsupported
        }

        let streamer = PCMStreamer(task: task) { [weak self] message in
            Task { @MainActor in self?.finish(with: message, id: id) }
        } onLevel: { [weak self] value in
            Task { @MainActor in
                guard let self, id == self.runID else { return }
                self.level = value
            }
        }
        self.streamer = streamer

        // The tap runs on a realtime audio thread, so it converts and hands
        // the bytes to the streamer without touching main-actor state.
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
            guard let data = Self.convert(buffer, using: converter, to: wireFormat) else { return }
            streamer.send(data)
        }
        engine.prepare()
        try engine.start()
    }

    private enum CaptureError: Error { case unsupported }

    /// Resamples one tap buffer into the wire format. Returns nil rather than
    /// sending anything the converter could not produce cleanly.
    private nonisolated static func convert(_ buffer: AVAudioPCMBuffer,
                                            using converter: AVAudioConverter,
                                            to format: AVAudioFormat) -> Data? {
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard capacity > 0,
              let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status == .haveData || status == .inputRanDry,
              conversionError == nil,
              output.frameLength > 0,
              let channel = output.int16ChannelData else { return nil }
        return Data(bytes: channel[0], count: Int(output.frameLength) * MemoryLayout<Int16>.size)
    }

    private func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}

/// Writes PCM to the socket from the audio thread, one frame at a time.
///
/// `URLSessionWebSocketTask` exposes no buffered-byte count, so backpressure
/// is tracked by counting frames that have been handed over but not yet
/// acknowledged. A microphone that outruns the uplink stops listening rather
/// than queueing minutes of stale audio.
private final class PCMStreamer: @unchecked Sendable {
    private let task: URLSessionWebSocketTask
    private let onFailure: (String) -> Void
    private let onLevel: (Float) -> Void
    private let lock = NSLock()
    private var inFlight = 0
    private var cancelled = false
    private var sinceLevel = 0
    private static let maximumInFlight = 24 // roughly two seconds of audio

    init(task: URLSessionWebSocketTask,
         onFailure: @escaping (String) -> Void,
         onLevel: @escaping (Float) -> Void) {
        self.task = task
        self.onFailure = onFailure
        self.onLevel = onLevel
    }

    func invalidate() {
        lock.lock(); cancelled = true; lock.unlock()
    }

    func send(_ data: Data) {
        lock.lock()
        if cancelled { lock.unlock(); return }
        if inFlight >= Self.maximumInFlight {
            cancelled = true
            lock.unlock()
            onFailure("The audio connection is too slow. Listening stopped.")
            return
        }
        inFlight += 1
        sinceLevel += 1
        let reportLevel = sinceLevel >= 5
        if reportLevel { sinceLevel = 0 }
        lock.unlock()

        if reportLevel { onLevel(Self.amplitude(of: data)) }
        task.send(.data(data)) { [weak self] error in
            guard let self else { return }
            self.lock.lock()
            self.inFlight -= 1
            let stopped = self.cancelled
            self.lock.unlock()
            if error != nil, !stopped {
                self.invalidate()
                self.onFailure("Listening stopped. The audio connection failed.")
            }
        }
    }

    /// Peak amplitude, 0...1, for the panel's activity meter.
    private static func amplitude(of data: Data) -> Float {
        data.withUnsafeBytes { raw -> Float in
            let samples = raw.bindMemory(to: Int16.self)
            guard !samples.isEmpty else { return 0 }
            var peak: Int32 = 0
            for sample in samples { peak = max(peak, Int32(sample.magnitude)) }
            return min(1, Float(peak) / Float(Int16.max))
        }
    }
}
