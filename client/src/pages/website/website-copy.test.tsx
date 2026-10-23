import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage, { CALL_LANGUAGES } from "./HomePage";
import FAQPage from "./FAQPage";
import ProductsPage from "./ProductsPage";
import DemoPage, { DEMO_CALL } from "./DemoPage";
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
