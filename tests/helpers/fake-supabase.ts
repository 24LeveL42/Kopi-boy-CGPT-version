import { vi } from "vitest";
import type { NotificationRow } from "@/lib/notifications";

interface PostgresChangesFilter {
  event: string;
  schema: string;
  table: string;
  filter?: string;
}

type ChangeHandler = (payload: { eventType: string; new: Record<string, unknown> }) => void;

/**
 * Stand-in for a supabase-js RealtimeChannel: records what the app subscribed
 * to, and lets a test push events / status changes exactly the way the real
 * Realtime server would.
 */
export class FakeChannel {
  handlers: { filter: PostgresChangesFilter; cb: ChangeHandler }[] = [];
  private statusCb: ((status: string) => void) | null = null;

  constructor(public name: string) {}

  on(_type: string, filter: PostgresChangesFilter, cb: ChangeHandler) {
    this.handlers.push({ filter, cb });
    return this;
  }

  subscribe(cb: (status: string) => void) {
    this.statusCb = cb;
    return this;
  }

  /** Simulate the channel status callback (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED). */
  setStatus(status: string) {
    this.statusCb?.(status);
  }

  /** Simulate a postgres_changes event for `table`, delivered to matching handlers. */
  emit(event: "INSERT" | "UPDATE" | "DELETE", table: string, row: object) {
    for (const h of this.handlers) {
      if ((h.filter.event === event || h.filter.event === "*") && h.filter.table === table) {
        h.cb({ eventType: event, new: row as Record<string, unknown> });
      }
    }
  }
}

export interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
  filters: ["eq" | "is", string, unknown][];
}

export function makeNotification(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n-1",
    user_id: "user-1",
    category: "orders",
    type: "order_accepted",
    title: "Order accepted",
    body: "Mama Lim Kitchen accepted your order.",
    url: "/orders/order-1",
    ref_id: "order-1",
    created_at: "2026-09-20T10:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

/**
 * Minimal fake of the supabase-js surface the notifications code touches:
 * auth.onAuthStateChange, channel()/removeChannel(), and from('notifications')
 * select().order().limit() / update().eq().is().
 */
export function createFakeSupabase(opts: { userId: string | null; rows?: NotificationRow[] }) {
  const state = {
    rows: opts.rows ?? [],
    selectError: null as { message: string } | null,
    updateError: null as { message: string } | null,
    selects: 0,
    updates: [] as RecordedUpdate[],
  };
  const channels: FakeChannel[] = [];
  const unsubscribe = vi.fn();

  const client = {
    auth: {
      onAuthStateChange: (cb: (event: string, session: { user: { id: string } } | null) => void) => {
        // Real auth-js delivers INITIAL_SESSION asynchronously, right after subscribing.
        setTimeout(() => cb("INITIAL_SESSION", opts.userId ? { user: { id: opts.userId } } : null), 0);
        return { data: { subscription: { unsubscribe } } };
      },
    },
    channel: (name: string) => {
      const ch = new FakeChannel(name);
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(),
    from: (table: string) => ({
      select: () => ({
        order: () => ({
          limit: async () => {
            state.selects++;
            return state.selectError
              ? { data: null, error: state.selectError }
              : { data: [...state.rows], error: null };
          },
        }),
      }),
      update: (values: Record<string, unknown>) => {
        const rec: RecordedUpdate = { table, values, filters: [] };
        state.updates.push(rec);
        const chain = {
          eq: (column: string, value: unknown) => {
            rec.filters.push(["eq", column, value]);
            return chain;
          },
          is: (column: string, value: unknown) => {
            rec.filters.push(["is", column, value]);
            return Promise.resolve({ error: state.updateError });
          },
        };
        return chain;
      },
    }),
  };

  return { client, state, channels, unsubscribe };
}
