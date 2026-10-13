/**
 * Delivery quote types + customer-facing messages, shared by the checkout UI
 * and the server actions. No fee math here — the quote_delivery RPC in the
 * database is the single source of truth for distance and fee.
 */

export type DeliveryType = "normal" | "express";

export const DELIVERY_TYPES: DeliveryType[] = ["normal", "express"];

export const DELIVERY_TYPE_LABEL: Record<DeliveryType, string> = {
  normal: "Normal",
  express: "Express",
};

export type DeliveryQuoteFailure =
  | "signed_out"
  | "invalid"
  | "not_found"
  | "unavailable"
  | "invalid_location"
  | "kitchen_location_missing"
  | "error";

export type DeliveryQuote =
  | { ok: true; address: string; lat: number; lng: number; distanceKm: number; fee: number }
  | { ok: false; reason: DeliveryQuoteFailure };

export function isDeliveryType(value: unknown): value is DeliveryType {
  return value === "normal" || value === "express";
}

export function deliveryQuoteMessage(reason: DeliveryQuoteFailure): string {
  switch (reason) {
    case "signed_out":
      return "Sign in to check your delivery fee.";
    case "invalid":
      return "Enter a 6-digit postal code.";
    case "not_found":
      return "We couldn't find that postal code. Please check it.";
    case "unavailable":
      return "Postal code lookup is temporarily unavailable. Please try again in a minute.";
    case "invalid_location":
      return "We couldn't work out a delivery distance for that postal code. Please check it.";
    case "kitchen_location_missing":
      return "This kitchen hasn't finished setting up its location yet.";
    case "error":
      return "Couldn't work out the delivery fee. Please try again.";
  }
}
