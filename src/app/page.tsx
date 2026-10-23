import { Marketplace } from "@/components/Marketplace";
import { getLiveMerchants } from "@/lib/kitchens";
import { getActiveDeals } from "@/lib/deals-server";

/**
 * Customer marketplace home — Feature #003.
 *
 * Reads real live kitchens from Supabase (see src/lib/kitchens.ts). Demo
 * data (src/lib/demo-data.ts) is no longer used here — it's kept only for
 * the filter-merchants test fixtures. Deals load alongside and come back
 * empty until their data source exists (src/lib/deals-server.ts).
 */
export default async function Home() {
  const [merchants, deals] = await Promise.all([getLiveMerchants(), getActiveDeals()]);
  return <Marketplace merchants={merchants} deals={deals} />;
}
