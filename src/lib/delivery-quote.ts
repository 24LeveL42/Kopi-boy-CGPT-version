import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";
import type { DeliveryQuote, DeliveryType } from "@/lib/delivery-types";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

// Errors quote_delivery raises by name.
const RPC_ERRORS = ["kitchen_location_missing", "invalid_location", "invalid_delivery_type"] as const;

/**
 * Geocodes the customer's postal code (OneMap) and asks the database for the
 * distance + fee. The quote_delivery RPC is the only place the fee is
 * calculated: base fee for Normal/Express plus a per-km rate, from distance
 * alone — never items, quantity or subtotal, which this doesn't even take.
 * Used by the checkout's live quote and again by placeOrder(), so the stored
 * fee is always recomputed on the server.
 */
export async function quoteDeliveryForPostalCode(
  supabase: ServerSupabase,
  kitchenId: string,
  postalCode: string,
  deliveryType: DeliveryType
): Promise<DeliveryQuote> {
  const geo = await geocodePostalCode(postalCode);
  if (!geo.ok) return { ok: false, reason: geo.reason };

  const { data, error } = await supabase.rpc("quote_delivery", {
    p_kitchen_id: kitchenId,
    p_lat: geo.lat,
    p_lng: geo.lng,
    p_type: deliveryType,
  });
  if (error) {
    const raised = RPC_ERRORS.find((name) => error.message.includes(name));
    if (raised === "kitchen_location_missing" || raised === "invalid_location") return { ok: false, reason: raised };
    return { ok: false, reason: "error" };
  }

  // A table-returning function comes back as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as { distance_km?: unknown; delivery_fee?: unknown } | null;
  const distanceKm = Number(row?.distance_km);
  const fee = Number(row?.delivery_fee);
  if (row?.distance_km == null || row?.delivery_fee == null || !Number.isFinite(distanceKm) || !Number.isFinite(fee)) {
    return { ok: false, reason: "error" };
  }

  return { ok: true, address: geo.address, lat: geo.lat, lng: geo.lng, distanceKm, fee };
}
