import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SupportChat, SupportChatToggle } from "@/components/SupportChat";
import type { ComplaintMessageRow } from "@/lib/complaints";
import { FakeChannel } from "./helpers/fake-supabase";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => holder.client }));
const clearMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/complaints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/complaints")>()),
  clearComplaintThread: clearMock,
}));

function makeComplaint(overrides: Partial<ComplaintMessageRow> = {}): ComplaintMessageRow {
  return {
    id: "c-1",
    order_id: "order-1",
    sender_id: "customer-1",
    body: "Food was cold",
    photo_path: null,
    created_at: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

/** Fake of the supabase-js surface SupportChat touches: channels, complaint_messages select/insert, storage upload/createSignedUrls. */
function createFake(opts: { rows?: ComplaintMessageRow[]; resolved?: boolean } = {}) {
  const state = {
    rows: opts.rows ?? [],
    resolved: opts.resolved ?? false,
    selects: 0,
    inserts: [] as { table: string; values: Record<string, unknown> }[],
    uploads: [] as { bucket: string; path: string; contentType?: string }[],
    signed: [] as { bucket: string; paths: string[] }[],
    insertError: null as { message: string } | null,
    uploadError: null as { message: string } | null,
  };
  const channels: FakeChannel[] = [];
  const client = {
    channel: (name: string) => {
      const ch = new FakeChannel(name);
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // complaint_resolutions lookup (isComplaintResolved)
          maybeSingle: async () => ({ data: state.resolved ? { order_id: "order-1" } : null, error: null }),
          order: () => ({
            limit: async () => {
              state.selects++;
              return { data: [...state.rows], error: null };
            },
          }),
        }),
      }),
      insert: async (values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        return { error: state.insertError };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: File, o: { contentType?: string }) => {
          state.uploads.push({ bucket, path, contentType: o.contentType });
          return { data: state.uploadError ? null : { path }, error: state.uploadError };
        },
        createSignedUrls: async (paths: string[]) => {
          state.signed.push({ bucket, paths });
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })), error: null };
        },
      }),
    },
  };
  return { client, state, channels };
}

type Fake = ReturnType<typeof createFake>;

async function mountChat(fake: Fake) {
  holder.client = fake.client;
  render(<SupportChat orderId="order-1" currentUserId="customer-1" />);
  await waitFor(() => expect(fake.channels).toHaveLength(1));
  await act(async () => {
    fake.channels[0].setStatus("SUBSCRIBED");
  });
  await waitFor(() => expect(fake.state.selects).toBeGreaterThan(0));
  return fake.channels[0];
}

