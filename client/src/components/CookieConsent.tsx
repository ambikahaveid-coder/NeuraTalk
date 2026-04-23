import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Cookie, X, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CookiePreferences {
  essential: boolean;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

const COOKIE_CONSENT_KEY = "neuratalk_cookie_consent";
const COOKIE_PREFERENCES_KEY = "neuratalk_cookie_preferences";

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    essential: true,
    functional: false,
    analytics: false,
    marketing: false,
  });

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      const timer = setTimeout(() => setShowBanner(true), 1000);
      return () => clearTimeout(timer);
    } else {
      const savedPrefs = localStorage.getItem(COOKIE_PREFERENCES_KEY);
      if (savedPrefs) {
        setPreferences(JSON.parse(savedPrefs));
      }
    }
  }, []);

  const saveConsent = (accepted: boolean, prefs?: CookiePreferences) => {
    const finalPrefs = prefs || (accepted ? {
      essential: true,
      functional: true,
      analytics: true,
      marketing: false,
    } : {
      essential: true,
      functional: false,
      analytics: false,
      marketing: false,
    });

    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({
      timestamp: new Date().toISOString(),
      accepted,
    }));
    localStorage.setItem(COOKIE_PREFERENCES_KEY, JSON.stringify(finalPrefs));
    setPreferences(finalPrefs);
    setShowBanner(false);
    setShowSettings(false);
  };

  const handleAcceptAll = () => {
    saveConsent(true);
  };

  const handleRejectAll = () => {
    saveConsent(false);
  };

  const handleSavePreferences = () => {
    saveConsent(true, preferences);
  };

  if (!showBanner) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6"
      >
        <Card className="max-w-4xl mx-auto p-6 shadow-lg border-primary/20">
          {!showSettings ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Cookie className="w-6 h-6 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-lg">Cookie Preferences</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      We use cookies to enhance your experience, analyze site traffic, and for marketing purposes. 
                      By clicking "Accept All", you consent to our use of cookies. 
                      Read our <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a> for more information.
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRejectAll}
                  className="flex-shrink-0"
                  data-testid="button-cookie-close"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              
              <div className="flex flex-wrap gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowSettings(true)}
                  data-testid="button-cookie-settings"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Manage Preferences
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRejectAll}
                  data-testid="button-cookie-reject"
                >
                  Reject All
                </Button>
                <Button
                  onClick={handleAcceptAll}
                  data-testid="button-cookie-accept"
                >
                  Accept All
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">Cookie Settings</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSettings(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted">
                  <div>
                    <Label className="font-medium">Essential Cookies</Label>
                    <p className="text-sm text-muted-foreground">
                      Required for the website to function. Cannot be disabled.
                    </p>
                  </div>
                  <Switch checked disabled data-testid="switch-cookie-essential" />
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div>
                    <Label className="font-medium">Functional Cookies</Label>
                    <p className="text-sm text-muted-foreground">
                      Remember your preferences and settings.
                    </p>
                  </div>
                  <Switch
                    checked={preferences.functional}
                    onCheckedChange={(checked) => 
                      setPreferences(p => ({ ...p, functional: checked }))
                    }
                    data-testid="switch-cookie-functional"
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div>
                    <Label className="font-medium">Analytics Cookies</Label>
                    <p className="text-sm text-muted-foreground">
                      Help us understand how visitors interact with our website.
                    </p>
                  </div>
                  <Switch
                    checked={preferences.analytics}
                    onCheckedChange={(checked) => 
                      setPreferences(p => ({ ...p, analytics: checked }))
                    }
                    data-testid="switch-cookie-analytics"
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div>
                    <Label className="font-medium">Marketing Cookies</Label>
                    <p className="text-sm text-muted-foreground">
                      Used to deliver personalized advertisements.
                    </p>
                  </div>
                  <Switch
                    checked={preferences.marketing}
                    onCheckedChange={(checked) => 
                      setPreferences(p => ({ ...p, marketing: checked }))
                    }
                    data-testid="switch-cookie-marketing"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSavePreferences}
                  data-testid="button-cookie-save"
                >
                  Save Preferences
                </Button>
              </div>
            </div>
          )}
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
