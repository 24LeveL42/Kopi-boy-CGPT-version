import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CartProvider } from "@/lib/cart-context";
import { lineKey } from "@/lib/cart-lines";
import { MenuItemRow } from "@/components/MenuItemRow";
import MerchantPage from "@/app/merchant/[id]/page";
import type { MenuOptionGroup, MenuOptionGroupRow } from "@/lib/menu-options";

/** The Customer add-on picker (stage A2): MenuItemRow + AddOnSheet, and the menu page's groups query. */

const db = vi.hoisted(() => ({
  optionGroups: { data: [] as unknown, error: null as unknown },
  queries: [] as { table: string; select: string; filters: [string, unknown][] }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const query = { table, select: "", filters: [] as [string, unknown][] };
      db.queries.push(query);
      const builder: Record<string, unknown> = {};
      builder.select = (cols: string) => ((query.select = cols), builder);
      builder.eq = (col: string, val: unknown) => (query.filters.push([col, val]), builder);
      builder.order = () => builder;
      builder.maybeSingle = async () => ({
        data: table === "kitchens" ? { id: "k1", business_name: "Aunty May", category: "hawker", cuisine_type: "chinese", description: null, hero_image: null } : null,
        error: null,
      });
      builder.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: "m1", name: "Laksa", price: 6.5, photo_url: null }, { id: "m2", name: "Kopi", price: 2, photo_url: null }], error: null });
      builder.returns = async () => db.optionGroups;
      return builder;
    },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), notFound: () => { throw new Error("notFound"); } }));

const HOT = "00000000-0000-4000-8000-000000000103";
const MILD = "00000000-0000-4000-8000-000000000104";
const EGG = "00000000-0000-4000-8000-000000000105";
const TOFU = "00000000-0000-4000-8000-000000000106";
const PRAWN = "00000000-0000-4000-8000-000000000107";

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
    { id: PRAWN, name: "Prawns", price: 2, soldOut: false },
  ],
};
const LAKSA = { id: "m1", name: "Laksa", price: 6.5, photo_url: null };

const savedCart = () => JSON.parse(localStorage.getItem("kb-cart") ?? "null");

function renderRow(groups: MenuOptionGroup[] = [SPICE, EXTRAS], props: { unavailable?: boolean } = {}) {
  return render(
    <CartProvider>
      <MenuItemRow kitchenId="k1" kitchenName="Aunty May" item={LAKSA} groups={groups} {...props} />
    </CartProvider>
  );
}

const openSheet = () => {
  fireEvent.click(screen.getByRole("button", { name: "Add Laksa to cart" }));
  return screen.getByRole("dialog", { name: "Laksa" });
};
const addButton = (sheet: HTMLElement) => within(sheet).getByRole("button", { name: /Add to cart|Not available/ });

beforeEach(() => {
  localStorage.clear();
  db.optionGroups = { data: [], error: null };
  db.queries = [];
});
afterEach(cleanup);

