import { Merchant } from "@/lib/types";
import { MerchantCard } from "./MerchantCard";
export function MerchantGrid({merchants,heading,showSeeAll=false}:{merchants:Merchant[];heading:string;showSeeAll?:boolean}){
 return <section><div className="mb-3 flex items-center justify-between"><h2 className="kb-section-title">{heading}</h2>{showSeeAll&&<button className="text-sm font-bold text-purple-700">See all <span aria-hidden>›</span></button>}</div>{merchants.length===0?<EmptyState/>:<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{merchants.map(m=><MerchantCard key={m.id} merchant={m}/>)}</div>}</section>;
}
function EmptyState(){return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center"><p className="font-semibold">No cooks or stalls found</p><p className="mt-1 text-sm text-slate-500">Try another search, category or cuisine.</p></div>}
