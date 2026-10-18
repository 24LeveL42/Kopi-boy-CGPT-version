import { describe, it, expect } from "vitest";
import {
  ADDRESS_LIMIT_MESSAGE,
  NEW_ADDRESS,
  canAddAddress,
  initialDeliverySelection,
  isAddressId,
  sortAddresses,
  validateAddressDetails,
  validateAddressInput,
  type SavedAddress,
} from "@/lib/addresses";

function address(overrides: Partial<SavedAddress> = {}): SavedAddress {
  return {
    id: "a1",
    label: "Home",
    postal_code: "310123",
    address_line: "123 LORONG 1 TOA PAYOH SINGAPORE 310123",
    unit: null,
    notes: null,
    is_default: false,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateAddressInput", () => {
  it("accepts a full address and tidies whitespace", () => {
    expect(validateAddressInput({ label: "  Work ", postalCode: " 310123 ", unit: " #05-12 ", notes: "Call   when you\narrive" })).toEqual({
      ok: true,
      value: { label: "Work", postalCode: "310123", unit: "#05-12", notes: "Call when you arrive" },
    });
  });

  it("turns empty unit and notes into null", () => {
    expect(validateAddressInput({ label: "Home", postalCode: "310123", unit: "  ", notes: "" })).toMatchObject({
      ok: true,
      value: { unit: null, notes: null },
    });
  });

  it("accepts a short custom label up to 20 characters", () => {
    expect(validateAddressInput({ label: "Mum's place", postalCode: "310123" }).ok).toBe(true);
    expect(validateAddressInput({ label: "x".repeat(20), postalCode: "310123" }).ok).toBe(true);
  });

  it.each([
    [{ label: "", postalCode: "310123" }, "Give this address a label, like Home or Work."],
    [{ label: "x".repeat(21), postalCode: "310123" }, "Keep the label to 20 characters."],
    [{ label: "Home", postalCode: "3101" }, "Enter a 6-digit postal code."],
    [{ label: "Home", postalCode: "31012a" }, "Enter a 6-digit postal code."],
    [{ label: "Home", postalCode: "310123", unit: "x".repeat(21) }, "Keep the unit number to 20 characters."],
    [{ label: "Home", postalCode: "310123", notes: "x".repeat(201) }, "Keep delivery notes to 200 characters."],
  ])("rejects %j", (input, message) => {
    expect(validateAddressInput(input)).toEqual({ ok: false, message });
  });

  it("rejects missing input instead of throwing", () => {
    expect(validateAddressInput(null)).toMatchObject({ ok: false });
  });
});

describe("validateAddressDetails", () => {
  it("allows exactly 20 / 200 characters", () => {
    expect(validateAddressDetails("x".repeat(20), "y".repeat(200))).toEqual({ ok: true, unit: "x".repeat(20), notes: "y".repeat(200) });
  });
});

describe("address limit", () => {
  it("allows up to 5 addresses", () => {
    expect(canAddAddress(0)).toBe(true);
    expect(canAddAddress(4)).toBe(true);
    expect(canAddAddress(5)).toBe(false);
  });

  it("explains the limit in plain words", () => {
    expect(ADDRESS_LIMIT_MESSAGE).toBe("You can save up to 5 addresses. Delete one to add another.");
  });
});

describe("default address", () => {
  it("lists the default first, then oldest first", () => {
    const list = sortAddresses([
      address({ id: "b", created_at: "2026-10-02T00:00:00Z" }),
      address({ id: "c", created_at: "2026-10-03T00:00:00Z", is_default: true }),
      address({ id: "a", created_at: "2026-10-01T00:00:00Z" }),
    ]);
    expect(list.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  it("checkout preselects the default address", () => {
    expect(initialDeliverySelection([address({ id: "a" }), address({ id: "b", is_default: true })])).toBe("b");
  });

  it("falls back to the first saved address, then to a new address", () => {
    expect(initialDeliverySelection([address({ id: "a" }), address({ id: "b" })])).toBe("a");
    expect(initialDeliverySelection([])).toBe(NEW_ADDRESS);
  });
});

describe("isAddressId", () => {
  it("only accepts uuids", () => {
    expect(isAddressId("6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b")).toBe(true);
    expect(isAddressId("1 or 1=1")).toBe(false);
    expect(isAddressId(42)).toBe(false);
  });
});
