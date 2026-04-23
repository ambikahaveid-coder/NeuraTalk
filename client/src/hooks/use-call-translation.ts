import { useRef, useCallback, useState, useEffect } from "react";
import { applyNoiseSuppression } from "./use-noise-suppression";

interface TranslationEntry {
  id: string;
  speaker: "me" | "them";
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string;
  timestamp: number;
  latencyMs?: number;
  provider?: string;
}

type VoiceId = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

interface UseCallTranslationOptions {
  sourceLanguage: string;
  targetLanguage: string;
  emotionPreservation: boolean;
  voicePreservation?: boolean;
  voiceProfileId?: string;
  ultraLowLatency?: boolean;
  myVoiceId?: VoiceId;
  theirVoiceId?: VoiceId;
  onTranslation?: (entry: TranslationEntry) => void;
  onEmotion?: (emotion: string) => void;
  onAudio?: (audioBase64: string) => void;
  onRemoteAudio?: (audioBase64: string) => void;
  onLatency?: (latencyMs: number) => void;
  onVoiceDetected?: (speaker: "me" | "them", voiceId: VoiceId) => void;
}

interface TranslationStatus {
  isUltraLowLatencyAvailable: boolean;
  isVoiceCloningAvailable: boolean;
  expectedLatencyMs: number;
  provider: string;
}

interface AudioPipeline {
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  processor: ScriptProcessorNode | null;
  audioBuffer: Float32Array[];
  silenceTimeout: NodeJS.Timeout | null;
  lastSpeechTime: number;
  isListening: boolean;
}

