import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OrderChat } from "@/components/OrderChat";
import { createFakeMessagesSupabase, makeMessage } from "./helpers/fake-messages-supabase";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => holder.client }));

type Fake = ReturnType<typeof createFakeMessagesSupabase>;

/** Renders OrderChat, waits for the channel, and completes the SUBSCRIBED -> initial-fetch handshake. */
async function mountChat(fake: Fake, props: Partial<React.ComponentProps<typeof OrderChat>> = {}) {
  holder.client = fake.client;
  render(
    <OrderChat
      orderId="order-1"
      currentUserId="customer-1"
      riderName={props.riderName ?? "Ah Seng"}
      {...props}
    />
  );
  await waitFor(() => expect(fake.channels).toHaveLength(1));
  await act(async () => {
    fake.channels[0].setStatus("SUBSCRIBED");
  });
  await waitFor(() => expect(fake.state.selects).toBeGreaterThan(0));
  return fake.channels[0];
}

describe("OrderChat — live via Realtime", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads existing messages, oldest first", async () => {
    const fake = createFakeMessagesSupabase({
      rows: [
        makeMessage({ id: "a", sender_id: "customer-1", body: "Where are you?", created_at: "2026-09-20T10:00:00.000Z" }),
        makeMessage({ id: "b", sender_id: "rider-1", body: "Almost there!", created_at: "2026-09-20T10:01:00.000Z" }),
      ],
    });
    await mountChat(fake);
    const items = await screen.findAllByTestId("chat-message");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Where are you?");
    expect(items[1]).toHaveTextContent("Almost there!");
  });

  it("puts the customer's messages on the right and labels the rider's on the left with their name", async () => {
    const fake = createFakeMessagesSupabase({
      rows: [
        makeMessage({ id: "a", sender_id: "customer-1", body: "Where are you?", created_at: "2026-09-20T10:00:00.000Z" }),
        makeMessage({ id: "b", sender_id: "rider-1", body: "Almost there!", created_at: "2026-09-20T10:01:00.000Z" }),
      ],
    });
    await mountChat(fake);
    const [mine, theirs] = await screen.findAllByTestId("chat-message");
    expect(mine).toHaveAttribute("data-mine", "true");
    expect(mine).toHaveClass("items-end");
    expect(mine).not.toHaveTextContent("Ah Seng");
    expect(theirs).toHaveAttribute("data-mine", "false");
    expect(theirs).toHaveClass("items-start");
    expect(theirs).toHaveTextContent("Ah Seng");
  });

  it("labels the rider 'Your rider' when their name isn't known", async () => {
    const fake = createFakeMessagesSupabase({ rows: [makeMessage({ id: "b", sender_id: "rider-1", body: "Here" })] });
    await mountChat(fake, { riderName: "  " });
    expect(await screen.findByTestId("chat-message")).toHaveTextContent("Your rider");
  });

  it("subscribes to INSERT on messages, filtered to this order", async () => {
    const fake = createFakeMessagesSupabase();
    const channel = await mountChat(fake);
    expect(channel.name).toBe("messages:order-1");
    expect(channel.handlers.map((h) => h.filter)).toEqual([
      { event: "INSERT", schema: "public", table: "messages", filter: "order_id=eq.order-1" },
    ]);
  });

  it("a live INSERT from the rider appears immediately, aligned left", async () => {
    const fake = createFakeMessagesSupabase();
    const channel = await mountChat(fake);

    act(() => {
      channel.emit("INSERT", "messages", makeMessage({ id: "new", sender_id: "rider-1", body: "On my way!" }));
    });

    const item = await screen.findByTestId("chat-message");
    expect(item).toHaveTextContent("On my way!");
    expect(item).toHaveAttribute("data-mine", "false");
  });

  it("a live INSERT echoing the customer's own send is aligned right", async () => {
    const fake = createFakeMessagesSupabase();
    const channel = await mountChat(fake);

    act(() => {
      channel.emit("INSERT", "messages", makeMessage({ id: "mine", sender_id: "customer-1", body: "Ok thanks!" }));
    });

    const item = await screen.findByTestId("chat-message");
    expect(item).toHaveAttribute("data-mine", "true");
  });

  it("sending inserts with the current user as sender and clears the draft", async () => {
    const fake = createFakeMessagesSupabase();
    await mountChat(fake);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  hello  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(fake.state.inserts).toHaveLength(1));
    expect(fake.state.inserts[0]).toEqual({
      table: "messages",
      values: { order_id: "order-1", sender_id: "customer-1", body: "hello", photo_path: null },
    });
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("does not insert empty or whitespace-only drafts", async () => {
    const fake = createFakeMessagesSupabase();
    await mountChat(fake);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(fake.state.inserts).toHaveLength(0);
  });

  it("shows an inline error and keeps the draft if the send is rejected (e.g. RLS closed the chat)", async () => {
    const fake = createFakeMessagesSupabase();
    fake.state.insertError = { message: "row-level security" };
    await mountChat(fake);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "still there?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText(/couldn.t be sent/i)).toBeInTheDocument());
    expect(screen.getByLabelText("Message")).toHaveValue("still there?");
  });

  it("falls back to a fetch-only load if the channel can't connect", async () => {
    const fake = createFakeMessagesSupabase({ rows: [makeMessage({ id: "a" })] });
    holder.client = fake.client;
    render(<OrderChat orderId="order-1" currentUserId="customer-1" riderName={null} />);
    await waitFor(() => expect(fake.channels).toHaveLength(1));
    await act(async () => {
      fake.channels[0].setStatus("CHANNEL_ERROR");
    });
    await waitFor(() => expect(screen.getAllByTestId("chat-message")).toHaveLength(1));
  });

  it("falls back to 'your rider' when no rider name is known yet", async () => {
    const fake = createFakeMessagesSupabase();
    holder.client = fake.client;
    render(<OrderChat orderId="order-1" currentUserId="customer-1" riderName={null} />);
    expect(await screen.findByText(/Chat with your rider/)).toBeInTheDocument();
  });

  it("removes its Realtime channel on unmount", async () => {
    const fake = createFakeMessagesSupabase();
    const channel = await mountChat(fake);
    cleanup();
    expect(fake.client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("renders a rider's photo-only message as a signed image, not an empty bubble", async () => {
    const fake = createFakeMessagesSupabase({
      rows: [makeMessage({ id: "p", sender_id: "rider-1", body: "", photo_path: "order-1/rider-1/x.jpg" })],
    });
    await mountChat(fake);
    const img = await screen.findByTestId("chat-photo");
    expect(img.getAttribute("src")).toBe("https://signed.example/order-1/rider-1/x.jpg");
    expect(fake.state.signed).toEqual(["order-1/rider-1/x.jpg"]);
    expect(screen.getByTestId("chat-message").querySelector("p")).toBeNull();
  });

  it("uploads an attached photo under <order>/<user>/ and sends it with no text", async () => {
    vi.stubGlobal("crypto", { ...crypto, randomUUID: () => "uuid-1" });
    const fake = createFakeMessagesSupabase();
    await mountChat(fake);
    const file = new File(["x"], "Gate Code.PNG", { type: "image/png" });
    fireEvent.change(screen.getByTestId("chat-photo-input"), { target: { files: [file] } });
    expect(screen.getByText(/Gate Code\.PNG/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(fake.state.uploads).toEqual([{ bucket: "order-chat-photos", path: "order-1/customer-1/uuid-1.png", contentType: "image/png" }]);
    expect(fake.state.inserts[0].values).toEqual({
      order_id: "order-1",
      sender_id: "customer-1",
      body: "",
      photo_path: "order-1/customer-1/uuid-1.png",
    });
    expect(screen.queryByText(/Gate Code\.PNG/)).toBeNull();
  });

  it("does not insert the message if the photo upload fails", async () => {
    const fake = createFakeMessagesSupabase();
    fake.state.uploadError = { message: "new row violates row-level security policy" };
    await mountChat(fake);
    fireEvent.change(screen.getByTestId("chat-photo-input"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(fake.state.inserts).toHaveLength(0);
    expect(screen.getByText(/Photo couldn't be uploaded/)).toBeInTheDocument();
  });

  it("rejects a non-image or oversized file before uploading", async () => {
    const fake = createFakeMessagesSupabase();
    await mountChat(fake);
    fireEvent.change(screen.getByTestId("chat-photo-input"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText(/JPEG, PNG, WebP or HEIC/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(fake.state.uploads).toHaveLength(0);
  });
});
