import { useState } from "react";

/** A partner's logo, or its first letter in its colour when there is no logo or the link is broken. */
export function BrandMark({ name, logoUrl, color, className = "h-10 w-10 rounded-lg", textClassName = "text-base" }: {
  name: string; logoUrl?: string | null; color?: string | null; className?: string; textClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (logoUrl && !broken) {
    return <img src={logoUrl} alt="" className={`${className} object-contain`} onError={() => setBroken(true)} />;
  }
  return (
    <div className={`${className} flex shrink-0 items-center justify-center font-bold text-white ${textClassName}`} style={{ background: color || "#0f766e" }} aria-hidden="true">
      {(name || "?").trim().slice(0, 1).toUpperCase()}
    </div>
  );
}