export function useCallTranslation(options: UseCallTranslationOptions) {
  const { 
    sourceLanguage, 
    targetLanguage, 
    emotionPreservation, 
    voicePreservation = false,
    voiceProfileId,
    ultraLowLatency = false,
    myVoiceId: initialMyVoiceId,
    theirVoiceId: initialTheirVoiceId,
    onTranslation, 
    onEmotion,
    onAudio,
    onRemoteAudio,
    onLatency,
    onVoiceDetected,
  } = options;
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isListeningRemote, setIsListeningRemote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myVoiceId, setMyVoiceId] = useState<VoiceId | null>(initialMyVoiceId || null);
  const [theirVoiceId, setTheirVoiceId] = useState<VoiceId | null>(initialTheirVoiceId || null);
  const [status, setStatus] = useState<TranslationStatus>({
    isUltraLowLatencyAvailable: false,
    isVoiceCloningAvailable: false,
    expectedLatencyMs: 1500,
    provider: "openai",
  });
  
  const myVoiceDetectedRef = useRef(!!initialMyVoiceId);
  const theirVoiceDetectedRef = useRef(!!initialTheirVoiceId);
  const myVoiceIdRef = useRef<VoiceId | null>(initialMyVoiceId || null);
  const theirVoiceIdRef = useRef<VoiceId | null>(initialTheirVoiceId || null);
  
  // Separate pipelines for local (me) and remote (them) audio
  const localPipelineRef = useRef<AudioPipeline>({
    audioContext: null,
    analyser: null,
    sourceNode: null,
    processor: null,
    audioBuffer: [],
    silenceTimeout: null,
    lastSpeechTime: 0,
    isListening: false,
  });
  
  const remotePipelineRef = useRef<AudioPipeline>({
    audioContext: null,
    analyser: null,
    sourceNode: null,
    processor: null,
    audioBuffer: [],
    silenceTimeout: null,
    lastSpeechTime: 0,
    isListening: false,
  });
  
  const localNoiseCleanupRef = useRef<(() => void) | null>(null);
  const remoteNoiseCleanupRef = useRef<(() => void) | null>(null);
  
  const optionsRef = useRef({ 
    sourceLanguage, 
    targetLanguage, 
    emotionPreservation, 
    voicePreservation,
    voiceProfileId,
    ultraLowLatency,
    onTranslation, 
    onEmotion,
    onAudio,
    onRemoteAudio,
    onLatency,
    onVoiceDetected,
  });
  optionsRef.current = { 
    sourceLanguage, 
    targetLanguage, 
    emotionPreservation, 
    voicePreservation,
    voiceProfileId,
    ultraLowLatency,
    onTranslation, 
    onEmotion,
    onAudio,
    onRemoteAudio,
    onLatency,
    onVoiceDetected,
  };
  
  // Ultra-optimized for <100ms latency when streaming services available
  const SILENCE_THRESHOLD = 0.02;
  const SILENCE_DURATION = ultraLowLatency ? 100 : 200;
  const MIN_AUDIO_DURATION = ultraLowLatency ? 80 : 150;
  const SAMPLE_RATE = 16000;

  const detectVoiceIdentity = useCallback(async (audioBase64: string, speaker: "me" | "them") => {
    const alreadyDetected = speaker === "me" ? myVoiceDetectedRef.current : theirVoiceDetectedRef.current;
    if (alreadyDetected) return;

    try {
      const response = await fetch("/api/call/detect-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: audioBase64 }),
      });

      if (!response.ok) return;

      const result = await response.json();
      const detectedVoice = result.suggestedVoiceId as VoiceId;

      if (speaker === "me") {
        myVoiceDetectedRef.current = true;
        myVoiceIdRef.current = detectedVoice;
        setMyVoiceId(detectedVoice);
      } else {
        theirVoiceDetectedRef.current = true;
        theirVoiceIdRef.current = detectedVoice;
        setTheirVoiceId(detectedVoice);
      }

      optionsRef.current.onVoiceDetected?.(speaker, detectedVoice);
    } catch (err) {
      console.warn(`Voice detection failed for ${speaker}:`, err);
    }
  }, []);

  // Check available services on mount
  useEffect(() => {
    const checkServices = async () => {
      try {
        const [ultraLowLatencyStatus, voiceCloningStatus] = await Promise.all([
          fetch("/api/call/ultra-low-latency-status").then(r => r.json()).catch(() => null),
          fetch("/api/voice-cloning/status").then(r => r.json()).catch(() => null),
        ]);

        const isUltraLowLatencyAvailable = ultraLowLatencyStatus?.available || false;
        const isVoiceCloningAvailable = voiceCloningStatus?.available || false;

        let expectedLatencyMs = 1500; // OpenAI fallback
        let provider = "openai";

        if (isUltraLowLatencyAvailable) {
          expectedLatencyMs = 80;
          provider = "ultra-low-latency-streaming";
        } else if (ultraLowLatencyStatus?.services?.streamingSTT) {
          expectedLatencyMs = 300;
          provider = "local-ai";
        }

        if (isVoiceCloningAvailable && voicePreservation) {
          provider += "+voice-cloning";
        }

        setStatus({
          isUltraLowLatencyAvailable,
          isVoiceCloningAvailable,
          expectedLatencyMs,
          provider,
        });
      } catch (err) {
        console.warn("Failed to check translation services:", err);
      }
    };

    checkServices();
  }, [voicePreservation]);

  // Process audio buffer for a specific speaker
  const processAudioBuffer = useCallback(async (
    pipeline: AudioPipeline, 
    speaker: "me" | "them"
  ) => {
    if (pipeline.audioBuffer.length === 0) return;
    
    const totalLength = pipeline.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const minSamples = (MIN_AUDIO_DURATION / 1000) * SAMPLE_RATE;
    
    if (totalLength < minSamples) {
      pipeline.audioBuffer = [];
      return;
    }
    
    const processStartTime = Date.now();
    setIsProcessing(true);
    
    try {
      const combinedBuffer = new Float32Array(totalLength);
      let offset = 0;
      for (const buf of pipeline.audioBuffer) {
        combinedBuffer.set(buf, offset);
        offset += buf.length;
      }
      pipeline.audioBuffer = [];
      
      const pcm16 = new Int16Array(combinedBuffer.length);
      for (let i = 0; i < combinedBuffer.length; i++) {
        const s = Math.max(-1, Math.min(1, combinedBuffer[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      
      const uint8Array = new Uint8Array(pcm16.buffer);
      const audioBase64 = btoa(Array.from(uint8Array).map(b => String.fromCharCode(b)).join(''));
      
      const { 
        sourceLanguage: srcLang, 
        targetLanguage: tgtLang, 
        emotionPreservation: emotionPres, 
        voicePreservation: voicePres,
        voiceProfileId: profileId,
        onTranslation: onTrans, 
        onEmotion: onEmot,
        onAudio: onAud,
        onRemoteAudio: onRemAud,
        onLatency: onLat
      } = optionsRef.current;
      
      // Auto-detect voice identity from first audio sample
      detectVoiceIdentity(audioBase64, speaker);
      
      // Get the consistent voice ID for this speaker
      // "me" translating → remote hears my voice identity
      // "them" translating → I hear their voice identity
      const speakerVoiceId = speaker === "me" 
        ? myVoiceIdRef.current 
        : theirVoiceIdRef.current;
      
      // BIDIRECTIONAL: Swap languages based on speaker
      // Me → Them: My language → Their language (so they hear me in their language)
      // Them → Me: Their language → My language (so I hear them in my language)
      const translateFrom = speaker === "me" ? srcLang : tgtLang;
      const translateTo = speaker === "me" ? tgtLang : srcLang;
      
      // Choose endpoint based on voice preservation setting
      const endpoint = voicePres && profileId 
        ? "/api/call/translate-natural" 
        : "/api/call/translate";
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: audioBase64,
          sourceLanguage: translateFrom,
          targetLanguage: translateTo,
          detectEmotion: emotionPres,
          voiceProfileId: profileId,
          voiceId: speakerVoiceId || undefined,
        }),
      });
      
      if (!response.ok) {
        throw new Error("Translation failed");
      }
      
      const result = await response.json();
      const latencyMs = Date.now() - processStartTime;
      
      // Report latency
      onLat?.(latencyMs);
      
      if (result.originalText && result.translatedText) {
        const entry: TranslationEntry = {
          id: `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          speaker,
          originalText: result.originalText,
          translatedText: result.translatedText,
          sourceLanguage: translateFrom,
          targetLanguage: translateTo,
          emotion: result.emotion,
          timestamp: Date.now(),
          latencyMs,
          provider: result.provider,
        };
        
        onTrans?.(entry);
        
        if (result.emotion && emotionPres) {
          onEmot?.(result.emotion);
        }
        
        // Play translated audio if available
        // For "me" → send to remote (they hear my translated voice)
        // For "them" → play locally (I hear their translated voice)
        if (result.audioBase64) {
          if (speaker === "me" && onAud) {
            onAud(result.audioBase64);
          } else if (speaker === "them" && onRemAud) {
            onRemAud(result.audioBase64);
          }
        }
      }
    } catch (err) {
      console.error(`Audio processing error (${speaker}):`, err);
    } finally {
      setIsProcessing(false);
    }
  }, [MIN_AUDIO_DURATION, SAMPLE_RATE]);

  // Create audio pipeline for a stream
  const createAudioPipeline = useCallback((
    stream: MediaStream,
    pipelineRef: React.MutableRefObject<AudioPipeline>,
    speaker: "me" | "them"
  ) => {
    const pipeline = pipelineRef.current;
    
    pipeline.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    pipeline.analyser = pipeline.audioContext.createAnalyser();
    pipeline.analyser.fftSize = 2048;
    
    pipeline.sourceNode = pipeline.audioContext.createMediaStreamSource(stream);
    pipeline.processor = pipeline.audioContext.createScriptProcessor(4096, 1, 1);
    
    const muteNode = pipeline.audioContext.createGain();
    muteNode.gain.value = 0;
    
    pipeline.sourceNode.connect(pipeline.analyser);
    pipeline.analyser.connect(pipeline.processor);
    pipeline.processor.connect(muteNode);
    muteNode.connect(pipeline.audioContext.destination);
    
    pipeline.processor.onaudioprocess = (e) => {
      if (!pipeline.isListening) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      const dataArray = new Float32Array(inputData);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += Math.abs(dataArray[i]);
      }
      const average = sum / dataArray.length;
      
      if (average > SILENCE_THRESHOLD) {
        pipeline.lastSpeechTime = Date.now();
        pipeline.audioBuffer.push(new Float32Array(dataArray));
        
        if (pipeline.silenceTimeout) {
          clearTimeout(pipeline.silenceTimeout);
        }
        
        pipeline.silenceTimeout = setTimeout(() => {
          processAudioBuffer(pipeline, speaker);
        }, SILENCE_DURATION);
      }
    };
    
    pipeline.isListening = true;
  }, [SAMPLE_RATE, SILENCE_THRESHOLD, SILENCE_DURATION, processAudioBuffer]);

  // Cleanup a pipeline
  const cleanupPipeline = useCallback((pipeline: AudioPipeline) => {
    pipeline.isListening = false;
    
    if (pipeline.silenceTimeout) {
      clearTimeout(pipeline.silenceTimeout);
      pipeline.silenceTimeout = null;
    }
    
    if (pipeline.processor) {
      pipeline.processor.disconnect();
      pipeline.processor = null;
    }
    
    if (pipeline.sourceNode) {
      pipeline.sourceNode.disconnect();
      pipeline.sourceNode = null;
    }
    
    if (pipeline.audioContext && pipeline.audioContext.state !== "closed") {
      pipeline.audioContext.close();
      pipeline.audioContext = null;
    }
    
    pipeline.audioBuffer = [];
  }, []);

  // Start listening to LOCAL audio (my speech → their language)
  const startListening = useCallback(async (stream: MediaStream) => {
    if (localPipelineRef.current.isListening) return;
    
    try {
      if (localNoiseCleanupRef.current) {
        localNoiseCleanupRef.current();
        localNoiseCleanupRef.current = null;
      }
      const { suppressedStream, cleanup } = applyNoiseSuppression(stream);
      localNoiseCleanupRef.current = cleanup;
      createAudioPipeline(suppressedStream, localPipelineRef, "me");
      setIsListening(true);
      setError(null);
    } catch (err) {
      console.error("Failed to start local audio capture:", err);
      setError("Failed to start audio capture");
      localPipelineRef.current.isListening = false;
    }
  }, [createAudioPipeline]);

  // Start listening to REMOTE audio (their speech → my language)
  // This enables true bidirectional translation
  const startListeningRemote = useCallback(async (stream: MediaStream) => {
    if (remotePipelineRef.current.isListening) return;
    
    try {
      if (remoteNoiseCleanupRef.current) {
        remoteNoiseCleanupRef.current();
        remoteNoiseCleanupRef.current = null;
      }
      const { suppressedStream, cleanup } = applyNoiseSuppression(stream);
      remoteNoiseCleanupRef.current = cleanup;
      createAudioPipeline(suppressedStream, remotePipelineRef, "them");
      setIsListeningRemote(true);
      setError(null);
    } catch (err) {
      console.error("Failed to start remote audio capture:", err);
      setError("Failed to start remote audio capture");
      remotePipelineRef.current.isListening = false;
    }
  }, [createAudioPipeline]);

  const stopListening = useCallback(() => {
    if (localNoiseCleanupRef.current) {
      localNoiseCleanupRef.current();
      localNoiseCleanupRef.current = null;
    }
    cleanupPipeline(localPipelineRef.current);
    setIsListening(false);
  }, [cleanupPipeline]);

  const stopListeningRemote = useCallback(() => {
    if (remoteNoiseCleanupRef.current) {
      remoteNoiseCleanupRef.current();
      remoteNoiseCleanupRef.current = null;
    }
    cleanupPipeline(remotePipelineRef.current);
    setIsListeningRemote(false);
  }, [cleanupPipeline]);

  const stopAll = useCallback(() => {
    stopListening();
    stopListeningRemote();
  }, [stopListening, stopListeningRemote]);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  return {
    isListening,
    isListeningRemote,
    isProcessing,
    error,
    status,
    myVoiceId,
    theirVoiceId,
    startListening,
    startListeningRemote,
    stopListening,
    stopListeningRemote,
    stopAll,
  };
}
