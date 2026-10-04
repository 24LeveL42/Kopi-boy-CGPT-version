"use client";
import { CuisineDef, CuisineType } from "@/lib/types";
export function CuisineFilter({cuisines,active,onSelect}:{cuisines:CuisineDef[];active:CuisineType|"all";onSelect:(id:CuisineType|"all")=>void}){
 return <div role="tablist" aria-label="Cuisine type" className="kb-chip-row">{cuisines.map(c=>{const on=c.id===active;return <button key={c.id} role="tab" aria-selected={on} onClick={()=>onSelect(c.id)} className={`kb-chip ${on?"is-active":""}`}>{c.label}</button>})}</div>;
}
