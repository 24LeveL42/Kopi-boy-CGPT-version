import { describe, it, expect, vi, beforeEach } from "vitest";
import { cancelOrder } from "@/lib/order-actions";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

interface MaybeSingleResult {
  data: { id: string } | null;
  error: { message: string } | null;
}

function makeSupabaseMock(authedUserId: string | null, maybeSingleResult: MaybeSingleResult) {
  const updateCalls: unknown[] = [];
  const eqCalls: [string, unknown][] = [];

  const chain = {
    update: vi.fn((values: unknown) => {
      updateCalls.push(values);
      return chain;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    }),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => maybeSingleResult),
  };

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authedUserId ? { id: authedUserId } : null } })),
    },
    from: vi.fn(() => chain),
    updateCalls,
    eqCalls,
  };
}

describe("cancelOrder", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("cancels an order that's still 'placed', guarding the update on that state", async () => {
    const supabase = makeSupabaseMock("customer-1", { data: { id: "order-1" }, error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await expect(cancelOrder("order-1")).resolves.toEqual({ ok: true });

    expect(supabase.from).toHaveBeenCalledWith("orders");
    expect(supabase.updateCalls[0]).toMatchObject({ order_status: "cancelled" });
    expect(supabase.eqCalls).toContainEqual(["id", "order-1"]);
    expect(supabase.eqCalls).toContainEqual(["order_status", "placed"]);
  });

  it("is blocked once the kitchen has already accepted/rejected — update matches 0 rows", async () => {
    const supabase = makeSupabaseMock("customer-1", { data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    // Returned, not thrown: a thrown Error's message is redacted by Next.js
    // in production for Server Actions, so this must survive as real data.
    await expect(cancelOrder("order-1")).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/no longer be cancelled/i),
    });
  });

  it("surfaces a Supabase error instead of silently failing", async () => {
    const supabase = makeSupabaseMock("customer-1", { data: null, error: { message: "boom" } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await expect(cancelOrder("order-1")).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/boom/),
    });
  });

  it("requires a signed-in customer", async () => {
    const supabase = makeSupabaseMock(null, { data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await expect(cancelOrder("order-1")).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/sign in/i),
    });
  });
});
