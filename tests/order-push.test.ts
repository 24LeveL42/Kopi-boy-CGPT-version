// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORDER_PUSH_EVENTS,
  buildOrderPushPayload,
  isOrderPushEvent,
  orderPushDedupeKey,
} from "@/lib/order-push";
import { handleOrderPushWebhook, type OrderPushDeps, type PushTarget } from "@/lib/order-push-server";

const ORDER_ID = "6f1c2b9e-1d2a-4c3b-9a8f-0e1d2c3b4a59";
const CUSTOMER_ID = "0b6f7a8e-2c1d-4e3f-8a9b-1c2d3e4f5a6b";
const SECRET = "a-long-shared-webhook-secret";

const ENV = {
  PUSH_WEBHOOK_SECRET: SECRET,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
  VAPID_SUBJECT: "mailto:test@example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Just the supabase-js calls the handler makes, backed by in-memory tables.
 * customer_push_log enforces its primary key the way Postgres does (23505).
 */
function createFakeAdmin(opts: { subs?: SubRow[]; orderCustomer?: string | null } = {}) {
  const state = {
    log: new Set<string>(),
    subs: [...(opts.subs ?? [])],
    deletedIds: [] as string[],
  };
  const orderCustomer = opts.orderCustomer === undefined ? CUSTOMER_ID : opts.orderCustomer;

  const client = {
    from(table: string) {
      if (table === "orders") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({
                data: id === ORDER_ID && orderCustomer ? { customer_id: orderCustomer } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "customer_push_log") {
        return {
          insert: async (row: { dedupe_key: string }) => {
            if (state.log.has(row.dedupe_key)) {
              return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            }
            state.log.add(row.dedupe_key);
            return { error: null };
          },
        };
      }
      if (table === "customer_push_subscriptions") {
        return {
          select: () => ({
            eq: (_col: string, userId: string) => ({
              returns: async () => ({ data: state.subs.filter((s) => s.user_id === userId), error: null }),
            }),
          }),
          delete: () => ({
            in: async (_col: string, ids: string[]) => {
              state.deletedIds.push(...ids);
              state.subs = state.subs.filter((s) => !ids.includes(s.id));
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as unknown as SupabaseClient, state };
}

function sub(id: string, userId = CUSTOMER_ID): SubRow {
  return { id, user_id: userId, endpoint: `https://push.example.com/${id}`, p256dh: "p", auth: "a" };
}

function webhook(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-webhook-secret"] = secret;
  return new Request("https://app.example.com/api/push/order-update", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeDeps(admin: SupabaseClient, send: OrderPushDeps["send"] = vi.fn(async () => ({}))) {
  const createAdmin = vi.fn(() => admin);
  return { deps: { env: ENV, createAdmin, send } satisfies OrderPushDeps, createAdmin, send };
}

describe("event → message mapping", () => {
  it.each([
    ["order_accepted", "Your order was accepted. Pay now and send your proof within 15 minutes."],
    ["order_cancelled", "Your order was cancelled."],
    ["payment_received", "Payment received. Your food is being prepared."],
    ["payment_not_received", "Your payment wasn't received. Please check and send your proof again."],
    ["rider_on_the_way", "A rider is on the way to pick up your order."],
    ["order_delivered", "Your order was delivered. Enjoy!"],
  ])("%s says the agreed line and links to the order", (event, body) => {
    const payload = buildOrderPushPayload(event, ORDER_ID);
    expect(payload).toEqual({
      title: expect.any(String),
      body,
      url: `/orders/${ORDER_ID}`,
      tag: `order-${ORDER_ID}`,
    });
  });

  it("covers exactly the six push events", () => {
    expect([...ORDER_PUSH_EVENTS].sort()).toEqual(
      ["order_accepted", "order_cancelled", "order_delivered", "payment_not_received", "payment_received", "rider_on_the_way"].sort()
    );
  });

  it("sends nothing for any other change", () => {
    for (const other of ["order_placed", "order_ready", "preparation_status", "", null, undefined, 42]) {
      expect(isOrderPushEvent(other)).toBe(false);
      expect(buildOrderPushPayload(other, ORDER_ID)).toBeNull();
    }
  });

  it("refuses an order id that isn't a uuid (no arbitrary links)", () => {
    expect(buildOrderPushPayload("order_accepted", "../../evil")).toBeNull();
  });

  it("keeps titles short and generic", () => {
    for (const event of ORDER_PUSH_EVENTS) {
      const { title, body } = buildOrderPushPayload(event, ORDER_ID)!;
      expect(title.length).toBeLessThanOrEqual(30);
      expect(body.length).toBeLessThanOrEqual(80);
    }
  });
});

describe("POST /api/push/order-update — authentication", () => {
  it("refuses a wrong secret without touching the database or sending", async () => {
    const { client } = createFakeAdmin({ subs: [sub("s1")] });
    const { deps, createAdmin, send } = makeDeps(client);
    const res = await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "order_accepted" }, "wrong-secret"), deps);
    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a request with no secret header", async () => {
    const { client } = createFakeAdmin();
    const { deps, createAdmin } = makeDeps(client);
    const res = await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "order_accepted" }, null), deps);
    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("refuses everything when the secret isn't configured", async () => {
    const { client } = createFakeAdmin();
    const { deps } = makeDeps(client);
    const res = await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "order_accepted" }, ""), {
      ...deps,
      env: { ...ENV, PUSH_WEBHOOK_SECRET: "" },
    });
    expect(res.status).toBe(503);
  });

  it("rejects an unknown event even with the right secret", async () => {
    const { client } = createFakeAdmin({ subs: [sub("s1")] });
    const { deps, send } = makeDeps(client);
    const res = await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "order_ready" }), deps);
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  describe("the real route file", () => {
    const saved = { ...process.env };
    beforeEach(() => Object.assign(process.env, ENV));
    afterEach(() => {
      process.env = { ...saved };
    });

    it("answers 401 to a wrong secret", async () => {
      const { POST } = await import("@/app/api/push/order-update/route");
      const res = await POST(webhook({ order_id: ORDER_ID, event: "order_accepted" }, "nope"));
      expect(res.status).toBe(401);
    });
  });
});

describe("POST /api/push/order-update — sending", () => {
  it("pushes the generic payload to every subscription of the order's customer only", async () => {
    const { client } = createFakeAdmin({ subs: [sub("s1"), sub("s2"), sub("other", "someone-else")] });
    const send = vi.fn<OrderPushDeps["send"]>(async () => ({}));
    const { deps } = makeDeps(client, send);

    const res = await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "payment_received" }), deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ subscriptions: 2, sent: 2, removed: 0 });
    expect(send.mock.calls.map(([t]) => t.endpoint).sort()).toEqual([
      "https://push.example.com/s1",
      "https://push.example.com/s2",
    ]);
    expect(JSON.parse(send.mock.calls[0][1])).toEqual({
      title: "Payment received",
      body: "Payment received. Your food is being prepared.",
      url: `/orders/${ORDER_ID}`,
      tag: `order-${ORDER_ID}`,
    });
  });
});

