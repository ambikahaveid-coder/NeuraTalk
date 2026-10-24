import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage, { CALL_LANGUAGES } from "./HomePage";
import FAQPage from "./FAQPage";
import ProductsPage from "./ProductsPage";
import DemoPage, { DEMO_CALL } from "./DemoPage";
import BusinessPage from "./BusinessPage";
import BusinessMessagingPolicyPage from "./BusinessMessagingPolicyPage";
import TermsPage from "./TermsPage";
import PrivacyPage from "./PrivacyPage";
import TrustCenterPage from "./TrustCenterPage";
import HelpCenterPage from "./HelpCenterPage";
import ReleaseNotesPage from "./ReleaseNotesPage";
import AboutPage from "./AboutPage";
import SolutionsPage from "./SolutionsPage";
import AIUsagePolicyPage from "./AIUsagePolicyPage";
import CookiePolicyPage from "./CookiePolicyPage";
import AccountDeletionPage from "./AccountDeletionPage";
import DataRetentionPage from "./DataRetentionPage";
import RecordingConsentPage from "./RecordingConsentPage";
import RefundPolicyPage from "./RefundPolicyPage";
import CancellationPolicyPage from "./CancellationPolicyPage";
import LegalNoticePage from "./LegalNoticePage";
import CopyrightPage from "./CopyrightPage";
import TranslationDisclaimerPage from "./TranslationDisclaimerPage";
import DataExportPage from "./DataExportPage";
import DPAPage from "./DPAPage";
import { LANGUAGES, LANGUAGE_SUMMARY, COMPANY } from "./site-facts";
import { delayTone, ownVoiceShare, voiceCloneState } from "../AdminSections";

beforeAll(() => {
  // framer-motion's whileInView needs this; jsdom doesn't have it.
  if (!("IntersectionObserver" in window)) {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    (window as any).IntersectionObserver = IO;
  }
});

// Claims the product doesn't (or no longer) back up. The public pages must
// never make them again.
const BANNED = [
  /sub-300\s*ms/i,
  /thousands of users/i,
  /100% secure/i,
  /zero third-party/i,
  /live subtitles/i,
  /subtitle translation overlay/i,
  /100\+ languages/i,
  /HIPAA/i,
  /white-label/i,
  /24\/7/i,
  /[2-9]0\+ languages/i,
  /[2-9]0\+ language pairs/i,
  /(?<!not )end-to-end encrypted/i,
  /SOC 2 (Type II )?(certified|compliant|controls)/i,
  /ISO 27001 (certified|security practices)/i,
  /GDPR[- ]compliant|compliant with GDPR/i,
  /99\.9%/,
  /self-hosted/i,
  /standard voice/i,
  /Kamailio|Airtel\/Jio|SIP trunk/i,
  /Digital ?Ocean/i,
  /screen sharing/i,
  /\[Registration Number\]/i,
  /USD/,
];

function expectNoBannedClaims(container: HTMLElement) {
  const text = container.textContent || "";
  for (const pattern of BANNED) expect(text).not.toMatch(pattern);
}

