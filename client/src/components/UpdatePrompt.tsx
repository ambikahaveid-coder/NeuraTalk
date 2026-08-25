import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function UpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.ready.then((reg) => {
      setRegistration(reg);

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        }
      });
    });

    // A "controllerchange" event also fires the very first time a
    // service worker ever activates for this page (uncontrolled ->
    // controlled), not just when a new version replaces an old one.
    // Reloading unconditionally on that first activation can abort an
    // in-flight navigation (e.g. a direct deep link) for no reason --
    // only reload when this page already had a controller, i.e. a real
    // worker-to-worker update.
    const hadControllerAtMount = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadControllerAtMount || refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.type === "SW_UPDATED") {
        window.location.reload();
      }
    });
  }, []);

  const handleUpdate = () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  };

  const handleDismiss = () => {
    setUpdateAvailable(false);
  };

  if (!updateAvailable) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -100 }}
        className="fixed top-4 left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-sm"
        data-testid="update-prompt"
      >
        <Card className="border-primary/20 bg-background/95 backdrop-blur-lg shadow-xl">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <RefreshCw className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground">Update Available</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  A new version is ready. Refresh to update.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={handleUpdate}
                    className="gap-2"
                    data-testid="button-update-app"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Update Now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDismiss}
                    data-testid="button-dismiss-update"
                  >
                    Later
                  </Button>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0 h-8 w-8"
                onClick={handleDismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
