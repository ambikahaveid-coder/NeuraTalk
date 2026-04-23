import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { TranslationSubtitles } from '../components/TranslationSubtitles';
import { EmotionIndicator } from '../components/EmotionIndicator';
import { CallState, LANGUAGES } from '../types';

interface CallScreenProps {
  callState: CallState;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
}

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export function CallScreen({
  callState,
  onEndCall,
  onToggleMute,
  onToggleSpeaker,
}: CallScreenProps) {
  const { status, phoneNumber, callerName, duration, isMuted, isSpeakerOn } = callState;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <EmotionIndicator
          emotion={callState.currentEmotion}
          size="lg"
          showLabel={true}
        />
        
        <View style={styles.callerInfo}>
          <Text style={styles.callerName}>{callerName || phoneNumber || 'Unknown'}</Text>
          <Text style={styles.callStatus}>
            {status === 'dialing' && 'Calling...'}
            {status === 'ringing' && 'Ringing...'}
            {status === 'active' && formatDuration(duration)}
          </Text>
        </View>
      </View>

      <View style={styles.translationContainer}>
        <TranslationSubtitles
          entries={callState.translations}
          currentEmotion={callState.currentEmotion}
          myLanguage={callState.myLanguage}
          theirLanguage={callState.theirLanguage}
          isListening={status === 'active' && !isMuted}
        />
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, isMuted && styles.controlButtonActive]}
          onPress={onToggleMute}
        >
          <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
          <Text style={styles.controlLabel}>Mute</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.endCallButton]}
          onPress={onEndCall}
        >
          <Text style={styles.endCallIcon}>📞</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, isSpeakerOn && styles.controlButtonActive]}
          onPress={onToggleSpeaker}
        >
          <Text style={styles.controlIcon}>{isSpeakerOn ? '🔊' : '🔈'}</Text>
          <Text style={styles.controlLabel}>Speaker</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  callerInfo: {
    alignItems: 'center',
    marginTop: 20,
  },
  callerName: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
  },
  callStatus: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    marginTop: 8,
  },
  translationContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'flex-end',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 40,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  controlButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.5)',
  },
  controlIcon: {
    fontSize: 24,
  },
  controlLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    marginTop: 4,
  },
  endCallButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '135deg' }],
  },
  endCallIcon: {
    fontSize: 28,
  },
});

export default CallScreen;
