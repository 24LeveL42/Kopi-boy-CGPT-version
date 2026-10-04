import { getLiveMerchants } from "@/lib/kitchens";
import { FavouritesView } from "@/components/FavouritesView";
import { BottomNav } from "@/components/BottomNav";
export default async function FavouritesPage() { const merchants=await getLiveMerchants(); return <div className="kb-app-shell min-h-screen pb-28"><main className="mx-auto max-w-md px-4 py-5 sm:px-6"><FavouritesView merchants={merchants}/></main><BottomNav/></div>; }
