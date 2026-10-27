import { describe, it, expect, vi, beforeEach } from "vitest";
import { hideMyOrder, hideAllMyPastOrders } from "@/lib/order-actions";
import { createClient } from "@/lib/supabase/server";
import { isOrderFinished } from "@/app/orders/[id]/page";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const ORDER_ID = "11111111-2222-4333-8444-555555555555";

const db = {
  user: { id: "customer-1" } as { id: string } | null,
  result: { data: null as unknown, error: null as { code?: string; message: string } | null },
  rpc: vi.fn(),
};

beforeEach(() => {
  db.user = { id: "customer-1" };
  db.result = { data: true, error: null };
  db.rpc = vi.fn(async () => db.result);
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: db.user } })) },
    rpc: db.rpc,
  } as never);
});

describe("hideMyOrder", () => {
  it("calls hide_my_order with the order id on the customer's own session", async () => {
    expect(await hideMyOrder(ORDER_ID)).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("hide_my_order", { p_order_id: ORDER_ID });
  });

  it("refuses a non-UUID id without calling the database", async () => {
    const result = await hideMyOrder("not-an-id");
    expect(result.ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in", async () => {
    db.user = null;
    expect(await hideMyOrder(ORDER_ID)).toEqual({ ok: false, message: "Please sign in to manage your orders." });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("says only finished orders can be removed when the function hides nothing", async () => {
    db.result = { data: false, error: null };
    expect(await hideMyOrder(ORDER_ID)).toEqual({ ok: false, message: "Only finished orders can be removed." });
  });

  it("explains gracefully when the SQL hasn't been run yet (PGRST202)", async () => {
    db.result = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await hideMyOrder(ORDER_ID)).toEqual({
      ok: false,
      message: "Removing orders isn't available yet — please try again later.",
    });
  });

  it("does not leak a database error message", async () => {
    db.result = { data: null, error: { code: "XX000", message: "internal detail" } };
    const result = await hideMyOrder(ORDER_ID);
    expect(result).toEqual({ ok: false, message: "Couldn't remove this order — please try again." });
  });
});

describe("hideAllMyPastOrders", () => {
  it("calls hide_all_my_past_orders with no arguments", async () => {
    db.result = { data: 3, error: null };
    expect(await hideAllMyPastOrders()).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("hide_all_my_past_orders");
  });

  it("treats zero hidden as success", async () => {
    db.result = { data: 0, error: null };
    expect(await hideAllMyPastOrders()).toEqual({ ok: true });
  });

  it("asks a signed-out visitor to sign in", async () => {
    db.user = null;
    expect((await hideAllMyPastOrders()).ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("explains gracefully when the SQL hasn't been run yet (PGRST202)", async () => {
    db.result = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await hideAllMyPastOrders()).toEqual({
      ok: false,
      message: "Removing orders isn't available yet — please try again later.",
    });
  });

  it("reports any other failure", async () => {
    db.result = { data: null, error: { code: "42501", message: "permission denied" } };
    expect(await hideAllMyPastOrders()).toEqual({ ok: false, message: "Couldn't clear your past orders — please try again." });
  });
});

describe("isOrderFinished", () => {
  const delivery = (status: string) => ({ status, accepted_at: null, completed_at: null });

  it("is true for cancelled, rejected and delivered orders", () => {
    expect(isOrderFinished({ order_status: "cancelled" }, [])).toBe(true);
    expect(isOrderFinished({ order_status: "rejected" }, [])).toBe(true);
    expect(isOrderFinished({ order_status: "accepted" }, [delivery("cancelled"), delivery("completed")])).toBe(true);
  });

  it("is false for anything still in progress", () => {
    expect(isOrderFinished({ order_status: "placed" }, [])).toBe(false);
    expect(isOrderFinished({ order_status: "accepted" }, [])).toBe(false);
    for (const status of ["open", "accepted", "cancelled", "release_requested"]) {
      expect(isOrderFinished({ order_status: "accepted" }, [delivery(status)])).toBe(false);
    }
  });
});
