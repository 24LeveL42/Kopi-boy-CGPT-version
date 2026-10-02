"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { SignOutButton } from "./SignOutButton";

export function TopBar({ location = "Nearby" }: { location?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <header className="flex items-center justify-between py-2">
        <button aria-label="Open menu" onClick={() => setMenuOpen(true)} className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--kb-ink)" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
        </button>
        <Image src="/brand/logo-full.png" alt="Kopi Boy" width={132} height={52} className="h-10 w-auto object-contain" priority />
        <button aria-label={`Location: ${location}`} className="flex max-w-[120px] items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-semibold shadow-sm">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--kb-purple)" strokeWidth="2"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/></svg>
          <span className="truncate">{location}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 w-80 max-w-[84%] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <Image src="/brand/logo-full.png" alt="Kopi Boy" width={130} height={52} className="h-11 w-auto object-contain" />
              <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100">×</button>
            </div>
            <nav className="mt-8 space-y-2">
              {[["/","Home"],["/orders","My Orders"],["/account","My Profile"]].map(([href,label]) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} className="block rounded-2xl px-4 py-3 font-semibold hover:bg-purple-50">{label}</Link>)}
            </nav>
            <div className="mt-8 border-t border-slate-100 pt-5"><SignOutButton /></div>
          </aside>
        </div>
      )}
    </>
  );
}
