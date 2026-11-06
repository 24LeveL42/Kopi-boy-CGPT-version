import { describe, it, expect } from "vitest";
import { REGION_CODES, REGION_COLOURS, REGION_LABEL, anyRegion, orderByCloseness, toRegion, type RegionCode } from "@/lib/regions";

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe("regions — codes and labels", () => {
  it("has exactly North, South, East and West", () => {
    expect([...REGION_CODES]).toEqual(["north", "south", "east", "west"]);
    expect(REGION_CODES.map((c) => REGION_LABEL[c])).toEqual(["North", "South", "East", "West"]);
  });

  it("toRegion accepts only the four codes", () => {
    for (const code of REGION_CODES) expect(toRegion(code)).toBe(code);
    for (const v of [null, undefined, "", "North", "central", "north ", 1, {}]) expect(toRegion(v)).toBeNull();
  });

  it("anyRegion is true only when some merchant has a region", () => {
    expect(anyRegion([])).toBe(false);
    expect(anyRegion([{ region: null }, {}])).toBe(false);
    expect(anyRegion([{ region: null }, { region: "east" }])).toBe(true);
  });
});

describe("regions — tag colours", () => {
  it.each(REGION_CODES)("%s text passes WCAG AA (4.5:1) on white and on its own tint", (code) => {
    const { text, background } = REGION_COLOURS[code];
    expect(contrast(text, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(REGION_CODES)("%s is neither purple (the brand chip) nor green (Halal / NEW / Registered)", (code) => {
    const h = hue(REGION_COLOURS[code].text);
    expect(h >= 250 && h <= 330, `purple hue ${h}`).toBe(false);
    expect(h >= 75 && h <= 165, `green hue ${h}`).toBe(false);
  });

  it("gives the four regions clearly different hues", () => {
    const hues = REGION_CODES.map((c) => hue(REGION_COLOURS[c].text));
    for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) expect(hueGap(hues[i], hues[j])).toBeGreaterThanOrEqual(25);
  });
});

type K = { id: string; region?: RegionCode | null; isBlocked?: boolean };
const ids = (list: K[]) => list.map((k) => k.id);

describe("orderByCloseness — nearby, own region, other regions, no region", () => {
  const KITCHENS: K[] = [
    { id: "w1", region: "west" },
    { id: "none1", region: null },
    { id: "e1", region: "east" },
    { id: "n1", region: "north" },
    { id: "e2", region: "east" },
    { id: "s1", region: "south" },
    { id: "none2" },
  ];

  it("puts nearby first, then the customer's region, then North/South/East/West, then no region", () => {
    const out = orderByCloseness(KITCHENS, { nearbyIds: new Set(["s1", "none2"]), customerRegion: "east" });
    expect(ids(out)).toEqual(["s1", "none2", "e1", "e2", "n1", "w1", "none1"]);
  });

  it("keeps the given order inside each group (nearby ones too)", () => {
    const out = orderByCloseness(KITCHENS, { nearbyIds: new Set(["e2", "w1"]), customerRegion: null });
    expect(ids(out).slice(0, 2)).toEqual(["w1", "e2"]);
  });

  it("without a customer region, only groups by region (no region last)", () => {
    expect(ids(orderByCloseness(KITCHENS))).toEqual(["n1", "s1", "e1", "e2", "w1", "none1", "none2"]);
  });

  it("with nothing nearby, still returns every kitchen: never an empty list", () => {
    const out = orderByCloseness(KITCHENS, { nearbyIds: new Set(), customerRegion: "west" });
    expect(ids(out)).toEqual(["w1", "n1", "s1", "e1", "e2", "none1", "none2"]);
    expect(out).toHaveLength(KITCHENS.length);
  });

  it("keeps blocked kitchens after every available one, even a nearby blocked kitchen", () => {
    const list: K[] = [{ id: "blocked-near", region: "east", isBlocked: true }, { id: "far", region: "west" }, { id: "blocked-none", isBlocked: true }];
    const out = orderByCloseness(list, { nearbyIds: new Set(["blocked-near"]), customerRegion: "east" });
    expect(ids(out)).toEqual(["far", "blocked-near", "blocked-none"]);
  });

  it("does not change the input array", () => {
    const copy = [...KITCHENS];
    orderByCloseness(KITCHENS, { customerRegion: "south" });
    expect(KITCHENS).toEqual(copy);
  });
});
