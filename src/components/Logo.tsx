import Image from "next/image";
import { BRAND_NAME } from "@/lib/brand";

// Wordmark: first word in purple, the rest in green ("KOPI" "BOY").
const [wordmarkFirst, ...wordmarkWords] = BRAND_NAME.toUpperCase().split(" ");
const wordmarkRest = wordmarkWords.join(" ");

interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

/**
 * KB logomark — the real approved artwork (public/brand/logo-icon.png,
 * background removed, cropped from the source file). Do not redraw this
 * as SVG; if the asset changes, replace the PNG in public/brand instead.
 */
export function Logo({ size = 40, showWordmark = true, className = "" }: LogoProps) {
  // Source crop is 427x367 (not square) — preserve that aspect ratio.
  const height = size;
  const width = Math.round(size * (427 / 367));

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Image
        src="/brand/logo-icon.png"
        alt={BRAND_NAME}
        width={width}
        height={height}
        style={{ height, width: "auto" }}
        priority
      />
      {showWordmark && (
        <span
          className="font-display font-semibold tracking-tight leading-none"
          style={{ fontSize: size * 0.5 }}
        >
          <span style={{ color: "var(--kb-purple)" }}>{wordmarkFirst}</span>{" "}
          <span style={{ color: "var(--kb-green)" }}>{wordmarkRest}</span>
        </span>
      )}
    </div>
  );
}
