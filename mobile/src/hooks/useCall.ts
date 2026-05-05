import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { CallState, Emotion, TranslationMode } from '../types';
import { signalingService } from '../services/signaling';
import { NativeTelephony } from '../native/telephony';
import { useNetworkState } from './useNetworkState';
import { useTranslation } from './useTranslation';
import { useVoiceTranslation } from './useVoiceTranslation';
import { liveKitService, LiveKitJoinParams, LiveKitRoomSnapshot } from '../services/livekit';
import { IncomingCallInvite, pushService } from '../services/push';
import { callApi } from '../services/api';

const initialCallState: CallState = {
  status: 'idle',
  duration: 0,
  isMuted: false,
  isSpeakerOn: false,
  myLanguage: 'en',
  theirLanguage: 'auto',
  translationEnabled: true,
  translations: [],
  connectionState: 'disconnected',
  audioRoute: 'unknown',
  networkType: 'unknown',
  hasNetwork: true,
  participantCount: 0,
  callerIdentityMode: 'unknown',
  translationStatus: 'idle',
  translationMode: 'subtitles',
  voiceTranslationStatus: 'idle',
};

const recoverableStatuses: CallState['status'][] = [
  'dialing',
  'ringing',
  'connecting',
  'connected',
  'reconnecting',
];

interface SignalingPayload {
  type?: string;
  sessionId?: string;
  callId?: string;
  callerName?: string;
  callerIdentityMode?: CallState['callerIdentityMode'];
  livekitUrl?: string;
  livekitToken?: string;
  payload?: {
    livekitUrl?: string;
    livekitToken?: string;
    callerIdentityMode?: CallState['callerIdentityMode'];
  };
}

function isRecoverableStatus(status: CallState['status']): boolean {
  return recoverableStatuses.includes(status);
}

function extractMediaSession(message: SignalingPayload): LiveKitJoinParams | null {
  const livekitUrl = message.livekitUrl || message.payload?.livekitUrl;
  const livekitToken = message.livekitToken || message.payload?.livekitToken;
  const callId = message.sessionId || message.callId;

  if (!livekitUrl || !livekitToken || !callId) {
    return null;
  }

  return {
    callId,
    url: livekitUrl,
    token: livekitToken,
  };
}

function extractCallerIdentityMode(message: SignalingPayload): CallState['callerIdentityMode'] {
  return message.callerIdentityMode || message.payload?.callerIdentityMode || 'unknown';
}

