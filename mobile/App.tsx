import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { useAuth } from './src/hooks/useAuth';
import { deviceApi } from './src/services/api';
import { NativeTelephony } from './src/native/telephony';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import CallScreen from './src/screens/CallScreen';
import ConsentScreen from './src/screens/ConsentScreen';

const Stack = createNativeStackNavigator();
const queryClient = new QueryClient();

function AppNavigator() {
  const { user, isAuthenticated, isLoading, token } = useAuth();
  const [deviceRegistered, setDeviceRegistered] = useState(false);

  useEffect(() => {
    if (isAuthenticated && token && !deviceRegistered) {
      registerDevice();
    }
  }, [isAuthenticated, token, deviceRegistered]);

  const registerDevice = async () => {
    try {
      const deviceId = `${Platform.OS}_${Date.now().toString(36)}`;
      
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
    } catch (error) {
      console.error('Failed to register device:', error);
    }
  };

  if (isLoading) {
    return null;
  }

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
            component={CallScreen}
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
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </QueryClientProvider>
  );
}
