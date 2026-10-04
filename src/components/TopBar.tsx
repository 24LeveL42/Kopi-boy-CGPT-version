"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { SignOutButton } from "./SignOutButton";
import { useNotifications } from "@/lib/notifications-context";
export function TopBar({ location = "Nearby" }: { location?: string }) {
 const [menuOpen,setMenuOpen]=useState(false); const {unreadCount}=useNotifications();
 return <>
  <header className="kb-home-topbar">
   <button aria-label="Open menu" onClick={()=>setMenuOpen(true)} className="kb-icon-button kb-glass-button"><MenuIcon/></button>
   <Link href="/" aria-label="Kopi Boy home" className="kb-home-logo"><Image src="/brand/logo-full.png" alt="Kopi Boy" width={128} height={48} className="h-10 w-auto object-contain" priority/></Link>
   <div className="flex items-center gap-2"><Link href="/notifications" aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-full border border-[#ebe9ef] bg-white text-[#24212d]"><BellIcon/>{unreadCount>0&&<span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[#ef3d58]"/>}</Link><button aria-label={`Location: ${location}`} className="kb-location-pill"><PinIcon/><span className="truncate">{location}</span><Chevron/></button></div>
  </header>
  {menuOpen&&<div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true"><button aria-label="Close menu" onClick={()=>setMenuOpen(false)} className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"/><aside className="kb-drawer"><div className="flex items-center justify-between"><Image src="/brand/logo-full.png" alt="Kopi Boy" width={128} height={48} className="h-10 w-auto object-contain"/><button aria-label="Close menu" onClick={()=>setMenuOpen(false)} className="kb-icon-button bg-slate-100">×</button></div><div className="mt-6 rounded-[25px] bg-gradient-to-br from-[#6320dd] to-[#0db183] p-5 text-white"><p className="text-[10px] font-black uppercase tracking-[.16em] text-white/70">Kopi Boy</p><p className="mt-2 text-2xl font-black leading-tight">Local food.<br/>Local people.</p><p className="mt-2 text-xs text-white/80">Home cooks, hawkers and neighbourhood favourites.</p></div><nav className="mt-5 space-y-1">{[['/','Home','⌂'],['/favourites','Favourites','♡'],['/orders','Orders','▣'],['/cart','Your Cart','🛍'],['/account','My Profile','♙'],['/notifications','Notifications','♧']].map(([href,label,icon])=><Link key={href} href={href} onClick={()=>setMenuOpen(false)} className="kb-drawer-link"><span className="flex items-center gap-3"><span className="kb-profile-link-icon">{icon}</span>{label}</span><ChevronRight/></Link>)}</nav><div className="mt-5 border-t border-slate-100 pt-4"><SignOutButton/></div></aside></div>}
 </>;
}
function MenuIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>}
function BellIcon(){return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 9a6 6 0 10-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8"/><path d="M10 21h4"/></svg>}
function PinIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/></svg>}
function Chevron(){return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>}
function ChevronRight(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>}
