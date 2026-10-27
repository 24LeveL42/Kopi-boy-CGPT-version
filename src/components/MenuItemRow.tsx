"use client";

import { useState } from "react";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";
import { lineKey } from "@/lib/cart-lines";
import { UNAVAILABLE_LABEL } from "@/lib/kitchen-availability";
import { blockingGroup, type MenuOptionGroup } from "@/lib/menu-options";
import type { CartItemOption } from "@/lib/types-order";
import { AddOnSheet } from "@/components/AddOnSheet";

/**
 * `unavailable`: the kitchen is blocked by HQ — every way of adding more is disabled; lowering a quantity already in the cart still works.
 * `groups`: the dish's add-on groups. A dish without any works exactly as before (one tap adds it);
 * with groups, adding opens the AddOnSheet and quantities are changed per line in the cart.
 */
export function MenuItemRow({ kitchenId, kitchenName, item, groups = [], unavailable = false }: { kitchenId: string; kitchenName: string; item: { id: string; name: string; price: number; photo_url: string | null }; groups?: MenuOptionGroup[]; unavailable?: boolean }) {
  const { cart, addItem, setQuantity } = useCart();
  const [showDetail, setShowDetail] = useState(false);
  const [picking, setPicking] = useState(false);
  const hasGroups = groups.length > 0;
  const blocked = hasGroups ? blockingGroup(groups) : null;
  const plainKey = lineKey({ menuItemId: item.id });
  const lines = cart?.kitchenId === kitchenId ? cart.items.filter((i) => i.menuItemId === item.id) : [];
  const quantity = lines.find((i) => lineKey(i) === plainKey)?.quantity ?? 0;
  const inCart = lines.reduce((sum, i) => sum + i.quantity, 0);
  const add = () => addItem(kitchenId, kitchenName, { menuItemId: item.id, name: item.name, price: item.price, photoUrl: item.photo_url });
  const addWithOptions = (options: CartItemOption[]) => {
    setPicking(false);
    addItem(kitchenId, kitchenName, { menuItemId: item.id, name: item.name, price: item.price, photoUrl: item.photo_url, options });
  };
  const openPicker = () => {
    setShowDetail(false);
    setPicking(true);
  };
  return <>
    <article className="kb-menu-row">
      <button type="button" onClick={() => setShowDetail(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="kb-menu-thumb">{item.photo_url ? <Image src={item.photo_url} alt="" fill sizes="84px" className="object-cover"/> : <span>🍽️</span>}</div>
        <div className="min-w-0"><h3 className="truncate text-[15px] font-extrabold text-slate-900">{item.name}</h3><p className="mt-1 text-sm font-semibold text-slate-500">${item.price.toFixed(2)}</p>{hasGroups ? <p data-testid="menu-row-note" className="mt-1 text-[11px] font-semibold text-slate-400">{blocked ? "Not available right now" : inCart > 0 ? `${inCart} in cart · Add-ons available` : "Add-ons available"}</p> : <p className="mt-1 text-[11px] text-slate-400">Tap for details</p>}</div>
      </button>
      {hasGroups ? <button type="button" onClick={openPicker} disabled={unavailable || !!blocked} aria-haspopup="dialog" aria-label={`Add ${item.name} to cart`} className="kb-add-button disabled:cursor-not-allowed disabled:opacity-40">+</button>
      : quantity===0 ? <button type="button" onClick={add} disabled={unavailable} aria-label={`Add ${item.name} to cart`} className="kb-add-button disabled:cursor-not-allowed disabled:opacity-40">+</button> : <div className="kb-quantity"><button aria-label={`Decrease ${item.name} quantity`} onClick={()=>setQuantity(plainKey,quantity-1)}>−</button><b>{quantity}</b><button aria-label={`Increase ${item.name} quantity`} disabled={unavailable} onClick={()=>setQuantity(plainKey,quantity+1)} className="disabled:cursor-not-allowed disabled:opacity-40">+</button></div>}
    </article>
    {showDetail && <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-5" onClick={()=>setShowDetail(false)}>
      <div className="kb-detail-sheet" onClick={e=>e.stopPropagation()}>
        <div className="relative h-64 w-full bg-slate-100">{item.photo_url?<Image src={item.photo_url} alt="" fill sizes="(min-width:640px) 420px,100vw" className="object-cover" priority/>:<div className="grid h-full place-items-center text-6xl">🍽️</div>}<button onClick={()=>setShowDetail(false)} aria-label="Close" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-2xl shadow">×</button></div>
        <div className="p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-purple-600">From {kitchenName}</p><h2 className="mt-2 text-2xl font-black tracking-tight">{item.name}</h2><p className="mt-2 text-xl font-extrabold">${item.price.toFixed(2)}</p><p className="mt-2 text-sm leading-6 text-slate-500">{hasGroups?"A menu item from this neighbourhood kitchen. Choose your add-ons, then add it to your cart.":"A menu item from this neighbourhood kitchen. Tap add to put it in your cart."}</p>
          {blocked&&<p className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">{blocked.name} is sold out, so this dish can&apos;t be ordered right now.</p>}
          <div className="mt-5">{hasGroups?<button onClick={openPicker} disabled={unavailable||!!blocked} aria-haspopup="dialog" className="kb-primary-button w-full disabled:cursor-not-allowed disabled:opacity-50">{unavailable?UNAVAILABLE_LABEL:blocked?"Not available right now":"Choose add-ons"}</button>:quantity===0?<button onClick={add} disabled={unavailable} className="kb-primary-button w-full disabled:cursor-not-allowed disabled:opacity-50">{unavailable?UNAVAILABLE_LABEL:`Add to cart · $${item.price.toFixed(2)}`}</button>:<div className="kb-quantity-large"><button onClick={()=>setQuantity(plainKey,quantity-1)}>−</button><b>{quantity}</b><button disabled={unavailable} onClick={()=>setQuantity(plainKey,quantity+1)} className="disabled:cursor-not-allowed disabled:opacity-40">+</button></div>}</div></div>
      </div>
    </div>}
    {picking && <AddOnSheet item={item} groups={groups} unavailable={unavailable} onAdd={addWithOptions} onClose={()=>setPicking(false)}/>}
  </>;
}
