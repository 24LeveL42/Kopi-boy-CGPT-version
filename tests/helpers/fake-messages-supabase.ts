import { vi } from "vitest";
import type { MessageRow } from "@/lib/messages";
import { FakeChannel } from "./fake-supabase";

export function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "m-1",
    order_id: "order-1",
    sender_id: "customer-1",
    body: "Hello!",
    photo_path: null,
    is_delivery_proof: false,
    created_at: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

export interface RecordedInsert {
  table: string;
  values: Record<string, unknown>;
}

/**
 * Minimal fake of the supabase-js surface OrderChat touches: channel()/
 * removeChannel(), and from('messages') select().eq().order().limit() /
 * insert(), and storage upload()/createSignedUrls() for photo messages.
 */
export function createFakeMessagesSupabase(opts: { rows?: MessageRow[] } = {}) {
  const state = {
    rows: opts.rows ?? [],
    selectError: null as { message: string } | null,
    insertError: null as { message: string } | null,
    uploadError: null as { message: string } | null,
    selects: 0,
    inserts: [] as RecordedInsert[],
    signed: [] as string[],
    uploads: [] as { bucket: string; path: string; contentType?: string }[],
  };
  const channels: FakeChannel[] = [];

  const client = {
    channel: (name: string) => {
      const ch = new FakeChannel(name);
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: File, o: { contentType?: string }) => {
          state.uploads.push({ bucket, path, contentType: o.contentType });
          return { data: state.uploadError ? null : { path }, error: state.uploadError };
        },
        createSignedUrls: async (paths: string[]) => {
          state.signed.push(...paths);
          return { data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })), error: null };
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => {
              state.selects++;
              return state.selectError
                ? { data: null, error: state.selectError }
                : { data: [...state.rows], error: null };
            },
          }),
        }),
      }),
      insert: async (values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        return { error: state.insertError };
      },
    }),
  };

  return { client, state, channels };
}
