"use client";
import type { ReactNode } from "react";
import { CuisineDef, CuisineType } from "@/lib/types";

/** A row of single-choice chips (kb-chip-row / kb-chip), shared by the cuisine and region filters. */
export function ChipFilter<T extends string>({ label, options, active, onSelect }: { label: string; options: { id: T; label: string; icon?: ReactNode }[]; active: T; onSelect: (id: T) => void }) {
  return <div role="tablist" aria-label={label} className="kb-chip-row">{options.map(o => { const on = o.id === active; return <button key={o.id} role="tab" aria-selected={on} onClick={() => onSelect(o.id)} className={`kb-chip ${on ? "is-active" : ""}`}>{o.icon}{o.label}</button>; })}</div>;
}

export function CuisineFilter({cuisines,active,onSelect}:{cuisines:CuisineDef[];active:CuisineType|"all";onSelect:(id:CuisineType|"all")=>void}){
 return <ChipFilter label="Cuisine type" options={cuisines} active={active} onSelect={onSelect} />;
}
