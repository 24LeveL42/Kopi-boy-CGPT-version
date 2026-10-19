// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PURGE_BATCH_SIZE, PURGE_MAX_BATCHES, handlePaymentProofPurge, type PurgeDeps } from "@/lib/payment-proof-purge-server";

const SECRET = "a-long-shared-webhook-secret";
const ENV = {
  PUSH_WEBHOOK_SECRET: SECRET,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

/**
 * The bucket and the two RPCs, in memory. Like the real
 * expired_payment_proof_files, the "database" alone decides which files are
 * old enough; the handler only ever deletes names it was given.
 */
function createFakeAdmin(opts: { files?: { name: string; old: boolean }[]; listError?: string; removeError?: string; removeNothing?: boolean } = {}) {
  const state = {
    files: [...(opts.files ?? [])],
    removeCalls: [] as { bucket: string; names: string[] }[],
    clearCalls: 0,
  };
  const client = {
    rpc: async (fn: string, args?: { p_limit?: number }) => {
      if (fn === "expired_payment_proof_files") {
        if (opts.listError) return { data: null, error: { message: opts.listError } };
        return { data: state.files.filter((f) => f.old).slice(0, args?.p_limit).map((f) => f.name), error: null };
      }
      if (fn === "clear_removed_payment_proofs") {
        state.clearCalls += 1;
        return { data: 0, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (names: string[]) => {
          state.removeCalls.push({ bucket, names });
          if (opts.removeError) return { data: null, error: { message: opts.removeError } };
          if (opts.removeNothing) return { data: [], error: null };
          const removed = state.files.filter((f) => names.includes(f.name));
          state.files = state.files.filter((f) => !names.includes(f.name));
          return { data: removed.map((f) => ({ name: f.name })), error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, state };
}

function request(secret: string | null = SECRET) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-webhook-secret"] = secret;
  return new Request("https://app.example.com/api/cron/purge-payment-proofs", { method: "POST", headers, body: "{}" });
}

function deps(admin: SupabaseClient, env = ENV) {
  const createAdmin = vi.fn(() => admin);
  return { deps: { env, createAdmin } satisfies PurgeDeps, createAdmin };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/cron/purge-payment-proofs — authentication", () => {
  it("refuses a wrong or missing secret without touching storage", async () => {
    const { client } = createFakeAdmin({ files: [{ name: "a", old: true }] });
    for (const secret of ["wrong-secret", null]) {
      const { deps: d, createAdmin } = deps(client);
      const res = await handlePaymentProofPurge(request(secret), d);
      expect(res.status).toBe(401);
      expect(createAdmin).not.toHaveBeenCalled();
    }
  });

  it("refuses everything when not configured", async () => {
    const { client } = createFakeAdmin();
    const { deps: d } = deps(client, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" });
    expect((await handlePaymentProofPurge(request(), d)).status).toBe(503);
  });
});

describe("POST /api/cron/purge-payment-proofs — deleting", () => {
  it("deletes only the files the database says are past the retention period, then clears the orders", async () => {
    const { client, state } = createFakeAdmin({
      files: [
        { name: "o1/c1/old.jpg", old: true },
        { name: "o1/c1/replaced-old.jpg", old: true },
        { name: "o2/c2/new.jpg", old: false },
      ],
    });
    const { deps: d } = deps(client);

    const res = await handlePaymentProofPurge(request(), d);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2, cleared: 0, more: false });
    expect(state.removeCalls).toEqual([{ bucket: "payment-proofs", names: ["o1/c1/old.jpg", "o1/c1/replaced-old.jpg"] }]);
    expect(state.files.map((f) => f.name)).toEqual(["o2/c2/new.jpg"]);
    expect(state.clearCalls).toBe(1);
    expect(logSpy).toHaveBeenCalledWith("payment proof purge: deleted 2 file(s), cleared 0 order(s)");
  });

  it("is idempotent: a second run deletes nothing", async () => {
    const { client, state } = createFakeAdmin({ files: [{ name: "a", old: true }] });
    const { deps: d } = deps(client);
    await handlePaymentProofPurge(request(), d);
    const again = await handlePaymentProofPurge(request(), d);
    expect(await again.json()).toEqual({ deleted: 0, cleared: 0, more: false });
    expect(state.removeCalls).toHaveLength(1);
  });

  it("works through big backlogs in batches and stops at the daily cap", async () => {
    const total = PURGE_BATCH_SIZE * PURGE_MAX_BATCHES + 5;
    const files = Array.from({ length: total }, (_, i) => ({ name: `f${i}`, old: true }));
    const { client, state } = createFakeAdmin({ files });
    const { deps: d } = deps(client);

    const res = await handlePaymentProofPurge(request(), d);

    expect(await res.json()).toEqual({ deleted: PURGE_BATCH_SIZE * PURGE_MAX_BATCHES, cleared: 0, more: true });
    expect(state.removeCalls).toHaveLength(PURGE_MAX_BATCHES);
    expect(state.removeCalls.every((c) => c.names.length === PURGE_BATCH_SIZE)).toBe(true);
    expect(state.files).toHaveLength(5);
  });

  it("stops instead of looping when storage removes nothing", async () => {
    const { client, state } = createFakeAdmin({ files: [{ name: "a", old: true }], removeNothing: true });
    const { deps: d } = deps(client);
    const res = await handlePaymentProofPurge(request(), d);
    expect(res.status).toBe(500);
    expect(state.removeCalls).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("reports a storage error but still clears orders whose files are already gone", async () => {
    const { client, state } = createFakeAdmin({ files: [{ name: "a", old: true }], removeError: "boom" });
    const { deps: d } = deps(client);
    const res = await handlePaymentProofPurge(request(), d);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "deleting files failed: boom", deleted: 0 });
    expect(state.clearCalls).toBe(1);
  });

  it("deletes nothing when the database can't list files", async () => {
    const { client, state } = createFakeAdmin({ files: [{ name: "a", old: true }], listError: "no function" });
    const { deps: d } = deps(client);
    const res = await handlePaymentProofPurge(request(), d);
    expect(res.status).toBe(500);
    expect(state.removeCalls).toEqual([]);
  });

  describe("the real route file", () => {
    const saved = { ...process.env };
    beforeEach(() => Object.assign(process.env, ENV));
    afterEach(() => {
      process.env = { ...saved };
    });

    it("answers 401 to a wrong secret", async () => {
      const { POST } = await import("@/app/api/cron/purge-payment-proofs/route");
      expect((await POST(request("nope"))).status).toBe(401);
    });
  });
});