describe("public website copy", () => {
  it("home page explains own-voice translated calls without false claims", () => {
    const { container } = render(<HomePage />);
    expect(screen.getByTestId("text-hero-title").textContent).toMatch(/They hear you in theirs/);
    expect(screen.getByText("Your own voice")).toBeInTheDocument();
    expect(screen.getByText("Language-aware calls")).toBeInTheDocument();
    expect(screen.getByText("Captions when needed")).toBeInTheDocument();
    for (const language of CALL_LANGUAGES) expect(screen.getByText(language)).toBeInTheDocument();
    expectNoBannedClaims(container);
  });

  it("FAQ says honestly that both people need NeuraTalk", () => {
    const { container } = render(<FAQPage />);
    expect(screen.getByText("Does the other person need NeuraTalk?")).toBeInTheDocument();
    expectNoBannedClaims(container);
  });

  it("products page has no unbacked claims", () => {
    const { container } = render(<ProductsPage />);
    expect(screen.getByText("Translated video calls")).toBeInTheDocument();
    expectNoBannedClaims(container);
  });

  it("demo plays the scripted call turn by turn and can be replayed", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<DemoPage />);
      expectNoBannedClaims(container);
      fireEvent.click(screen.getByTestId("button-demo-play"));
      act(() => { vi.advanceTimersByTime(400); });
      expect(screen.getByText(`“${DEMO_CALL[0].said}”`)).toBeInTheDocument();
      for (let i = 1; i < DEMO_CALL.length; i++) {
        act(() => { vi.advanceTimersByTime(4000); });
      }
      expect(screen.getAllByTestId("demo-progress-done")).toHaveLength(DEMO_CALL.length);
      expect(screen.getByTestId("button-demo-play").textContent).toMatch(/Play again/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("admin call-quality helpers", () => {
  it("rates translation delay against the 600 ms target", () => {
    expect(delayTone(450).label).toBe("Good");
    expect(delayTone(600).label).toBe("Good");
    expect(delayTone(900).label).toBe("Noticeable");
    expect(delayTone(2000).label).toBe("Too slow");
  });

  it("works out the own-voice share, or null before any calls", () => {
    expect(ownVoiceShare(undefined)).toBeNull();
    expect(ownVoiceShare({ own_voice_turns: 0, fallback_voice_turns: 0 })).toBeNull();
    expect(ownVoiceShare({ own_voice_turns: 3, fallback_voice_turns: 1 })).toBe(75);
  });

  it("gives each voice clone one plain status", () => {
    expect(voiceCloneState({ moderationStatus: "rejected", trainingStatus: "ready", isEnabled: true }).key).toBe("adminOff");
    expect(voiceCloneState({ moderationStatus: "approved", trainingStatus: "failed", isEnabled: true }).key).toBe("failed");
    expect(voiceCloneState({ moderationStatus: "approved", trainingStatus: "training", isEnabled: true }).key).toBe("training");
    expect(voiceCloneState({ moderationStatus: "approved", trainingStatus: "ready", isEnabled: false }).key).toBe("ownerOff");
    expect(voiceCloneState({ moderationStatus: "approved", trainingStatus: "ready", isEnabled: true }).key).toBe("inUse");
  });
});

describe("public website content audit (Oct 2026)", () => {
  const pages: [string, () => JSX.Element][] = [
    ["Business", () => <BusinessPage />],
    ["Business Messaging Policy", () => <BusinessMessagingPolicyPage />],
    ["Terms", () => <TermsPage />],
    ["Privacy", () => <PrivacyPage />],
    ["Trust Center", () => <TrustCenterPage />],
    ["Help Center", () => <HelpCenterPage />],
    ["Release Notes", () => <ReleaseNotesPage />],
    ["About", () => <AboutPage />],
    ["Solutions", () => <SolutionsPage />],
    ["AI Usage", () => <AIUsagePolicyPage />],
    ["Cookie Policy", () => <CookiePolicyPage />],
    ["Account Deletion", () => <AccountDeletionPage />],
    ["Data Retention", () => <DataRetentionPage />],
    ["Recording", () => <RecordingConsentPage />],
    ["Refund", () => <RefundPolicyPage />],
    ["Cancellation", () => <CancellationPolicyPage />],
    ["Legal Notice", () => <LegalNoticePage />],
    ["Copyright", () => <CopyrightPage />],
    ["Translation Disclaimer", () => <TranslationDisclaimerPage />],
    ["Data Export", () => <DataExportPage />],
    ["DPA", () => <DPAPage />],
  ];
  for (const [name, Page] of pages) {
    it(`${name} page makes no banned claims`, () => {
      const { container } = render(<Page />);
      expectNoBannedClaims(container);
    });
  }

  it("languages are the app's 23, the same everywhere", () => {
    expect(LANGUAGES).toHaveLength(23);
    expect(new Set(CALL_LANGUAGES)).toEqual(new Set(LANGUAGES));
    expect(LANGUAGE_SUMMARY).toMatch(/^23 languages/);
  });

  it("terms and privacy name the real company and its CIN", () => {
    for (const Page of [TermsPage, PrivacyPage]) {
      const { container, unmount } = render(<Page />);
      expect(container.textContent).toContain(COMPANY.legalName);
      unmount();
    }
    const { container } = render(<TermsPage />);
    expect(container.textContent).toContain(COMPANY.cin);
  });

  it("privacy policy states call audio is not recorded and text is kept 30 days", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toMatch(/never record the audio of your calls/i);
    expect(container.textContent).toMatch(/30 days/);
  });

  it("help center search filters answers", () => {
    render(<HelpCenterPage />);
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "delete my account" } });
    expect(screen.getByText("How do I delete my account?")).toBeInTheDocument();
    expect(screen.queryByText("How do I make my first translated call?")).not.toBeInTheDocument();
  });
});
