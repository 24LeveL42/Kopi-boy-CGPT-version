import { describe, it, expect } from "vitest";
import type * as Leaflet from "leaflet";
import { riderIcon, dropoffIcon, RIDER_ICON_SIZE, DROPOFF_PIN_SIZE } from "@/lib/riderIcon";

// divIcon just hands back its options, so the test reads exactly what Leaflet gets.
const L = { divIcon: (opts: unknown) => opts } as unknown as typeof Leaflet;
type Opts = { iconSize: [number, number]; iconAnchor: [number, number]; html: string };

describe("riderIcon", () => {
  it("is 24px, anchored at its centre", () => {
    const icon = riderIcon(L) as unknown as Opts;
    expect(RIDER_ICON_SIZE).toBe(24);
    expect(icon.iconSize).toEqual([24, 24]);
    expect(icon.iconAnchor).toEqual([12, 12]);
    expect(icon.html).toContain('width="24" height="24"');
  });

  it("pulses while live, not when stale, and flips when heading west", () => {
    const live = riderIcon(L, { heading: 90 }) as unknown as Opts;
    expect(live.html).toContain("kb-rider__pulse");
    expect(live.html).toContain("transform:none");
    const stale = riderIcon(L, { heading: 270, stale: true }) as unknown as Opts;
    expect(stale.html).not.toContain("kb-rider__pulse");
    expect(stale.html).toContain("kb-rider--stale");
    expect(stale.html).toContain("scaleX(-1)");
  });
});

describe("dropoffIcon", () => {
  it("is 20x26px with its tip (bottom centre) on the address", () => {
    const icon = dropoffIcon(L) as unknown as Opts;
    expect(DROPOFF_PIN_SIZE).toEqual([20, 26]);
    expect(icon.iconSize).toEqual([20, 26]);
    expect(icon.iconAnchor).toEqual([10, 26]);
  });
});
