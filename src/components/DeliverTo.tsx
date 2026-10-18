"use client";

import Link from "next/link";
import { MAX_ADDRESSES, MAX_NOTES_LENGTH, MAX_UNIT_LENGTH, NEW_ADDRESS, PRESET_LABELS, type SavedAddress } from "@/lib/addresses";

const INPUT_CLASS = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm";

export interface NewAddressDraft {
  unit: string;
  notes: string;
  save: boolean;
  label: string;
}

/**
 * Checkout's "Deliver to": the customer's saved addresses (default
 * preselected by CartView) plus "Deliver to a different address", which
 * shows the postal code + Check button, unit, notes and "Save this address".
 * With no saved addresses it's just the new-address form. Display/input only
 * — CartView quotes the fee and placeOrder() re-reads everything server-side.
 */
export function DeliverTo({
  addresses,
  selection,
  onSelect,
  postalCode,
  onPostalCodeChange,
  onCheckPostalCode,
  checking,
  postalStatus,
  postalFound,
  draft,
  onDraftChange,
  canSave,
}: {
  addresses: SavedAddress[];
  selection: string;
  onSelect: (id: string) => void;
  postalCode: string;
  onPostalCodeChange: (code: string) => void;
  onCheckPostalCode: () => void;
  checking: boolean;
  postalStatus: string | null;
  postalFound: boolean;
  draft: NewAddressDraft;
  onDraftChange: (draft: NewAddressDraft) => void;
  canSave: boolean;
}) {
  const isNew = selection === NEW_ADDRESS;
  const status = postalStatus && (
    <p data-testid="postal-status" className={`mt-2 text-xs ${postalFound && !checking ? "font-semibold text-purple-700" : "text-slate-500"}`}>
      {postalStatus}
    </p>
  );

  const newAddressForm = (
    <div className="mt-3 rounded-2xl bg-[#faf8ff] p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-100 text-purple-700">⌂</span>
        <div className="min-w-0 flex-1">
          <label htmlFor="delivery-postal-code" className="block text-sm font-bold">
            Delivery postal code
          </label>
          <input
            id="delivery-postal-code"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            placeholder="e.g. 310123"
            value={postalCode}
            onChange={(e) => onPostalCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={INPUT_CLASS}
          />
        </div>
        <button type="button" onClick={onCheckPostalCode} disabled={checking} className="kb-text-button">
          Check postal code
        </button>
      </div>
      {status}
      <label htmlFor="delivery-unit" className="mt-3 block text-sm font-bold">
        Unit <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <input id="delivery-unit" maxLength={MAX_UNIT_LENGTH} placeholder="e.g. #05-12" value={draft.unit} onChange={(e) => onDraftChange({ ...draft, unit: e.target.value })} className={INPUT_CLASS} />
      <label htmlFor="delivery-notes" className="mt-3 block text-sm font-bold">
        Notes for the rider <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <input id="delivery-notes" maxLength={MAX_NOTES_LENGTH} placeholder="e.g. Call when you arrive" value={draft.notes} onChange={(e) => onDraftChange({ ...draft, notes: e.target.value })} className={INPUT_CLASS} />

      {canSave ? (
        <>
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={draft.save} onChange={(e) => onDraftChange({ ...draft, save: e.target.checked })} className="h-4 w-4 accent-purple-600" />
            Save this address
          </label>
          {draft.save && (
            <div className="mt-2 flex gap-2" role="group" aria-label="Save as">
              {PRESET_LABELS.map((preset) => {
                const selected = draft.label === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onDraftChange({ ...draft, label: preset })}
                    className={selected ? "rounded-xl border-2 border-purple-500 bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700" : "rounded-xl border border-slate-200 bg-white px-3 py-1 text-xs font-bold"}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p data-testid="save-address-full" className="mt-3 text-xs text-slate-500">
          You&apos;ve saved {MAX_ADDRESSES} addresses already, so this one won&apos;t be saved. You can manage them in{" "}
          <Link href="/account/addresses" className="font-bold text-purple-700">
            My Addresses
          </Link>
          .
        </p>
      )}
    </div>
  );

  return (
    <section className="kb-cart-card mt-5">
      <p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Deliver to</p>
      {addresses.length === 0 ? (
        newAddressForm
      ) : (
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Deliver to">
          {addresses.map((a) => {
            const selected = selection === a.id;
            return (
              <label key={a.id} className={selected ? "flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-purple-500 bg-purple-50 p-3" : "flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3"}>
                <input type="radio" name="deliver-to" value={a.id} checked={selected} onChange={() => onSelect(a.id)} className="mt-1 accent-purple-600" aria-label={`${a.label}: ${a.address_line}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="kb-mini-pill">{a.label}</span>
                    {a.is_default && <span className="kb-success-pill">Default</span>}
                  </span>
                  <span className="mt-1 block text-sm font-bold text-slate-900">{a.address_line}</span>
                  {a.unit && <span className="block text-xs text-slate-600">{a.unit}</span>}
                  {a.notes && <span className="block text-xs text-slate-500">“{a.notes}”</span>}
                </span>
              </label>
            );
          })}
          <label className={isNew ? "flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-purple-500 bg-purple-50 p-3" : "flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"}>
            <input type="radio" name="deliver-to" value={NEW_ADDRESS} checked={isNew} onChange={() => onSelect(NEW_ADDRESS)} className="accent-purple-600" />
            <span className="text-sm font-bold">Deliver to a different address</span>
          </label>
          {isNew ? newAddressForm : postalStatus && !postalFound && status}
        </div>
      )}
    </section>
  );
}
