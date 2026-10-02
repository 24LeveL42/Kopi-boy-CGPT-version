import { describe, it, expect } from "vitest";
import { clearComplaintThread, type ComplaintClearClient } from "@/lib/complaints";

const ORDER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

/**
 * In-memory Storage bucket + complaint_messages table. Mirrors how Supabase
 * reports an RLS-denied delete: no error, just nothing removed.
 */
function createFake(opts: {
  objects: string[];
  rows: { id: string; order_id: string }[];
  canDeletePhotos?: boolean;
  canDeleteRows?: boolean;
  resolved?: boolean;
  /** HQ resolves the thread right after the photos go — RLS then blocks the row delete. */
  resolveAfterPhotos?: boolean;
}) {
  const state = {
    objects: new Set(opts.objects),
    rows: [...opts.rows],
    removeCalls: [] as string[][],
    listError: false,
    resolved: opts.resolved ?? false,
    resolutionError: false,
  };
  // RLS: a delete by the customer only matches while the thread is unresolved (complaint_thread_clearable).
  const allowed = (flag: boolean | undefined) => flag !== false && !state.resolved;
  const client = {
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("complaint-photos");
        return {
          list: async (prefix: string, o: { limit: number; offset: number }) => {
            if (state.listError) return { data: null, error: { message: "boom" } };
            // One level below `prefix`: files have an id, sub-folders don't.
            const entries = new Map<string, string | null>();
            for (const key of state.objects) {
              if (!key.startsWith(`${prefix}/`)) continue;
              const [head, ...rest] = key.slice(prefix.length + 1).split("/");
              entries.set(head, rest.length ? null : `id-${key}`);
            }
            const all = [...entries].map(([name, id]) => ({ name, id }));
            return { data: all.slice(o.offset, o.offset + o.limit), error: null };
          },
          remove: async (paths: string[]) => {
            state.removeCalls.push(paths);
            if (!allowed(opts.canDeletePhotos)) return { data: [], error: null };
            for (const p of paths) state.objects.delete(p);
            if (opts.resolveAfterPhotos) state.resolved = true;
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
    from: (table: string) => {
      if (table === "complaint_resolutions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                state.resolutionError
                  ? { data: null, error: { message: "boom" } }
                  : { data: state.resolved ? { order_id: ORDER } : null, error: null },
            }),
          }),
        };
      }
      expect(table).toBe("complaint_messages");
      return {
        delete: () => ({
          eq: async (_col: string, orderId: string) => {
            if (allowed(opts.canDeleteRows)) state.rows = state.rows.filter((r) => r.order_id !== orderId);
            return { error: null };
          },
        }),
        select: () => ({
          eq: async (_col: string, orderId: string) => ({ count: state.rows.filter((r) => r.order_id === orderId).length, error: null }),
        }),
      };
    },
  } as unknown as ComplaintClearClient;
  return { client, state };
}

describe("clearComplaintThread", () => {
  it("deletes every photo under the order's folder (all uploaders) and every message row, leaving other orders alone", async () => {
    const fake = createFake({
      objects: [`${ORDER}/customer-1/a.jpg`, `${ORDER}/customer-1/b.png`, `${ORDER}/admin-1/c.jpg`, `${OTHER}/customer-1/keep.jpg`],
      rows: [
        { id: "m1", order_id: ORDER },
        { id: "m2", order_id: ORDER },
        { id: "m3", order_id: OTHER },
      ],
    });
    expect(await clearComplaintThread(fake.client, ORDER)).toEqual({ ok: true });
    expect([...fake.state.objects]).toEqual([`${OTHER}/customer-1/keep.jpg`]);
    expect(fake.state.rows).toEqual([{ id: "m3", order_id: OTHER }]);
    expect(fake.state.removeCalls.flat().sort()).toEqual([`${ORDER}/admin-1/c.jpg`, `${ORDER}/customer-1/a.jpg`, `${ORDER}/customer-1/b.png`]);
  });

  it("with no photos, skips Storage removal and just deletes the rows", async () => {
    const fake = createFake({ objects: [], rows: [{ id: "m1", order_id: ORDER }] });
    expect(await clearComplaintThread(fake.client, ORDER)).toEqual({ ok: true });
    expect(fake.state.removeCalls).toEqual([]);
    expect(fake.state.rows).toEqual([]);
  });

  it("catches a silently-denied photo delete and keeps the messages", async () => {
    const fake = createFake({ objects: [`${ORDER}/admin-1/c.jpg`], rows: [{ id: "m1", order_id: ORDER }], canDeletePhotos: false });
    const result = await clearComplaintThread(fake.client, ORDER);
    expect(result.ok).toBe(false);
    expect(fake.state.objects.size).toBe(1);
    expect(fake.state.rows).toHaveLength(1);
  });

  it("catches a silently-denied row delete (0 rows affected, no error)", async () => {
    const fake = createFake({ objects: [`${ORDER}/customer-1/a.jpg`], rows: [{ id: "m1", order_id: ORDER }], canDeleteRows: false });
    const result = await clearComplaintThread(fake.client, ORDER);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/messages/) });
    expect(fake.state.rows).toHaveLength(1);
  });

  it("aborts before deleting anything if the folder can't be listed", async () => {
    const fake = createFake({ objects: [`${ORDER}/customer-1/a.jpg`], rows: [{ id: "m1", order_id: ORDER }] });
    fake.state.listError = true;
    expect((await clearComplaintThread(fake.client, ORDER)).ok).toBe(false);
    expect(fake.state.removeCalls).toEqual([]);
    expect(fake.state.rows).toHaveLength(1);
  });

  it("refuses a resolved thread without touching Storage or the rows", async () => {
    const fake = createFake({ objects: [`${ORDER}/customer-1/a.jpg`], rows: [{ id: "m1", order_id: ORDER }], resolved: true });
    expect(await clearComplaintThread(fake.client, ORDER)).toEqual({ ok: false, message: expect.stringMatching(/resolved/), resolved: true });
    expect(fake.state.removeCalls).toEqual([]);
    expect(fake.state.objects.size).toBe(1);
    expect(fake.state.rows).toHaveLength(1);
  });

  it("aborts before deleting anything if the resolved status can't be checked", async () => {
    const fake = createFake({ objects: [`${ORDER}/customer-1/a.jpg`], rows: [{ id: "m1", order_id: ORDER }] });
    fake.state.resolutionError = true;
    expect((await clearComplaintThread(fake.client, ORDER)).ok).toBe(false);
    expect(fake.state.removeCalls).toEqual([]);
    expect(fake.state.rows).toHaveLength(1);
  });

  it("reports 'resolved' when HQ resolves mid-clear and RLS blocks the row delete", async () => {
    const fake = createFake({ objects: [`${ORDER}/customer-1/a.jpg`], rows: [{ id: "m1", order_id: ORDER }], resolveAfterPhotos: true });
    expect(await clearComplaintThread(fake.client, ORDER)).toMatchObject({ ok: false, resolved: true });
    expect(fake.state.rows).toHaveLength(1);
  });
});
