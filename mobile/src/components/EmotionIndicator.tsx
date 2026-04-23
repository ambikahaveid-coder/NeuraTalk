import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Emotion, EMOTION_COLORS } from '../types';

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
  sm: { container: 24, dot: 12, fontSize: 10 },
  md: { container: 36, dot: 18, fontSize: 12 },
  lg: { container: 48, dot: 24, fontSize: 14 },
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
          styles.indicator,
          {
            width: dimensions.container,
            height: dimensions.container,
            backgroundColor: `${color}33`,
            borderRadius: dimensions.container / 2,
          },
        ]}
      >
        <View
          style={[
            styles.dot,
            {
              width: dimensions.dot,
              height: dimensions.dot,
              backgroundColor: color,
              borderRadius: dimensions.dot / 2,
            },
          ]}
        />
      </View>
      {showLabel && (
        <Text style={[styles.label, { fontSize: dimensions.fontSize, color }]}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 4,
  },
  indicator: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {},
  label: {
    fontWeight: '600',
  },
});

export default EmotionIndicator;
