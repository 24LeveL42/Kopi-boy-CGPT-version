"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { UNAVAILABLE_LABEL } from "@/lib/kitchen-availability";
import { blockingGroup, groupRuleLabel, missingRequired, pickedOptions, togglePick, type MenuOptionGroup } from "@/lib/menu-options";
import type { CartItemOption } from "@/lib/types-order";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

/**
 * The add-on picker: a bottom sheet (a centred card from sm up) listing a
 * dish's groups. Radios when a group allows 1 pick, checkboxes otherwise;
 * sold-out options can't be picked. Add to cart stays disabled until every
 * required group has a pick. Prices are display only — the server prices
 * the order. Escape or the backdrop closes it; Tab stays inside; focus goes
 * back to whatever opened it.
 */
export function AddOnSheet({
  item,
  groups,
  unavailable = false,
  onAdd,
  onClose,
}: {
  item: { name: string; price: number };
  groups: MenuOptionGroup[];
  unavailable?: boolean;
  onAdd: (options: CartItemOption[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const blocked = blockingGroup(groups);
  const missing = missingRequired(groups, picked);
  const options = pickedOptions(groups, picked);
  const price = Math.round((item.price + options.reduce((s, o) => s + o.price, 0)) * 100) / 100;
  const canAdd = !unavailable && !blocked && missing.length === 0;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (sheet.current?.querySelector<HTMLElement>("input:not([disabled])") ?? sheet.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !sheet.current) return;
    const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-5" onClick={onClose}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="addon-sheet"
        className="kb-detail-sheet flex max-h-[88vh] flex-col sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-black tracking-tight">{item.name}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">${item.price.toFixed(2)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-2xl">×</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {groups.map((group) => {
            const single = group.maxPicks === 1;
            const mine = group.options.filter((o) => picked.includes(o.id));
            const full = !single && mine.length >= group.maxPicks;
            const ruleId = `${titleId}-${group.id}-rule`;
            return (
              <fieldset key={group.id} aria-describedby={ruleId} data-testid="addon-group">
                <legend className="flex w-full items-center justify-between gap-2">
                  <span className="text-[15px] font-extrabold text-slate-900">{group.name}</span>
                  <span id={ruleId} className={group.required ? "kb-mini-pill" : "kb-mini-pill !bg-slate-100 !text-slate-600"}>{groupRuleLabel(group)}</span>
                </legend>
                {blocked?.id === group.id && (
                  <p className="mt-2 rounded-2xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">{group.name} is sold out, so this dish can&apos;t be ordered right now.</p>
                )}
                <div className="mt-2 space-y-2">
                  {single && !group.required && (
                    <OptionRow type="radio" name={group.id} label="None" checked={mine.length === 0} onChange={() => setPicked((p) => togglePick(group, p, null))} />
                  )}
                  {group.options.map((option) => {
                    const checked = picked.includes(option.id);
                    return (
                      <OptionRow
                        key={option.id}
                        type={single ? "radio" : "checkbox"}
                        name={group.id}
                        label={option.name}
                        price={option.price}
                        soldOut={option.soldOut}
                        checked={checked}
                        disabled={option.soldOut || (full && !checked)}
                        onChange={() => setPicked((p) => togglePick(group, p, option.id))}
                      />
                    );
                  })}
                </div>
                <p aria-live="polite" className="mt-1 min-h-4 text-xs font-semibold text-slate-500">
                  {full ? `You can pick up to ${group.maxPicks}.` : ""}
                </p>
              </fieldset>
            );
          })}
        </div>

        <div className="border-t border-slate-100 p-5">
          <p aria-live="polite" data-testid="addon-missing" className="mb-2 min-h-5 text-center text-sm font-semibold text-slate-600">
            {blocked ? "This dish can't be ordered right now." : missing.length > 0 ? `Choose ${missing.map((g) => g.name).join(", ")} to continue.` : ""}
          </p>
          <button type="button" disabled={!canAdd} onClick={() => onAdd(options)} className="kb-primary-button w-full disabled:cursor-not-allowed disabled:opacity-50">
            {unavailable ? UNAVAILABLE_LABEL : blocked ? "Not available right now" : <>Add to cart <span>· ${price.toFixed(2)}</span></>}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-400">The final price is confirmed at checkout.</p>
        </div>
      </div>
    </div>
  );
}

function OptionRow({
  type,
  name,
  label,
  price = 0,
  soldOut = false,
  checked,
  disabled = false,
  onChange,
}: {
  type: "radio" | "checkbox";
  name: string;
  label: string;
  price?: number;
  soldOut?: boolean;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2 text-sm ${checked ? "border-purple-500 bg-purple-50" : "border-slate-200 bg-white"} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={soldOut ? `${id}-sold-out` : undefined}
        className="h-5 w-5 shrink-0 accent-purple-600"
      />
      <span className={`min-w-0 flex-1 font-semibold ${soldOut ? "text-slate-400 line-through" : "text-slate-800"}`}>{label}</span>
      {soldOut ? (
        <span id={`${id}-sold-out`} className="shrink-0 text-xs font-bold text-slate-500">Sold out</span>
      ) : price > 0 ? (
        <span className="shrink-0 text-xs font-bold text-slate-600">+${price.toFixed(2)}</span>
      ) : null}
    </label>
  );
}
