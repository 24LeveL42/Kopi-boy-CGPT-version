import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { BottomNav } from "@/components/BottomNav";

export default async function AccountPage() {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const name=user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email?.split("@")[0]||"Customer";
  return <div className="kb-app-shell min-h-screen pb-28"><main className="mx-auto max-w-md px-4 py-6 sm:px-6">
    <section className="kb-profile-hero"><div className="kb-profile-avatar">{name.slice(0,1).toUpperCase()}</div><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.15em] text-white/70">My account</p><h1 className="mt-1 truncate text-2xl font-black text-white">{user?name:"Welcome to Kopi Boy"}</h1><p className="mt-1 truncate text-sm text-white/75">{user?.email??"Sign in to manage your orders and profile."}</p></div></section>
    {!user?<div className="kb-signin-card mt-4"><p className="font-extrabold">Your account is ready when you are.</p><p className="mt-1 text-sm text-slate-500">Sign in to view your orders and use your Kopi Boy account.</p><Link href="/login" className="kb-primary-button mt-4 w-full">Sign in</Link></div>:<>
      <section className="kb-profile-menu mt-4">{[["/orders","My Orders","▣"],["/notifications","Notifications","♢"],["/cart","Your Cart","🛍"],["#","My Addresses","⌖"],["#","Payment Method","▣"],["#","Help & Support","?"],["#","About Kopi Boy","ⓘ"]].map(([href,label,icon])=>href==="#"?<div key={label} className="kb-profile-link is-disabled"><span className="kb-profile-link-icon">{icon}</span><span>{label}</span><span className="ml-auto text-slate-300">›</span></div>:<Link key={label} href={href} className="kb-profile-link"><span className="kb-profile-link-icon">{icon}</span><span>{label}</span><span className="ml-auto text-slate-300">›</span></Link>)}</section>
      <div className="kb-signout-card mt-4"><p className="text-xs text-slate-500">Signed in as</p><p className="mt-1 text-sm font-bold text-slate-800">{user.email}</p><div className="mt-4"><SignOutButton/></div></div>
    </>}
  </main><BottomNav/></div>;
}
