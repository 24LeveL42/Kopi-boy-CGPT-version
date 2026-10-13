"use server";

import { createClient } from "@/lib/supabase/server";
import { quoteDeliveryForPostalCode } from "@/lib/delivery-quote";
import { isDeliveryType, type DeliveryQuoteFailure } from "@/lib/delivery-types";

export type DeliveryQuoteResult =
  | { ok: true; address: string; distanceKm: number; fee: number }
  | { ok: false; reason: DeliveryQuoteFailure };

/**
 * Checkout's live delivery quote: geocodes the postal code on the server and
 * calls quote_delivery. Coordinates stay on the server; the client only gets
 * the address it found, the distance and the fee. Display only — placeOrder()
 * recomputes the fee itself and never takes it from the client.
 */
export async function quoteDelivery(
  kitchenId: string,
  postalCode: string,
  deliveryType: string
): Promise<DeliveryQuoteResult> {
  if (!isDeliveryType(deliveryType)) return { ok: false, reason: "error" };

  // Server Actions are reachable by direct POST, so don't act as an open
  // geocoding proxy for anyone who isn't signed in.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, reason: "signed_out" };

  const quote = await quoteDeliveryForPostalCode(supabase, String(kitchenId ?? ""), String(postalCode ?? ""), deliveryType);
  if (!quote.ok) return quote;
  return { ok: true, address: quote.address, distanceKm: quote.distanceKm, fee: quote.fee };
}
