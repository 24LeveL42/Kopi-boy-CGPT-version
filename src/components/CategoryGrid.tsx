import Image from "next/image";
import { MerchantCategory } from "@/lib/types";
interface CategoryTile { id: MerchantCategory; label: string; image: string; }
const TILES: CategoryTile[] = [
  {id:"home-cook",label:"Home Cooks",image:"/categories/home-cooks.jpg"},
  {id:"hawker",label:"Hawkers",image:"/categories/hawkers.jpg"},
  {id:"bulk-orders",label:"Vegetarian",image:"/categories/bulk-orders.jpg"},
  {id:"bakery",label:"Bakery",image:"/categories/bakers.jpg"},
  {id:"drinks",label:"Drinks & Desserts",image:"/categories/drinks-desserts.jpg"},
];
export function CategoryGrid({active,onSelect}:{active:MerchantCategory|"all";onSelect:(id:MerchantCategory|"all")=>void}) {
 return <div className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Merchant categories">
  {TILES.map(t=>{const on=active===t.id;return <button key={t.id} role="tab" aria-selected={on} onClick={()=>onSelect(on?"all":t.id)} className={`relative h-[112px] w-[116px] shrink-0 overflow-hidden rounded-2xl text-left shadow-sm ring-1 ring-black/5 ${on?"ring-2 ring-purple-500":""}`}>
    <Image src={t.image} alt="" fill sizes="116px" className="object-cover"/><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8 text-xs font-extrabold text-white">{t.label}</span>
  </button>})}
 </div>;
}
