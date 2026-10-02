import type { CSSProperties } from "react";

/**
 * Pulsing placeholder block for loading.tsx skeletons. `tone` picks a color
 * that reads on the surface it sits on: "navy" for blocks directly on the app
 * background, "card" for blocks inside a white card.
 */
export function Skeleton({
  className = "",
  tone = "navy",
  style,
}: {
  className?: string;
  tone?: "navy" | "card";
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg ${className}`}
      style={{ background: tone === "navy" ? "var(--kb-navy-raised)" : "var(--kb-cream)", ...style }}
    />
  );
}

/** Screen-reader announcement to pair with a skeleton (the blocks themselves are aria-hidden). */
export function LoadingStatus({ label = "Loading…" }: { label?: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}
