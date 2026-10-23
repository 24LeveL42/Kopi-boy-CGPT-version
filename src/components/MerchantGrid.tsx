import Link from "next/link";
import { Merchant } from "@/lib/types";
import type { DealBadgeKind } from "@/lib/deals";
import { MerchantCard } from "./MerchantCard";
export function MerchantGrid({merchants,heading,subheading,showSeeAll=false,variant="grid",id,dealBadges}:{merchants:Merchant[];heading:string;subheading?:string;showSeeAll?:boolean;variant?:"grid"|"list"|"row";id?:string;dealBadges?:ReadonlyMap<string,DealBadgeKind>}){
 return <section id={id} className="kb-section"><div className="kb-section-heading"><div><h2>{heading}</h2><p>{subheading??(heading.includes("Popular")?"Neighbourhood favourites worth trying.":"Browse local sellers near you.")}</p></div>{showSeeAll&&<Link href="/?browse=all" className="kb-see-all">See all <span>›</span></Link>}</div>{merchants.length===0?<EmptyState/>:<div className={variant === "list" ? "mt-3 space-y-2.5" : variant === "row" ? "kb-card-row mt-3" : "mt-3 grid grid-cols-2 gap-3"}>{merchants.map(m=><MerchantCard key={m.id} merchant={m} variant={variant === "list" ? "list" : "grid"} dealBadge={dealBadges?.get(m.id)}/>)}</div>}</section>;
}
function EmptyState(){return <div className="kb-empty-state"><div className="kb-empty-icon">⌕</div><p className="font-extrabold">No cooks or stalls found</p><p className="mt-1 text-sm text-slate-500">Try another search, category or cuisine.</p></div>}
