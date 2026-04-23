import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callApi } from '../services/api';

export function ConsentScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [translationConsent, setTranslationConsent] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);

  const saveConsentMutation = useMutation({
    mutationFn: () => callApi.grantConsent({
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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Enable Calling</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.heroSection}>
          <View style={styles.iconContainer}>
            <Text style={styles.heroIcon}>📞</Text>
          </View>
          <Text style={styles.heroTitle}>Enable Calling Features</Text>
          <Text style={styles.heroSubtitle}>
            Before you make your first call, please review and accept our terms
          </Text>
        </View>

        <View style={styles.featuresSection}>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>🌐</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Real-Time Translation</Text>
              <Text style={styles.featureDescription}>
                Your voice is processed by AI to translate in real-time. 
                The other person hears your voice in their language.
              </Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>🎤</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Voice Processing</Text>
              <Text style={styles.featureDescription}>
                Audio is processed in real-time for translation. 
                We don't store call content without your explicit consent.
              </Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>🔒</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Privacy First</Text>
              <Text style={styles.featureDescription}>
                All processing uses self-hosted, secure infrastructure. 
                No third-party telecom services access your calls.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.consentSection}>
          <Text style={styles.sectionTitle}>Your Consent</Text>

          <View style={styles.consentItem}>
            <View style={styles.consentContent}>
              <View style={styles.consentHeader}>
                <Text style={styles.consentTitle}>Terms & Conditions</Text>
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredText}>Required</Text>
                </View>
              </View>
              <Text style={styles.consentDescription}>
                I have read and agree to the Terms of Service and Privacy Policy.
              </Text>
            </View>
            <Switch
              value={termsAccepted}
              onValueChange={setTermsAccepted}
              trackColor={{ false: '#374151', true: '#22d3ee' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={styles.consentItem}>
            <View style={styles.consentContent}>
              <View style={styles.consentHeader}>
                <Text style={styles.consentTitle}>Translation Processing</Text>
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredText}>Required</Text>
                </View>
              </View>
              <Text style={styles.consentDescription}>
                I consent to real-time voice translation during calls.
              </Text>
            </View>
            <Switch
              value={translationConsent}
              onValueChange={setTranslationConsent}
              trackColor={{ false: '#374151', true: '#22d3ee' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={styles.consentItem}>
            <View style={styles.consentContent}>
              <View style={styles.consentHeader}>
                <Text style={styles.consentTitle}>Call Recording</Text>
                <View style={styles.optionalBadge}>
                  <Text style={styles.optionalText}>Optional</Text>
                </View>
              </View>
              <Text style={styles.consentDescription}>
                Allow recording of calls for quality improvement.
              </Text>
            </View>
            <Switch
              value={recordingConsent}
              onValueChange={setRecordingConsent}
              trackColor={{ false: '#374151', true: '#22d3ee' }}
              thumbColor="#ffffff"
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.proceedButton, !canProceed && styles.buttonDisabled]}
          onPress={() => saveConsentMutation.mutate()}
          disabled={!canProceed || saveConsentMutation.isPending}
        >
          {saveConsentMutation.isPending ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text style={styles.proceedButtonText}>Accept & Continue</Text>
          )}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backText: {
    color: '#22d3ee',
    fontSize: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(34, 211, 238, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroIcon: {
    fontSize: 40,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  featuresSection: {
    gap: 16,
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
  },
  featureIcon: {
    fontSize: 20,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 18,
  },
  consentSection: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  consentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
  },
  consentContent: {
    flex: 1,
  },
  consentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  consentTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  requiredBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 4,
  },
  requiredText: {
    fontSize: 10,
    color: '#ef4444',
  },
  optionalBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(34, 211, 238, 0.2)',
    borderRadius: 4,
  },
  optionalText: {
    fontSize: 10,
    color: '#22d3ee',
  },
  consentDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  proceedButton: {
    backgroundColor: '#22d3ee',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  proceedButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ConsentScreen;
