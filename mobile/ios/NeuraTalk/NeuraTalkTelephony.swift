import Foundation
import CallKit
import AVFoundation

/**
 * NeuraTalk Telephony Native Module for iOS
 *
 * Provides SIM-to-SIM call bridging using iOS CallKit.
 * Handles incoming call notifications via VoIP push, outgoing call setup, and audio routing.
 *
 * Architecture notes per replit.md:
 * - Self-hosted infrastructure only (no Twilio/Vonage)
 * - Acts as communication enhancement layer, not telecom carrier
 * - Respects iOS CallKit sandbox
 */
@objc(NeuraTalkTelephony)
class NeuraTalkTelephony: RCTEventEmitter {
    
    private let callController = CXCallController()
    private var provider: CXProvider?
    private var activeCalls: [UUID: CallInfo] = [:]
    private var audioSession = AVAudioSession.sharedInstance()
    
    // MARK: - Initialization
    
    override init() {
        super.init()
        setupCallProvider()
    }
    
    private func setupCallProvider() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallsPerCallGroup = 1
        configuration.maximumCallGroups = 1
        configuration.supportedHandleTypes = [.phoneNumber]
        configuration.iconTemplateImageData = nil
        
        provider = CXProvider(configuration: configuration)
        provider?.setDelegate(self, queue: nil)
    }
    
    // MARK: - React Native Module Setup
    
    override static func moduleName() -> String! {
        return "NeuraTalkTelephony"
    }
    
    override static func requiresMainQueueSetup() -> Bool {
        return true
    }
    
    override func supportedEvents() -> [String]! {
        return [
            "onIncomingCall",
            "onCallConnected",
            "onCallEnded",
            "onCallFailed",
            "onAudioRouteChanged"
        ]
    }
    
    // MARK: - React Native Methods
    
    @objc
    func initialize(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        resolve([
            "initialized": true,
            "callKitAvailable": true
        ])
    }
    
    @objc
    func reportIncomingCall(_ callId: String, callerName: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let uuid = UUID(uuidString: callId) ?? UUID(uuidString: callId.replacingOccurrences(of: "call_", with: "")) else {
            let uuid = UUID()
            handleIncomingCall(uuid: uuid, callerName: callerName, originalCallId: callId, resolve: resolve, reject: reject)
            return
        }
        
        handleIncomingCall(uuid: uuid, callerName: callerName, originalCallId: callId, resolve: resolve, reject: reject)
    }
    
    private func handleIncomingCall(uuid: UUID, callerName: String, originalCallId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = callerName
        update.hasVideo = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        
        // Store call info
        activeCalls[uuid] = CallInfo(callId: originalCallId, callerName: callerName, state: .ringing)
        
        provider?.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if let error = error {
                self?.activeCalls.removeValue(forKey: uuid)
                reject("CALLKIT_ERROR", error.localizedDescription, error)
            } else {
                self?.sendEvent(withName: "onIncomingCall", body: [
                    "callId": originalCallId,
                    "callerName": callerName
                ])
                resolve(true)
            }
        }
    }
    
    @objc
    func answerCall(_ callId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let (uuid, _) = findCall(byId: callId) else {
            reject("CALL_NOT_FOUND", "Call not found: \(callId)", nil)
            return
        }
        
        let action = CXAnswerCallAction(call: uuid)
        callController.request(CXTransaction(action: action)) { [weak self] error in
            if let error = error {
                reject("ANSWER_ERROR", error.localizedDescription, error)
            } else {
                self?.activeCalls[uuid]?.state = .active
                self?.sendEvent(withName: "onCallConnected", body: ["callId": callId])
                resolve(true)
            }
        }
    }
    
    @objc
    func endCall(_ callId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let (uuid, _) = findCall(byId: callId) else {
            // Call might already be ended
            resolve(true)
            return
        }
        
        let action = CXEndCallAction(call: uuid)
        callController.request(CXTransaction(action: action)) { [weak self] error in
            if let error = error {
                reject("END_CALL_ERROR", error.localizedDescription, error)
            } else {
                self?.activeCalls.removeValue(forKey: uuid)
                self?.sendEvent(withName: "onCallEnded", body: ["callId": callId])
                resolve(true)
            }
        }
    }
    
    @objc
    func startOutgoingCall(_ phoneNumber: String, callerName: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let uuid = UUID()
        let callId = "call_\(uuid.uuidString)"
        
        let handle = CXHandle(type: .phoneNumber, value: phoneNumber)
        let startCallAction = CXStartCallAction(call: uuid, handle: handle)
        startCallAction.isVideo = false
        
        activeCalls[uuid] = CallInfo(callId: callId, callerName: callerName, phoneNumber: phoneNumber, state: .dialing)
        
        callController.request(CXTransaction(action: startCallAction)) { [weak self] error in
            if let error = error {
                self?.activeCalls.removeValue(forKey: uuid)
                reject("START_CALL_ERROR", error.localizedDescription, error)
            } else {
                resolve(callId)
            }
        }
    }
    
    @objc
    func setMuted(_ muted: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let (uuid, _) = activeCalls.first(where: { $0.value.state == .active }) else {
            resolve(true)
            return
        }
        
        let action = CXSetMutedCallAction(call: uuid, muted: muted)
        callController.request(CXTransaction(action: action)) { error in
            if let error = error {
                reject("MUTE_ERROR", error.localizedDescription, error)
            } else {
                resolve(true)
            }
        }
    }
    
    @objc
    func setSpeaker(_ enabled: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        do {
            if enabled {
                try audioSession.overrideOutputAudioPort(.speaker)
            } else {
                try audioSession.overrideOutputAudioPort(.none)
            }
            
            sendEvent(withName: "onAudioRouteChanged", body: [
                "route": enabled ? "speaker" : "earpiece"
            ])
            
            resolve(true)
        } catch {
            reject("SPEAKER_ERROR", error.localizedDescription, error)
        }
    }
    
    @objc
    func setAudioRoute(_ route: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        do {
            switch route {
            case "speaker":
                try audioSession.overrideOutputAudioPort(.speaker)
            case "earpiece":
                try audioSession.overrideOutputAudioPort(.none)
            case "bluetooth":
                // Bluetooth routing is handled automatically by the system
                try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
            default:
                reject("INVALID_ROUTE", "Invalid audio route: \(route)", nil)
                return
            }
            
            sendEvent(withName: "onAudioRouteChanged", body: ["route": route])
            resolve(true)
        } catch {
            reject("AUDIO_ROUTE_ERROR", error.localizedDescription, error)
        }
    }
    
    @objc
    func isCallActive(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let hasActiveCall = activeCalls.values.contains { $0.state == .active }
        resolve(hasActiveCall)
    }
    
    @objc
    func requestPhonePermissions(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        // iOS doesn't require explicit phone permissions for CallKit
        resolve(true)
    }
    
    // MARK: - Helper Methods
    
    private func findCall(byId callId: String) -> (UUID, CallInfo)? {
        return activeCalls.first { $0.value.callId == callId }
    }
}

