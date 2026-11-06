import { REGION_COLOURS, REGION_LABEL, type RegionCode } from "@/lib/regions";

/**
 * A kitchen's region as a small tag: the word itself (never colour alone) in
 * the region's AA-contrast colour (src/lib/regions.ts). Screen readers hear
 * "Region: East". Renders nothing without a region.
 */
export function RegionTag({ region }: { region: RegionCode | null | undefined }) {
  if (!region) return null;
  const { text, background } = REGION_COLOURS[region];
  return (
    <span
      data-testid="region-tag"
      data-region={region}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold leading-4"
      style={{ background, color: text }}
    >
      <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden="true">
        <path d="M4 0C1.8 0 0 1.7 0 3.9 0 6.8 4 10 4 10s4-3.2 4-6.1C8 1.7 6.2 0 4 0Zm0 5.3a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z" fill="currentColor" />
      </svg>
      <span className="sr-only">Region: </span>
      {REGION_LABEL[region]}
    </span>
  );
}