describe("A dish without add-ons", () => {
  it("still adds in one tap, with no picker", () => {
    renderRow([]);
    fireEvent.click(screen.getByRole("button", { name: "Add Laksa to cart" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(savedCart().items).toEqual([{ menuItemId: "m1", name: "Laksa", price: 6.5, photoUrl: null, quantity: 1 }]);
    fireEvent.click(screen.getByRole("button", { name: "Increase Laksa quantity" }));
    expect(savedCart().items[0].quantity).toBe(2);
  });
});

describe("The add-on sheet", () => {
  it("shows each group's rule, radios for 1 pick and checkboxes otherwise", () => {
    renderRow();
    const sheet = openSheet();
    const [spice, extras] = within(sheet).getAllByRole("group");
    expect(spice).toHaveAccessibleName(/Spice level/);
    expect(spice).toHaveAccessibleDescription("Required · Choose 1");
    expect(within(spice).getAllByRole("radio")).toHaveLength(2);
    expect(extras).toHaveAccessibleDescription("Optional · Choose up to 2");
    expect(within(extras).getAllByRole("checkbox")).toHaveLength(3);
  });

  it("greys out sold-out options so they can't be picked", () => {
    renderRow();
    const sheet = openSheet();
    const mild = within(sheet).getByRole("radio", { name: /Mild/ });
    expect(mild).toBeDisabled();
    expect(mild).toHaveAccessibleDescription("Sold out");
    fireEvent.click(mild);
    expect(mild).not.toBeChecked();
  });

  it("keeps Add to cart disabled until every required group has a pick, then shows the live price", () => {
    renderRow();
    const sheet = openSheet();
    expect(addButton(sheet)).toBeDisabled();
    expect(within(sheet).getByTestId("addon-missing")).toHaveTextContent("Choose Spice level to continue.");
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Extra egg/ }));
    expect(addButton(sheet)).toBeDisabled();
    expect(addButton(sheet)).toHaveTextContent("$7.30");
    fireEvent.click(within(sheet).getByRole("radio", { name: /Hot/ }));
    expect(addButton(sheet)).toBeEnabled();
    expect(within(sheet).getByTestId("addon-missing")).toHaveTextContent("");
  });

  it("stops at max_picks: the other boxes are disabled until one is unticked", () => {
    renderRow();
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Extra egg/ }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Tofu/ }));
    expect(within(sheet).getByRole("checkbox", { name: /Prawns/ })).toBeDisabled();
    expect(within(sheet).getByText("You can pick up to 2.")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Tofu/ }));
    expect(within(sheet).getByRole("checkbox", { name: /Prawns/ })).toBeEnabled();
  });

  it("an optional single-pick group can be cleared with None", () => {
    const size: MenuOptionGroup = { id: "g3", name: "Size", required: false, maxPicks: 1, options: [{ id: PRAWN, name: "Large", price: 1, soldOut: false }] };
    renderRow([size]);
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: /Large/ }));
    expect(addButton(sheet)).toHaveTextContent("$7.50");
    fireEvent.click(within(sheet).getByRole("radio", { name: "None" }));
    expect(addButton(sheet)).toHaveTextContent("$6.50");
  });

  it("adds the dish with its picks as one line, and closes", () => {
    renderRow();
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: /Hot/ }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Extra egg/ }));
    fireEvent.click(addButton(sheet));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(savedCart().items).toEqual([
      {
        menuItemId: "m1",
        name: "Laksa",
        price: 6.5,
        photoUrl: null,
        quantity: 1,
        options: [
          { id: HOT, groupName: "Spice level", name: "Hot", price: 0 },
          { id: EGG, groupName: "Extras", name: "Extra egg", price: 0.8 },
        ],
      },
    ]);
    expect(screen.getByTestId("menu-row-note")).toHaveTextContent("1 in cart");
  });

  it("same dish, same picks: the line's quantity goes up; different picks: a separate line", () => {
    renderRow();
    const addWith = (...names: RegExp[]) => {
      const sheet = openSheet();
      for (const name of names) fireEvent.click(within(sheet).getByRole(/Hot/.test(String(name)) ? "radio" : "checkbox", { name }));
      fireEvent.click(addButton(sheet));
    };
    addWith(/Hot/, /Extra egg/);
    addWith(/Hot/, /Extra egg/);
    addWith(/Hot/);
    const items = savedCart().items;
    expect(items.map((i: { quantity: number }) => i.quantity)).toEqual([2, 1]);
    expect(lineKey(items[0])).toBe(`m1|${[HOT, EGG].sort().join(",")}`);
    expect(lineKey(items[1])).toBe(`m1|${HOT}`);
    expect(screen.getByTestId("menu-row-note")).toHaveTextContent("3 in cart");
  });

  it("closes on Escape and gives focus back to the + button", () => {
    renderRow();
    const plus = screen.getByRole("button", { name: "Add Laksa to cart" });
    plus.focus();
    const sheet = openSheet();
    expect(within(sheet).getByRole("radio", { name: /Hot/ })).toHaveFocus();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(plus).toHaveFocus();
  });

  it("keeps Tab inside the sheet", () => {
    renderRow();
    const sheet = openSheet();
    const close = within(sheet).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(sheet, { key: "Tab", shiftKey: true });
    // Add to cart is disabled, so the last focusable control is the last enabled checkbox.
    expect(within(sheet).getByRole("checkbox", { name: /Prawns/ })).toHaveFocus();
    fireEvent.keyDown(sheet, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("a blocked kitchen can't add from the sheet either", () => {
    renderRow([EXTRAS], { unavailable: true });
    expect(screen.getByRole("button", { name: "Add Laksa to cart" })).toBeDisabled();
  });
});

describe("A required group with nothing left", () => {
  const SOLD_OUT = { ...SPICE, options: SPICE.options.map((o) => ({ ...o, soldOut: true })) };

  it("can't be ordered, and says so on the row and in the details", () => {
    renderRow([SOLD_OUT, EXTRAS]);
    expect(screen.getByRole("button", { name: "Add Laksa to cart" })).toBeDisabled();
    expect(screen.getByTestId("menu-row-note")).toHaveTextContent("Not available right now");
    fireEvent.click(screen.getByRole("heading", { name: "Laksa" }).closest("button")!);
    const details = screen.getByRole("dialog", { name: "Laksa" });
    expect(details).toHaveTextContent("Spice level is sold out, so this dish can't be ordered right now.");
    expect(within(details).getByRole("button", { name: "Not available right now" })).toBeDisabled();
    expect(savedCart()).toBeNull();
  });
});

describe("Merchant page", () => {
  const ROWS: MenuOptionGroupRow[] = [
    {
      id: "g1",
      menu_item_id: "m1",
      name: "Spice level",
      required: true,
      max_picks: 1,
      sort_order: 0,
      menu_options: [{ id: HOT, name: "Hot", price: "0.00", sold_out: false, sort_order: 0 }],
    },
  ];

  async function renderPage() {
    const page = await MerchantPage({ params: Promise.resolve({ id: "k1" }) });
    return render(<CartProvider>{page}</CartProvider>);
  }

  it("loads the kitchen's groups in one query and gives each dish its own", async () => {
    db.optionGroups = { data: ROWS, error: null };
    await renderPage();
    const groupsQuery = db.queries.find((q) => q.table === "menu_option_groups");
    expect(groupsQuery?.filters).toEqual([["menu_items.kitchen_id", "k1"]]);
    expect(groupsQuery?.select).toContain("menu_options(");
    fireEvent.click(screen.getByRole("button", { name: "Add Laksa to cart" }));
    expect(screen.getByRole("dialog", { name: "Laksa" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Laksa" }), { key: "Escape" });
    // Kopi has no groups: one tap adds it.
    fireEvent.click(screen.getByRole("button", { name: "Add Kopi to cart" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(savedCart().items).toHaveLength(1);
  });

  it("still shows the menu, with plain dishes, if the groups query fails", async () => {
    db.optionGroups = { data: null, error: { code: "42P01", message: "relation does not exist" } };
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Laksa to cart" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(savedCart().items[0]).toMatchObject({ menuItemId: "m1", quantity: 1 });
  });
});
