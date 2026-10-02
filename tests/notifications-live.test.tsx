import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { NotificationsProvider, TOAST_DURATION_MS } from "@/lib/notifications-context";
import { NotificationBell } from "@/components/NotificationBell";
import { NotificationToasts } from "@/components/NotificationToasts";
import { NotificationsInbox } from "@/components/NotificationsInbox";
import { createFakeSupabase, makeNotification } from "./helpers/fake-supabase";

const holder = vi.hoisted(() => ({ client: null as unknown }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => holder.client }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault(); // jsdom can't navigate; the real Link would client-side route
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

type Fake = ReturnType<typeof createFakeSupabase>;

function App() {
  return (
    <NotificationsProvider>
      <NotificationBell />
      <NotificationToasts />
      <NotificationsInbox />
    </NotificationsProvider>
  );
}

/** Renders the app for `userId`, waits for the channel, and completes the SUBSCRIBED → initial-fetch handshake. */
async function mountApp(fake: Fake) {
  holder.client = fake.client;
  render(<App />);
  await waitFor(() => expect(fake.channels).toHaveLength(1));
  await act(async () => {
    fake.channels[0].setStatus("SUBSCRIBED");
  });
  await waitFor(() => expect(fake.state.selects).toBeGreaterThan(0));
  return fake.channels[0];
}

const badge = () => screen.queryByTestId("notification-badge");

describe("customer notifications — live via Realtime", () => {
  beforeEach(() => {
    router.push.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("loads existing notifications and shows the unread count on the bell", async () => {
    const fake = createFakeSupabase({
      userId: "user-1",
      rows: [
        makeNotification({ id: "a", read_at: null }),
        makeNotification({ id: "b", read_at: null, created_at: "2026-09-20T09:00:00.000Z" }),
        makeNotification({ id: "c", read_at: "2026-09-20T09:30:00.000Z", created_at: "2026-09-20T08:00:00.000Z" }),
      ],
    });
    await mountApp(fake);
    await waitFor(() => expect(badge()).toHaveTextContent("2"));
    expect(screen.getAllByTestId("notification-item")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Notifications, 2 unread" })).toHaveAttribute("href", "/notifications");
  });

  it("subscribes to ONLY the signed-in customer's rows (INSERT + UPDATE on notifications, filtered by user_id)", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [] });
    const channel = await mountApp(fake);
    expect(channel.name).toBe("notifications:user-1");
    const subs = channel.handlers.map((h) => h.filter);
    expect(subs).toEqual([
      { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq.user-1" },
      { event: "UPDATE", schema: "public", table: "notifications", filter: "user_id=eq.user-1" },
    ]);
  });

  it("a live INSERT updates the badge, inbox and toast IMMEDIATELY — pushed, with no refetch and no timer", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [makeNotification({ id: "old", read_at: "2026-09-20T09:00:00.000Z" })] });
    const channel = await mountApp(fake);
    await waitFor(() => expect(screen.getAllByTestId("notification-item")).toHaveLength(1));
    expect(badge()).toBeNull();
    const selectsBefore = fake.state.selects;

    // The cook accepts; the DB trigger inserts a notification; Realtime pushes it.
    act(() => {
      channel.emit(
        "INSERT",
        "notifications",
        makeNotification({
          id: "new",
          title: "Order accepted",
          body: "Mama Lim Kitchen accepted your order. Pay via PayNow to +65 91234567.",
          created_at: "2026-09-20T10:30:00.000Z",
        })
      );
    });

    // No waitFor / no timers advanced: the UI must already reflect it.
    expect(badge()).toHaveTextContent("1");
    const toast = screen.getByTestId("notification-toast");
    expect(within(toast).getByText("Order accepted")).toBeInTheDocument();
    expect(within(toast).getByText(/Pay via PayNow to \+65 91234567/)).toBeInTheDocument();
    const items = screen.getAllByTestId("notification-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Pay via PayNow"); // newest first
    // Proof it was pushed, not polled: the database was not queried again.
    expect(fake.state.selects).toBe(selectsBefore);
  });

  it("shows nothing and opens no channel when signed out", async () => {
    const fake = createFakeSupabase({ userId: null });
    holder.client = fake.client;
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Sign in to see updates/)).toBeInTheDocument());
    expect(fake.channels).toHaveLength(0);
    expect(fake.state.selects).toBe(0);
    expect(screen.queryByRole("link", { name: /Notifications/ })).toBeNull();
  });

  it("tapping a notification marks it read (optimistically) and persists read_at for that row only", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [makeNotification({ id: "a", url: "/orders/order-9", ref_id: "order-9" })] });
    await mountApp(fake);
    await waitFor(() => expect(badge()).toHaveTextContent("1"));

    fireEvent.click(screen.getByTestId("notification-item"));

    expect(badge()).toBeNull(); // optimistic, before the DB round-trip finishes
    await waitFor(() => expect(fake.state.updates).toHaveLength(1));
    const update = fake.state.updates[0];
    expect(update.table).toBe("notifications");
    expect(Object.keys(update.values)).toEqual(["read_at"]);
    expect(update.filters).toEqual([
      ["eq", "id", "a"],
      ["is", "read_at", null],
    ]);
  });

  it("rolls the unread state back if saving read_at fails", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [makeNotification({ id: "a" })] });
    await mountApp(fake);
    await waitFor(() => expect(badge()).toHaveTextContent("1"));
    fake.state.updateError = { message: "boom" };

    fireEvent.click(screen.getByTestId("notification-item"));

    await waitFor(() => expect(badge()).toHaveTextContent("1"));
  });

  it("'Mark all as read' clears every unread and issues a single update", async () => {
    const fake = createFakeSupabase({
      userId: "user-1",
      rows: [makeNotification({ id: "a" }), makeNotification({ id: "b", created_at: "2026-09-20T09:00:00.000Z" })],
    });
    await mountApp(fake);
    await waitFor(() => expect(badge()).toHaveTextContent("2"));

    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(badge()).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
    await waitFor(() => expect(fake.state.updates).toHaveLength(1));
    expect(fake.state.updates[0].filters).toEqual([["is", "read_at", null]]);
  });

  it("an UPDATE from another tab/device syncs the read state live", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [makeNotification({ id: "a" })] });
    const channel = await mountApp(fake);
    await waitFor(() => expect(badge()).toHaveTextContent("1"));

    act(() => {
      channel.emit("UPDATE", "notifications", makeNotification({ id: "a", read_at: "2026-09-20T10:10:00.000Z" }));
    });

    expect(badge()).toBeNull();
    expect(fake.state.updates).toHaveLength(0); // it's a sync, not a write-back
  });

  it("a live toast auto-dismisses after the timeout but stays in the inbox", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [] });
    const channel = await mountApp(fake);
    vi.useFakeTimers();

    act(() => {
      channel.emit("INSERT", "notifications", makeNotification({ id: "t1" }));
    });
    expect(screen.getAllByTestId("notification-toast")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getAllByTestId("notification-toast")).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("notification-toast")).toBeNull();
    expect(screen.getAllByTestId("notification-item")).toHaveLength(1);
    expect(badge()).toHaveTextContent("1");
  });

  it("tapping a toast opens its order and marks it read", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [] });
    const channel = await mountApp(fake);

    act(() => {
      channel.emit("INSERT", "notifications", makeNotification({ id: "t1", url: "/orders/order-42", ref_id: "order-42", title: "Rider on the way" }));
    });
    fireEvent.click(within(screen.getByTestId("notification-toast")).getByText("Rider on the way"));

    expect(router.push).toHaveBeenCalledWith("/orders/order-42");
    expect(screen.queryByTestId("notification-toast")).toBeNull();
    expect(badge()).toBeNull();
    await waitFor(() => expect(fake.state.updates).toHaveLength(1));
  });

  it("a reconnect re-fetches and merges missed notifications without duplicating or toasting them", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [makeNotification({ id: "a" })] });
    const channel = await mountApp(fake);
    await waitFor(() => expect(screen.getAllByTestId("notification-item")).toHaveLength(1));

    // While the socket was down the cook marked the order ready.
    fake.state.rows = [
      makeNotification({ id: "b", title: "Food is ready", created_at: "2026-09-20T11:00:00.000Z" }),
      makeNotification({ id: "a" }),
    ];
    await act(async () => {
      channel.setStatus("SUBSCRIBED"); // Realtime reconnected
    });

    await waitFor(() => expect(screen.getAllByTestId("notification-item")).toHaveLength(2));
    expect(badge()).toHaveTextContent("2");
    expect(screen.queryByTestId("notification-toast")).toBeNull();
  });

  it("shows an error with retry when the initial load fails, and recovers", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [makeNotification({ id: "a" })] });
    fake.state.selectError = { message: "network" };
    await mountApp(fake);
    await waitFor(() => expect(screen.getByText(/Couldn.t load your notifications/)).toBeInTheDocument());

    fake.state.selectError = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getAllByTestId("notification-item")).toHaveLength(1));
  });

  it("removes its Realtime channel on unmount", async () => {
    const fake = createFakeSupabase({ userId: "user-1", rows: [] });
    const channel = await mountApp(fake);
    cleanup();
    expect(fake.client.removeChannel).toHaveBeenCalledWith(channel);
    expect(fake.unsubscribe).toHaveBeenCalled();
  });
});
