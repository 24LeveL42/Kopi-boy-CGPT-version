/**
 * A dish's add-on groups as the menu shows them (menu_option_groups /
 * menu_options, docs/supabase-addons.sql), and the picker's rules. Client-safe.
 *
 * The server checks every rule again when it prices the order; these only
 * decide what the picker lets the customer tap.
 */

import type { CartItemOption } from "@/lib/types-order";

export interface MenuOption {
  id: string;
  name: string;
  price: number;
  soldOut: boolean;
}

export interface MenuOptionGroup {
  id: string;
  name: string;
  /** Must pick at least 1. */
  required: boolean;
  /** At most this many picks. 1 = radio buttons. */
  maxPicks: number;
  options: MenuOption[];
}

/** A row of the menu page's menu_option_groups query, with its menu_options embedded. */
export interface MenuOptionGroupRow {
  id: string;
  menu_item_id: string;
  name: string;
  required: boolean;
  max_picks: number;
  sort_order: number | null;
  menu_options: { id: string; name: string; price: number | string; sold_out: boolean; sort_order: number | null }[] | null;
}

const bySortOrder = <T extends { sort_order: number | null; name: string }>(a: T, b: T) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);

/** Groups per dish id, each group and its options in the cook's order. */
export function groupsByMenuItem(rows: readonly MenuOptionGroupRow[] | null | undefined): Map<string, MenuOptionGroup[]> {
  const map = new Map<string, MenuOptionGroup[]>();
  for (const row of [...(rows ?? [])].sort(bySortOrder)) {
    const options = [...(row.menu_options ?? [])].sort(bySortOrder).flatMap((o) => {
      const price = Number(o.price);
      return Number.isFinite(price) && price >= 0 ? [{ id: o.id, name: o.name, price, soldOut: o.sold_out === true }] : [];
    });
    const group: MenuOptionGroup = { id: row.id, name: row.name, required: row.required === true, maxPicks: Math.max(1, row.max_picks || 1), options };
    map.set(row.menu_item_id, [...(map.get(row.menu_item_id) ?? []), group]);
  }
  return map;
}

/** A required group nobody can pick from (every option sold out, or none): the dish can't be ordered. */
export function blockingGroup(groups: readonly MenuOptionGroup[]): MenuOptionGroup | null {
  return groups.find((g) => g.required && !g.options.some((o) => !o.soldOut)) ?? null;
}

/** Required groups that have no pick yet. */
export function missingRequired(groups: readonly MenuOptionGroup[], picked: readonly string[]): MenuOptionGroup[] {
  return groups.filter((g) => g.required && !g.options.some((o) => picked.includes(o.id)));
}

/**
 * The picks after tapping `optionId`. Single-pick groups swap the pick;
 * otherwise a tap ticks or unticks it, and nothing past max_picks gets in.
 * Sold-out options never change anything. `optionId` null clears the group
 * (the "None" choice of an optional single-pick group).
 */
export function togglePick(group: MenuOptionGroup, picked: readonly string[], optionId: string | null): string[] {
  const inGroup = new Set(group.options.map((o) => o.id));
  const others = picked.filter((id) => !inGroup.has(id));
  const mine = picked.filter((id) => inGroup.has(id));
  if (optionId === null) return others;
  const option = group.options.find((o) => o.id === optionId);
  if (!option || option.soldOut) return [...picked];
  if (group.maxPicks === 1) return [...others, optionId];
  if (mine.includes(optionId)) return picked.filter((id) => id !== optionId);
  if (mine.length >= group.maxPicks) return [...picked];
  return [...picked, optionId];
}

/** The picks as cart options, in menu order (group by group). */
export function pickedOptions(groups: readonly MenuOptionGroup[], picked: readonly string[]): CartItemOption[] {
  return groups.flatMap((g) => g.options.filter((o) => picked.includes(o.id)).map((o) => ({ id: o.id, groupName: g.name, name: o.name, price: o.price })));
}

/** "Required · Choose 1", "Required · Choose 1–3", "Optional · Choose up to 3" … */
export function groupRuleLabel(group: MenuOptionGroup): string {
  const choose = !group.required ? `Choose up to ${group.maxPicks}` : group.maxPicks === 1 ? "Choose 1" : `Choose 1–${group.maxPicks}`;
  return `${group.required ? "Required" : "Optional"} · ${choose}`;
}
