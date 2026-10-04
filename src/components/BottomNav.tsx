"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart-context";
export function BottomNav(){
 const pathname=usePathname(); const {itemCount}=useCart();
 const items=[{href:"/",label:"Home",icon:<HomeIcon/>},{href:"/orders",label:"Orders",icon:<OrdersIcon/>},{href:"/favourites",label:"Favourites",icon:<HeartIcon/>},{href:"/account",label:"Profile",icon:<ProfileIcon/>}];
 return <nav className="kb-bottom-nav" aria-label="Primary navigation"><div className="kb-bottom-nav-inner">{items.map(it=>{const active=it.href==="/"?pathname==="/":pathname.startsWith(it.href);return <Link key={it.label} href={it.href} className={`kb-bottom-item ${active?"is-active":""}`}><span>{it.icon}</span><span>{it.label}</span></Link>})}{itemCount>0&&<Link href="/cart" className="kb-bottom-cart"><BagIcon/><b>{itemCount}</b></Link>}</div></nav>
}
function HomeIcon(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9"/></svg>}
function OrdersIcon(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>}
function HeartIcon(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10A4.7 4.7 0 0112 6a4.7 4.7 0 018.8 2.8Z"/></svg>}
function BagIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>}
function ProfileIcon(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.7-4.2 4.9-6.5 7.5-6.5s5.8 2.3 7.5 6.5"/></svg>}
