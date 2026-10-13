"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";
import { placeOrder } from "@/lib/order-actions";
import { isKitchenBlocked } from "@/lib/kitchen-actions";
import { UNAVAILABLE_ORDER_MESSAGE } from "@/lib/kitchen-availability";
import { quoteDelivery, type DeliveryQuoteResult } from "@/lib/delivery-actions";
import { DELIVERY_TYPES, deliveryQuoteMessage, type DeliveryType } from "@/lib/delivery-types";
import { useDeliveryPostalCode } from "@/lib/use-delivery-postal-code";
import { Spinner } from "@/components/Spinner";
import { BottomNav } from "@/components/BottomNav";

const DELIVERY_OPTION_TEXT: Record<DeliveryType, { title: string; note: string }> = {
 normal: { title: "🛵 Normal", note: "25–40 min" },
 express: { title: "⚡ Express", note: "Faster priority, higher fee" },
};

export function CartView({ isSignedIn }: { isSignedIn: boolean }) {
 const {cart,setQuantity,removeItem,subtotal,clearCart}=useCart(); const [checkout,setCheckout]=useState(false); const [pending,startTransition]=useTransition(); const [error,setError]=useState<string|null>(null); const router=useRouter();
 const {postalCode,setPostalCode,remember}=useDeliveryPostalCode(); const [deliveryType,setDeliveryType]=useState<DeliveryType>("normal"); const [recheck,setRecheck]=useState(0); const [showInvalid,setShowInvalid]=useState(false); const [quote,setQuote]=useState<{key:string;result:DeliveryQuoteResult}|null>(null);
 // The fee comes only from the server (geocoded postal code -> quote_delivery
 // RPC), keyed on kitchen + postal code + Normal/Express — never on the items,
 // so changing quantities doesn't re-quote or change it.
 const kitchenId=cart?.kitchenId; const postalValid=/^\d{6}$/.test(postalCode); const canQuote=isSignedIn&&!!kitchenId&&postalValid; const quoteKey=canQuote?`${kitchenId}|${postalCode}|${deliveryType}|${recheck}`:null;
 useEffect(()=>{if(!canQuote||!kitchenId)return;let cancelled=false;const key=`${kitchenId}|${postalCode}|${deliveryType}|${recheck}`;quoteDelivery(kitchenId,postalCode,deliveryType).then(result=>{if(cancelled)return;setQuote({key,result});if(result.ok)remember(postalCode)},()=>{if(!cancelled)setQuote({key,result:{ok:false,reason:"error"}})});return()=>{cancelled=true}},[canQuote,kitchenId,postalCode,deliveryType,recheck,remember]);
 // Warn early if HQ has blocked the cart's kitchen. placeOrder() re-checks on
 // the server either way; this only explains why Confirm Order is disabled.
 const [blockedKitchenId,setBlockedKitchenId]=useState<string|null>(null);
 useEffect(()=>{if(!kitchenId)return;let cancelled=false;isKitchenBlocked(kitchenId).then(b=>{if(!cancelled)setBlockedKitchenId(b?kitchenId:null)},()=>{});return()=>{cancelled=true}},[kitchenId]);
 const kitchenBlocked=!!kitchenId&&blockedKitchenId===kitchenId;
 const blockedNotice=kitchenBlocked&&<p role="alert" data-testid="kitchen-unavailable" className="mt-4 rounded-2xl bg-slate-200 p-3 text-sm font-semibold text-slate-700">{UNAVAILABLE_ORDER_MESSAGE} You can&apos;t place this order. Clear your cart to order from another kitchen.</p>;
 const currentQuote=quote&&quote.key===quoteKey?quote.result:null; const checking=quoteKey!=null&&currentQuote==null; const deliveryFee=currentQuote?.ok?currentQuote.fee:null; const total=subtotal+(deliveryFee??0);
 const postalStatus=!isSignedIn?deliveryQuoteMessage("signed_out"):showInvalid&&!postalValid?deliveryQuoteMessage("invalid"):checking?"Checking postal code…":currentQuote?.ok?`Found: ${currentQuote.address}`:currentQuote?deliveryQuoteMessage(currentQuote.reason):null;
 if(!cart||cart.items.length===0)return <div className="kb-app-shell min-h-screen pb-28"><div className="mx-auto max-w-md px-5 py-16 text-center"><div className="kb-empty-illustration">🛍️</div><h1 className="mt-5 text-2xl font-black">Your cart is waiting</h1><p className="mt-2 text-sm leading-6 text-slate-500">Add something delicious from a neighbourhood cook or hawker.</p><Link href="/" className="kb-primary-button mt-6 inline-flex">Explore local food</Link></div><BottomNav/></div>;
 function handleCheckPostalCode(){setShowInvalid(true);if(postalValid)setRecheck(n=>n+1)}
 function handlePlaceOrder(){if(!cart)return;setError(null);startTransition(async()=>{try{const result=await placeOrder(cart.kitchenId,cart.items.map(i=>({menuItemId:i.menuItemId,quantity:i.quantity})),{postalCode,deliveryType});if(!result.ok){setError(result.message);return}clearCart();router.push(`/orders/${result.orderId}`)}catch{setError("Something went wrong — please try again.")}})}
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
   <section className="kb-cart-card mt-4"><div className="flex justify-between text-sm text-slate-600"><span>Subtotal</span><b className="text-slate-900">${subtotal.toFixed(2)}</b></div><div className="mt-3 flex justify-between text-sm text-slate-600"><span>Delivery Fee</span><span>{deliveryFee!=null?`$${deliveryFee.toFixed(2)}`:"Calculated at checkout"}</span></div><div className="mt-4 border-t border-slate-100 pt-4 flex justify-between"><span className="text-base font-black">Total</span><span className="text-xl font-black">${total.toFixed(2)}</span></div><div className="kb-no-fee mt-4"><span>🏷️</span><div><b>No Platform Fee</b><small>100% of the food payment goes to our home cooks and hawkers.</small></div></div></section>
   {blockedNotice}
   <button onClick={()=>setCheckout(true)} className="kb-primary-button mt-5 w-full">Proceed to Checkout <span>${total.toFixed(2)}</span></button>
  </>:<>
   <div className="kb-checkout-title"><button onClick={()=>setCheckout(false)} className="kb-outline-button">← Back</button><div className="text-right"><p className="kb-eyebrow">FINAL STEP</p><h1>Checkout</h1></div></div>
   <section className="kb-cart-card mt-5"><p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Delivery Address</p><div className="mt-3 flex items-center gap-3 rounded-2xl bg-[#faf8ff] p-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-purple-100 text-purple-700">⌂</span><div className="min-w-0 flex-1"><label htmlFor="delivery-postal-code" className="block text-sm font-bold">Delivery postal code</label><input id="delivery-postal-code" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="e.g. 310123" value={postalCode} onChange={e=>{setPostalCode(e.target.value.replace(/\D/g,"").slice(0,6));setShowInvalid(false)}} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"/></div><button type="button" onClick={handleCheckPostalCode} disabled={checking} className="kb-text-button">Check postal code</button></div>{postalStatus&&<p data-testid="postal-status" className={`mt-2 text-xs ${currentQuote?.ok&&!checking?"font-semibold text-purple-700":"text-slate-500"}`}>{postalStatus}</p>}</section>
   <section className="kb-cart-card mt-4"><p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Delivery Option</p><div className="mt-3 grid grid-cols-3 gap-2">{DELIVERY_TYPES.map(t=>{const selected=deliveryType===t;return <button key={t} type="button" aria-pressed={selected} onClick={()=>setDeliveryType(t)} className={selected?"rounded-2xl border-2 border-purple-500 bg-purple-50 p-3 text-left":"rounded-2xl border border-slate-200 bg-white p-3 text-left"}><b className={`block text-sm ${selected?"text-purple-700":""}`}>{DELIVERY_OPTION_TEXT[t].title}</b><span className="text-xs text-slate-500">{DELIVERY_OPTION_TEXT[t].note}</span></button>})}<div className="rounded-2xl border border-slate-200 bg-white p-3 opacity-65"><b className="block text-sm">▣ Schedule</b><span className="text-xs text-slate-500">Later today</span><strong className="mt-1 block text-xs">Coming soon</strong></div></div><p data-testid="delivery-fee-estimate" className="mt-3 text-sm font-semibold text-slate-700">{currentQuote?.ok?`Estimated delivery fee S$${currentQuote.fee.toFixed(2)} (about ${currentQuote.distanceKm.toFixed(1)} km)`:checking?"Working out the delivery fee…":"Enter your postal code to see the delivery fee."}</p></section>
   <section className="kb-cart-card mt-4"><p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Payment Method</p><div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 p-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-purple-100 text-purple-700">▣</span><div><b className="block text-sm">Pay to Cook Directly</b><small className="text-xs text-slate-500">Cash / PayNow / QR</small></div><span className="ml-auto text-purple-600">✓</span></div></section>
   <section className="kb-cart-card mt-4"><div className="flex justify-between text-sm"><span>Subtotal</span><b>${subtotal.toFixed(2)}</b></div>{deliveryFee!=null&&<div className="mt-2 flex justify-between text-sm text-slate-600"><span>Delivery Fee</span><span>${deliveryFee.toFixed(2)}</span></div>}<div className="mt-3 flex justify-between border-t border-slate-100 pt-3"><b>Total</b><strong className="text-xl">${total.toFixed(2)}</strong></div></section>
   {blockedNotice}
   {isSignedIn?<><button onClick={handlePlaceOrder} disabled={pending||!currentQuote?.ok||kitchenBlocked} className="kb-primary-button mt-5 w-full">{pending&&<Spinner/>}{pending?"Confirming order…":<>Confirm Order <span>${total.toFixed(2)}</span></>}</button>{error&&<p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}</>:<div className="kb-signin-card mt-5"><p className="font-extrabold">Almost there</p><p className="mt-1 text-sm text-slate-500">Sign in to place your order.</p><Link href="/login" className="kb-primary-button mt-4 w-full">Sign in & continue</Link></div>}
  </>}
  <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">Kopi Boy charges no platform fee. Delivery fee is an estimate until the cook and rider confirm it.</p>
 </main><BottomNav/></div>;
}
