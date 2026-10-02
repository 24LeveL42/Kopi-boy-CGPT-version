import { Marketplace } from "@/components/Marketplace";
import { getLiveMerchants } from "@/lib/kitchens";

/**
 * Customer marketplace home — Feature #003.
 *
 * Reads real live kitchens from Supabase (see src/lib/kitchens.ts). Demo
 * data (src/lib/demo-data.ts) is no longer used here — it's kept only for
 * the filter-merchants test fixtures.
 */
export default async function Home() {
  const merchants = await getLiveMerchants();
  return <Marketplace merchants={merchants} />;
}
