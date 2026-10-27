import { describe, it, expect } from "vitest";
import { checkoutAttemptKey, describeOptions, lineKey, readSavedCart, toLineInput, unitPrice } from "@/lib/cart-lines";
import { blockingGroup, groupRuleLabel, groupsByMenuItem, missingRequired, pickedOptions, togglePick, type MenuOptionGroup } from "@/lib/menu-options";
import { addOnErrorMessage, parseOrderPricing } from "@/lib/order-pricing";

const HOT = "00000000-0000-4000-8000-000000000103";
const MILD = "00000000-0000-4000-8000-000000000104";
const EGG = "00000000-0000-4000-8000-000000000105";
const TOFU = "00000000-0000-4000-8000-000000000106";

const hot = { id: HOT, groupName: "Spice", name: "Hot", price: 0 };
const egg = { id: EGG, groupName: "Extras", name: "Extra egg", price: 0.8 };

describe("lineKey", () => {
  it("is the dish plus its sorted picks, whatever the order or case", () => {
    expect(lineKey({ menuItemId: "m1" })).toBe("m1|");
    expect(lineKey({ menuItemId: "m1", options: [] })).toBe("m1|");
    expect(lineKey({ menuItemId: "m1", options: [egg, hot] })).toBe(lineKey({ menuItemId: "m1", options: [{ ...hot, id: HOT.toUpperCase() }, egg] }));
  });

  it("differs for the same dish with different picks", () => {
    expect(lineKey({ menuItemId: "m1", options: [hot] })).not.toBe(lineKey({ menuItemId: "m1", options: [hot, egg] }));
    expect(lineKey({ menuItemId: "m1", options: [hot] })).not.toBe(lineKey({ menuItemId: "m1" }));
  });
});

describe("unitPrice / describeOptions / toLineInput", () => {
  it("adds the picks to the dish price, per unit", () => {
    expect(unitPrice({ price: 6.5 })).toBe(6.5);
    expect(unitPrice({ price: 6.5, options: [hot, egg, { ...egg, id: TOFU, price: 0.7 }] })).toBe(8);
  });

  it("lists picks, showing a price only when there is one", () => {
    expect(describeOptions([hot, egg])).toBe("Hot · Extra egg (+$0.80)");
    expect(describeOptions(undefined)).toBe("");
  });

  it("gives a plain dish exactly the old shape", () => {
    expect(toLineInput({ menuItemId: "m1", name: "Kopi", price: 2, quantity: 3 })).toEqual({ menuItemId: "m1", quantity: 3 });
    expect(toLineInput({ menuItemId: "m1", name: "Laksa", price: 6.5, quantity: 1, options: [hot, egg] })).toEqual({ menuItemId: "m1", quantity: 1, optionIds: [HOT, EGG] });
  });
});

