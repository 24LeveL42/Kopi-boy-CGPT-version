import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAddress, deleteAddress, lookupPostalCode, setDefaultAddress, updateAddress } from "@/lib/address-actions";
import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";
import { createFakeDb, type DbOp, type DbResult } from "./helpers/fake-db-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

const FOUND = { ok: true as const, lat: 1.337, lng: 103.845, address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123" };
const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const INPUT = { label: "Home", postalCode: "310123", unit: "#05-12", notes: "Call when you arrive" };

function useDb(respond?: (op: DbOp) => DbResult, opts?: { userId?: string | null }) {
  const db = createFakeDb(respond, opts);
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  return db;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(geocodePostalCode).mockReset().mockResolvedValue(FOUND);
});

describe("createAddress", () => {
  it("saves the geocoded address and coordinates, ignoring any the browser sends", async () => {
    const db = useDb((op) => (op.head ? { count: 2 } : {}));
    const tampered = { ...INPUT, lat: 1.2, lng: 103.6, address_line: "Fake street", is_default: true, user_id: "someone-else" };

    await expect(createAddress(tampered as never)).resolves.toEqual({ ok: true });

    expect(geocodePostalCode).toHaveBeenCalledWith("310123");
    const insert = db.ops.find((o) => o.kind === "insert");
    expect(insert?.table).toBe("customer_addresses");
    expect(insert?.values).toEqual({
      user_id: "customer-1",
      label: "Home",
      postal_code: "310123",
      address_line: FOUND.address,
      unit: "#05-12",
      notes: "Call when you arrive",
      lat: FOUND.lat,
      lng: FOUND.lng,
      is_default: false,
    });
  });

  it("makes the first address the default", async () => {
    const db = useDb((op) => (op.head ? { count: 0 } : {}));
    await createAddress(INPUT);
    expect(db.ops.find((o) => o.kind === "insert")?.values).toMatchObject({ is_default: true });
  });

  it("refuses a 6th address with the friendly limit message, before geocoding", async () => {
    const db = useDb((op) => (op.head ? { count: 5 } : {}));
    await expect(createAddress(INPUT)).resolves.toEqual({
      ok: false,
      message: "You can save up to 5 addresses. Delete one to add another.",
    });
    expect(geocodePostalCode).not.toHaveBeenCalled();
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("turns the database's limit error into the same message (two tabs racing)", async () => {
    useDb((op) => (op.head ? { count: 4 } : op.kind === "insert" ? { error: { code: "P0001", message: "address_limit_reached" } } : {}));
    await expect(createAddress(INPUT)).resolves.toEqual({
      ok: false,
      message: "You can save up to 5 addresses. Delete one to add another.",
    });
  });

  it("validates before touching the database", async () => {
    const db = useDb();
    await expect(createAddress({ ...INPUT, postalCode: "12" })).resolves.toEqual({ ok: false, message: "Enter a 6-digit postal code." });
    expect(db.ops).toEqual([]);
  });

  it("says when the postal code can't be found", async () => {
    vi.mocked(geocodePostalCode).mockResolvedValue({ ok: false, reason: "not_found" });
    useDb((op) => (op.head ? { count: 0 } : {}));
    await expect(createAddress(INPUT)).resolves.toEqual({ ok: false, message: "We couldn't find that postal code. Please check it." });
  });

  it("needs a signed-in customer", async () => {
    useDb(undefined, { userId: null });
    await expect(createAddress(INPUT)).resolves.toMatchObject({ ok: false, message: "Please sign in to save an address." });
  });
});

describe("updateAddress", () => {
  it("re-geocodes and only updates the signed-in customer's row", async () => {
    const db = useDb(() => ({ data: { id: ID } }));
    await expect(updateAddress(ID, { ...INPUT, lat: 9, lng: 9 } as never)).resolves.toEqual({ ok: true });

    const update = db.ops.find((o) => o.kind === "update");
    expect(update?.filters).toEqual({ id: ID, user_id: "customer-1" });
    expect(update?.values).toMatchObject({ address_line: FOUND.address, lat: FOUND.lat, lng: FOUND.lng });
    expect(update?.values).not.toHaveProperty("user_id");
  });

  it("says not found when the row isn't theirs", async () => {
    useDb(() => ({ data: null }));
    await expect(updateAddress(ID, INPUT)).resolves.toEqual({ ok: false, message: "That address couldn't be found." });
  });
});

describe("setDefaultAddress", () => {
  it("sets the flag with one scoped update (the database clears the old default)", async () => {
    const db = useDb(() => ({ data: { id: ID } }));
    await expect(setDefaultAddress(ID)).resolves.toEqual({ ok: true });
    expect(db.ops).toEqual([
      expect.objectContaining({ table: "customer_addresses", kind: "update", values: { is_default: true }, filters: { id: ID, user_id: "customer-1" } }),
    ]);
  });

  it("refuses someone else's address id", async () => {
    useDb(() => ({ data: null }));
    await expect(setDefaultAddress(ID)).resolves.toEqual({ ok: false, message: "That address couldn't be found." });
  });

  it("rejects a malformed id without a query", async () => {
    const db = useDb();
    await expect(setDefaultAddress("not-an-id")).resolves.toMatchObject({ ok: false });
    expect(db.ops).toEqual([]);
  });
});

describe("deleteAddress", () => {
  it("deletes only the customer's own row", async () => {
    const db = useDb(() => ({ data: { id: ID } }));
    await expect(deleteAddress(ID)).resolves.toEqual({ ok: true });
    expect(db.ops[0]).toMatchObject({ kind: "delete", filters: { id: ID, user_id: "customer-1" } });
  });

  it("returns a clean result when nothing matched", async () => {
    useDb(() => ({ data: null }));
    await expect(deleteAddress(ID)).resolves.toEqual({ ok: false, message: "That address couldn't be found." });
  });
});

describe("lookupPostalCode", () => {
  it("returns only the address, never coordinates", async () => {
    useDb();
    const result = await lookupPostalCode("310123");
    expect(result).toEqual({ ok: true, address: FOUND.address });
  });

  it("doesn't geocode for signed-out callers", async () => {
    useDb(undefined, { userId: null });
    await expect(lookupPostalCode("310123")).resolves.toEqual({ ok: false, reason: "signed_out" });
    expect(geocodePostalCode).not.toHaveBeenCalled();
  });
});
