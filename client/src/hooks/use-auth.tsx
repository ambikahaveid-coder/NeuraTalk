import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type User, type Organization, USER_ROLES } from "@shared/schema";
import { normalizePhoneNumber } from "@shared/phone";
import { useLocation } from "wouter";

export type UserWithOrg = User & {
  organization?: Organization | null;
};

type AuthState = {
  user: UserWithOrg | null;
  token: string | null;
};

type AuthContextType = {
  user: UserWithOrg | null;
  token: string | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isCompanyAdmin: boolean;
  isAgent: boolean;
  isConsumer: boolean;
  isInvestor: boolean;
  requestOtp: (data: { identifier: string; channel: "email" | "mobile" }) => Promise<any>;
  isRequestingOtp: boolean;
  requestOtpError: Error | null;
  verifyOtp: (data: { identifier: string; channel: "email" | "mobile"; code: string; firebaseToken?: string }) => Promise<any>;
  isVerifyingOtp: boolean;
  verifyOtpError: Error | null;
  companySignup: (data: any) => Promise<any>;
  isSigningUp: boolean;
  signupError: Error | null;
  setAuth: (token: string, user: UserWithOrg) => void;
  logout: () => void;
};

const AUTH_KEY = "neuratalk_auth";

function getStoredAuth(): AuthState {
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    return stored ? JSON.parse(stored) : { user: null, token: null };
  } catch {
    return { user: null, token: null };
  }
}

function setStoredAuth(auth: AuthState) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function clearStoredAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export function getAuthToken(): string | null {
  return getStoredAuth().token;
}

function normalizeIdentifier(identifier: string, channel: "email" | "mobile"): string {
  return channel === "mobile" ? normalizePhoneNumber(identifier) : identifier.trim();
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [authState, setAuthState] = useState<AuthState>(getStoredAuth);

  const updateAuth = useCallback((auth: AuthState) => {
    setAuthState(auth);
    setStoredAuth(auth);
  }, []);

  useEffect(() => {
    const stored = getStoredAuth();
    if (stored.token && stored.user) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${stored.token}` },
      })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error("Session expired");
        })
        .then(user => {
          setAuthState({ user, token: stored.token });
          setStoredAuth({ user, token: stored.token });
        })
        .catch(() => {
          clearStoredAuth();
          setAuthState({ user: null, token: null });
        });
    }
  }, []);

  const requestOtpMutation = useMutation({
    mutationFn: async ({ identifier, channel }: { identifier: string; channel: "email" | "mobile" }) => {
      const normalizedIdentifier = normalizeIdentifier(identifier, channel);
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: normalizedIdentifier, channel }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to send OTP");
      }
      
      return res.json();
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async ({ identifier, channel, code, firebaseToken }: { identifier: string; channel: "email" | "mobile"; code: string; firebaseToken?: string }) => {
      const normalizedIdentifier = normalizeIdentifier(identifier, channel);
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: normalizedIdentifier, channel, code, firebaseToken }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Invalid OTP");
      }
      
      const data = await res.json();
      if (data.success && data.token && data.user) {
        updateAuth({ user: data.user, token: data.token });
      }
      return data;
    },
  });

  const companySignupMutation = useMutation({
    mutationFn: async (data: {
      companyName: string;
      contactName: string;
      contactEmail: string;
      contactPhone?: string;
      industry?: string;
      size?: string;
      website?: string;
    }) => {
      const token = authState.token;
      // Map frontend field names to backend schema
      const payload = {
        name: data.companyName,
        email: data.contactEmail,
        adminName: data.contactName,
        phone: data.contactPhone ? normalizePhoneNumber(data.contactPhone) : undefined,
        industry: data.industry,
        website: data.website,
      };
      const res = await fetch("/api/companies/signup", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Signup failed");
      }
      
      const result = await res.json();
      if (result.user) {
        updateAuth({ user: result.user, token: authState.token });
      }
      return result;
    },
  });

  const logout = useCallback(async () => {
    const token = authState.token;
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    clearStoredAuth();
    setAuthState({ user: null, token: null });
    queryClient.clear();
    setLocation("/");
  }, [authState.token, queryClient, setLocation]);

  const user = authState.user;
  const token = authState.token;

  const setAuth = useCallback((newToken: string, newUser: UserWithOrg) => {
    updateAuth({ user: newUser, token: newToken });
  }, [updateAuth]);

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isSuperAdmin: user?.role === USER_ROLES.SUPER_ADMIN,
    isCompanyAdmin: user?.role === USER_ROLES.COMPANY_ADMIN,
    isAgent: user?.role === USER_ROLES.AGENT,
    isConsumer: user?.role === USER_ROLES.CONSUMER,
    isInvestor: user?.role === USER_ROLES.INVESTOR,
    
    requestOtp: requestOtpMutation.mutateAsync,
    isRequestingOtp: requestOtpMutation.isPending,
    requestOtpError: requestOtpMutation.error,
    
    verifyOtp: verifyOtpMutation.mutateAsync,
    isVerifyingOtp: verifyOtpMutation.isPending,
    verifyOtpError: verifyOtpMutation.error,
    
    companySignup: companySignupMutation.mutateAsync,
    isSigningUp: companySignupMutation.isPending,
    signupError: companySignupMutation.error,
    
    setAuth,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
