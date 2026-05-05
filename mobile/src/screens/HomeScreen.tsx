import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { RootNavigationProp } from '../../App';
import { useAuth } from '../hooks/useAuth';
import { callApi } from '../services/api';
import { CALL_LANGUAGE_OPTIONS } from '../config/languages';
import { TranslationMode } from '../types';
import PremiumBackground from '../components/PremiumBackground';
import NeuraTalkLogo from '../components/NeuraTalkLogo';
import { glass, premiumTheme } from '../theme/premium';

type CallExperience = 'audio' | 'video' | 'face_to_face';
type LanguageTarget = 'mine' | 'theirs';

const CALL_EXPERIENCES: Array<{
  id: CallExperience;
  title: string;
  subtitle: string;
  glow: string;
}> = [
  { id: 'audio', title: 'Audio Call', subtitle: 'Fastest low-latency conversation path', glow: premiumTheme.colors.blue },
  { id: 'video', title: 'Video Call', subtitle: 'Live camera + translated voice support', glow: premiumTheme.colors.purple },
  { id: 'face_to_face', title: 'Face to Face', subtitle: 'Premium interpreter-style session on video', glow: premiumTheme.colors.cyan },
];

const DIAL_PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

const FEATURE_CARDS = [
  {
    title: 'AI Voice Bridge',
    description: 'Switch between original voice, subtitles, and translated voice without losing the call.',
    accent: premiumTheme.colors.blue,
  },
  {
    title: 'Face-to-Face Relay',
    description: 'Run in-person interpretation sessions with camera context and safer fallback behavior.',
    accent: premiumTheme.colors.purple,
  },
  {
    title: 'PSTN Ready',
    description: 'Dial mobile numbers, monitor caller identity mode, and keep billing truth visible.',
    accent: premiumTheme.colors.green,
  },
];

const TRANSLATION_OPTIONS: Array<{ code: TranslationMode; name: string }> = [
  { code: 'off', name: 'Original Voice' },
  { code: 'subtitles', name: 'Subtitles' },
  { code: 'voice', name: 'Voice Translate' },
];

