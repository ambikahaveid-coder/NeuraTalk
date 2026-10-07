import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

const STORAGE_KEY = "theme";

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

function applyDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Public pages (website + login) follow the visitor's light/dark choice.
 * Dashboards are built for the dark theme only, so leaving a public page
 * switches back to dark (index.html also starts dark).
 */
export function usePublicTheme() {
  useEffect(() => {
    applyDark(preferredDark());
    return () => applyDark(true);
  }, []);
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => preferredDark());

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    applyDark(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Not saved; the choice still applies until the page is closed.
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      data-testid="button-theme-toggle"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