describe("SupportChat — live via Realtime", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("subscribes to INSERT on complaint_messages, filtered to this order", async () => {
    const fake = createFake();
    const channel = await mountChat(fake);
    expect(channel.name).toBe("complaint_messages:order-1");
    expect(channel.handlers.map((h) => h.filter)).toEqual([
      { event: "INSERT", schema: "public", table: "complaint_messages", filter: "order_id=eq.order-1" },
      { event: "INSERT", schema: "public", table: "complaint_resolutions", filter: "order_id=eq.order-1" },
    ]);
  });

  it("loads the existing thread oldest-first and labels HQ replies", async () => {
    const fake = createFake({
      rows: [
        makeComplaint({ id: "b", sender_id: "admin-1", body: "Sorry! Refund on the way.", created_at: "2026-09-20T10:05:00.000Z" }),
        makeComplaint({ id: "a" }),
      ],
    });
    await mountChat(fake);
    const items = await screen.findAllByTestId("support-message");
    expect(items.map((i) => i.getAttribute("data-mine"))).toEqual(["true", "false"]);
    expect(items[1]).toHaveTextContent("Kopi Boy Support");
    expect(items[1]).toHaveTextContent("Sorry! Refund on the way.");
  });

  it("a live admin reply appears without a reload", async () => {
    const fake = createFake();
    const channel = await mountChat(fake);
    act(() => {
      channel.emit("INSERT", "complaint_messages", makeComplaint({ id: "live", sender_id: "admin-1", body: "Looking into it" }));
    });
    const item = await screen.findByTestId("support-message");
    expect(item).toHaveTextContent("Looking into it");
    expect(item).toHaveAttribute("data-mine", "false");
  });

  it("sends text as the current user, then clears the draft", async () => {
    const fake = createFake();
    await mountChat(fake);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Missing my drink  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(fake.state.inserts).toEqual([
      { table: "complaint_messages", values: { order_id: "order-1", sender_id: "customer-1", body: "Missing my drink", photo_path: null } },
    ]);
    expect(fake.state.uploads).toHaveLength(0);
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("uploads an attached photo under <order>/<user>/ and sends it with no text", async () => {
    vi.stubGlobal("crypto", { ...crypto, randomUUID: () => "uuid-1" });
    const fake = createFake();
    await mountChat(fake);
    const file = new File(["x"], "Cold Soup.PNG", { type: "image/png" });
    fireEvent.change(screen.getByTestId("support-photo-input"), { target: { files: [file] } });
    expect(screen.getByText(/Cold Soup\.PNG/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(fake.state.uploads).toEqual([{ bucket: "complaint-photos", path: "order-1/customer-1/uuid-1.png", contentType: "image/png" }]);
    expect(fake.state.inserts[0].values).toEqual({
      order_id: "order-1",
      sender_id: "customer-1",
      body: "",
      photo_path: "order-1/customer-1/uuid-1.png",
    });
  });

  it("does not insert the message if the photo upload fails", async () => {
    const fake = createFake();
    fake.state.uploadError = { message: "new row violates row-level security policy" };
    await mountChat(fake);
    fireEvent.change(screen.getByTestId("support-photo-input"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(fake.state.inserts).toHaveLength(0);
    expect(screen.getByText(/Photo couldn't be uploaded/)).toBeInTheDocument();
  });

  it("rejects a non-image or oversized file before uploading", async () => {
    const fake = createFake();
    await mountChat(fake);
    fireEvent.change(screen.getByTestId("support-photo-input"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText(/JPEG, PNG, WebP or HEIC/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("renders evidence photos via signed URLs from the private bucket", async () => {
    const fake = createFake({ rows: [makeComplaint({ id: "p", body: "", photo_path: "order-1/customer-1/x.jpg" })] });
    await mountChat(fake);
    const img = await screen.findByTestId("support-photo");
    expect(img).toHaveAttribute("src", "https://signed.example/order-1/customer-1/x.jpg");
    expect(fake.state.signed).toEqual([{ bucket: "complaint-photos", paths: ["order-1/customer-1/x.jpg"] }]);
  });

  it("hides Clear chat while the thread is empty", async () => {
    await mountChat(createFake());
    expect(screen.queryByRole("button", { name: "Clear chat" })).not.toBeInTheDocument();
  });

  it("Clear chat does nothing unless the customer confirms", async () => {
    clearMock.mockReset();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const fake = createFake({ rows: [makeComplaint()] });
    await mountChat(fake);
    await screen.findByTestId("support-message");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    });
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/can't be undone/));
    expect(clearMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("support-message")).toBeInTheDocument();
  });

  it("Clear chat, once confirmed, deletes the thread and empties the list", async () => {
    clearMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("confirm", () => true);
    const fake = createFake({ rows: [makeComplaint(), makeComplaint({ id: "p", body: "", photo_path: "order-1/customer-1/x.jpg" })] });
    await mountChat(fake);
    await screen.findAllByTestId("support-message");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    });
    expect(clearMock).toHaveBeenCalledWith(fake.client, "order-1");
    expect(screen.queryByTestId("support-message")).not.toBeInTheDocument();
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it("hides Clear chat on a thread HQ has already resolved", async () => {
    await mountChat(createFake({ rows: [makeComplaint()], resolved: true }));
    await screen.findByTestId("support-message");
    expect(await screen.findByTestId("support-resolved")).toHaveTextContent(/kept as a record/);
    expect(screen.queryByRole("button", { name: "Clear chat" })).not.toBeInTheDocument();
  });

  it("hides Clear chat live when HQ resolves the thread while it's open", async () => {
    const fake = createFake({ rows: [makeComplaint()] });
    const channel = await mountChat(fake);
    expect(await screen.findByRole("button", { name: "Clear chat" })).toBeInTheDocument();
    act(() => {
      channel.emit("INSERT", "complaint_resolutions", { order_id: "order-1", resolved_by: "admin-1", resolved_at: "2026-09-25T10:00:00.000Z" });
    });
    expect(screen.queryByRole("button", { name: "Clear chat" })).not.toBeInTheDocument();
    expect(screen.getByTestId("support-resolved")).toBeInTheDocument();
  });

  it("hides Clear chat if the delete is refused because HQ resolved it meanwhile", async () => {
    clearMock.mockReset().mockResolvedValue({ ok: false, message: "Kopi Boy Support has marked this chat resolved", resolved: true });
    vi.stubGlobal("confirm", () => true);
    await mountChat(createFake({ rows: [makeComplaint()] }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Clear chat" }));
    });
    expect(screen.queryByRole("button", { name: "Clear chat" })).not.toBeInTheDocument();
    expect(screen.getByTestId("support-message")).toBeInTheDocument();
  });

  it("keeps the thread and shows why if clearing fails", async () => {
    clearMock.mockReset().mockResolvedValue({ ok: false, message: "Couldn't delete the photos — nothing else was removed. Please try again." });
    vi.stubGlobal("confirm", () => true);
    await mountChat(createFake({ rows: [makeComplaint()] }));
    await screen.findByTestId("support-message");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    });
    expect(screen.getByText(/Couldn't delete the photos/)).toBeInTheDocument();
    expect(screen.getByTestId("support-message")).toBeInTheDocument();
  });

  it("tears down the channel on unmount", async () => {
    const fake = createFake();
    const channel = await mountChat(fake);
    cleanup();
    expect(fake.client.removeChannel).toHaveBeenCalledWith(channel);
  });
});

describe("SupportChatToggle", () => {
  afterEach(cleanup);

  it("starts collapsed as 'Report an issue' when there's no thread yet", () => {
    holder.client = createFake().client;
    render(<SupportChatToggle orderId="order-1" currentUserId="customer-1" hasThread={false} />);
    expect(screen.getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
    expect(screen.queryByTestId("support-chat")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Report an issue" }));
    expect(screen.getByTestId("support-chat")).toBeInTheDocument();
  });

  it("starts open when a thread already exists", () => {
    holder.client = createFake().client;
    render(<SupportChatToggle orderId="order-1" currentUserId="customer-1" hasThread />);
    expect(screen.getByTestId("support-chat")).toBeInTheDocument();
  });
});
