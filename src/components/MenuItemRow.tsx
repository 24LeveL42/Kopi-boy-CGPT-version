"use client";

import { useState } from "react";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";

export function MenuItemRow({ kitchenId, kitchenName, item }: { kitchenId: string; kitchenName: string; item: { id: string; name: string; price: number; photo_url: string | null } }) {
  const { cart, addItem, setQuantity } = useCart();
  const [showDetail, setShowDetail] = useState(false);
  const quantity = cart?.kitchenId === kitchenId ? cart.items.find((i) => i.menuItemId === item.id)?.quantity ?? 0 : 0;
  const add = () => addItem(kitchenId, kitchenName, { menuItemId: item.id, name: item.name, price: item.price });
  return <>
    <article className="kb-menu-row">
      <button type="button" onClick={() => setShowDetail(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="kb-menu-thumb">{item.photo_url ? <Image src={item.photo_url} alt="" fill sizes="84px" className="object-cover"/> : <span>🍽️</span>}</div>
        <div className="min-w-0"><h3 className="truncate text-[15px] font-extrabold text-slate-900">{item.name}</h3><p className="mt-1 text-sm font-semibold text-slate-500">${item.price.toFixed(2)}</p><p className="mt-1 text-[11px] text-slate-400">Tap for details</p></div>
      </button>
      {quantity===0 ? <button type="button" onClick={add} className="kb-add-button">+</button> : <div className="kb-quantity"><button aria-label={`Decrease ${item.name} quantity`} onClick={()=>setQuantity(item.id,quantity-1)}>−</button><b>{quantity}</b><button aria-label={`Increase ${item.name} quantity`} onClick={()=>setQuantity(item.id,quantity+1)}>+</button></div>}
    </article>
    {showDetail && <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-5" onClick={()=>setShowDetail(false)}>
      <div className="kb-detail-sheet" onClick={e=>e.stopPropagation()}>
        <div className="relative h-64 w-full bg-slate-100">{item.photo_url?<Image src={item.photo_url} alt="" fill sizes="(min-width:640px) 420px,100vw" className="object-cover" priority/>:<div className="grid h-full place-items-center text-6xl">🍽️</div>}<button onClick={()=>setShowDetail(false)} aria-label="Close" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-2xl shadow">×</button></div>
        <div className="p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-purple-600">From {kitchenName}</p><h2 className="mt-2 text-2xl font-black tracking-tight">{item.name}</h2><p className="mt-2 text-xl font-extrabold">${item.price.toFixed(2)}</p><p className="mt-2 text-sm leading-6 text-slate-500">A menu item from this neighbourhood kitchen. Tap add to put it in your cart.</p><div className="mt-5">{quantity===0?<button onClick={add} className="kb-primary-button w-full">Add to cart · ${item.price.toFixed(2)}</button>:<div className="kb-quantity-large"><button onClick={()=>setQuantity(item.id,quantity-1)}>−</button><b>{quantity}</b><button onClick={()=>setQuantity(item.id,quantity+1)}>+</button></div>}</div></div>
      </div>
    </div>}
  </>;
}
