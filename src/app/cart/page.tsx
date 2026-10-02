import { createClient } from "@/lib/supabase/server";
import { CartView } from "@/components/CartView";

export default async function CartPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <CartView isSignedIn={!!user} />;
}
