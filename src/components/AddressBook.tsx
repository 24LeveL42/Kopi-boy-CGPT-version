"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAddress, deleteAddress, lookupPostalCode, setDefaultAddress, updateAddress } from "@/lib/address-actions";
import {
  MAX_ADDRESSES,
  MAX_LABEL_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_UNIT_LENGTH,
  POSTAL_CODE_HINT,
  PRESET_LABELS,
  canAddAddress,
  type SavedAddress,
} from "@/lib/addresses";
import { deliveryQuoteMessage } from "@/lib/delivery-types";
import { Spinner } from "@/components/Spinner";

const INPUT_CLASS = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm";

/**
 * My Addresses: the customer's saved delivery addresses (up to 5). Every
 * change goes through a Server Action (src/lib/address-actions.ts), then
 * router.refresh() re-reads the list on the server — same pattern as
 * CancelOrderButton / RateOrder.
 */
export function AddressBook({ addresses, loadFailed = false }: { addresses: SavedAddress[]; loadFailed?: boolean }) {
  const router = useRouter();
  // null = no form open; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canAdd = canAddAddress(addresses.length);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.message);
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError("Something went wrong — please try again.");
      }
    });
  }

  const editingAddress = editing && editing !== "new" ? addresses.find((a) => a.id === editing) ?? null : null;

  return (
    <>
      <div className="kb-page-title">
        <div>
          <p className="kb-eyebrow">DELIVERY</p>
          <h1>My Addresses</h1>
          <p>Save the places you order to, for a faster checkout.</p>
        </div>
      </div>

      {loadFailed && (
        <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">
          Couldn&apos;t load your saved addresses. Please try again.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      {editing ? (
        <AddressForm
          key={editing}
          address={editingAddress}
          pending={pending}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSave={(input) =>
            run(
              () => (editingAddress ? updateAddress(editingAddress.id, input) : createAddress(input)),
              () => setEditing(null)
            )
          }
        />
      ) : addresses.length === 0 && !loadFailed ? (
        <div className="kb-empty-state mt-5">
          <div className="kb-empty-illustration">⌖</div>
          <p className="mt-4 text-lg font-black">No saved addresses yet</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">Add your home or office once, then pick it at checkout in one tap.</p>
          <button type="button" onClick={() => setEditing("new")} className="kb-primary-button mt-5 w-full">
            + Add an address
          </button>
        </div>
      ) : (
        <>
          <ul className="mt-5 space-y-3" aria-label="Saved addresses">
            {addresses.map((a) => (
              <li key={a.id} data-testid="address-card" className="kb-cart-card">
                <div className="flex items-center gap-2">
                  <span className="kb-mini-pill">{a.label}</span>
                  {a.is_default && <span className="kb-success-pill">Default</span>}
                </div>
                <p className="mt-2 text-sm font-extrabold text-slate-900">{a.address_line}</p>
                {a.unit && <p className="mt-0.5 text-sm text-slate-600">{a.unit}</p>}
                {a.notes && <p className="mt-1 text-xs text-slate-500">“{a.notes}”</p>}

                {confirmDelete === a.id ? (
                  <div className="mt-3 flex items-center gap-2 rounded-2xl bg-red-50 p-3">
                    <p className="flex-1 text-xs font-bold text-red-600">Delete this address?</p>
                    <button type="button" onClick={() => setConfirmDelete(null)} disabled={pending} className="kb-outline-button">
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => run(() => deleteAddress(a.id), () => setConfirmDelete(null))}
                      disabled={pending}
                      className="kb-outline-button"
                      style={{ borderColor: "var(--kb-danger)", color: "var(--kb-danger)" }}
                    >
                      {pending && <Spinner />}Yes, delete
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button type="button" onClick={() => setEditing(a.id)} disabled={pending} className="kb-outline-button">
                      Edit
                    </button>
                    {!a.is_default && (
                      <button type="button" onClick={() => run(() => setDefaultAddress(a.id))} disabled={pending} className="kb-outline-button">
                        Set as default
                      </button>
                    )}
                    <button type="button" onClick={() => setConfirmDelete(a.id)} disabled={pending} className="kb-outline-button ml-auto" style={{ color: "var(--kb-danger)" }}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canAdd ? (
            <button type="button" onClick={() => setEditing("new")} disabled={pending} className="kb-primary-button mt-5 w-full">
              + Add a new address
            </button>
          ) : (
            <p data-testid="address-limit" className="mt-5 rounded-2xl bg-[#faf8ff] p-3 text-center text-sm font-semibold text-slate-600">
              You can save up to {MAX_ADDRESSES} addresses. Delete one to add another.
            </p>
          )}
        </>
      )}
    </>
  );
}

function AddressForm({
  address,
  pending,
  onSave,
  onCancel,
}: {
  address: SavedAddress | null;
  pending: boolean;
  onSave: (input: { label: string; postalCode: string; unit: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(address?.label ?? "Home");
  const [postalCode, setPostalCode] = useState(address?.postal_code ?? "");
  const [unit, setUnit] = useState(address?.unit ?? "");
  const [notes, setNotes] = useState(address?.notes ?? "");
  const [postalStatus, setPostalStatus] = useState<{ found: boolean; text: string } | null>(
    address ? { found: true, text: `Found: ${address.address_line}` } : null
  );
  const [checking, startChecking] = useTransition();

  function handleCheck() {
    if (!/^\d{6}$/.test(postalCode)) {
      setPostalStatus({ found: false, text: deliveryQuoteMessage("invalid") });
      return;
    }
    setPostalStatus(null);
    startChecking(async () => {
      try {
        const result = await lookupPostalCode(postalCode);
        setPostalStatus(result.ok ? { found: true, text: `Found: ${result.address}` } : { found: false, text: deliveryQuoteMessage(result.reason) });
      } catch {
        setPostalStatus({ found: false, text: deliveryQuoteMessage("error") });
      }
    });
  }

  return (
    <form
      className="kb-cart-card mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ label, postalCode, unit, notes });
      }}
    >
      <p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">{address ? "Edit address" : "New address"}</p>

      <label htmlFor="address-label" className="mt-4 block text-sm font-bold">
        Label
      </label>
      <div className="mt-2 flex gap-2">
        {PRESET_LABELS.map((preset) => {
          const selected = label === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={selected}
              onClick={() => setLabel(preset)}
              className={selected ? "rounded-xl border-2 border-purple-500 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-700" : "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold"}
            >
              {preset}
            </button>
          );
        })}
      </div>
      <input id="address-label" maxLength={MAX_LABEL_LENGTH} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Or type your own, e.g. Mum's place" className={INPUT_CLASS} />

      <label htmlFor="address-postal-code" className="mt-4 block text-sm font-bold">
        Postal code
      </label>
      <div className="flex items-center gap-2">
        <input
          id="address-postal-code"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder="e.g. 310123"
          value={postalCode}
          onChange={(e) => {
            setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            setPostalStatus(null);
          }}
          className={INPUT_CLASS}
        />
        <button type="button" onClick={handleCheck} disabled={checking} className="kb-text-button mt-1 shrink-0">
          Check postal code
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">{POSTAL_CODE_HINT}</p>
      {(checking || postalStatus) && (
        <p data-testid="address-postal-status" className={`mt-2 text-xs ${postalStatus?.found && !checking ? "font-semibold text-purple-700" : "text-slate-500"}`}>
          {checking ? "Checking postal code…" : postalStatus?.text}
        </p>
      )}

      <label htmlFor="address-unit" className="mt-4 block text-sm font-bold">
        Unit <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <input id="address-unit" maxLength={MAX_UNIT_LENGTH} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. #05-12" className={INPUT_CLASS} />

      <label htmlFor="address-notes" className="mt-4 block text-sm font-bold">
        Notes for the rider <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <textarea id="address-notes" maxLength={MAX_NOTES_LENGTH} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Call when you arrive" className={INPUT_CLASS} />

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="kb-outline-button flex-1" style={{ minHeight: 52 }}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className="kb-primary-button flex-[2]">
          {pending && <Spinner />}
          {pending ? "Saving…" : "Save address"}
        </button>
      </div>
    </form>
  );
}
