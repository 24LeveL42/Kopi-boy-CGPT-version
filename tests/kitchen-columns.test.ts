import { describe, it, expect } from "vitest";
import { formatKitchenArea, selectKitchens } from "@/lib/kitchens";

const missing = (col: string) => ({ data: null, error: { code: "42703", message: `column kitchens.${col} does not exist`, details: "", hint: "", name: "PostgrestError" } });

describe("selectKitchens — customer-readable kitchen columns", () => {
  it("never asks for business_address, neighbourhood or *", async () => {
    const asked: string[] = [];
    await selectKitchens(async (columns) => (asked.push(columns), { data: [], error: null }));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("postal_code");
    expect(asked[0]).not.toMatch(/business_address|neighbourhood|\*/);
  });

  it("drops only the optional column that doesn't exist yet, and retries", async () => {
    const asked: string[] = [];
    const result = await selectKitchens(async (columns) => {
      asked.push(columns);
      return columns.includes("business_uen") ? missing("business_uen") : { data: [{ id: "k-1" }], error: null };
    });
    expect(result.data).toEqual([{ id: "k-1" }]);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain("postal_code");
  });

  it("passes any other error straight through", async () => {
    const denied = { data: null, error: { code: "42501", message: "permission denied for table kitchens", details: "", hint: "", name: "PostgrestError" } };
    let calls = 0;
    const result = await selectKitchens(async () => (calls++, denied));
    expect(result).toBe(denied);
    expect(calls).toBe(1);
  });
});

describe("formatKitchenArea — postal sector only", () => {
  it("shows only the first two digits of a full postal code", () => {
    expect(formatKitchenArea("310123")).toBe("Postal sector 31");
    expect(formatKitchenArea(" 560456 ")).toBe("Postal sector 56");
  });

  it("works when the Partner app already exposes only the sector", () => {
    expect(formatKitchenArea("31")).toBe("Postal sector 31");
  });

  it("is null for a missing or unusable value", () => {
    for (const v of [null, undefined, "", "   ", "3", "abc123"]) expect(formatKitchenArea(v)).toBeNull();
  });
});
