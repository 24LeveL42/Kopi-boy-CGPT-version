import Link from "next/link";
import { Merchant } from "@/lib/types";
import { MerchantCard } from "./MerchantCard";
export function MerchantGrid({merchants,heading,showSeeAll=false,variant="grid"}:{merchants:Merchant[];heading:string;showSeeAll?:boolean;variant?:"grid"|"list"}){
 return <section className="kb-section"><div className="kb-section-heading"><div><h2>{heading}</h2><p>{heading.includes("Popular")?"Neighbourhood favourites worth trying.":"Browse local sellers near you."}</p></div>{showSeeAll&&<Link href="/?browse=all" className="kb-see-all">See all <span>›</span></Link>}</div>{merchants.length===0?<EmptyState/>:<div className={variant === "list" ? "mt-3 space-y-2.5" : "mt-3 grid grid-cols-2 gap-3"}>{merchants.map(m=><MerchantCard key={m.id} merchant={m} variant={variant}/>)}</div>}</section>;
}
function EmptyState(){return <div className="kb-empty-state"><div className="kb-empty-icon">⌕</div><p className="font-extrabold">No cooks or stalls found</p><p className="mt-1 text-sm text-slate-500">Try another search, category or cuisine.</p></div>}
