import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MenuItemRow } from "@/components/MenuItemRow";
import { CategoryPill, RatingSummary, RegisteredBadge } from "@/components/KitchenBadges";
import { formatKitchenArea, selectKitchens } from "@/lib/kitchens";
import { BottomNav } from "@/components/BottomNav";
import type { MerchantCategory } from "@/lib/types";

export default async function MerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: kitchen } = await selectKitchens((columns) => supabase.from("kitchens").select(columns).eq("id", id).eq("is_live", true).maybeSingle<{
    id: string; business_name: string; category: MerchantCategory; cuisine_type: string; description: string | null; postal_code?: string | null; business_uen?: string | null; hero_image?: string | null;
  }>());
  if (!kitchen) notFound();
  const [{ data: menuItems }, { data: ratingSummary }] = await Promise.all([
    supabase.from("menu_items").select("id, name, price, photo_url").eq("kitchen_id", id).order("created_at", { ascending: true }),
    supabase.from("kitchen_rating_summary").select("average, rating_count").eq("kitchen_id", id).maybeSingle<{ average: number; rating_count: number }>(),
  ]);
  const area = formatKitchenArea(kitchen.postal_code);
  const cuisine = ({ chinese:"Chinese", halal:"Halal", indian:"Indian", western:"Western" } as Record<string,string>)[kitchen.cuisine_type] ?? kitchen.cuisine_type;
  const hero = kitchen.hero_image || ({"home-cook":"/categories/home-cooks.jpg",hawker:"/categories/hawkers.jpg",bakery:"/categories/bakers.jpg","bulk-orders":"/categories/bulk-orders.jpg",drinks:"/categories/drinks-desserts.jpg"} as Record<string,string>)[kitchen.category];
  return <div className="kb-app-shell min-h-screen pb-28">
    <section className="relative h-[280px] overflow-hidden sm:h-[330px]">
      <Image src={hero} alt="" fill sizes="100vw" className="object-cover" priority/><div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/15 to-black/10"/>
      <Link href="/" aria-label="Back" className="absolute left-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/90 text-slate-900 shadow-lg">←</Link>
      <div className="absolute right-4 top-4 z-10 flex gap-2"><button className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-xl shadow-lg" aria-label="Share">↗</button><button className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-xl shadow-lg" aria-label="Favourite">♡</button></div>
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-3xl p-5 sm:p-8"><div className="flex items-end gap-3"><div className="kb-merchant-avatar"><Image src={hero} alt="" fill sizes="68px" className="object-cover"/></div><div className="min-w-0"><h1 className="truncate text-2xl font-black tracking-tight text-white sm:text-3xl">{kitchen.business_name}</h1><p className="mt-1 text-sm text-white/80">{cuisine}{area?` · ${area}`:""} · Local seller</p></div></div></div>
    </section>
    <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
      <section className="kb-merchant-summary"><div className="flex flex-wrap items-center gap-2"><CategoryPill category={kitchen.category}/>{kitchen.business_uen&&<RegisteredBadge uen={kitchen.business_uen} showUen/>}</div><div className="mt-3 flex items-center gap-2"><span className="font-extrabold text-amber-500">★ {ratingSummary?.average ? ratingSummary.average.toFixed(1):"New"}</span><span className="text-sm text-slate-500">{ratingSummary?.rating_count ?? 0} ratings</span><span className="text-slate-300">·</span><span className="text-sm font-semibold text-slate-600">25–40 min</span></div>{kitchen.description&&<p className="mt-4 text-sm leading-6 text-slate-600">{kitchen.description}</p>}<div className="kb-merchant-benefits"><div><b>◷</b><span>25–40 min<small>Delivery time</small></span></div><div><b>♧</b><span>Direct<small>Pay cook</small></span></div><div><b>✓</b><span>$0<small>Platform fee</small></span></div></div></section>
      <div className="kb-menu-tabs"><button className="is-active">Menu</button><button>Reviews</button><button>About</button></div>
      <section className="py-5"><div className="kb-section-heading mb-4"><div><h2>Menu</h2><p>{menuItems?.length ?? 0} items available</p></div></div>{menuItems&&menuItems.length>0?<div className="space-y-3">{menuItems.map(item=><MenuItemRow key={item.id} kitchenId={kitchen.id} kitchenName={kitchen.business_name} item={item}/>)}</div>:<div className="kb-empty-state">This kitchen hasn&apos;t added any menu items yet.</div>}</section>
    </main>
    <BottomNav/>
  </div>;
}
