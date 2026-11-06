"use client";
import { REGION_CODES, REGION_COLOURS, REGION_LABEL, type RegionCode } from "@/lib/regions";
import { ChipFilter } from "./CuisineFilter";

export type RegionChoice = RegionCode | "all";

const OPTIONS: { id: RegionChoice; label: string; icon?: React.ReactNode }[] = [
  { id: "all", label: "All" },
  ...REGION_CODES.map((code) => ({
    id: code,
    label: REGION_LABEL[code],
    // A dot in the tag colour, beside the word: ties the chip to the tags on the cards.
    icon: <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: REGION_COLOURS[code].text }} />,
  })),
];

/** All / North / South / East / West. The home page only shows it once some kitchen has a region. */
export function RegionFilter({ active, onSelect }: { active: RegionChoice; onSelect: (id: RegionChoice) => void }) {
  return <ChipFilter label="Region" options={OPTIONS} active={active} onSelect={onSelect} />;
}