// MARK: - CXProviderDelegate

extension NeuraTalkTelephony: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        // Clear all calls when provider resets
        activeCalls.removeAll()
    }
    
    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // Configure audio session for call
        do {
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
            try audioSession.setActive(true)
        } catch {
            print("Failed to configure audio session: \(error)")
        }
        
        if var callInfo = activeCalls[action.callUUID] {
            callInfo.state = .active
            activeCalls[action.callUUID] = callInfo
            sendEvent(withName: "onCallConnected", body: ["callId": callInfo.callId])
        }
        
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let callInfo = activeCalls[action.callUUID] {
            sendEvent(withName: "onCallEnded", body: ["callId": callInfo.callId])
        }
        
        activeCalls.removeValue(forKey: action.callUUID)
        
        // Deactivate audio session if no more calls
        if activeCalls.isEmpty {
            try? audioSession.setActive(false)
        }
        
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        // Configure audio session
        do {
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat)
            try audioSession.setActive(true)
        } catch {
            print("Failed to configure audio session: \(error)")
        }
        
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        // Mute is handled by the audio system
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // Audio session is now active
    }
    
    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        // Audio session is now inactive
    }
}

// MARK: - Call Info

private struct CallInfo {
    let callId: String
    let callerName: String
    var phoneNumber: String?
    var state: CallState
    
    init(callId: String, callerName: String, phoneNumber: String? = nil, state: CallState = .ringing) {
        self.callId = callId
        self.callerName = callerName
        self.phoneNumber = phoneNumber
        self.state = state
    }
}

private enum CallState {
    case dialing
    case ringing
    case active
    case ended
}
