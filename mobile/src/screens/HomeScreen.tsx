import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { callApi } from '../services/api';
import { LANGUAGES } from '../types';

export function HomeScreen() {
  const navigation = useNavigation();
  const { user, logout } = useAuth();
  
  const [phoneNumber, setPhoneNumber] = useState('');
  const [myLanguage, setMyLanguage] = useState('en');
  const [theirLanguage, setTheirLanguage] = useState('es');

  const { data: consentData } = useQuery({
    queryKey: ['callConsent'],
    queryFn: () => callApi.checkConsent(),
  });

  const handleStartCall = () => {
    if (!consentData?.hasConsent) {
      navigation.navigate('Consent' as never);
      return;
    }

    if (!phoneNumber.trim()) {
      return;
    }

    navigation.navigate('Call' as never, {
      phoneNumber,
      myLanguage,
      theirLanguage,
    } as never);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.userName}>{user?.name || user?.email || user?.phone}</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.callCard}>
          <Text style={styles.sectionTitle}>Start a Call</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={styles.input}
              placeholder="+1 234 567 8900"
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.languageRow}>
            <View style={styles.languageSelect}>
              <Text style={styles.label}>Your Language</Text>
              <View style={styles.languageOptions}>
                {LANGUAGES.slice(0, 5).map((lang) => (
                  <TouchableOpacity
                    key={lang.code}
                    style={[
                      styles.languageOption,
                      myLanguage === lang.code && styles.languageOptionActive,
                    ]}
                    onPress={() => setMyLanguage(lang.code)}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        myLanguage === lang.code && styles.languageOptionTextActive,
                      ]}
                    >
                      {lang.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.languageRow}>
            <View style={styles.languageSelect}>
              <Text style={styles.label}>Their Language</Text>
              <View style={styles.languageOptions}>
                {LANGUAGES.slice(0, 5).map((lang) => (
                  <TouchableOpacity
                    key={lang.code}
                    style={[
                      styles.languageOption,
                      theirLanguage === lang.code && styles.languageOptionActive,
                    ]}
                    onPress={() => setTheirLanguage(lang.code)}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        theirLanguage === lang.code && styles.languageOptionTextActive,
                      ]}
                    >
                      {lang.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.callButton} onPress={handleStartCall}>
            <Text style={styles.callButtonText}>Start Call</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.featuresCard}>
          <Text style={styles.sectionTitle}>Features</Text>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>🌐</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Real-Time Translation</Text>
              <Text style={styles.featureDescription}>
                Speak in your language, they hear in theirs
              </Text>
            </View>
          </View>

          <View style={styles.feature}>
            <Text style={styles.featureIcon}>💭</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Emotion Preservation</Text>
              <Text style={styles.featureDescription}>
                Your emotions are conveyed in translation
              </Text>
            </View>
          </View>

          <View style={styles.feature}>
            <Text style={styles.featureIcon}>🔒</Text>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Privacy First</Text>
              <Text style={styles.featureDescription}>
                Self-hosted, no third-party access
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
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
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  greeting: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  userName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  logoutButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  logoutText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    gap: 20,
  },
  callCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#ffffff',
  },
  languageRow: {
    marginBottom: 16,
  },
  languageSelect: {},
  languageOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  languageOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  languageOptionActive: {
    backgroundColor: '#22d3ee',
  },
  languageOptionText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  languageOptionTextActive: {
    color: '#0f172a',
    fontWeight: '600',
  },
  callButton: {
    backgroundColor: '#22d3ee',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  callButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  featuresCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 20,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  featureIcon: {
    fontSize: 24,
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
  },
});

export default HomeScreen;
