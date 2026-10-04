import Image from "next/image";
import { MerchantCategory } from "@/lib/types";
interface CategoryTile { id: MerchantCategory | "all"; label: string; image: string; }
const TILES: CategoryTile[] = [
 {id:"home-cook",label:"Home Cooks",image:"/categories/home-cooks.jpg"},
 {id:"hawker",label:"Hawkers",image:"/categories/hawkers.jpg"},
 {id:"bulk-orders",label:"Vegetarian",image:"/categories/bulk-orders.jpg"},
 {id:"bakery",label:"Bakery",image:"/categories/bakers.jpg"},
 {id:"drinks",label:"Drinks & Desserts",image:"/categories/drinks-desserts.jpg"},
 {id:"all",label:"All Cuisines",image:"/categories/home-cooks.jpg"},
];
export function CategoryGrid({active,onSelect}:{active:MerchantCategory|"all";onSelect:(id:MerchantCategory|"all")=>void}) {
 return <div className="kb-category-grid" role="tablist" aria-label="Merchant categories">{TILES.map(t=>{const on=active===t.id;return <button key={t.label} role="tab" aria-selected={on} onClick={()=>onSelect(t.id)} className={`kb-category-card ${on?"is-active":""}`}><Image src={t.image} alt="" fill sizes="120px" className="object-cover"/><span className="kb-category-shade"/><span className="relative z-10">{t.label}</span></button>})}</div>;
}
