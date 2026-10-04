"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Merchant } from "@/lib/types";
import { CategoryPill, RegisteredBadge } from "./KitchenBadges";

const FAV_KEY = "kb-favourites";

export function MerchantCard({ merchant, variant = "grid" }: { merchant: Merchant; variant?: "grid" | "list" }) {
  const [fav, setFav] = useState(false);
  useEffect(() => {
    try { setFav(JSON.parse(localStorage.getItem(FAV_KEY) || "[]").includes(merchant.id)); } catch {}
  }, [merchant.id]);
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    try {
      const ids: string[] = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      const next = ids.includes(merchant.id) ? ids.filter(id => id !== merchant.id) : [...ids, merchant.id];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      setFav(next.includes(merchant.id));
      window.dispatchEvent(new Event("kb-favourites-changed"));
    } catch {}
  };
  if (variant === "list") return (
    <Link href={`/merchant/${merchant.id}`} className="kb-merchant-list-card group">
      <div className="kb-list-image"><Image src={merchant.heroImage} alt="" fill sizes="88px" className="object-cover transition duration-500 group-hover:scale-105" /></div>
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-start justify-between gap-2"><h3 className="truncate text-[15px] font-black text-slate-900">{merchant.name}</h3><button type="button" onClick={toggle} aria-label={fav ? "Remove favourite" : "Add favourite"} className={`kb-heart ${fav ? "is-fav" : ""}`}>{fav ? "♥" : "♡"}</button></div>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">{merchant.cuisine} · {merchant.category === "home-cook" ? "Home Cook" : merchant.category === "hawker" ? "Hawker" : merchant.category === "bakery" ? "Bakery" : "Local Seller"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-[11px] font-black text-amber-500">★ {merchant.rating > 0 ? merchant.rating.toFixed(1) : "New"}</span><span className="text-[10px] text-slate-400">({merchant.ratingCount ?? 0})</span><span className="text-[10px] text-slate-500">◷ {merchant.etaMinutes}–{merchant.etaMinutes + 15} min</span>{merchant.cuisineType === "halal" && <span className="kb-halal-pill">Halal</span>}</div>
      </div>
    </Link>
  );
  return <Link href={`/merchant/${merchant.id}`} className="kb-merchant-card group">
    <div className="relative h-[176px] overflow-hidden sm:h-[190px]"><Image src={merchant.heroImage} alt="" fill sizes="(min-width:768px) 360px,92vw" className="object-cover transition duration-500 group-hover:scale-[1.04]"/>
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent"/>
      {merchant.isNew&&<span className="kb-card-new">NEW</span>}
      <button type="button" onClick={toggle} aria-label={fav ? "Remove favourite" : "Add favourite"} className={`kb-card-heart ${fav ? "is-fav" : ""}`}>{fav ? "♥" : "♡"}</button>
      <div className="absolute inset-x-0 bottom-0 p-3.5"><div className="flex items-end justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-[15px] font-extrabold text-white">{merchant.name}</h3><p className="mt-0.5 truncate text-xs text-white/80">{merchant.cuisine}{merchant.area?` · ${merchant.area}`:""}</p></div><span className="kb-rating-pill">★ {merchant.rating>0?merchant.rating.toFixed(1):"New"}</span></div></div>
    </div>
    <div className="p-3.5"><div className="flex items-center gap-1.5"><CategoryPill category={merchant.category}/>{merchant.businessUen&&<RegisteredBadge uen={merchant.businessUen}/>}</div><div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>◷ {merchant.etaMinutes}–{merchant.etaMinutes+15} min</span><span>From <b className="text-slate-900">${merchant.priceFrom.toFixed(2)}</b></span></div>{merchant.menuHighlights[0]?.name&&<p className="mt-2 truncate text-sm font-bold text-slate-800">Popular · {merchant.menuHighlights[0].name}</p>}</div>
  </Link>;
}
