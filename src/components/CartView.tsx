"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";
import { placeOrder } from "@/lib/order-actions";
import { useCustomerLocation } from "@/lib/use-customer-location";
import { haversineDistanceKm, estimateDeliveryFee } from "@/lib/distance";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";
import { BottomNav } from "@/components/BottomNav";

export function CartView({ isSignedIn }: { isSignedIn: boolean }) {
 const {cart,setQuantity,removeItem,subtotal,clearCart}=useCart(); const [checkout,setCheckout]=useState(false); const [pending,startTransition]=useTransition(); const [error,setError]=useState<string|null>(null); const router=useRouter(); const {coords,status:locationStatus,requestLocation}=useCustomerLocation(); const [kitchenCoords,setKitchenCoords]=useState<{latitude:number|null;longitude:number|null}|null>(null);
 useEffect(()=>{if(!cart)return;let cancelled=false;createClient().from("kitchens").select("latitude, longitude").eq("id",cart.kitchenId).maybeSingle().then(({data})=>{if(!cancelled)setKitchenCoords(data??null)});return()=>{cancelled=true}},[cart]);
 const distanceKm=coords&&kitchenCoords?.latitude!=null&&kitchenCoords?.longitude!=null?haversineDistanceKm(coords.latitude,coords.longitude,kitchenCoords.latitude,kitchenCoords.longitude):null; const deliveryFeeEstimate=distanceKm!=null?estimateDeliveryFee(distanceKm):null; const total=subtotal+(deliveryFeeEstimate??0);
 if(!cart||cart.items.length===0)return <div className="kb-app-shell min-h-screen pb-28"><div className="mx-auto max-w-md px-5 py-16 text-center"><div className="kb-empty-illustration">🛍️</div><h1 className="mt-5 text-2xl font-black">Your cart is waiting</h1><p className="mt-2 text-sm leading-6 text-slate-500">Add something delicious from a neighbourhood cook or hawker.</p><Link href="/" className="kb-primary-button mt-6 inline-flex">Explore local food</Link></div><BottomNav/></div>;
 function handlePlaceOrder(){if(!cart)return;setError(null);startTransition(async()=>{try{const {orderId}=await placeOrder(cart.kitchenId,cart.items.map(i=>({menuItemId:i.menuItemId,quantity:i.quantity})),coords);clearCart();router.push(`/orders/${orderId}`)}catch(e){setError(e instanceof Error?e.message:"Something went wrong — please try again.")}})}
 return <div className="kb-app-shell min-h-screen pb-32"><main className="mx-auto max-w-md px-4 py-5 sm:px-6">
  {!checkout?<>
   <div className="kb-checkout-title"><div><p className="kb-eyebrow">YOUR BAG</p><h1>Your Cart</h1><p>{cart.kitchenName}</p></div><button onClick={()=>{if(window.confirm("Remove everything from your cart?"))clearCart()}} className="kb-text-button">Clear All</button></div>
   <section className="kb-cart-card mt-5"><div className="flex items-center justify-between border-b border-slate-100 pb-3"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-purple-600">Your order</p><p className="mt-1 text-sm font-bold text-slate-900">{cart.items.reduce((s,i)=>s+i.quantity,0)} items from {cart.kitchenName}</p></div><span className="kb-mini-pill">Direct to cook</span></div><div className="divide-y divide-slate-100">{cart.items.map(item=><div key={item.menuItemId} className="flex items-center gap-3 py-4"><div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#f0e9ff] via-white to-[#e4f7ef] ring-1 ring-black/5">
              {item.photoUrl ? (
                <Image
                  src={item.photoUrl}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center">
                  <Image
                    src="/brand/logo-icon.png"
                    alt="Kopi Boy"
                    width={34}
                    height={34}
                    className="object-contain opacity-80"
                  />
                </div>
              )}
            </div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-slate-900">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">${item.price.toFixed(2)}</p></div><div className="kb-quantity"><button aria-label={`Decrease ${item.name} quantity`} onClick={()=>setQuantity(item.menuItemId,item.quantity-1)}>−</button><b>{item.quantity}</b><button aria-label={`Increase ${item.name} quantity`} onClick={()=>setQuantity(item.menuItemId,item.quantity+1)}>+</button></div><button aria-label={`Remove ${item.name} from cart`} onClick={()=>removeItem(item.menuItemId)} className="text-lg text-slate-300 hover:text-red-500">⌫</button></div>)}</div></section>
   <section className="kb-cart-card mt-4"><div className="flex justify-between text-sm text-slate-600"><span>Subtotal</span><b className="text-slate-900">${subtotal.toFixed(2)}</b></div>{deliveryFeeEstimate!=null&&<div className="mt-3 flex justify-between text-sm text-slate-600"><span>Delivery Fee</span><span>${deliveryFeeEstimate.toFixed(2)}</span></div>}<div className="mt-4 border-t border-slate-100 pt-4 flex justify-between"><span className="text-base font-black">Total</span><span className="text-xl font-black">${total.toFixed(2)}</span></div><div className="kb-no-fee mt-4"><span>🏷️</span><div><b>No Platform Fee</b><small>100% of the food payment goes to our home cooks and hawkers.</small></div></div></section>
   <button onClick={()=>setCheckout(true)} className="kb-primary-button mt-5 w-full">Proceed to Checkout <span>${total.toFixed(2)}</span></button>
  </>:<>
   <div className="kb-checkout-title"><button onClick={()=>setCheckout(false)} className="kb-outline-button">← Back</button><div className="text-right"><p className="kb-eyebrow">FINAL STEP</p><h1>Checkout</h1></div></div>
   <section className="kb-cart-card mt-5"><p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Delivery Address</p><div className="mt-3 flex items-center gap-3 rounded-2xl bg-[#faf8ff] p-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-purple-100 text-purple-700">⌂</span><div className="flex-1"><b className="block text-sm">Current location</b><small className="text-xs text-slate-500">Used to estimate delivery distance</small></div><button type="button" onClick={requestLocation} className="kb-text-button">{coords?"Ready":"Change"}</button></div>{!coords&&locationStatus!=="idle"&&<p className="mt-2 text-xs text-slate-500">{locationStatus==="denied"?"Location permission was denied — you can still place the order.":"Location isn't available right now — you can still place the order."}</p>}</section>
   <section className="kb-cart-card mt-4"><p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Delivery Option</p><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-2xl border-2 border-purple-500 bg-purple-50 p-3"><b className="block text-sm text-purple-700">🛵 Standard</b><span className="text-xs text-slate-500">25–40 min</span><strong className="mt-1 block text-xs">${deliveryFeeEstimate?.toFixed(2) ?? "—"}</strong></div><div className="rounded-2xl border border-slate-200 bg-white p-3 opacity-65"><b className="block text-sm">▣ Schedule</b><span className="text-xs text-slate-500">Later today</span><strong className="mt-1 block text-xs">Coming soon</strong></div></div></section>
   <section className="kb-cart-card mt-4"><p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Payment Method</p><div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 p-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-purple-100 text-purple-700">▣</span><div><b className="block text-sm">Pay to Cook Directly</b><small className="text-xs text-slate-500">Cash / PayNow / QR</small></div><span className="ml-auto text-purple-600">✓</span></div></section>
   <section className="kb-cart-card mt-4"><div className="flex justify-between text-sm"><span>Subtotal</span><b>${subtotal.toFixed(2)}</b></div>{deliveryFeeEstimate!=null&&<div className="mt-2 flex justify-between text-sm text-slate-600"><span>Delivery Fee</span><span>${deliveryFeeEstimate.toFixed(2)}</span></div>}<div className="mt-3 flex justify-between border-t border-slate-100 pt-3"><b>Total</b><strong className="text-xl">${total.toFixed(2)}</strong></div></section>
   {isSignedIn?<><button onClick={handlePlaceOrder} disabled={pending} className="kb-primary-button mt-5 w-full">{pending&&<Spinner/>}{pending?"Confirming order…":<>Confirm Order <span>${total.toFixed(2)}</span></>}</button>{error&&<p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}</>:<div className="kb-signin-card mt-5"><p className="font-extrabold">Almost there</p><p className="mt-1 text-sm text-slate-500">Sign in to place your order.</p><Link href="/login" className="kb-primary-button mt-4 w-full">Sign in & continue</Link></div>}
  </>}
  <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">Kopi Boy charges no platform fee. Delivery fee is an estimate until the cook and rider confirm it.</p>
 </main><BottomNav/></div>;
}
