import { useId } from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Force white text, for logos placed on the navy brand panel in either theme. */
  onDark?: boolean;
  /** Show the "CONNECT BEYOND LIMITS" tagline under the wordmark. */
  tagline?: boolean;
}

const textSizes = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-3xl md:text-4xl",
  xl: "text-4xl md:text-5xl",
};

const markHeights = { sm: 20, md: 24, lg: 38, xl: 48 };

/** The NeuraTalk "N + voice bars" mark (same artwork as public/logo-mark.svg and the app icon). */
export function LogoMark({ height = 24, className }: { height?: number; className?: string }) {
  // Gradient ids must be unique per instance when several logos are on one page.
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 132 100"
      height={height}
      width={height * 1.32}
      className={className}
      role="img"
      aria-label="NeuraTalk"
    >
      <defs>
        <linearGradient id={`n${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2AA8FF" />
          <stop offset="0.55" stopColor="#1E66F5" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
        <linearGradient id={`b${id}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#1E66F5" stopOpacity="0.3" />
          <stop offset="0.5" stopColor="#1E66F5" />
          <stop offset="1" stopColor="#2AA8FF" />
        </linearGradient>
      </defs>
      <path
        d="M20 84 V36 C20 8 50 4 62 30 L78 64 C86 82 110 80 110 60 V56"
        fill="none"
        stroke={`url(#n${id})`}
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="92" y="22" width="7" height="24" rx="3.5" fill={`url(#b${id})`} />
      <rect x="105" y="6" width="7" height="34" rx="3.5" fill={`url(#b${id})`} />
      <rect x="118" y="14" width="7" height="22" rx="3.5" fill={`url(#b${id})`} />
    </svg>
  );
}

/** "NeuraTalk" wordmark: "Neura" in white (or ink on light backgrounds), "Talk" in brand blue. */
export function Logo({ size = "md", className, onDark = false, tagline = false }: LogoProps) {
  return (
    <span className={cn("inline-flex flex-col leading-none", className)} data-testid="logo-neuratalk">
      <span
        className={cn("font-extrabold tracking-tight", textSizes[size])}
        style={{ fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em" }}
      >
        <span className={onDark ? "text-white" : "text-foreground"}>Neura</span>
        <span className="text-[#1E66F5]">Talk</span>
      </span>
      {tagline && (
        <span
          className={cn(
            "mt-1 text-[0.6rem] font-semibold tracking-[0.32em]",
            onDark ? "text-white/70" : "text-muted-foreground",
          )}
        >
          CONNECT BEYOND LIMITS
        </span>
      )}
    </span>
  );
}

export function LogoWithIcon({ size = "md", className, onDark, tagline }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark height={markHeights[size]} />
      <Logo size={size} onDark={onDark} tagline={tagline} />
    </div>
  );
}