describe("checkoutAttemptKey", () => {
  const delivery = { deliveryType: "normal", postalCode: "310123" };
  it("changes when the picks change, and only then", () => {
    const a = checkoutAttemptKey("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT] }], delivery);
    expect(checkoutAttemptKey("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT] }], delivery)).toBe(a);
    expect(checkoutAttemptKey("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [MILD] }], delivery)).not.toBe(a);
    expect(checkoutAttemptKey("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT, EGG] }], delivery)).not.toBe(a);
    expect(checkoutAttemptKey("k1", [{ menuItemId: "m1", quantity: 1 }], delivery)).not.toBe(a);
  });
});

describe("readSavedCart", () => {
  const OLD = { kitchenId: "k1", kitchenName: "Aunty May", items: [{ menuItemId: "m1", name: "Kopi", price: 2, photoUrl: null, quantity: 3 }, { menuItemId: "m2", name: "Toast", price: 3, quantity: 1 }] };

  it("loads a cart saved before add-ons unchanged", () => {
    expect(readSavedCart(JSON.parse(JSON.stringify(OLD)))).toEqual(OLD);
  });

  it("keeps add-on lines and lower-cases their ids", () => {
    const cart = readSavedCart({ ...OLD, items: [{ menuItemId: "m1", name: "Laksa", price: 6.5, quantity: 1, options: [{ ...hot, id: HOT.toUpperCase() }] }] });
    expect(cart?.items[0].options).toEqual([hot]);
  });

  it("drops lines that make no sense instead of crashing", () => {
    const cart = readSavedCart({
      ...OLD,
      items: [
        OLD.items[0],
        null,
        "x",
        { menuItemId: "", name: "a", price: 1, quantity: 1 },
        { menuItemId: "m3", name: "a", price: 1, quantity: 0 },
        { menuItemId: "m3", name: "a", price: 1, quantity: 1.5 },
        { menuItemId: "m3", name: "a", price: "1", quantity: 1 },
        { menuItemId: "m3", name: "a", price: 1, quantity: 1, options: "hot" },
        { menuItemId: "m3", name: "a", price: 1, quantity: 1, options: [{ id: "hot", groupName: "g", name: "Hot", price: 0 }] },
        { menuItemId: "m3", name: "a", price: 1, quantity: 1, options: [hot, hot] },
        { menuItemId: "m3", name: "a", price: 1, quantity: 1, options: [{ ...egg, price: -1 }] },
      ],
    });
    expect(cart?.items).toEqual([OLD.items[0]]);
  });

  it("is null for nothing usable", () => {
    for (const raw of [null, 1, "cart", [], {}, { kitchenId: "k1", kitchenName: "A" }, { kitchenId: "k1", kitchenName: "A", items: {} }, { ...OLD, items: [] }, { ...OLD, items: [null] }]) {
      expect(readSavedCart(raw)).toBeNull();
    }
  });

  it("merges lines that turn out to be the same", () => {
    const line = { menuItemId: "m1", name: "Laksa", price: 6.5, quantity: 1, options: [hot] };
    const cart = readSavedCart({ ...OLD, items: [line, { ...line, quantity: 2, options: [{ ...hot, id: HOT.toUpperCase() }] }, { ...line, options: [] }] });
    expect(cart?.items.map((i) => [lineKey(i), i.quantity])).toEqual([
      [`m1|${HOT}`, 3],
      ["m1|", 1],
    ]);
  });
});

const SPICE: MenuOptionGroup = {
  id: "g1",
  name: "Spice level",
  required: true,
  maxPicks: 1,
  options: [
    { id: HOT, name: "Hot", price: 0, soldOut: false },
    { id: MILD, name: "Mild", price: 0, soldOut: true },
  ],
};
const EXTRAS: MenuOptionGroup = {
  id: "g2",
  name: "Extras",
  required: false,
  maxPicks: 2,
  options: [
    { id: EGG, name: "Extra egg", price: 0.8, soldOut: false },
    { id: TOFU, name: "Tofu", price: 0.7, soldOut: false },
    { id: "00000000-0000-4000-8000-000000000107", name: "Prawns", price: 2, soldOut: false },
  ],
};

describe("picker rules", () => {
  it("single-pick groups swap the pick; sold out never gets in", () => {
    const spice = { ...SPICE, options: [...SPICE.options, { id: "x", name: "Medium", price: 0, soldOut: false }] };
    expect(togglePick(spice, [], HOT)).toEqual([HOT]);
    expect(togglePick(spice, [HOT, EGG], "x")).toEqual([EGG, "x"]);
    expect(togglePick(spice, [HOT], MILD)).toEqual([HOT]);
  });

  it("multi-pick groups tick and untick, never past max_picks", () => {
    let picked = togglePick(EXTRAS, [HOT], EGG);
    picked = togglePick(EXTRAS, picked, TOFU);
    expect(picked).toEqual([HOT, EGG, TOFU]);
    expect(togglePick(EXTRAS, picked, "00000000-0000-4000-8000-000000000107")).toEqual(picked);
    expect(togglePick(EXTRAS, picked, EGG)).toEqual([HOT, TOFU]);
  });

  it("None clears an optional group only", () => {
    expect(togglePick(EXTRAS, [HOT, EGG, TOFU], null)).toEqual([HOT]);
  });

  it("required groups need a pick; a required group with nothing available blocks the dish", () => {
    expect(missingRequired([SPICE, EXTRAS], [EGG]).map((g) => g.name)).toEqual(["Spice level"]);
    expect(missingRequired([SPICE, EXTRAS], [HOT])).toEqual([]);
    expect(blockingGroup([SPICE, EXTRAS])).toBeNull();
    const allSoldOut = { ...SPICE, options: SPICE.options.map((o) => ({ ...o, soldOut: true })) };
    expect(blockingGroup([allSoldOut, EXTRAS])?.name).toBe("Spice level");
    expect(blockingGroup([{ ...SPICE, options: [] }])?.name).toBe("Spice level");
    expect(blockingGroup([{ ...EXTRAS, options: EXTRAS.options.map((o) => ({ ...o, soldOut: true })) }])).toBeNull();
  });

  it("puts picks in menu order with their group names", () => {
    expect(pickedOptions([SPICE, EXTRAS], [TOFU, HOT])).toEqual([
      { id: HOT, groupName: "Spice level", name: "Hot", price: 0 },
      { id: TOFU, groupName: "Extras", name: "Tofu", price: 0.7 },
    ]);
  });

  it("labels the rules", () => {
    expect(groupRuleLabel(SPICE)).toBe("Required · Choose 1");
    expect(groupRuleLabel({ ...SPICE, maxPicks: 3 })).toBe("Required · Choose 1–3");
    expect(groupRuleLabel(EXTRAS)).toBe("Optional · Choose up to 2");
  });
});

describe("groupsByMenuItem", () => {
  it("groups by dish in the cook's order and reads prices", () => {
    const map = groupsByMenuItem([
      { id: "g2", menu_item_id: "m1", name: "Extras", required: false, max_picks: 2, sort_order: 2, menu_options: [
        { id: "b", name: "Tofu", price: "0.70", sold_out: false, sort_order: 2 },
        { id: "a", name: "Egg", price: "0.80", sold_out: true, sort_order: 1 },
      ] },
      { id: "g1", menu_item_id: "m1", name: "Spice", required: true, max_picks: 1, sort_order: 1, menu_options: null },
      { id: "g3", menu_item_id: "m2", name: "Size", required: true, max_picks: 1, sort_order: 0, menu_options: [] },
    ]);
    expect(map.get("m1")?.map((g) => g.name)).toEqual(["Spice", "Extras"]);
    expect(map.get("m1")?.[1].options).toEqual([
      { id: "a", name: "Egg", price: 0.8, soldOut: true },
      { id: "b", name: "Tofu", price: 0.7, soldOut: false },
    ]);
    expect(map.get("m2")?.[0].required).toBe(true);
    expect(groupsByMenuItem(null).size).toBe(0);
  });
});

describe("order-pricing add-on helpers", () => {
  it("flags a min_spend deal only", () => {
    const base = { subtotal: 20, discount_total: 2, food_total: 18, promotion_label: "$2 off" };
    expect(parseOrderPricing({ ...base, promotion_kind: "min_spend" })?.minSpendDeal).toBe(true);
    expect(parseOrderPricing({ ...base, promotion_kind: "percent_off" })).toEqual({ subtotal: 20, discountTotal: 2, foodTotal: 18, promotionLabel: "$2 off" });
  });

  it("words add-on errors and ignores everything else", () => {
    expect(addOnErrorMessage("option_sold_out")).toBe("One of the add-ons you picked has just sold out. Please check your choices.");
    expect(addOnErrorMessage("option_required_missing")).toBe("Please make a choice for every required option.");
    expect(addOnErrorMessage("kitchen_unavailable")).toBeNull();
    expect(addOnErrorMessage(undefined)).toBeNull();
  });
});
