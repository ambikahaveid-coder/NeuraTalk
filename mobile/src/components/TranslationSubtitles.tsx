import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { TranslationEntry, Emotion, EMOTION_COLORS, LANGUAGES } from '../types';

interface TranslationSubtitlesProps {
  entries: TranslationEntry[];
  currentEmotion?: Emotion | null;
  myLanguage: string;
  theirLanguage: string;
  isListening?: boolean;
}

const getLanguageName = (code: string): string => {
  const lang = LANGUAGES.find(l => l.code === code);
  return lang?.name || code;
};

export function TranslationSubtitles({
  entries,
  currentEmotion,
  myLanguage,
  theirLanguage,
  isListening = false,
}: TranslationSubtitlesProps) {
  const recentEntries = entries.slice(-5);
  const emotionColor = currentEmotion ? EMOTION_COLORS[currentEmotion] : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Live Translation</Text>
          {isListening && <View style={styles.listeningDot} />}
        </View>
        {currentEmotion && (
          <View style={[styles.emotionBadge, { backgroundColor: `${emotionColor}33` }]}>
            <Text style={[styles.emotionText, { color: emotionColor }]}>
              {currentEmotion}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.languageRow}>
        <Text style={styles.languageText}>You: {getLanguageName(myLanguage)}</Text>
        <Text style={styles.arrow}>→</Text>
        <Text style={styles.languageText}>Them: {getLanguageName(theirLanguage)}</Text>
      </View>

      <ScrollView style={styles.entriesList} showsVerticalScrollIndicator={false}>
        {recentEntries.length === 0 ? (
          <Text style={styles.placeholder}>Waiting for speech...</Text>
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
              {entry.emotion && (
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
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 16,
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
    color: '#22d3ee',
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
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },
  arrow: {
    color: '#22d3ee',
    fontSize: 12,
  },
  entriesList: {
    maxHeight: 150,
  },
  placeholder: {
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    paddingVertical: 16,
  },
  entry: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  entryMe: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  entryThem: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignSelf: 'flex-start',
    maxWidth: '80%',
  },
  speakerLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    marginBottom: 4,
  },
  originalText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginBottom: 2,
  },
  translatedText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
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
