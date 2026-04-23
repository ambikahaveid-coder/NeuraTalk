/**
 * ACCESSIBILITY PROVIDER
 * 
 * WHY THIS EXISTS:
 * Provides system-wide accessibility features:
 * - High contrast mode
 * - Reduced motion
 * - Font scaling
 * - Screen reader optimization
 * - Color blind modes
 * - Keyboard navigation
 * - Captions
 * 
 * COMPLIANCE:
 * - WCAG 2.1 AA guidelines
 * - Section 508
 * - ADA requirements
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

export interface AccessibilityPreferences {
  highContrast: boolean;
  reducedMotion: boolean;
  fontSize: "small" | "medium" | "large" | "x-large";
  screenReaderOptimized: boolean;
  colorBlindMode: "protanopia" | "deuteranopia" | "tritanopia" | null;
  keyboardNavigation: boolean;
  captionsEnabled: boolean;
}

const defaultPreferences: AccessibilityPreferences = {
  highContrast: false,
  reducedMotion: false,
  fontSize: "medium",
  screenReaderOptimized: false,
  colorBlindMode: null,
  keyboardNavigation: true,
  captionsEnabled: false,
};

interface AccessibilityContextType {
  preferences: AccessibilityPreferences;
  updatePreferences: (prefs: Partial<AccessibilityPreferences>) => void;
  isLoading: boolean;
}

const AccessibilityContext = createContext<AccessibilityContextType | null>(null);

const FONT_SIZE_MAP = {
  small: "14px",
  medium: "16px",
  large: "18px",
  "x-large": "20px",
};

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const [localPrefs, setLocalPrefs] = useState<AccessibilityPreferences>(() => {
    // Load from localStorage for guests
    try {
      const stored = localStorage.getItem("accessibility_prefs");
      if (stored) return JSON.parse(stored);
    } catch {}
    
    // Check system preferences
    const systemPrefs = { ...defaultPreferences };
    if (typeof window !== "undefined") {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        systemPrefs.reducedMotion = true;
      }
      if (window.matchMedia("(prefers-contrast: more)").matches) {
        systemPrefs.highContrast = true;
      }
    }
    return systemPrefs;
  });

  // Fetch preferences from server for logged in users
  const { data: serverPrefs, isLoading } = useQuery<{ success: boolean; preferences: AccessibilityPreferences }>({
    queryKey: ["/api/user/accessibility"],
    queryFn: async () => {
      if (!token) return { success: true, preferences: localPrefs };
      const res = await fetch("/api/user/accessibility", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!user,
  });

  // Update preferences mutation
  const updateMutation = useMutation({
    mutationFn: async (prefs: Partial<AccessibilityPreferences>) => {
      if (!token) {
        // Save to localStorage for guests
        const newPrefs = { ...localPrefs, ...prefs };
        localStorage.setItem("accessibility_prefs", JSON.stringify(newPrefs));
        return newPrefs;
      }
      
      const res = await fetch("/api/user/accessibility", {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/accessibility"] });
    },
  });

  const preferences = user && serverPrefs?.preferences 
    ? serverPrefs.preferences 
    : localPrefs;

  const updatePreferences = (prefs: Partial<AccessibilityPreferences>) => {
    setLocalPrefs(prev => ({ ...prev, ...prefs }));
    updateMutation.mutate(prefs);
  };

  // Apply accessibility styles to document
  useEffect(() => {
    const root = document.documentElement;
    
    // Font size
    root.style.fontSize = FONT_SIZE_MAP[preferences.fontSize];
    
    // High contrast
    if (preferences.highContrast) {
      root.classList.add("high-contrast");
    } else {
      root.classList.remove("high-contrast");
    }
    
    // Reduced motion
    if (preferences.reducedMotion) {
      root.classList.add("reduced-motion");
    } else {
      root.classList.remove("reduced-motion");
    }
    
    // Color blind mode
    root.classList.remove("protanopia", "deuteranopia", "tritanopia");
    if (preferences.colorBlindMode) {
      root.classList.add(preferences.colorBlindMode);
    }
    
    // Screen reader optimizations
    if (preferences.screenReaderOptimized) {
      root.classList.add("sr-optimized");
    } else {
      root.classList.remove("sr-optimized");
    }
    
  }, [preferences]);

  return (
    <AccessibilityContext.Provider value={{ 
      preferences, 
      updatePreferences,
      isLoading,
    }}>
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error("useAccessibility must be used within AccessibilityProvider");
  }
  return context;
}

// Skip link component for keyboard navigation
export function SkipLink({ targetId, children }: { targetId: string; children: ReactNode }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:p-4 focus:bg-primary focus:text-primary-foreground"
    >
      {children}
    </a>
  );
}

// Announce to screen readers
export function useAnnounce() {
  return (message: string, priority: "polite" | "assertive" = "polite") => {
    const announcer = document.getElementById("a11y-announcer");
    if (announcer) {
      announcer.setAttribute("aria-live", priority);
      announcer.textContent = message;
      setTimeout(() => {
        announcer.textContent = "";
      }, 1000);
    }
  };
}
