import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "neuratalk-theme-change";

function preferredDark(): boolean {
  try {
    const theme = localStorage.getItem(STORAGE_KEY);
    if (theme === "dark") return true;
    if (theme === "light") return false;
  } catch {
    // Storage blocked: fall back to the system setting.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

/** Pages that must stay dark (live calls) put a hold on the theme while open. */
let darkHolds = 0;

function applyTheme() {
  document.documentElement.classList.toggle("dark", darkHolds > 0 || preferredDark());
}

/**
 * Every page -- website, login and all dashboards -- follows the person's
 * light/dark choice (or the phone/computer setting until they pick one).
 * Call once near the root of the app.
 */
export function useAppTheme() {
  useEffect(() => {
    applyTheme();
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme();
    media?.addEventListener?.("change", onChange);
    window.addEventListener("storage", onChange);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      media?.removeEventListener?.("change", onChange);
      window.removeEventListener("storage", onChange);
      window.removeEventListener(CHANGE_EVENT, onChange);
    };
  }, []);
}

/** Kept for the public pages that already call it; the app-wide hook does the work. */
export function usePublicTheme() {
  useEffect(() => { applyTheme(); }, []);
}

/** Live call screens are designed dark (like a phone's call screen). */
export function useForceDarkTheme() {
  useEffect(() => {
    darkHolds++;
    applyTheme();
    return () => {
      darkHolds = Math.max(0, darkHolds - 1);
      applyTheme();
    };
  }, []);
}

export function ThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(() => preferredDark());

  useEffect(() => {
    const sync = () => setIsDark(preferredDark());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Not saved; apply for this page only.
      document.documentElement.classList.toggle("dark", next);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      data-testid="button-theme-toggle"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
