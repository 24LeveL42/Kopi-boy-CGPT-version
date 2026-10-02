"use client";
import { CuisineDef, CuisineType } from "@/lib/types";
export function CuisineFilter({cuisines,active,onSelect}:{cuisines:CuisineDef[];active:CuisineType|"all";onSelect:(id:CuisineType|"all")=>void}){
 return <div role="tablist" aria-label="Cuisine type" className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
 {cuisines.map(c=>{const on=c.id===active;return <button key={c.id} role="tab" aria-selected={on} onClick={()=>onSelect(c.id)} className={`shrink-0 rounded-full px-4 py-2 text-[12px] font-bold transition ${on?"bg-purple-600 text-white shadow-sm":"bg-white text-slate-600 ring-1 ring-slate-200"}`}>{c.label}</button>})}
 </div>;
}
