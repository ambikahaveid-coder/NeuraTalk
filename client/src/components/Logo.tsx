import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function Logo({ size = "md", className }: LogoProps) {
  const sizeClasses = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-3xl md:text-4xl",
    xl: "text-4xl md:text-5xl",
  };

  return (
    <span
      className={cn(
        "font-black tracking-tight",
        "bg-clip-text text-transparent",
        "bg-gradient-to-b from-slate-400 via-slate-300 to-slate-500",
        "dark:from-slate-300 dark:via-white dark:to-slate-400",
        "drop-shadow-sm",
        sizeClasses[size],
        className
      )}
      style={{
        fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
        letterSpacing: "-0.02em",
      }}
      data-testid="logo-neuratalk"
    >
      NeuraTalk
    </span>
  );
}

export function LogoWithIcon({ size = "md", className }: LogoProps) {
  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
    xl: "w-8 h-8",
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div 
        className={cn(
          "rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 p-1.5",
          iconSizes[size]
        )}
      >
        <svg 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="w-full h-full text-white"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      </div>
      <Logo size={size} />
    </div>
  );
}