export function useCall(userId: number, authToken: string, deviceId: string) {
  const network = useNetworkState();
  const [supportsTranslatedAudioPlayback, setSupportsTranslatedAudioPlayback] = useState(false);
  const {
    state: translationState,
    prepareForCall,
    reset: resetTranslation,
    markListening,
    handleRealtimeEvent,
    setLanguages: setTranslationLanguages,
    setTranslationRequested,
  } = useTranslation({
    initialMyLanguage: initialCallState.myLanguage,
    initialTheirLanguage: initialCallState.theirLanguage,
    initialEnabled: initialCallState.translationEnabled,
  });
  const {
    state: voiceTranslationState,
    prepareForCall: prepareVoiceTranslation,
    reset: resetVoiceTranslation,
    markListening: markVoiceListening,
    handleRealtimeEvent: handleVoiceRealtimeEvent,
    setRequestedMode: setRequestedVoiceMode,
  } = useVoiceTranslation({
    initialMode: initialCallState.translationMode,
    supportsNativePlayback: supportsTranslatedAudioPlayback,
    onPlayTranslatedAudio: async (audioUrl) => NativeTelephony.playTranslatedAudio(audioUrl),
    onStopTranslatedAudio: async () => {
      await NativeTelephony.stopTranslatedAudio();
    },
    onOriginalVoiceSuppressionChange: async (suppressed) => {
      await liveKitService.setLocalAudioEnabled(!suppressed);
    },
  });
  const [callState, setCallState] = useState<CallState>(initialCallState);
  const [isConnected, setIsConnected] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const endedResetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callIdRef = useRef<string | null>(null);
  const lastDialedNumberRef = useRef<string | null>(null);
  const pendingIncomingInviteRef = useRef<IncomingCallInvite | null>(null);
  const pendingMediaSessionRef = useRef<LiveKitJoinParams | null>(null);
  const recoveryInFlightRef = useRef(false);
  const callStateRef = useRef<CallState>(initialCallState);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    setCallState((prev) => ({
      ...prev,
      myLanguage: translationState.myLanguage,
      theirLanguage: translationState.theirLanguage,
      translationEnabled: translationState.translationEnabled,
      translations: translationState.translations,
      translationStatus: translationState.translationStatus,
      translationWarning: translationState.translationWarning,
      translationLatencyMs: translationState.translationLatencyMs,
      translationConfidence: translationState.translationConfidence,
      mixedLanguageDetected: translationState.mixedLanguageDetected,
      translationMode: voiceTranslationState.effectiveMode,
      voiceTranslationStatus: voiceTranslationState.status,
      voiceTranslationWarning: voiceTranslationState.warning,
      voiceTranslationLatencyMs: voiceTranslationState.latencyMs,
      translatedAudioUrl: voiceTranslationState.translatedAudioUrl,
      originalVoiceSuppressed: voiceTranslationState.originalVoiceSuppressed,
    }));
  }, [translationState, voiceTranslationState]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      return;
    }

    timerRef.current = setInterval(() => {
      setCallState((prev) => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
  }, []);

  const clearEndedResetTimer = useCallback(() => {
    if (endedResetTimerRef.current) {
      clearTimeout(endedResetTimerRef.current);
      endedResetTimerRef.current = null;
    }
  }, []);

  const resetCallState = useCallback((nextConnectionState: CallState['connectionState']) => {
    stopTimer();
    clearEndedResetTimer();
    pendingIncomingInviteRef.current = null;
    pendingMediaSessionRef.current = null;
    callIdRef.current = null;
    resetTranslation();
    resetVoiceTranslation();

    setCallState((prev) => ({
      ...initialCallState,
      myLanguage: translationState.myLanguage,
      theirLanguage: translationState.theirLanguage,
      translationEnabled: translationState.translationEnabled,
      networkType: network.type,
      hasNetwork: network.isOnline,
      connectionState: nextConnectionState,
      audioRoute: prev.audioRoute,
    }));
  }, [clearEndedResetTimer, network.isOnline, network.type, resetTranslation, resetVoiceTranslation, stopTimer, translationState.myLanguage, translationState.theirLanguage, translationState.translationEnabled]);

  const transitionToEnded = useCallback((reason?: string) => {
    stopTimer();
    clearEndedResetTimer();

    setCallState((prev) => ({
      ...prev,
      status: 'ended',
      connectionState: 'disconnected',
      errorMessage: reason,
    }));

    endedResetTimerRef.current = setTimeout(() => {
      resetCallState(signalingService.isConnected() ? 'connected' : 'disconnected');
    }, 1200);
  }, [clearEndedResetTimer, resetCallState, stopTimer]);
  const applyRoomSnapshot = useCallback((snapshot: LiveKitRoomSnapshot) => {
    setCallState((prev) => {
      const next: CallState = {
        ...prev,
        participantCount: snapshot.participantCount,
        connectionState: snapshot.connectionState,
      };

      if (snapshot.connectionState === 'connected') {
        next.status = 'connected';
        next.errorMessage = undefined;
      } else if (
        snapshot.connectionState === 'connecting' &&
        prev.status !== 'ended' &&
        prev.status !== 'failed' &&
        prev.status !== 'idle'
      ) {
        next.status = 'connecting';
      } else if (
        snapshot.connectionState === 'reconnecting' &&
        prev.status !== 'ended' &&
        prev.status !== 'failed' &&
        prev.status !== 'idle'
      ) {
        next.status = 'reconnecting';
        next.errorMessage = 'Audio path interrupted. Reconnecting media...';
      }

      return next;
    });

    if (snapshot.connectionState === 'connected') {
      startTimer();
    }
  }, [startTimer]);

  const joinMediaSession = useCallback(async (session: LiveKitJoinParams) => {
    pendingMediaSessionRef.current = session;

    setCallState((prev) => ({
      ...prev,
      status: prev.status === 'ringing' ? 'ringing' : 'connecting',
      callId: session.callId,
      connectionState: 'connecting',
      errorMessage: undefined,
    }));

    try {
      const snapshot = await liveKitService.joinRoom(session);
      await liveKitService.publishControlMessage({
        type: 'language-change',
        payload: { language: callStateRef.current.myLanguage },
      }).catch(() => undefined);
      await liveKitService.publishControlMessage({
        type: 'translation-mode',
        payload: { translationMode: voiceTranslationState.requestedMode },
      }).catch(() => undefined);
      applyRoomSnapshot(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to establish media session';
      stopTimer();
      setCallState((prev) => ({
        ...prev,
        status: 'failed',
        connectionState: 'disconnected',
        errorMessage: message,
      }));
    }
  }, [applyRoomSnapshot, stopTimer, voiceTranslationState.requestedMode]);

  const handleIncomingInvite = useCallback((invite: IncomingCallInvite, showNativeUi: boolean) => {
    pendingIncomingInviteRef.current = invite;
    callIdRef.current = invite.callId;
    pendingMediaSessionRef.current = invite.livekitUrl && invite.livekitToken
      ? {
          callId: invite.callId,
          url: invite.livekitUrl,
          token: invite.livekitToken,
        }
      : null;

    setCallState((prev) => ({
      ...prev,
      status: 'ringing',
      callId: invite.callId,
      phoneNumber: invite.callerId,
      callerName: invite.callerName,
      errorMessage: undefined,
      connectionState: signalingService.isConnected() ? 'connected' : 'connecting',
    }));

    if (showNativeUi) {
      NativeTelephony.showIncomingCall(invite.callId, invite.callerName || invite.callerId).catch(() => undefined);
    }
  }, []);

  const recoverConnectivity = useCallback(async () => {
    if (recoveryInFlightRef.current || !callIdRef.current) {
      return;
    }

    recoveryInFlightRef.current = true;

    setCallState((prev) => ({
      ...prev,
      status: 'reconnecting',
      connectionState: 'reconnecting',
      errorMessage: 'Recovering call after network change...',
    }));

    try {
      if (!signalingService.isConnected()) {
        signalingService.reconnectNow();
      }

      if (pendingMediaSessionRef.current) {
        const snapshot = await liveKitService.revalidateMediaSession();
        applyRoomSnapshot(snapshot);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recovery failed';
      stopTimer();
      setCallState((prev) => ({
        ...prev,
        status: 'failed',
        connectionState: 'disconnected',
        errorMessage: message,
      }));
    } finally {
      recoveryInFlightRef.current = false;
    }
  }, [applyRoomSnapshot, stopTimer]);

  const handleSignalingMessage = useCallback((message: any) => {
    const normalizedMessage = message?.payload?.type ? message.payload : message;

    void handleVoiceRealtimeEvent(normalizedMessage, {
      callId: callIdRef.current || undefined,
      translationEnabled: callStateRef.current.translationEnabled,
    });

    if (handleRealtimeEvent(normalizedMessage, callIdRef.current || undefined)) {
      return;
    }

    const mediaSession = extractMediaSession(normalizedMessage as SignalingPayload);
    const callerIdentityMode = extractCallerIdentityMode(normalizedMessage as SignalingPayload);

    switch (normalizedMessage.type) {
      case 'call_initiated':
        callIdRef.current = normalizedMessage.sessionId;
        if (mediaSession) {
          pendingMediaSessionRef.current = mediaSession;
        }
        setCallState((prev) => ({
          ...prev,
          status: 'dialing',
          callId: normalizedMessage.sessionId,
          callerIdentityMode,
          connectionState: 'connected',
          errorMessage: undefined,
        }));
        break;

      case 'call_ringing':
        if (mediaSession) {
          pendingMediaSessionRef.current = mediaSession;
        }
        setCallState((prev) => ({
          ...prev,
          status: 'ringing',
          callerIdentityMode,
          connectionState: 'connected',
          errorMessage: undefined,
        }));
        break;

      case 'call_connected':
        if (mediaSession) {
          void joinMediaSession(mediaSession);
        } else {
          setCallState((prev) => ({
            ...prev,
            status: 'connecting',
            startTime: prev.startTime || Date.now(),
            callerIdentityMode,
            connectionState: 'connecting',
            errorMessage: undefined,
          }));
        }
        break;

      case 'call_rejected':
        transitionToEnded(normalizedMessage.reason || 'Call was rejected');
        break;

      case 'call_ended':
        transitionToEnded();
        break;

      case 'call_failed':
      case 'token_expired':
        stopTimer();
        setCallState((prev) => ({
          ...prev,
          status: 'failed',
          connectionState: 'disconnected',
          errorMessage: normalizedMessage.reason || (normalizedMessage.type === 'token_expired' ? 'Call token expired' : 'Call failed'),
        }));
        break;

      case 'incoming_call':
        handleIncomingInvite({
          callId: normalizedMessage.sessionId,
          callerId: normalizedMessage.from,
          callerName: normalizedMessage.callerName,
          callType: normalizedMessage.callType === 'video' ? 'video' : 'voice',
          livekitUrl: mediaSession?.url,
          livekitToken: mediaSession?.token,
        }, true);
        break;

      case 'emotion_detected':
        setCallState((prev) => ({
          ...prev,
          currentEmotion: normalizedMessage.emotion as Emotion,
        }));
        break;
    }
  }, [handleIncomingInvite, handleRealtimeEvent, handleVoiceRealtimeEvent, joinMediaSession, stopTimer, transitionToEnded]);

  useEffect(() => {
    if (!userId || !authToken || !deviceId) {
      return;
    }

    NativeTelephony.initialize().catch(() => undefined);
    NativeTelephony.getCapabilities().then((capabilities) => {
      setSupportsTranslatedAudioPlayback(capabilities.supportsTranslatedAudioPlayback === true);
    }).catch(() => undefined);
    NativeTelephony.getCurrentAudioRoute().then((route) => {
      setCallState((prev) => ({ ...prev, audioRoute: route }));
    }).catch(() => undefined);

    signalingService.connect(userId, authToken, deviceId);

    const unsubRoomSnapshot = liveKitService.onSnapshot(applyRoomSnapshot);
    const unsubRoomData = liveKitService.onDataMessage((message) => {
      handleSignalingMessage(message);
    });
    const unsubConnect = signalingService.onConnect(() => {
      setIsConnected(true);
      markListening();
      markVoiceListening(callStateRef.current.translationEnabled);
      setCallState((prev) => ({
        ...prev,
        connectionState: pendingMediaSessionRef.current && isRecoverableStatus(prev.status) ? 'connecting' : 'connected',
        status: prev.status === 'reconnecting' && !pendingMediaSessionRef.current ? 'connecting' : prev.status,
        errorMessage: prev.status === 'reconnecting' ? 'Revalidating call session...' : prev.errorMessage,
      }));
    });

    const unsubDisconnect = signalingService.onDisconnect(() => {
      setIsConnected(false);
      setCallState((prev) => ({
        ...prev,
        connectionState: isRecoverableStatus(prev.status) ? 'reconnecting' : 'disconnected',
        status: isRecoverableStatus(prev.status) ? 'reconnecting' : prev.status,
        errorMessage: isRecoverableStatus(prev.status)
          ? 'Signaling lost. Waiting for recovery...'
          : prev.errorMessage,
      }));
    });

    const unsubMessage = signalingService.onMessage(handleSignalingMessage);
    const unsubIncoming = NativeTelephony.onIncomingCall((event) => {
      handleIncomingInvite({
        callId: event.callId,
        callerId: event.phoneNumber,
        callerName: event.callerName,
        callType: 'voice',
      }, false);
    });
    const unsubNativeConnected = NativeTelephony.onCallConnected((event) => {
      if (callIdRef.current && event.callId !== callIdRef.current) return;
      setCallState((prev) => ({
        ...prev,
        status: 'connected',
        startTime: prev.startTime || Date.now(),
        connectionState: 'connected',
        errorMessage: undefined,
      }));
      markListening();
      markVoiceListening(callStateRef.current.translationEnabled);
      startTimer();
    });
    const unsubNativeEnded = NativeTelephony.onCallEnded((event) => {
      if (callIdRef.current && event.callId !== callIdRef.current) return;
      transitionToEnded();
    });
    const unsubNativeFailed = NativeTelephony.onCallFailed((event) => {
      if (callIdRef.current && event.callId !== callIdRef.current) return;
      stopTimer();
      setCallState((prev) => ({
        ...prev,
        status: 'failed',
        connectionState: 'disconnected',
        errorMessage: event.reason || 'Call failed',
      }));
    });
    const unsubAudioRoute = NativeTelephony.onAudioRouteChanged((event) => {
      setCallState((prev) => ({ ...prev, audioRoute: event.route }));
    });

    void pushService.initialize({
      deviceId,
      onIncomingCall: (invite) => {
        handleIncomingInvite(invite, false);
      },
    });

    void pushService.recoverPendingIncomingCall().then((invite) => {
      if (invite) {
        handleIncomingInvite(invite, true);
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        return;
      }

      void pushService.syncTokens(deviceId);
      void pushService.recoverPendingIncomingCall().then((invite) => {
        if (invite && callStateRef.current.status === 'idle') {
          handleIncomingInvite(invite, true);
        }
      });
    });

    return () => {
      unsubRoomSnapshot();
      unsubRoomData();
      unsubConnect();
      unsubDisconnect();
      unsubMessage();
      unsubIncoming();
      unsubNativeConnected();
      unsubNativeEnded();
      unsubNativeFailed();
      unsubAudioRoute();
      appStateSubscription.remove();
      pushService.teardown();
      void liveKitService.leaveRoom().catch(() => undefined);
      signalingService.disconnect();
      clearEndedResetTimer();
      stopTimer();
    };
  }, [
    applyRoomSnapshot,
    authToken,
    clearEndedResetTimer,
    deviceId,
    handleIncomingInvite,
    handleSignalingMessage,
    startTimer,
    stopTimer,
    transitionToEnded,
    markListening,
    markVoiceListening,
    userId,
  ]);

  useEffect(() => {
    setCallState((prev) => ({
      ...prev,
      hasNetwork: network.isOnline,
      networkType: network.type,
    }));

    const currentStatus = callStateRef.current.status;
    if (!network.isOnline && isRecoverableStatus(currentStatus)) {
      setCallState((prev) => ({
        ...prev,
        status: 'reconnecting',
        connectionState: 'reconnecting',
        errorMessage: 'Network lost. Holding the call until connectivity returns...',
      }));
      return;
    }

    if (network.isOnline && network.hasTransitioned && isRecoverableStatus(currentStatus)) {
      void recoverConnectivity();
    }
  }, [network.changedAt, network.hasTransitioned, network.isOnline, network.type, recoverConnectivity]);

  const initiateCall = useCallback((
    phoneNumber: string,
    options?: { callType?: 'voice' | 'video'; callExperience?: 'audio' | 'video' | 'face_to_face' },
  ) => {
    lastDialedNumberRef.current = phoneNumber;
    clearEndedResetTimer();
    pendingIncomingInviteRef.current = null;
    pendingMediaSessionRef.current = null;
    const decision = prepareForCall();
    const voiceDecision = prepareVoiceTranslation(decision.enabled);

    setCallState((prev) => ({
      ...prev,
      status: 'dialing',
      phoneNumber,
      callType: options?.callType || 'voice',
      callExperience: options?.callExperience || (options?.callType === 'video' ? 'video' : 'audio'),
      callerName: undefined,
      duration: 0,
      translations: [],
      errorMessage: undefined,
      participantCount: 0,
      callerIdentityMode: 'unknown',
      connectionState: isConnected ? 'connected' : 'connecting',
      myLanguage: decision.sourceLanguage,
      theirLanguage: decision.targetLanguage,
      translationEnabled: decision.enabled,
      translationStatus: decision.enabled ? 'idle' : 'disabled',
      translationWarning: decision.warning,
      mixedLanguageDetected: decision.mode === 'best_effort',
      translationLatencyMs: undefined,
      translationConfidence: undefined,
      translationMode: voiceDecision.effectiveMode,
      voiceTranslationStatus: voiceDecision.effectiveMode === 'off' ? 'idle' : 'listening',
      voiceTranslationWarning: voiceDecision.warning,
      voiceTranslationLatencyMs: undefined,
      translatedAudioUrl: undefined,
      originalVoiceSuppressed: false,
    }));

    const sessionId = signalingService.initiateCall(phoneNumber, {
      callType: options?.callType || 'voice',
      callExperience: options?.callExperience || (options?.callType === 'video' ? 'video' : 'audio'),
      myLanguage: decision.sourceLanguage,
      theirLanguage: decision.targetLanguage,
      translationEnabled: decision.enabled,
      translationMode: voiceDecision.requestedMode,
    });

    callIdRef.current = sessionId;
  }, [clearEndedResetTimer, isConnected, prepareForCall, prepareVoiceTranslation]);

  const answerCall = useCallback(() => {
    if (!callIdRef.current) {
      return;
    }

    setCallState((prev) => ({
      ...prev,
      status: pendingMediaSessionRef.current ? 'connecting' : 'connected',
      startTime: prev.startTime || Date.now(),
      connectionState: pendingMediaSessionRef.current ? 'connecting' : 'connected',
      errorMessage: undefined,
    }));
    if (!pendingMediaSessionRef.current) {
      markListening();
      markVoiceListening(callStateRef.current.translationEnabled);
    }

    void callApi.updateStatus(callIdRef.current, 'accepted', { source: 'mobile_native_accept' }).catch(() => undefined);
    NativeTelephony.answerCall(callIdRef.current).catch(() => undefined);

    if (pendingMediaSessionRef.current) {
      void joinMediaSession(pendingMediaSessionRef.current);
    } else {
      startTimer();
    }
  }, [joinMediaSession, markListening, markVoiceListening, startTimer]);

  const endCall = useCallback(() => {
    const currentCallId = callIdRef.current;
    if (currentCallId) {
      signalingService.endCall(currentCallId);
      void callApi.updateStatus(currentCallId, 'ended', { source: 'mobile_end_call' }).catch(() => undefined);
      if (callStateRef.current.status === 'ringing') {
        void pushService.rejectIncomingCall(currentCallId);
      }
      NativeTelephony.endCall(currentCallId).catch(() => undefined);
    }

    void liveKitService.leaveRoom().catch(() => undefined);
    transitionToEnded();
  }, [transitionToEnded]);

  const retryLastCall = useCallback(() => {
    if (!lastDialedNumberRef.current) {
      return;
    }

    signalingService.reconnectNow();
    void recoverConnectivity();
    initiateCall(lastDialedNumberRef.current);
  }, [initiateCall, recoverConnectivity]);

  const toggleMute = useCallback(() => {
    setCallState((prev) => {
      const nextMuted = !prev.isMuted;
      NativeTelephony.setMuted(nextMuted).catch(() => undefined);
      return { ...prev, isMuted: nextMuted };
    });
  }, []);

  const toggleSpeaker = useCallback(() => {
    setCallState((prev) => {
      const nextSpeaker = !prev.isSpeakerOn;
      NativeTelephony.setSpeaker(nextSpeaker).catch(() => undefined);
      return {
        ...prev,
        isSpeakerOn: nextSpeaker,
        audioRoute: nextSpeaker ? 'speaker' : 'earpiece',
      };
    });
  }, []);

  const setAudioRoute = useCallback((route: 'earpiece' | 'speaker' | 'bluetooth') => {
    NativeTelephony.setAudioRoute(route).catch(() => undefined);
    setCallState((prev) => ({
      ...prev,
      isSpeakerOn: route === 'speaker',
      audioRoute: route,
    }));
  }, []);

  const setLanguages = useCallback((myLanguage: string, theirLanguage: string) => {
    setTranslationLanguages(myLanguage, theirLanguage);
    void liveKitService.publishControlMessage({
      type: 'language-change',
      payload: { language: myLanguage },
    }).catch(() => undefined);
    if (callIdRef.current) {
      signalingService.updateTranslationMode(callIdRef.current, {
        myLanguage,
        theirLanguage,
        translationEnabled: callStateRef.current.translationEnabled,
        translationMode: voiceTranslationState.requestedMode,
      });
    }
  }, [setTranslationLanguages, voiceTranslationState.requestedMode]);

  const setTranslationEnabled = useCallback((enabled: boolean) => {
    setTranslationRequested(enabled);
    const voiceDecision = setRequestedVoiceMode(voiceTranslationState.requestedMode, enabled);
    void liveKitService.publishControlMessage({
      type: 'translation-mode',
      payload: { translationMode: enabled ? voiceTranslationState.requestedMode : 'off' },
    }).catch(() => undefined);
    setCallState((prev) => ({
      ...prev,
      translationEnabled: enabled,
      translationMode: voiceDecision.effectiveMode,
      voiceTranslationStatus: voiceDecision.effectiveMode === 'off' ? 'idle' : 'listening',
      voiceTranslationWarning: voiceDecision.warning,
      originalVoiceSuppressed: false,
    }));
    if (callIdRef.current) {
      signalingService.updateTranslationMode(callIdRef.current, {
        myLanguage: callStateRef.current.myLanguage,
        theirLanguage: callStateRef.current.theirLanguage,
        translationEnabled: enabled,
        translationMode: voiceTranslationState.requestedMode,
      });
    }
  }, [setRequestedVoiceMode, setTranslationRequested, voiceTranslationState.requestedMode]);

  const setTranslationMode = useCallback((mode: TranslationMode) => {
    const decision = setRequestedVoiceMode(mode, callStateRef.current.translationEnabled);
    void liveKitService.publishControlMessage({
      type: 'translation-mode',
      payload: { translationMode: mode },
    }).catch(() => undefined);

    setCallState((prev) => ({
      ...prev,
      translationMode: decision.effectiveMode,
      voiceTranslationStatus: decision.effectiveMode === 'off' ? 'idle' : 'listening',
      voiceTranslationWarning: decision.warning,
      originalVoiceSuppressed: false,
    }));

    if (callIdRef.current) {
      signalingService.updateTranslationMode(callIdRef.current, {
        myLanguage: callStateRef.current.myLanguage,
        theirLanguage: callStateRef.current.theirLanguage,
        translationEnabled: callStateRef.current.translationEnabled,
        translationMode: mode,
      });
    }
  }, [setRequestedVoiceMode]);

  return {
    callState,
    isConnected,
    network,
    initiateCall,
    answerCall,
    endCall,
    retryLastCall,
    toggleMute,
    toggleSpeaker,
    setAudioRoute,
    setLanguages,
    setTranslationEnabled,
    setTranslationMode,
  };
}
