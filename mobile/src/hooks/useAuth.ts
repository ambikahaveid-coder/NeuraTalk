import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';
import { authApi, setAuthToken, initializeAuth } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      await initializeAuth();
      const storedToken = await AsyncStorage.getItem('authToken');
      
      if (storedToken) {
        setAuthToken(storedToken);
        const profile = await authApi.getProfile();
        setState({
          user: profile.user,
          token: storedToken,
          isLoading: false,
          isAuthenticated: true,
        });
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      await AsyncStorage.removeItem('authToken');
      setState({
        user: null,
        token: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  };

  const requestOtp = useCallback(async (identifier: string, channel: 'email' | 'mobile') => {
    const result = await authApi.requestOtp(identifier, channel);
    return result;
  }, []);

  const verifyOtp = useCallback(async (identifier: string, code: string, channel: 'email' | 'mobile') => {
    const result = await authApi.verifyOtp(identifier, code, channel);
    
    if (result.token) {
      await AsyncStorage.setItem('authToken', result.token);
      setAuthToken(result.token);
      
      setState({
        user: result.user,
        token: result.token,
        isLoading: false,
        isAuthenticated: true,
      });
    }
    
    return result;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    await AsyncStorage.removeItem('authToken');
    setState({
      user: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,
    });
  }, []);

  return {
    ...state,
    requestOtp,
    verifyOtp,
    logout,
    checkAuth,
  };
}
