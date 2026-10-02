/**
 * Small inline spinner for pending buttons. Inherits the button's text color
 * (currentColor) and is aria-hidden, so the button's accessible name stays
 * its label ("Placing order…" etc.) rather than picking up the icon.
 */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-testid="spinner"
      className="inline-block shrink-0 animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Page-level spinner for loading.tsx fallbacks that don't warrant a full skeleton. */
export function PageSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3"
      style={{ color: "var(--kb-on-navy-soft)" }}
    >
      <Spinner size={28} />
      <span className="text-sm">{label}</span>
    </div>
  );
}
