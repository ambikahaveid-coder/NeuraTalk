import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = __DEV__ 
  ? 'http://localhost:5000' 
  : 'https://neuratalk.in'; // Use your actual production backend URL

let authToken: string | null = null;

export async function initializeAuth() {
  authToken = await AsyncStorage.getItem('authToken');
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    AsyncStorage.setItem('authToken', token);
  } else {
    AsyncStorage.removeItem('authToken');
  }
}

export async function apiRequest<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  endpoint: string,
  body?: any
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ message: 'Request failed' })) as {
      message?: string;
      error?: string;
    };
    throw new Error(errorPayload.message || errorPayload.error || 'Request failed');
  }

  return await response.json() as T;
}

export const authApi = {
  requestOtp: (identifier: string, channel: 'email' | 'mobile') =>
    apiRequest('POST', '/api/auth/otp/request', { identifier, channel }),
    
  verifyOtp: (identifier: string, code: string, channel: 'email' | 'mobile') =>
    apiRequest('POST', '/api/auth/otp/verify', { identifier, code, channel }),
    
  getProfile: () => apiRequest('GET', '/api/auth/me'),
  
  logout: () => {
    setAuthToken(null);
    return Promise.resolve();
  },
};

export const callApi = {
  checkConsent: () => apiRequest('GET', '/api/call/consent'),
  
  grantConsent: (consent: { termsAccepted: boolean; translationConsent: boolean; recordingConsent?: boolean }) =>
    apiRequest('POST', '/api/call/consent', consent),

  getIncoming: () => apiRequest<{
    incoming?: {
      callId: string;
      callerId: string;
      callerName?: string;
      callType: 'voice' | 'video';
      livekitUrl?: string;
      livekitToken?: string;
    } | null;
  }>('GET', '/api/calls/incoming'),

  rejectIncoming: (callId: string) => apiRequest('POST', `/api/calls/${callId}/reject`),

  updateStatus: (
    callId: string,
    status: string,
    metadata?: Record<string, unknown>,
  ) => apiRequest('PATCH', `/api/calls/${callId}/status`, { status, metadata }),

  getLivekitConfig: () => apiRequest<{ url?: string | null }>('GET', '/api/livekit/config'),
};

export const deviceApi = {
  register: (device: {
    deviceId: string;
    platform: 'android' | 'ios';
    pushToken?: string;
    voipToken?: string;
    deviceName?: string;
    appVersion?: string;
    osVersion?: string;
    capabilities?: any;
  }) => apiRequest('POST', '/api/devices/register', device),
  
  getDevices: () => apiRequest('GET', '/api/devices'),
  
  updateToken: (deviceId: string, tokens: { pushToken?: string; voipToken?: string }) =>
    apiRequest('PATCH', `/api/devices/${deviceId}/token`, tokens),
    
  unregister: (deviceId: string) => apiRequest('DELETE', `/api/devices/${deviceId}`),
};
