"use server";

import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";
import { deliveryQuoteMessage, type DeliveryQuoteFailure } from "@/lib/delivery-types";
import { ADDRESS_LIMIT_MESSAGE, MAX_ADDRESSES, isAddressId, validateAddressInput, type AddressInput } from "@/lib/addresses";
import { addressErrorMessage } from "@/lib/address-store";

export type AddressActionResult = { ok: true } | { ok: false; message: string };

export type PostalLookupResult = { ok: true; address: string } | { ok: false; reason: DeliveryQuoteFailure };

/**
 * "Check postal code" on the address form: geocodes on the server and returns
 * only the address found. Signed-in only, so it isn't an open geocoding proxy.
 */
export async function lookupPostalCode(postalCode: string): Promise<PostalLookupResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, reason: "signed_out" };

  const geo = await geocodePostalCode(String(postalCode ?? ""));
  if (!geo.ok) return { ok: false, reason: geo.reason };
  return { ok: true, address: geo.address };
}

/*
 * The four actions below take only label / postal code / unit / notes from
 * the browser. address_line, lat and lng always come from geocoding the
 * postal code here — any coordinates a caller adds are ignored because they
 * are never read. Every query is scoped to the signed-in user as well as
 * RLS. They return result objects rather than throwing, for the same reason
 * as cancelOrder() (thrown messages are redacted in production).
 */

async function geocodeForSave(postalCode: string) {
  const geo = await geocodePostalCode(postalCode);
  if (!geo.ok) return { ok: false as const, message: deliveryQuoteMessage(geo.reason) };
  return geo;
}

export async function createAddress(input: AddressInput): Promise<AddressActionResult> {
  const valid = validateAddressInput(input);
  if (!valid.ok) return valid;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to save an address." };

  // Friendly early answer; the database trigger is what actually enforces it.
  const { count, error: countError } = await supabase
    .from("customer_addresses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countError) return { ok: false, message: addressErrorMessage(countError) };
  if ((count ?? 0) >= MAX_ADDRESSES) return { ok: false, message: ADDRESS_LIMIT_MESSAGE };

  const geo = await geocodeForSave(valid.value.postalCode);
  if (!geo.ok) return geo;

  const { error } = await supabase.from("customer_addresses").insert({
    user_id: user.id,
    label: valid.value.label,
    postal_code: valid.value.postalCode,
    address_line: geo.address,
    unit: valid.value.unit,
    notes: valid.value.notes,
    lat: geo.lat,
    lng: geo.lng,
    // The first address saved becomes the default (the trigger does the same).
    is_default: (count ?? 0) === 0,
  });
  if (error) return { ok: false, message: addressErrorMessage(error) };
  return { ok: true };
}

export async function updateAddress(id: string, input: AddressInput): Promise<AddressActionResult> {
  if (!isAddressId(id)) return { ok: false, message: "That address couldn't be found." };
  const valid = validateAddressInput(input);
  if (!valid.ok) return valid;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to edit an address." };

  const geo = await geocodeForSave(valid.value.postalCode);
  if (!geo.ok) return geo;

  const { data, error } = await supabase
    .from("customer_addresses")
    .update({
      label: valid.value.label,
      postal_code: valid.value.postalCode,
      address_line: geo.address,
      unit: valid.value.unit,
      notes: valid.value.notes,
      lat: geo.lat,
      lng: geo.lng,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: addressErrorMessage(error) };
  if (!data) return { ok: false, message: "That address couldn't be found." };
  return { ok: true };
}

export async function deleteAddress(id: string): Promise<AddressActionResult> {
  if (!isAddressId(id)) return { ok: false, message: "That address couldn't be found." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to delete an address." };

  // If this was the default, the database promotes the newest remaining one.
  const { data, error } = await supabase
    .from("customer_addresses")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: "Couldn't delete that address. Please try again." };
  if (!data) return { ok: false, message: "That address couldn't be found." };
  return { ok: true };
}

export async function setDefaultAddress(id: string): Promise<AddressActionResult> {
  if (!isAddressId(id)) return { ok: false, message: "That address couldn't be found." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to change your default address." };

  // One update: the database trigger clears the old default in the same
  // statement, so there's never a moment with two defaults or none.
  const { data, error } = await supabase
    .from("customer_addresses")
    .update({ is_default: true })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: "Couldn't change your default address. Please try again." };
  if (!data) return { ok: false, message: "That address couldn't be found." };
  return { ok: true };
}
