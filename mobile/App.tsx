import React, { useEffect, useMemo, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { useAuth } from './src/hooks/useAuth';
import { useCall } from './src/hooks/useCall';
import { deviceApi } from './src/services/api';
import { NativeTelephony } from './src/native/telephony';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import CallScreen from './src/screens/CallScreen';
import ConsentScreen from './src/screens/ConsentScreen';
import { TranslationMode } from './src/types';

type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Consent: undefined;
  Call: undefined | {
    phoneNumber?: string;
    myLanguage?: string;
    theirLanguage?: string;
    translationMode?: TranslationMode;
    callType?: 'voice' | 'video';
    callExperience?: 'audio' | 'video' | 'face_to_face';
  };
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
const Stack = createNativeStackNavigator<RootStackParamList>();
const queryClient = new QueryClient();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function AppNavigator() {
  const { user, isAuthenticated, isLoading, token } = useAuth();
  const [deviceRegistered, setDeviceRegistered] = useState(false);

  const deviceId = useMemo(() => `${Platform.OS}_${Date.now().toString(36)}`, []);
  const call = useCall(user?.id || 0, token || '', deviceId);

  useEffect(() => {
    if (isAuthenticated && token && !deviceRegistered) {
      registerDevice().catch((error) => {
        console.error('Failed to register device:', error);
      });
    }
  }, [deviceRegistered, isAuthenticated, token]);

  useEffect(() => {
    const activeCall = call.callState.status !== 'idle';
    if (!activeCall || !navigationRef.isReady()) {
      return;
    }

    const currentRoute = navigationRef.getCurrentRoute()?.name;
    if (currentRoute !== 'Call') {
      navigationRef.navigate('Call');
    }
  }, [call.callState.status]);

  const registerDevice = async () => {
    await NativeTelephony.initialize();

    await deviceApi.register({
      deviceId,
      platform: Platform.OS as 'android' | 'ios',
      deviceName: `${Platform.OS} Device`,
      appVersion: '1.0.0',
      osVersion: Platform.Version.toString(),
      capabilities: {
        supportsWebRTC: true,
        supportsSIM: true,
        supportsNativeTelephony: NativeTelephony.isAvailable(),
        audioCodecs: ['opus'],
      },
    });

    setDeviceRegistered(true);
  };

  if (isLoading) {
    return null;
  }

  const CallScreenContainer = ({ route }: NativeStackScreenProps<RootStackParamList, 'Call'>) => {
    useEffect(() => {
      const phoneNumber = route.params?.phoneNumber;
      if (!phoneNumber || !token || !user?.id || call.callState.status !== 'idle') {
        return;
      }

      if (route.params?.myLanguage && route.params?.theirLanguage) {
        call.setLanguages(route.params.myLanguage, route.params.theirLanguage);
      }
      if (route.params?.translationMode) {
        call.setTranslationMode(route.params.translationMode);
      }

      call.initiateCall(phoneNumber, {
        callType: route.params?.callType || 'voice',
        callExperience: route.params?.callExperience || (route.params?.callType === 'video' ? 'video' : 'audio'),
      });
    }, [route.params?.callExperience, route.params?.callType, route.params?.myLanguage, route.params?.phoneNumber, route.params?.theirLanguage, route.params?.translationMode]);

    return (
      <CallScreen
        callState={call.callState}
        onEndCall={call.endCall}
        onToggleMute={call.toggleMute}
        onToggleSpeaker={call.toggleSpeaker}
        onRetryCall={call.retryLastCall}
        onSetTranslationMode={call.setTranslationMode}
      />
    );
  };

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      {!isAuthenticated ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Consent" component={ConsentScreen} />
          <Stack.Screen
            name="Call"
            component={CallScreenContainer}
            options={{
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer ref={navigationRef}>
        <AppNavigator />
      </NavigationContainer>
    </QueryClientProvider>
  );
}
