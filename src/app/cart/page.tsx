import { createClient } from "@/lib/supabase/server";
import { loadSavedAddresses } from "@/lib/address-store";
import { CartView } from "@/components/CartView";

export default async function CartPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A load failure just means checkout falls back to typing a postal code.
  const { addresses } = user ? await loadSavedAddresses(supabase, user.id) : { addresses: [] };

  return <CartView isSignedIn={!!user} savedAddresses={addresses} />;
}
