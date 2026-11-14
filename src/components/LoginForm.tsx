"use client";

import { useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "./Spinner";
import Image from "next/image";
import { BRAND_NAME } from "@/lib/brand";
import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal-links";

export const AUTH_FAILED_MESSAGE="Sign-in didn't work, please try again.";
export const IN_APP_BROWSER_TIP="Opened from Facebook or Instagram? Google sign-in may not work here. Tap ⋯ and choose Open in Chrome or Safari.";
/** Facebook / Instagram / Messenger in-app browsers, where Google blocks sign-in. */
export function isInAppBrowser(userAgent:string){return /FBAN|FBAV|FB_IAB|FBIOS|Instagram/i.test(userAgent)}
/** The user agent never changes during a visit: nothing to subscribe to. */
const noSubscribe=()=>()=>{};

/** authFailed: /auth/callback sent us back with ?error=auth-failed. */
export function LoginForm({authFailed=false}:{authFailed?:boolean}){
 const [welcome,setWelcome]=useState(!authFailed); const [error,setError]=useState<string|null>(authFailed?AUTH_FAILED_MESSAGE:null); const [googleLoading,setGoogleLoading]=useState(false); const supabase=createClient();
 // false on the server and during hydration, so both renders match; the real answer after.
 const inAppBrowser=useSyncExternalStore(noSubscribe,()=>isInAppBrowser(navigator.userAgent),()=>false);
 async function handleGoogleSignIn(){if(googleLoading)return;setGoogleLoading(true);setError(null);const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:`${window.location.origin}/auth/callback`}});if(error){setError(error.message);setGoogleLoading(false)}}
 if (welcome) return <div className="kb-welcome-screen"><div className="kb-welcome-photo"><Image src="/categories/home-cooks.jpg" alt="Local food" fill sizes="100vw" className="object-cover" priority/><div className="kb-welcome-shade"/><div className="relative z-10 flex min-h-screen flex-col justify-between p-7 text-white"><div className="pt-7"><Image src="/brand/logo-full.png" alt={BRAND_NAME} width={190} height={70} className="h-16 w-auto object-contain brightness-0 invert" priority/><h1 className="mt-8 text-4xl font-black leading-[1.03] tracking-tight">Local Food<br/>Local People<br/>Delivered to You</h1><p className="mt-4 max-w-[18rem] text-sm leading-6 text-white/80">Discover home cooks, hawkers and neighbourhood favourites.</p></div><div className="pb-4"><button onClick={()=>setWelcome(false)} className="kb-primary-button w-full">Get Started</button><button onClick={()=>setWelcome(false)} className="mt-3 w-full rounded-2xl border border-white/60 bg-black/35 py-4 text-sm font-black text-white backdrop-blur">Sign In</button></div></div></div></div>;
 return <div className="kb-login-shell"><div className="kb-login-card"><div className="text-center"><Image src="/brand/logo-full.png" alt={BRAND_NAME} width={150} height={56} className="mx-auto h-14 w-auto object-contain" priority/><p className="kb-eyebrow mt-5">WELCOME TO {BRAND_NAME.toUpperCase()}</p><h1 className="mt-2 text-3xl font-black tracking-tight">Local food.<br/>Local people.</h1><p className="mt-3 text-sm leading-6 text-slate-500">Sign in with your Google account to order from home cooks, hawkers and neighbourhood food businesses.</p></div>
 <button onClick={handleGoogleSignIn} disabled={googleLoading} className="kb-google-button mt-7">{googleLoading?<Spinner size={18}/>:<GoogleIcon/>}{googleLoading?"Redirecting…":"Continue with Google"}</button>
 {inAppBrowser&&<p role="note" className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">{IN_APP_BROWSER_TIP}</p>}
 {error&&<p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</p>}
 <p className="mt-6 text-center text-[11px] leading-5 text-slate-400">By continuing, you agree to our <LegalLink label="Terms of Use"/> and <LegalLink label="Privacy Policy"/>.</p>
 </div></div>;
}
/** A same-tab link to /terms or /privacy, from LEGAL_LINKS. */
function LegalLink({label}:{label:string}){const l=LEGAL_LINKS.find(x=>x.label===label)!;return <Link href={l.href} className="underline underline-offset-2 hover:text-slate-600">{l.label}</Link>}
function GoogleIcon(){return <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>}