export function HomeScreen() {
  const navigation = useNavigation<RootNavigationProp>();
  const { user, logout } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [myLanguage, setMyLanguage] = useState('en');
  const [theirLanguage, setTheirLanguage] = useState('auto');
  const [translationMode, setTranslationMode] = useState<TranslationMode>('voice');
  const [activeLanguageTarget, setActiveLanguageTarget] = useState<LanguageTarget>('mine');
  const [languageSearch, setLanguageSearch] = useState('');
  const [experience, setExperience] = useState<CallExperience>('audio');
  const fabPulse = useRef(new Animated.Value(0.92)).current;

  const { data: consentData } = useQuery({
    queryKey: ['callConsent'],
    queryFn: () => callApi.checkConsent(),
  });

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fabPulse, { toValue: 1.02, duration: 1100, useNativeDriver: true }),
        Animated.timing(fabPulse, { toValue: 0.92, duration: 1100, useNativeDriver: true }),
      ]),
    ).start();
  }, [fabPulse]);

  const filteredLanguages = useMemo(() => {
    const query = languageSearch.trim().toLowerCase();
    if (!query) {
      return CALL_LANGUAGE_OPTIONS;
    }
    return CALL_LANGUAGE_OPTIONS.filter((language) =>
      language.name.toLowerCase().includes(query) || language.code.toLowerCase().includes(query),
    );
  }, [languageSearch]);

  const liveActivity = useMemo(() => {
    const modeLabel = experience === 'face_to_face' ? 'Face to Face Relay' : experience === 'video' ? 'Video Session' : 'Audio Session';
    const translationLabel = translationMode === 'voice' ? 'Voice active when ready' : translationMode === 'subtitles' ? 'Subtitle safety mode' : 'Original voice only';
    return `${modeLabel} • ${translationLabel}`;
  }, [experience, translationMode]);

  const earningsHeadline = user?.role === 'agent' || user?.role === 'company_admin'
    ? 'Revenue sync becomes live after billable calls'
    : 'Usage insights unlock after your first completed session';

  const appendDial = (digit: string) => {
    setPhoneNumber((prev) => `${prev}${digit}`);
  };

  const handleBackspace = () => {
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const handleStartCall = () => {
    if (!consentData?.hasConsent) {
      navigation.navigate('Consent');
      return;
    }

    if (!phoneNumber.trim()) {
      return;
    }

    navigation.navigate('Call', {
      phoneNumber,
      myLanguage,
      theirLanguage,
      translationMode,
      callType: experience === 'audio' ? 'voice' : 'video',
      callExperience: experience,
    });
  };

  const setLanguage = (code: string) => {
    if (activeLanguageTarget === 'mine') {
      setMyLanguage(code);
      return;
    }
    setTheirLanguage(code);
  };

  const selectedLanguage = activeLanguageTarget === 'mine' ? myLanguage : theirLanguage;

  return (
    <PremiumBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.eyebrow}>Premium AI Calling</Text>
              <Text style={styles.greeting}>Hi, {user?.name || user?.email || user?.phone || 'NeuraTalk User'}</Text>
              <Text style={styles.subGreeting}>Audio, video, and face-to-face translation in one control room.</Text>
            </View>
            <TouchableOpacity style={styles.logoutButton} onPress={logout}>
              <Text style={styles.logoutText}>Exit</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.heroCard, glass]}>
            <NeuraTalkLogo size={76} />
            <View style={styles.heroMeta}>
              <Text style={styles.heroTitle}>NeuraTalk AI Relay</Text>
              <Text style={styles.heroSubtitle}>
                Futuristic multilingual calling with safer translation fallback, lipsync-aware sessions, and operational truth.
              </Text>
            </View>
          </View>

          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, glass]}>
              <Text style={styles.metricLabel}>Earnings</Text>
              <Text style={styles.metricValue}>Live Sync</Text>
              <Text style={styles.metricHint}>{earningsHeadline}</Text>
            </View>
            <View style={[styles.metricCard, glass]}>
              <Text style={styles.metricLabel}>Live Activity</Text>
              <Text style={styles.metricValue}>Ready</Text>
              <Text style={styles.metricHint}>{liveActivity}</Text>
            </View>
          </View>

          <View style={[styles.panel, glass]}>
            <Text style={styles.sectionTitle}>Call Experience</Text>
            <Text style={styles.sectionHint}>Audio, video, and face-to-face options stay visible and intentional.</Text>
            <View style={styles.experienceGrid}>
              {CALL_EXPERIENCES.map((option) => {
                const active = option.id === experience;
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.experienceCard,
                      active && { borderColor: option.glow, shadowColor: option.glow, shadowOpacity: 0.35, elevation: 8 },
                    ]}
                    onPress={() => setExperience(option.id)}
                  >
                    <Text style={styles.experienceTitle}>{option.title}</Text>
                    <Text style={styles.experienceSubtitle}>{option.subtitle}</Text>
                    {option.id === 'face_to_face' ? (
                      <Text style={styles.experienceFootnote}>Runs on video session today for reliable transport.</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.panel, glass]}>
            <View style={styles.panelHeaderRow}>
              <View>
                <Text style={styles.sectionTitle}>Language Studio</Text>
                <Text style={styles.sectionHint}>Rounded chips, search, and auto-detect with a premium control feel.</Text>
              </View>
              <View style={styles.targetToggle}>
                <TouchableOpacity
                  style={[styles.targetChip, activeLanguageTarget === 'mine' && styles.targetChipActive]}
                  onPress={() => setActiveLanguageTarget('mine')}
                >
                  <Text style={styles.targetChipText}>I speak</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.targetChip, activeLanguageTarget === 'theirs' && styles.targetChipActive]}
                  onPress={() => setActiveLanguageTarget('theirs')}
                >
                  <Text style={styles.targetChipText}>They hear</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TextInput
              style={styles.searchInput}
              placeholder="Search language or use auto detect"
              placeholderTextColor={premiumTheme.colors.textSoft}
              value={languageSearch}
              onChangeText={setLanguageSearch}
            />

            <View style={styles.chipWrap}>
              {filteredLanguages.map((language) => {
                const active = selectedLanguage === language.code;
                return (
                  <TouchableOpacity
                    key={language.code}
                    style={[styles.languageChip, active && styles.languageChipActive]}
                    onPress={() => setLanguage(language.code)}
                  >
                    <Text style={[styles.languageChipText, active && styles.languageChipTextActive]}>
                      {language.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.panel, glass]}>
            <Text style={styles.sectionTitle}>Dial Pad</Text>
            <Text style={styles.sectionHint}>Glow-driven keypad with one-tap AI mode visibility.</Text>

            <View style={styles.dialHeader}>
              <TextInput
                style={styles.phoneInput}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="+91 98765 43210"
                placeholderTextColor={premiumTheme.colors.textSoft}
                keyboardType="phone-pad"
              />
              <View style={[styles.translationBadge, translationMode === 'voice' ? styles.translationBadgeOn : styles.translationBadgeOff]}>
                <Text style={styles.translationBadgeText}>
                  AI {translationMode === 'voice' ? 'ON' : translationMode === 'subtitles' ? 'CAPTION' : 'OFF'}
                </Text>
              </View>
            </View>

            <View style={styles.chipWrap}>
              {TRANSLATION_OPTIONS.map((option) => {
                const active = option.code === translationMode;
                return (
                  <TouchableOpacity
                    key={option.code}
                    style={[styles.languageChip, active && styles.languageChipActive]}
                    onPress={() => setTranslationMode(option.code)}
                  >
                    <Text style={[styles.languageChipText, active && styles.languageChipTextActive]}>{option.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.keypad}>
              {DIAL_PAD.map((row) => (
                <View key={row.join('-')} style={styles.keypadRow}>
                  {row.map((digit) => (
                    <TouchableOpacity key={digit} style={styles.keypadKey} onPress={() => appendDial(digit)}>
                      <Text style={styles.keypadKeyText}>{digit}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </View>

            <View style={styles.dialActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleBackspace}>
                <Text style={styles.secondaryButtonText}>Delete</Text>
              </TouchableOpacity>
              <Animated.View style={{ transform: [{ scale: fabPulse }] }}>
                <TouchableOpacity style={styles.callActionButton} onPress={handleStartCall}>
                  <Text style={styles.callActionButtonText}>
                    {experience === 'audio' ? 'Start Audio' : experience === 'video' ? 'Start Video' : 'Start Face-to-Face'}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          </View>

          <View style={styles.featureGrid}>
            {FEATURE_CARDS.map((feature) => (
              <View key={feature.title} style={[styles.featureCard, glass, { borderColor: `${feature.accent}66` }]}>
                <Text style={[styles.featureTitle, { color: feature.accent }]}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </PremiumBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 36,
    gap: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  eyebrow: {
    color: premiumTheme.colors.cyan,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  greeting: {
    color: premiumTheme.colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subGreeting: {
    color: premiumTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 8,
    maxWidth: 280,
    lineHeight: 19,
  },
  logoutButton: {
    ...glass,
    borderRadius: premiumTheme.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logoutText: {
    color: premiumTheme.colors.text,
    fontWeight: '600',
  },
  heroCard: {
    borderRadius: premiumTheme.radius.xl,
    padding: 22,
    overflow: 'hidden',
  },
  heroMeta: {
    marginTop: 14,
  },
  heroTitle: {
    color: premiumTheme.colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: premiumTheme.colors.textMuted,
    marginTop: 8,
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    borderRadius: premiumTheme.radius.lg,
    padding: 18,
  },
  metricLabel: {
    color: premiumTheme.colors.textSoft,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  metricValue: {
    color: premiumTheme.colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 10,
  },
  metricHint: {
    color: premiumTheme.colors.textMuted,
    marginTop: 8,
    lineHeight: 18,
    fontSize: 12,
  },
  panel: {
    borderRadius: premiumTheme.radius.xl,
    padding: 20,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  sectionTitle: {
    color: premiumTheme.colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  sectionHint: {
    color: premiumTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },
  experienceGrid: {
    gap: 12,
    marginTop: 16,
  },
  experienceCard: {
    backgroundColor: premiumTheme.colors.surfaceStrong,
    borderColor: premiumTheme.colors.border,
    borderWidth: 1,
    borderRadius: premiumTheme.radius.lg,
    padding: 16,
  },
  experienceTitle: {
    color: premiumTheme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  experienceSubtitle: {
    color: premiumTheme.colors.textMuted,
    marginTop: 8,
    lineHeight: 18,
    fontSize: 12,
  },
  experienceFootnote: {
    color: premiumTheme.colors.textSoft,
    marginTop: 10,
    fontSize: 11,
  },
  targetToggle: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: premiumTheme.radius.pill,
    padding: 4,
  },
  targetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: premiumTheme.radius.pill,
  },
  targetChipActive: {
    backgroundColor: 'rgba(79,123,255,0.28)',
  },
  targetChipText: {
    color: premiumTheme.colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  searchInput: {
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: premiumTheme.colors.borderStrong,
    borderWidth: 1,
    borderRadius: premiumTheme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: premiumTheme.colors.text,
    fontSize: 15,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  languageChip: {
    borderRadius: premiumTheme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  languageChipActive: {
    backgroundColor: 'rgba(79,123,255,0.24)',
    borderColor: 'rgba(138,92,255,0.72)',
    shadowColor: premiumTheme.colors.purple,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  languageChipText: {
    color: premiumTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  languageChipTextActive: {
    color: premiumTheme.colors.text,
  },
  dialHeader: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  phoneInput: {
    flex: 1,
    color: premiumTheme.colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: premiumTheme.colors.borderStrong,
    borderRadius: premiumTheme.radius.lg,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  translationBadge: {
    borderRadius: premiumTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 86,
    alignItems: 'center',
  },
  translationBadgeOn: {
    backgroundColor: 'rgba(79,123,255,0.22)',
    borderColor: 'rgba(79,123,255,0.48)',
    borderWidth: 1,
  },
  translationBadgeOff: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: premiumTheme.colors.border,
    borderWidth: 1,
  },
  translationBadgeText: {
    color: premiumTheme.colors.text,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  keypad: {
    marginTop: 18,
    gap: 12,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  keypadKey: {
    width: 88,
    height: 72,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(138,92,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: premiumTheme.colors.blue,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 4,
  },
  keypadKeyText: {
    color: premiumTheme.colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  dialActions: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secondaryButton: {
    borderRadius: premiumTheme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: premiumTheme.colors.textMuted,
    fontWeight: '700',
  },
  callActionButton: {
    minWidth: 192,
    borderRadius: premiumTheme.radius.pill,
    paddingHorizontal: 28,
    paddingVertical: 18,
    backgroundColor: premiumTheme.colors.blue,
    shadowColor: premiumTheme.colors.blue,
    shadowOpacity: 0.44,
    shadowRadius: 22,
    elevation: 12,
  },
  callActionButtonText: {
    color: premiumTheme.colors.text,
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  featureGrid: {
    gap: 12,
  },
  featureCard: {
    borderRadius: premiumTheme.radius.lg,
    padding: 18,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  featureDescription: {
    color: premiumTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
});

export default HomeScreen;