describe("POST /api/push/order-update — duplicate prevention", () => {
  it("sends a change once, however many times the webhook arrives", async () => {
    const { client } = createFakeAdmin({ subs: [sub("s1")] });
    const { deps, send } = makeDeps(client);
    const body = { order_id: ORDER_ID, event: "order_accepted" };

    const first = await handleOrderPushWebhook(webhook(body), deps);
    const second = await handleOrderPushWebhook(webhook(body), deps);

    expect(await first.json()).toMatchObject({ sent: 1 });
    expect(await second.json()).toEqual({ duplicate: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("still sends a genuinely new change of the same kind (a second rejected proof)", async () => {
    const { client } = createFakeAdmin({ subs: [sub("s1")] });
    const { deps, send } = makeDeps(client);

    await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "payment_not_received", ref: "2026-10-16T10:00:00+00:00" }), deps);
    await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "payment_not_received", ref: "2026-10-16T10:00:00+00:00" }), deps);
    await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "payment_not_received", ref: "2026-10-16T10:09:00+00:00" }), deps);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keys each change by order, event and ref", () => {
    expect(orderPushDedupeKey(ORDER_ID, "order_accepted")).toBe(`${ORDER_ID}:order_accepted:`);
    expect(orderPushDedupeKey(ORDER_ID, "rider_on_the_way", "rider-1")).toBe(`${ORDER_ID}:rider_on_the_way:rider-1`);
  });
});

describe("POST /api/push/order-update — expired subscriptions", () => {
  it("deletes subscriptions the push service reports gone (410/404) and keeps the rest", async () => {
    const { client, state } = createFakeAdmin({ subs: [sub("ok"), sub("gone-410"), sub("gone-404"), sub("flaky")] });
    const send = vi.fn(async (target: PushTarget) => {
      if (target.endpoint.endsWith("gone-410")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (target.endpoint.endsWith("gone-404")) throw Object.assign(new Error("Not Found"), { statusCode: 404 });
      if (target.endpoint.endsWith("flaky")) throw Object.assign(new Error("Server error"), { statusCode: 500 });
      return {};
    });
    const { deps } = makeDeps(client, send);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await handleOrderPushWebhook(webhook({ order_id: ORDER_ID, event: "order_delivered" }), deps);

    expect(await res.json()).toEqual({ subscriptions: 4, sent: 1, failed: 1, removed: 2 });
    expect(state.deletedIds.sort()).toEqual(["gone-404", "gone-410"]);
    expect(state.subs.map((s) => s.id).sort()).toEqual(["flaky", "ok"]);
    errorSpy.mockRestore();
  });
});
