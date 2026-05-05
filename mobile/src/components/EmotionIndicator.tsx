import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Emotion, EMOTION_COLORS } from '../types';
import { premiumTheme } from '../theme/premium';

interface EmotionIndicatorProps {
  emotion: Emotion | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const EMOTION_LABELS: Record<Emotion, string> = {
  happy: 'Happy',
  calm: 'Calm',
  angry: 'Frustrated',
  sad: 'Sad',
  stressed: 'Stressed',
  neutral: 'Neutral',
  excited: 'Excited',
};

const SIZES = {
  sm: { shell: 30, core: 12, fontSize: 10 },
  md: { shell: 42, core: 16, fontSize: 12 },
  lg: { shell: 56, core: 22, fontSize: 14 },
};

export function EmotionIndicator({ emotion, size = 'md', showLabel = true }: EmotionIndicatorProps) {
  if (!emotion) return null;

  const color = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral;
  const label = EMOTION_LABELS[emotion] || 'Unknown';
  const dimensions = SIZES[size];

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.shell,
          {
            width: dimensions.shell,
            height: dimensions.shell,
            borderRadius: dimensions.shell / 2,
            borderColor: `${color}66`,
            shadowColor: color,
          },
        ]}
      >
        <View
          style={[
            styles.core,
            {
              width: dimensions.core,
              height: dimensions.core,
              borderRadius: dimensions.core / 2,
              backgroundColor: color,
              shadowColor: color,
            },
          ]}
        />
      </View>
      {showLabel ? (
        <Text style={[styles.label, { fontSize: dimensions.fontSize, color }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
  },
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 251, 255, 0.05)',
    borderWidth: 1,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  core: {
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 4,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});

export default EmotionIndicator;
