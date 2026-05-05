import React, { useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callApi } from '../services/api';
import PremiumBackground from '../components/PremiumBackground';
import NeuraTalkLogo from '../components/NeuraTalkLogo';
import { glass, premiumTheme } from '../theme/premium';

const CONSENT_ITEMS = [
  {
    key: 'translation',
    icon: 'AI',
    title: 'Realtime Translation',
    description: 'NeuraTalk processes live speech to deliver translated conversations without blocking the call.',
  },
  {
    key: 'privacy',
    icon: 'SEC',
    title: 'Private by Design',
    description: 'Call flows use secure transport. Recording and retention only happen when the account policy allows it.',
  },
  {
    key: 'quality',
    icon: 'OPS',
    title: 'Production Safety',
    description: 'When translation is slow or unavailable, the voice call continues with honest fallback states.',
  },
];

export function ConsentScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [translationConsent, setTranslationConsent] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);

  const saveConsentMutation = useMutation({
    mutationFn: () =>
      callApi.grantConsent({
        termsAccepted,
        translationConsent,
        recordingConsent,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['callConsent'] });
      navigation.goBack();
    },
  });

  const canProceed = termsAccepted && translationConsent;

  return (
    <PremiumBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Call Consent</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.heroCard, glass]}>
            <NeuraTalkLogo compact />
            <Text style={styles.heroTitle}>Enable Premium AI Calling</Text>
            <Text style={styles.heroSubtitle}>
              Before your first audio, video, or face-to-face session, confirm how translation and privacy should work for this device.
            </Text>
          </View>

          <View style={styles.infoStack}>
            {CONSENT_ITEMS.map((item) => (
              <View key={item.key} style={[styles.infoCard, glass]}>
                <View style={styles.infoIcon}>
                  <Text style={styles.infoIconText}>{item.icon}</Text>
                </View>
                <View style={styles.infoBody}>
                  <Text style={styles.infoTitle}>{item.title}</Text>
                  <Text style={styles.infoDescription}>{item.description}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.sectionCard, glass]}>
            <Text style={styles.sectionEyebrow}>Required Permissions</Text>
            <Text style={styles.sectionTitle}>Choose your consent preferences</Text>

            <ConsentRow
              title="Terms and Privacy"
              description="Agree to the service terms and privacy policy for calling and verification."
              badge="Required"
              value={termsAccepted}
              onValueChange={setTermsAccepted}
              accent={premiumTheme.colors.red}
            />
            <ConsentRow
              title="Voice Translation Processing"
              description="Allow live speech processing for subtitles and translated voice when you enable it in a call."
              badge="Required"
              value={translationConsent}
              onValueChange={setTranslationConsent}
              accent={premiumTheme.colors.red}
            />
            <ConsentRow
              title="Call Recording Controls"
              description="Optional quality review and audit recording, subject to account policy and backend support."
              badge="Optional"
              value={recordingConsent}
              onValueChange={setRecordingConsent}
              accent={premiumTheme.colors.blue}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerNote}>
            Translation never blocks call audio. You can switch between original voice, subtitles, and voice translation inside the app.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, !canProceed && styles.primaryButtonDisabled]}
            disabled={!canProceed || saveConsentMutation.isPending}
            onPress={() => saveConsentMutation.mutate()}
          >
            {saveConsentMutation.isPending ? (
              <ActivityIndicator color={premiumTheme.colors.text} />
            ) : (
              <Text style={styles.primaryButtonText}>Accept and Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </PremiumBackground>
  );
}

interface ConsentRowProps {
  title: string;
  description: string;
  badge: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  accent: string;
}

function ConsentRow({ title, description, badge, value, onValueChange, accent }: ConsentRowProps) {
  return (
    <View style={styles.consentRow}>
      <View style={styles.consentTextWrap}>
        <View style={styles.consentHeader}>
          <Text style={styles.consentTitle}>{title}</Text>
          <View style={[styles.badge, { backgroundColor: `${accent}22`, borderColor: `${accent}44` }]}>
            <Text style={[styles.badgeText, { color: accent }]}>{badge}</Text>
          </View>
        </View>
        <Text style={styles.consentDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        thumbColor={premiumTheme.colors.text}
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: premiumTheme.colors.blue }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: premiumTheme.colors.border,
  },
  backButtonText: {
    color: premiumTheme.colors.text,
    fontWeight: '600',
  },
  headerTitle: {
    color: premiumTheme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  headerSpacer: {
    width: 82,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 18,
  },
  heroCard: {
    marginTop: 10,
    borderRadius: 28,
    padding: 24,
    overflow: 'hidden',
  },
  heroTitle: {
    marginTop: 18,
    color: premiumTheme.colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  heroSubtitle: {
    marginTop: 8,
    color: premiumTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  infoStack: {
    gap: 14,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderRadius: 24,
    padding: 18,
  },
  infoIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(79,123,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(79,123,255,0.32)',
  },
  infoIconText: {
    color: premiumTheme.colors.cyan,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  infoBody: {
    flex: 1,
  },
  infoTitle: {
    color: premiumTheme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  infoDescription: {
    marginTop: 6,
    color: premiumTheme.colors.textMuted,
    lineHeight: 20,
    fontSize: 13,
  },
  sectionCard: {
    borderRadius: 28,
    padding: 22,
    gap: 18,
  },
  sectionEyebrow: {
    color: premiumTheme.colors.cyan,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: premiumTheme.colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  consentTextWrap: {
    flex: 1,
  },
  consentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  consentTitle: {
    color: premiumTheme.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  consentDescription: {
    marginTop: 6,
    color: premiumTheme.colors.textMuted,
    lineHeight: 19,
    fontSize: 13,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(5,11,26,0.82)',
  },
  footerNote: {
    color: premiumTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  primaryButton: {
    borderRadius: 22,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: premiumTheme.colors.blue,
    shadowColor: premiumTheme.colors.blue,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: premiumTheme.colors.text,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.4,
  },
});

export default ConsentScreen;
