import Image from "next/image";
import Link from "next/link";
import { Merchant } from "@/lib/types";
import { CategoryPill, RegisteredBadge } from "./KitchenBadges";
export function MerchantCard({merchant}:{merchant:Merchant}){
 return <Link href={`/merchant/${merchant.id}`} className="group block overflow-hidden rounded-[22px] bg-white shadow-[0_8px_26px_rgba(24,24,40,.08)] ring-1 ring-slate-100 transition hover:-translate-y-0.5 focus-visible:-translate-y-0.5">
  <div className="relative h-44 w-full"><Image src={merchant.heroImage} alt="" fill sizes="(min-width:768px) 340px,90vw" className="object-cover transition duration-300 group-hover:scale-[1.02]"/>
   <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-3 pt-12"><div className="flex items-end justify-between gap-2"><div className="flex items-center gap-2"><div className="relative h-9 w-9 overflow-hidden rounded-full border-2 border-white"><Image src={merchant.avatarImage} alt="" fill sizes="36px" className="object-cover"/></div><div><h3 className="text-[15px] font-extrabold text-white">{merchant.name}</h3><p className="text-xs text-white/80">{merchant.cuisine}{merchant.area?` · ${merchant.area}`:""}</p></div></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-extrabold text-slate-900">★ {merchant.rating.toFixed(1)}</span></div></div>
   {merchant.isNew&&<span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-extrabold text-white">NEW</span>}
  </div>
  <div className="p-3.5"><div className="flex flex-wrap gap-1.5"><CategoryPill category={merchant.category}/>{merchant.businessUen&&<RegisteredBadge uen={merchant.businessUen}/>}</div>
   <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{merchant.etaMinutes} min delivery</span><span>From <b className="text-slate-900">${merchant.priceFrom.toFixed(2)}</b></span></div>
   {merchant.menuHighlights[0]?.name&&<p className="mt-2 truncate text-sm font-semibold text-slate-800">Popular: {merchant.menuHighlights[0].name}</p>}
  </div>
 </Link>;
}
