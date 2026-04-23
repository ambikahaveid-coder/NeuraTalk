import { useState, useCallback, useEffect, useRef } from 'react';
import { CallState, TranslationEntry, Emotion } from '../types';
import { signalingService } from '../services/signaling';
import { NativeTelephony } from '../native/telephony';

const initialCallState: CallState = {
  status: 'idle',
  duration: 0,
  isMuted: false,
  isSpeakerOn: false,
  myLanguage: 'en',
  theirLanguage: 'es',
  translationEnabled: true,
  translations: [],
};

export function useCall(userId: number, authToken: string, deviceId: string) {
  const [callState, setCallState] = useState<CallState>(initialCallState);
  const [isConnected, setIsConnected] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const callIdRef = useRef<string | null>(null);

  useEffect(() => {
    signalingService.connect(userId, authToken, deviceId);
    
    const unsubConnect = signalingService.onConnect(() => {
      setIsConnected(true);
    });
    
    const unsubDisconnect = signalingService.onDisconnect(() => {
      setIsConnected(false);
    });
    
    const unsubMessage = signalingService.onMessage((message) => {
      handleSignalingMessage(message);
    });

    return () => {
      unsubConnect();
      unsubDisconnect();
      unsubMessage();
      signalingService.disconnect();
    };
  }, [userId, authToken, deviceId]);

  const handleSignalingMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'call_initiated':
        setCallState(prev => ({
          ...prev,
          status: 'dialing',
          callId: message.sessionId,
        }));
        callIdRef.current = message.sessionId;
        break;

      case 'call_ringing':
        setCallState(prev => ({ ...prev, status: 'ringing' }));
        break;

      case 'call_connected':
        setCallState(prev => ({
          ...prev,
          status: 'active',
          startTime: Date.now(),
        }));
        startTimer();
        break;

      case 'call_ended':
        endCall();
        break;

      case 'incoming_call':
        setCallState(prev => ({
          ...prev,
          status: 'ringing',
          callId: message.sessionId,
          phoneNumber: message.from,
          callerName: message.callerName,
        }));
        callIdRef.current = message.sessionId;
        NativeTelephony.showIncomingCall(message.sessionId, message.callerName || message.from);
        break;

      case 'translation':
        const entry: TranslationEntry = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          speaker: message.speaker,
          originalText: message.originalText,
          translatedText: message.translatedText,
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          emotion: message.emotion,
          timestamp: Date.now(),
        };
        setCallState(prev => ({
          ...prev,
          translations: [...prev.translations, entry].slice(-50),
        }));
        break;

      case 'emotion_detected':
        setCallState(prev => ({
          ...prev,
          currentEmotion: message.emotion as Emotion,
        }));
        break;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCallState(prev => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const initiateCall = useCallback((phoneNumber: string) => {
    setCallState(prev => ({
      ...prev,
      status: 'dialing',
      phoneNumber,
      duration: 0,
      translations: [],
    }));

    const sessionId = signalingService.initiateCall(phoneNumber, {
      myLanguage: callState.myLanguage,
      theirLanguage: callState.theirLanguage,
      translationEnabled: callState.translationEnabled,
    });

    callIdRef.current = sessionId;
  }, [callState.myLanguage, callState.theirLanguage, callState.translationEnabled]);

  const answerCall = useCallback(() => {
    if (!callIdRef.current) return;
    
    setCallState(prev => ({
      ...prev,
      status: 'active',
      startTime: Date.now(),
    }));
    startTimer();
    
    NativeTelephony.answerCall(callIdRef.current);
  }, [startTimer]);

  const endCall = useCallback(() => {
    if (callIdRef.current) {
      signalingService.endCall(callIdRef.current);
      NativeTelephony.endCall(callIdRef.current);
    }
    
    stopTimer();
    setCallState(prev => ({
      ...initialCallState,
      myLanguage: prev.myLanguage,
      theirLanguage: prev.theirLanguage,
      translationEnabled: prev.translationEnabled,
    }));
    callIdRef.current = null;
  }, [stopTimer]);

  const toggleMute = useCallback(() => {
    setCallState(prev => {
      const newMuted = !prev.isMuted;
      NativeTelephony.setMuted(newMuted);
      return { ...prev, isMuted: newMuted };
    });
  }, []);

  const toggleSpeaker = useCallback(() => {
    setCallState(prev => {
      const newSpeaker = !prev.isSpeakerOn;
      NativeTelephony.setSpeaker(newSpeaker);
      return { ...prev, isSpeakerOn: newSpeaker };
    });
  }, []);

  const setLanguages = useCallback((myLanguage: string, theirLanguage: string) => {
    setCallState(prev => ({ ...prev, myLanguage, theirLanguage }));
  }, []);

  const setTranslationEnabled = useCallback((enabled: boolean) => {
    setCallState(prev => ({ ...prev, translationEnabled: enabled }));
  }, []);

  return {
    callState,
    isConnected,
    initiateCall,
    answerCall,
    endCall,
    toggleMute,
    toggleSpeaker,
    setLanguages,
    setTranslationEnabled,
  };
}
