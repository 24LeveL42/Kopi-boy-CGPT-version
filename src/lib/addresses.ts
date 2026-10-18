/**
 * Saved delivery addresses — types, limits and validation shared by the
 * My Addresses page, checkout and the server actions
 * (src/lib/address-actions.ts, placeOrder in src/lib/order-actions.ts).
 * Mirrors public.customer_addresses (docs/supabase-customer-addresses.sql).
 *
 * No coordinates here on purpose: lat/lng are set on the server from the
 * geocoded postal code and never sent to the browser.
 */

export const MAX_ADDRESSES = 5;
export const MAX_LABEL_LENGTH = 20;
export const MAX_UNIT_LENGTH = 20;
export const MAX_NOTES_LENGTH = 200;

export const PRESET_LABELS = ["Home", "Work", "Other"] as const;

export const ADDRESS_LIMIT_MESSAGE = `You can save up to ${MAX_ADDRESSES} addresses. Delete one to add another.`;

/** A saved address as the browser sees it. */
export interface SavedAddress {
  id: string;
  label: string;
  postal_code: string;
  address_line: string;
  unit: string | null;
  notes: string | null;
  is_default: boolean;
  created_at: string;
}

/** The columns the browser is allowed to see (never lat/lng). */
export const SAVED_ADDRESS_COLUMNS = "id, label, postal_code, address_line, unit, notes, is_default, created_at";

export interface AddressInput {
  label: string;
  postalCode: string;
  unit?: string | null;
  notes?: string | null;
}

export interface CleanAddressInput {
  label: string;
  postalCode: string;
  unit: string | null;
  notes: string | null;
}

export type AddressValidation = { ok: true; value: CleanAddressInput } | { ok: false; message: string };

// Control characters (newlines included) have no place in a label or unit.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
// Notes may keep ordinary spaces but not other control characters.
const NOTES_CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

function clean(value: unknown, pattern: RegExp): string {
  return String(value ?? "")
    .replace(pattern, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DetailsValidation = { ok: true; unit: string | null; notes: string | null } | { ok: false; message: string };

/** Unit + notes checks, shared with checkout's "different address", which has no label. */
export function validateAddressDetails(unit: unknown, notes: unknown): DetailsValidation {
  const cleanUnit = clean(unit, CONTROL_CHARS);
  const cleanNotes = clean(notes, NOTES_CONTROL_CHARS);
  if (cleanUnit.length > MAX_UNIT_LENGTH) return { ok: false, message: `Keep the unit number to ${MAX_UNIT_LENGTH} characters.` };
  if (cleanNotes.length > MAX_NOTES_LENGTH) return { ok: false, message: `Keep delivery notes to ${MAX_NOTES_LENGTH} characters.` };
  return { ok: true, unit: cleanUnit || null, notes: cleanNotes || null };
}

export function validateAddressInput(input: AddressInput | null | undefined): AddressValidation {
  const label = clean(input?.label, CONTROL_CHARS);
  if (!label) return { ok: false, message: "Give this address a label, like Home or Work." };
  if (label.length > MAX_LABEL_LENGTH) return { ok: false, message: `Keep the label to ${MAX_LABEL_LENGTH} characters.` };

  // Format only — geocoding on the server is what proves it exists.
  const postalCode = String(input?.postalCode ?? "").trim();
  if (!/^\d{6}$/.test(postalCode)) return { ok: false, message: "Enter a 6-digit postal code." };

  const details = validateAddressDetails(input?.unit, input?.notes);
  if (!details.ok) return details;

  return { ok: true, value: { label, postalCode, unit: details.unit, notes: details.notes } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAddressId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Default first, then oldest first, so the list doesn't jump around as addresses are added. */
export function sortAddresses(addresses: SavedAddress[]): SavedAddress[] {
  return [...addresses].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function canAddAddress(count: number): boolean {
  return count < MAX_ADDRESSES;
}

/** What checkout's "Deliver to" starts on: the default address, else the first saved one, else a new address. */
export const NEW_ADDRESS = "new";

/** Under every postal code field: OneMap doesn't know brand-new buildings yet. */
export const POSTAL_CODE_HINT = "New building? Try a nearby postal code.";
export function initialDeliverySelection(addresses: SavedAddress[]): string {
  return (addresses.find((a) => a.is_default) ?? addresses[0])?.id ?? NEW_ADDRESS;
}

/** One line for a card or the order page: "123 Toa Payoh ... · #05-12". */
export function formatAddressLine(addressLine: string, unit: string | null | undefined): string {
  return unit ? `${addressLine} · ${unit}` : addressLine;
}
