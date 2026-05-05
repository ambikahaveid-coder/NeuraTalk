import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import PremiumBackground from '../components/PremiumBackground';
import NeuraTalkLogo from '../components/NeuraTalkLogo';
import { glass, premiumTheme } from '../theme/premium';

type Step = 'identifier' | 'otp';

export function LoginScreen() {
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<'email' | 'mobile'>('mobile');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmail = identifier.includes('@');

  const handleRequestOtp = async () => {
    if (!identifier.trim()) {
      setError('Enter your mobile number or work email');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const detectedChannel = isEmail ? 'email' : 'mobile';
      setChannel(detectedChannel);
      await requestOtp(identifier, detectedChannel);
      setStep('otp');
    } catch (err: any) {
      setError(err.message || 'Unable to send OTP right now');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim() || otp.length < 6) {
      setError('Enter the 6-digit OTP');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await verifyOtp(identifier, otp, channel);
    } catch (err: any) {
      setError(err.message || 'Invalid OTP');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PremiumBackground>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
          <View style={styles.hero}>
            <NeuraTalkLogo size={92} />
            <Text style={styles.heroTitle}>Premium AI Calling</Text>
            <Text style={styles.heroSubtitle}>
              Secure voice, video, face-to-face interpretation, and multilingual relay from one futuristic identity layer.
            </Text>
          </View>

          <View style={[styles.authCard, glass]}>
            <Text style={styles.cardEyebrow}>{step === 'identifier' ? 'Sign in' : 'Verify access'}</Text>
            <Text style={styles.cardTitle}>
              {step === 'identifier' ? 'Start your NeuraTalk session' : 'Enter your secure OTP'}
            </Text>
            <Text style={styles.cardHint}>
              {step === 'identifier'
                ? 'Use mobile for telecom login or email for back-office access.'
                : `Code sent to ${identifier}`}
            </Text>

            {step === 'identifier' ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Phone number or email"
                  placeholderTextColor={premiumTheme.colors.textSoft}
                  value={identifier}
                  onChangeText={setIdentifier}
                  keyboardType={isEmail ? 'email-address' : 'phone-pad'}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {!isEmail ? (
                  <Text style={styles.helperText}>
                    Default flow supports Indian numbers fast. International numbers should include full country code.
                  </Text>
                ) : null}
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
                <TouchableOpacity
                  style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                  onPress={handleRequestOtp}
                  disabled={isLoading}
                >
                  {isLoading ? <ActivityIndicator color={premiumTheme.colors.text} /> : <Text style={styles.primaryButtonText}>Send OTP</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="000000"
                  placeholderTextColor={premiumTheme.colors.textSoft}
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                  textContentType="oneTimeCode"
                />
                <Text style={styles.helperText}>
                  This OTP unlocks your encrypted call identity, translation settings, and device registration.
                </Text>
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
                <TouchableOpacity
                  style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={isLoading}
                >
                  {isLoading ? <ActivityIndicator color={premiumTheme.colors.text} /> : <Text style={styles.primaryButtonText}>Verify OTP</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    setStep('identifier');
                    setOtp('');
                    setError(null);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Change identity</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </PremiumBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 26,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 24,
  },
  heroTitle: {
    marginTop: 18,
    color: premiumTheme.colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: premiumTheme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 12,
    maxWidth: 320,
  },
  authCard: {
    borderRadius: premiumTheme.radius.xl,
    padding: 22,
    marginBottom: 10,
  },
  cardEyebrow: {
    color: premiumTheme.colors.cyan,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontSize: 12,
    marginBottom: 10,
  },
  cardTitle: {
    color: premiumTheme.colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  cardHint: {
    color: premiumTheme.colors.textMuted,
    marginTop: 10,
    marginBottom: 18,
    lineHeight: 20,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: premiumTheme.radius.lg,
    borderColor: premiumTheme.colors.borderStrong,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
    color: premiumTheme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    color: premiumTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  errorText: {
    color: premiumTheme.colors.red,
    marginTop: 14,
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: premiumTheme.colors.blue,
    borderRadius: premiumTheme.radius.pill,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 18,
    shadowColor: premiumTheme.colors.blue,
    shadowOpacity: 0.42,
    shadowRadius: 20,
    elevation: 10,
  },
  primaryButtonText: {
    color: premiumTheme.colors.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 10,
  },
  secondaryButtonText: {
    color: premiumTheme.colors.textMuted,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.72,
  },
});

export default LoginScreen;
