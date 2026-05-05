import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { TranslationEntry, Emotion, EMOTION_COLORS, CallState } from '../types';
import { getLanguageName } from '../config/languages';
import { glass, premiumTheme } from '../theme/premium';

interface TranslationSubtitlesProps {
  entries: TranslationEntry[];
  currentEmotion?: Emotion | null;
  myLanguage: string;
  theirLanguage: string;
  isListening?: boolean;
  translationStatus?: CallState['translationStatus'];
  translationWarning?: string;
  translationLatencyMs?: number;
  translationConfidence?: number;
}

const statusTitle = (status?: CallState['translationStatus']): string => {
  switch (status) {
    case 'listening':
      return 'Listening...';
    case 'translating':
      return 'Translating...';
    case 'unavailable':
      return 'Translation unavailable';
    case 'disabled':
      return 'Translation paused';
    default:
      return 'Live Translation';
  }
};

const placeholderText = (status?: CallState['translationStatus']): string => {
  switch (status) {
    case 'unavailable':
      return 'Translation is unavailable right now. Audio call continues normally.';
    case 'disabled':
      return 'Translation is paused for this language pair.';
    case 'translating':
      return 'Translating the latest stable phrase...';
    default:
      return 'Waiting for a clear phrase...';
  }
};

export function TranslationSubtitles({
  entries,
  currentEmotion,
  myLanguage,
  theirLanguage,
  isListening = false,
  translationStatus = 'idle',
  translationWarning,
  translationLatencyMs,
  translationConfidence,
}: TranslationSubtitlesProps) {
  const recentEntries = entries.slice(-5);
  const emotionColor = currentEmotion ? EMOTION_COLORS[currentEmotion] : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>{statusTitle(translationStatus)}</Text>
          {isListening && <View style={styles.listeningDot} />}
        </View>
        {currentEmotion ? (
          <View style={[styles.emotionBadge, { backgroundColor: `${emotionColor}33` }]}>
            <Text style={[styles.emotionText, { color: emotionColor }]}>
              {currentEmotion}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.languageRow}>
        <Text style={styles.languageText}>You: {getLanguageName(myLanguage)}</Text>
        <Text style={styles.arrow}>to</Text>
        <Text style={styles.languageText}>Them: {getLanguageName(theirLanguage)}</Text>
      </View>

      {translationWarning ? (
        <Text style={styles.warningText}>{translationWarning}</Text>
      ) : null}

      {(translationLatencyMs || translationConfidence != null) ? (
        <Text style={styles.metaText}>
          {translationLatencyMs ? `Latency ${translationLatencyMs}ms` : 'Latency n/a'}
          {translationConfidence != null ? `  |  Confidence ${Math.round(translationConfidence * 100)}%` : ''}
        </Text>
      ) : null}

      <ScrollView style={styles.entriesList} showsVerticalScrollIndicator={false}>
        {recentEntries.length === 0 ? (
          <Text style={styles.placeholder}>{placeholderText(translationStatus)}</Text>
        ) : (
          recentEntries.map((entry) => (
            <View
              key={entry.id}
              style={[
                styles.entry,
                entry.speaker === 'me' ? styles.entryMe : styles.entryThem,
              ]}
            >
              <Text style={styles.speakerLabel}>
                {entry.speaker === 'me' ? 'You' : 'Them'}
              </Text>
              <Text style={styles.originalText}>{entry.originalText}</Text>
              <Text style={styles.translatedText}>{entry.translatedText}</Text>
              {(entry.latencyMs || entry.confidence != null || entry.mixedLanguage) ? (
                <Text style={styles.entryMeta}>
                  {entry.latencyMs ? `${entry.latencyMs}ms` : 'n/a'}
                  {entry.confidence != null ? `  |  ${Math.round(entry.confidence * 100)}% confidence` : ''}
                  {entry.mixedLanguage ? '  |  mixed language' : ''}
                </Text>
              ) : null}
              {entry.emotion ? (
                <View
                  style={[
                    styles.entryEmotion,
                    { backgroundColor: `${EMOTION_COLORS[entry.emotion]}33` },
                  ]}
                >
                  <Text
                    style={[styles.entryEmotionText, { color: EMOTION_COLORS[entry.emotion] }]}
                  >
                    {entry.emotion}
                  </Text>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...glass,
    backgroundColor: 'rgba(7, 14, 28, 0.68)',
    borderRadius: 22,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: premiumTheme.colors.cyan,
    fontSize: 14,
    fontWeight: '600',
  },
  listeningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  emotionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  emotionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  languageText: {
    color: premiumTheme.colors.textMuted,
    fontSize: 12,
  },
  arrow: {
    color: premiumTheme.colors.cyan,
    fontSize: 12,
  },
  warningText: {
    color: premiumTheme.colors.amber,
    fontSize: 12,
    marginBottom: 8,
  },
  metaText: {
    color: premiumTheme.colors.textSoft,
    fontSize: 11,
    marginBottom: 10,
  },
  entriesList: {
    maxHeight: 150,
  },
  placeholder: {
    color: premiumTheme.colors.textSoft,
    textAlign: 'center',
    paddingVertical: 16,
  },
  entry: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  entryMe: {
    backgroundColor: 'rgba(79,123,255,0.22)',
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  entryThem: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignSelf: 'flex-start',
    maxWidth: '80%',
  },
  speakerLabel: {
    color: premiumTheme.colors.textSoft,
    fontSize: 10,
    marginBottom: 4,
  },
  originalText: {
    color: premiumTheme.colors.textMuted,
    fontSize: 12,
    marginBottom: 2,
  },
  translatedText: {
    color: premiumTheme.colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  entryMeta: {
    color: premiumTheme.colors.textSoft,
    fontSize: 10,
    marginTop: 4,
  },
  entryEmotion: {
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  entryEmotionText: {
    fontSize: 10,
  },
});

export default TranslationSubtitles;
