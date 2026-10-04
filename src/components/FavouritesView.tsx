"use client";
import { useEffect, useState } from "react";
import { Merchant } from "@/lib/types";
import { MerchantCard } from "./MerchantCard";
const KEY="kb-favourites";
export function FavouritesView({merchants}:{merchants:Merchant[]}){const [ids,setIds]=useState<string[]>([]);const load=()=>{try{setIds(JSON.parse(localStorage.getItem(KEY)||"[]"))}catch{setIds([])}};useEffect(()=>{load();const h=()=>load();window.addEventListener("kb-favourites-changed",h);return()=>window.removeEventListener("kb-favourites-changed",h)},[]);const saved=merchants.filter(m=>ids.includes(m.id));return <><div className="kb-page-title"><div><p className="kb-eyebrow">YOUR SAVED FOOD</p><h1>Favourites</h1><p>Keep your favourite local cooks and hawkers close.</p></div></div>{saved.length?<div className="mt-5 space-y-2.5">{saved.map(m=><MerchantCard key={m.id} merchant={m} variant="list"/>)}</div>:<div className="kb-empty-state mt-5"><div className="kb-empty-icon">♥</div><p className="font-extrabold">No favourites yet</p><p className="mt-1 text-sm text-slate-500">Tap the heart on a cook or stall you want to remember.</p></div>}</>}
