import { vi } from "vitest";

export interface DbOp {
  table: string;
  kind: "select" | "insert" | "update" | "delete";
  values?: Record<string, unknown>;
  columns?: string;
  head?: boolean;
  filters: Record<string, unknown>;
}

export interface DbResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}

/**
 * Minimal supabase-js stand-in for server actions: every from() chain is
 * recorded as one DbOp (table, select/insert/update/delete, eq filters) and
 * answered by `respond`, whether it ends in maybeSingle()/single()/in() or is
 * awaited directly. rpc() answers quote_delivery with a fixed distance/fee.
 */
export function createFakeDb(respond: (op: DbOp) => DbResult = () => ({}), opts: { userId?: string | null } = {}) {
  const ops: DbOp[] = [];
  const userId = opts.userId === undefined ? "customer-1" : opts.userId;

  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    rpc: vi.fn(async () => ({ data: [{ distance_km: 3.04, delivery_fee: 3.3 }], error: null })),
    from: vi.fn((table: string) => {
      const op: DbOp = { table, kind: "select", filters: {} };
      ops.push(op);
      const resolve = () => {
        const r = respond(op);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null });
      };
      const chain = {
        select(columns?: string, o?: { head?: boolean }) {
          if (op.kind === "select") {
            op.columns = columns;
            op.head = o?.head;
          }
          return chain;
        },
        insert(values: Record<string, unknown>) {
          op.kind = "insert";
          op.values = values;
          return chain;
        },
        update(values: Record<string, unknown>) {
          op.kind = "update";
          op.values = values;
          return chain;
        },
        delete() {
          op.kind = "delete";
          return chain;
        },
        eq(column: string, value: unknown) {
          op.filters[column] = value;
          return chain;
        },
        order: () => chain,
        returns: () => chain,
        in(column: string, value: unknown) {
          op.filters[column] = value;
          return resolve();
        },
        maybeSingle: resolve,
        single: resolve,
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return resolve().then(onFulfilled, onRejected);
        },
      };
      return chain;
    }),
  };

  return { client, ops };
}
