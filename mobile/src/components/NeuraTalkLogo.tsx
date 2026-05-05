import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { premiumTheme } from '../theme/premium';

interface NeuraTalkLogoProps {
  size?: number;
  showWordmark?: boolean;
  subtitle?: string;
  compact?: boolean;
}

export function NeuraTalkLogo({
  size = 88,
  showWordmark = true,
  subtitle = 'CONNECT. COMMUNICATE. CARE.',
  compact = false,
}: NeuraTalkLogoProps) {
  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          <LinearGradient id="brandStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={premiumTheme.colors.blue} />
            <Stop offset="100%" stopColor={premiumTheme.colors.purple} />
          </LinearGradient>
        </Defs>
        <Path
          d="M33 86c-10-9-16-20-16-34 0-24 19-42 44-42 10 0 19 3 27 9"
          fill="none"
          stroke="url(#brandStroke)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <Path
          d="M33 86l-7 18 19-10h25"
          fill="none"
          stroke="url(#brandStroke)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx="42" cy="56" r="4" fill="url(#brandStroke)" />
        <Circle cx="56" cy="56" r="4" fill="url(#brandStroke)" />
        <Circle cx="70" cy="56" r="4" fill="url(#brandStroke)" />
        <Path
          d="M69 36a14 14 0 0 1 27-1 19 19 0 0 1 8 37v1a18 18 0 0 1-17 18H79a18 18 0 0 1-18-18V47a18 18 0 0 1 8-11Z"
          fill="none"
          stroke="url(#brandStroke)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx="88" cy="46" r="4" fill="url(#brandStroke)" />
        <Circle cx="100" cy="58" r="5" fill="url(#brandStroke)" />
        <Circle cx="84" cy="62" r="4" fill="url(#brandStroke)" />
        <Circle cx="95" cy="76" r="4" fill="url(#brandStroke)" />
        <Path d="M88 46l12 12-16 4 11 14" fill="none" stroke="url(#brandStroke)" strokeWidth="4" strokeLinecap="round" />
      </Svg>

      {showWordmark ? (
        <View style={[styles.wordmarkWrap, compact && styles.wordmarkWrapCompact]}>
          <Text style={[styles.wordmark, compact && styles.wordmarkCompact]}>
            <Text style={styles.wordmarkPrimary}>Neura</Text>
            <Text style={styles.wordmarkAccent}>Talk</Text>
          </Text>
          <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  wordmarkWrap: {
    alignItems: 'center',
    marginTop: 12,
  },
  wordmarkWrapCompact: {
    marginTop: 8,
  },
  wordmark: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.2,
  },
  wordmarkCompact: {
    fontSize: 28,
  },
  wordmarkPrimary: {
    color: '#EAF2FF',
  },
  wordmarkAccent: {
    color: premiumTheme.colors.purple,
  },
  subtitle: {
    color: premiumTheme.colors.textSoft,
    marginTop: 6,
    fontSize: 11,
    letterSpacing: 2.2,
  },
  subtitleCompact: {
    fontSize: 10,
    letterSpacing: 1.6,
  },
});

export default NeuraTalkLogo;
