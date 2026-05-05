import React from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { TranslationSubtitles } from '../components/TranslationSubtitles';
import { EmotionIndicator } from '../components/EmotionIndicator';
import PremiumBackground from '../components/PremiumBackground';
import { CallState, TranslationMode } from '../types';
import { glass, premiumTheme } from '../theme/premium';

interface CallScreenProps {
  callState: CallState;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onRetryCall?: () => void;
  onSetTranslationMode?: (mode: TranslationMode) => void;
}

const nextTranslationMode = (mode: TranslationMode | undefined): TranslationMode => {
  switch (mode) {
    case 'off':
      return 'subtitles';
    case 'subtitles':
      return 'voice';
    case 'voice':
    default:
      return 'off';
  }
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const statusLabel = (status: CallState['status'], duration: number) => {
  switch (status) {
    case 'dialing':
      return 'Dialing relay';
    case 'ringing':
      return 'Ringing remote listener';
    case 'connecting':
      return 'Binding media path';
    case 'connected':
      return formatDuration(duration);
    case 'reconnecting':
      return 'Recovering session';
    case 'failed':
      return 'Call recovery failed';
    case 'ended':
      return 'Session ended';
    default:
      return 'Preparing call';
  }
};

const modeLabel = (mode?: TranslationMode) => {
  switch (mode) {
    case 'voice':
      return 'Voice';
    case 'off':
      return 'Original';
    case 'subtitles':
    default:
      return 'Subtitles';
  }
};

export function CallScreen({
  callState,
  onEndCall,
  onToggleMute,
  onToggleSpeaker,
  onRetryCall,
  onSetTranslationMode,
}: CallScreenProps) {
  const {
    status,
    phoneNumber,
    callerName,
    duration,
    isMuted,
    isSpeakerOn,
    errorMessage,
    connectionState,
    audioRoute,
    networkType,
    translationMode,
    voiceTranslationStatus,
    voiceTranslationWarning,
    callType,
    callExperience,
  } = callState;

  const interactive = status === 'connected' || status === 'reconnecting' || status === 'connecting';

  return (
    <PremiumBackground>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />

        <View style={styles.topSection}>
          <View style={[styles.signalPill, glass]}>
            <Text style={styles.signalPillText}>
              {callExperience === 'face_to_face' ? 'Face-to-Face AI' : callType === 'video' ? 'Video Call' : 'Audio Call'}
            </Text>
          </View>

          <EmotionIndicator emotion={callState.currentEmotion} size="lg" showLabel={true} />

          <View style={styles.callerInfo}>
            <Text style={styles.callerName}>{callerName || phoneNumber || 'Unknown Caller'}</Text>
            <Text style={styles.callStatus}>{statusLabel(status, duration)}</Text>
            <Text style={styles.metaLine}>
              {connectionState === 'reconnecting'
                ? 'Network recovery in progress'
                : connectionState === 'connected'
                  ? 'Media path connected'
                  : connectionState === 'connecting'
                    ? 'Connecting media transport'
                    : 'Disconnected from call service'}
            </Text>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={[styles.metaCard, glass]}>
            <Text style={styles.metaCardLabel}>Network</Text>
            <Text style={styles.metaCardValue}>{networkType || 'unknown'}</Text>
          </View>
          <View style={[styles.metaCard, glass]}>
            <Text style={styles.metaCardLabel}>Audio Route</Text>
            <Text style={styles.metaCardValue}>{audioRoute || 'unknown'}</Text>
          </View>
          <View style={[styles.metaCard, glass]}>
            <Text style={styles.metaCardLabel}>AI Mode</Text>
            <Text style={styles.metaCardValue}>{modeLabel(translationMode)}</Text>
          </View>
        </View>

        {voiceTranslationWarning ? (
          <View style={[styles.warningCard, glass]}>
            <Text style={styles.warningText}>{voiceTranslationWarning}</Text>
          </View>
        ) : null}
        {errorMessage ? (
          <View style={[styles.errorCard, glass]}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.translationWrap}>
          <TranslationSubtitles
            entries={callState.translations}
            currentEmotion={callState.currentEmotion}
            myLanguage={callState.myLanguage}
            theirLanguage={callState.theirLanguage}
            isListening={status === 'connected' && !isMuted}
            translationStatus={callState.translationStatus}
            translationWarning={callState.translationWarning}
            translationLatencyMs={callState.translationLatencyMs}
            translationConfidence={callState.translationConfidence}
          />
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.sideControl, glass, isMuted && styles.sideControlActive, !interactive && styles.controlDisabled]}
            onPress={onToggleMute}
            disabled={!interactive}
          >
            <Text style={styles.sideControlTitle}>{isMuted ? 'Muted' : 'Mic Live'}</Text>
            <Text style={styles.sideControlHint}>Audio input</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.endButton} onPress={onEndCall}>
            <Text style={styles.endButtonText}>End</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sideControl, glass, isSpeakerOn && styles.sideControlActive, !interactive && styles.controlDisabled]}
            onPress={onToggleSpeaker}
            disabled={!interactive}
          >
            <Text style={styles.sideControlTitle}>{isSpeakerOn ? 'Speaker' : 'Private'}</Text>
            <Text style={styles.sideControlHint}>Audio output</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={[styles.modeButton, glass, !interactive && styles.controlDisabled]}
            onPress={() => onSetTranslationMode?.(nextTranslationMode(translationMode))}
            disabled={!interactive || !onSetTranslationMode}
          >
            <Text style={styles.modeButtonTitle}>{modeLabel(translationMode)} Translation</Text>
            <Text style={styles.modeButtonHint}>
              Voice state: {voiceTranslationStatus || 'idle'} • tap to cycle
            </Text>
          </TouchableOpacity>
        </View>

        {status === 'failed' && onRetryCall ? (
          <View style={styles.retryWrap}>
            <TouchableOpacity style={styles.retryButton} onPress={onRetryCall}>
              <Text style={styles.retryButtonText}>Retry Session</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </SafeAreaView>
    </PremiumBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  topSection: {
    alignItems: 'center',
    marginTop: 6,
  },
  signalPill: {
    borderRadius: premiumTheme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 18,
  },
  signalPillText: {
    color: premiumTheme.colors.cyan,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  callerInfo: {
    alignItems: 'center',
    marginTop: 16,
  },
  callerName: {
    color: premiumTheme.colors.text,
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  callStatus: {
    color: premiumTheme.colors.textMuted,
    fontSize: 16,
    marginTop: 10,
  },
  metaLine: {
    color: premiumTheme.colors.textSoft,
    fontSize: 12,
    marginTop: 8,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  metaCard: {
    flex: 1,
    borderRadius: premiumTheme.radius.lg,
    padding: 14,
  },
  metaCardLabel: {
    color: premiumTheme.colors.textSoft,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  metaCardValue: {
    color: premiumTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
  },
  warningCard: {
    marginTop: 12,
    borderRadius: premiumTheme.radius.md,
    padding: 14,
  },
  warningText: {
    color: premiumTheme.colors.amber,
    fontSize: 12,
    lineHeight: 18,
  },
  errorCard: {
    marginTop: 12,
    borderRadius: premiumTheme.radius.md,
    padding: 14,
    borderColor: 'rgba(251,113,133,0.32)',
  },
  errorText: {
    color: premiumTheme.colors.red,
    fontSize: 12,
    lineHeight: 18,
  },
  translationWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingVertical: 18,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sideControl: {
    flex: 1,
    minHeight: 86,
    borderRadius: premiumTheme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sideControlActive: {
    borderColor: 'rgba(79,123,255,0.55)',
    backgroundColor: 'rgba(79,123,255,0.16)',
  },
  controlDisabled: {
    opacity: 0.45,
  },
  sideControlTitle: {
    color: premiumTheme.colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  sideControlHint: {
    color: premiumTheme.colors.textSoft,
    fontSize: 11,
    marginTop: 6,
  },
  endButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: premiumTheme.colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: premiumTheme.colors.red,
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 12,
  },
  endButtonText: {
    color: premiumTheme.colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  bottomActions: {
    marginTop: 18,
  },
  modeButton: {
    borderRadius: premiumTheme.radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  modeButtonTitle: {
    color: premiumTheme.colors.text,
    fontWeight: '800',
    fontSize: 14,
  },
  modeButtonHint: {
    color: premiumTheme.colors.textMuted,
    fontSize: 11,
    marginTop: 6,
  },
  retryWrap: {
    marginTop: 16,
  },
  retryButton: {
    backgroundColor: premiumTheme.colors.blue,
    borderRadius: premiumTheme.radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: premiumTheme.colors.blue,
    shadowOpacity: 0.42,
    shadowRadius: 20,
    elevation: 10,
  },
  retryButtonText: {
    color: premiumTheme.colors.text,
    fontWeight: '800',
    fontSize: 15,
  },
});

export default CallScreen;
