import { vi } from "vitest";

export interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

export interface RpcResult {
  data?: unknown;
  error?: { code?: string; message: string; details?: string } | null;
}

/** What PostgREST answers while public.place_order doesn't exist yet. */
export const PLACE_ORDER_MISSING = {
  code: "PGRST202",
  message: "Could not find the function public.place_order(p_customer_id, p_delivery, p_expected, p_items, p_kitchen_id, p_request_id) in the schema cache",
};

/**
 * Stand-in for the service-role client (src/lib/supabase/admin.ts): records
 * every rpc() and answers with `respond`, by default a new order "order-1".
 */
export function createFakeAdmin(respond: (call: RpcCall) => RpcResult = () => ({ data: { order_id: "order-1", existing: false } })) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      const call = { name, args };
      calls.push(call);
      const r = respond(call);
      return { data: r.data ?? null, error: r.error ?? null };
    }),
  };
  return { client, calls };
}
