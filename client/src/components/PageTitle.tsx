import { useEffect } from "react";
import { useLocation } from "wouter";

const BASE = "NeuraTalk — AI Voice Translation & Communication Platform";

// Public pages get their own browser-tab and search-result title; every
// other route keeps the brand title from index.html.
const TITLES: Record<string, string> = {
  "/about": "About",
  "/pricing": "Pricing",
  "/products": "Products",
  "/solutions": "Solutions",
  "/contact": "Contact",
  "/help": "Help Center",
  "/faq": "FAQ",
  "/demo": "Live Demo",
  "/status": "System Status",
  "/trust": "Trust & Security",
  "/api-docs": "API Docs",
  "/sdk-docs": "SDK Docs",
  "/release-notes": "Release Notes",
  "/login": "Log in",
  "/app-login": "Log in",
  "/privacy": "Privacy Policy",
  "/terms": "Terms of Service",
  "/refund-policy": "Refund Policy",
  "/cancellation-policy": "Cancellation Policy",
  "/cookie-policy": "Cookie Policy",
  "/copyright": "Copyright",
  "/dpa": "Data Processing Agreement",
  "/data-retention": "Data Retention",
  "/data-export": "Export Your Data",
  "/account-deletion": "Delete Your Account",
  "/ai-usage-policy": "AI Usage Policy",
  "/recording-consent": "Recording Consent",
  "/translation-disclaimer": "Translation Disclaimer",
  "/legal-notice": "Legal Notice",
  "/report-abuse": "Report Abuse",
  "/investor": "Investors",
};

export function PageTitle() {
  const [location] = useLocation();
  useEffect(() => {
    const name = TITLES[location];
    document.title = name ? `${name} · NeuraTalk` : BASE;
  }, [location]);
  return null;
}
