import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { premiumTheme } from '../theme/premium';

interface PremiumBackgroundProps {
  children: React.ReactNode;
}

export function PremiumBackground({ children }: PremiumBackgroundProps) {
  return (
    <View style={styles.container}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
        <Defs>
          <LinearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={premiumTheme.colors.background} />
            <Stop offset="50%" stopColor="#081126" />
            <Stop offset="100%" stopColor="#111A35" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bg)" />
      </Svg>

      <View style={[styles.glow, styles.glowBlue]} />
      <View style={[styles.glow, styles.glowPurple]} />
      <View style={[styles.glow, styles.glowCyan]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: premiumTheme.colors.background,
  },
  glow: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.34,
  },
  glowBlue: {
    width: 220,
    height: 220,
    top: -30,
    right: -40,
    backgroundColor: premiumTheme.colors.blue,
    shadowColor: premiumTheme.colors.blue,
    shadowOpacity: 0.5,
    shadowRadius: 70,
    elevation: 18,
  },
  glowPurple: {
    width: 260,
    height: 260,
    bottom: 120,
    left: -90,
    backgroundColor: premiumTheme.colors.purple,
    shadowColor: premiumTheme.colors.purple,
    shadowOpacity: 0.48,
    shadowRadius: 78,
    elevation: 18,
  },
  glowCyan: {
    width: 180,
    height: 180,
    top: '40%',
    right: 10,
    backgroundColor: '#35D7FF',
    shadowColor: '#35D7FF',
    shadowOpacity: 0.22,
    shadowRadius: 52,
    elevation: 12,
  },
});

export default PremiumBackground;
