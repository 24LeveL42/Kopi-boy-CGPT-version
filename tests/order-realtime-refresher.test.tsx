import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { OrderRealtimeRefresher } from "@/components/OrderRealtimeRefresher";
import { createFakeSupabase } from "./helpers/fake-supabase";

const holder = vi.hoisted(() => ({ client: null as unknown }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => holder.client }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function setup(props: { isSettled?: boolean } = {}) {
  const fake = createFakeSupabase({ userId: "user-1" });
  holder.client = fake.client;
  const utils = render(<OrderRealtimeRefresher orderId="order-7" isSettled={props.isSettled ?? false} fallbackIntervalMs={5000} />);
  return { fake, channel: fake.channels[0], ...utils };
}

describe("OrderRealtimeRefresher (replaces OrderStatusPoller)", () => {
  beforeEach(() => {
    router.refresh.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("subscribes to this order's orders row and its delivery_requests rows", () => {
    const { channel } = setup();
    expect(channel.name).toBe("order:order-7");
    expect(channel.handlers.map((h) => h.filter)).toEqual([
      { event: "*", schema: "public", table: "orders", filter: "id=eq.order-7" },
      { event: "*", schema: "public", table: "delivery_requests", filter: "order_id=eq.order-7" },
    ]);
  });

  it("refreshes the page the moment the order changes (cook accepts) — pushed, not polled", () => {
    const { channel } = setup();
    act(() => channel.setStatus("SUBSCRIBED"));
    router.refresh.mockClear(); // ignore the catch-up refresh on connect

    act(() => channel.emit("UPDATE", "orders", { id: "order-7", order_status: "accepted" }));
    expect(router.refresh).toHaveBeenCalledTimes(1);

    act(() => channel.emit("UPDATE", "delivery_requests", { order_id: "order-7", status: "accepted" }));
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("does NOT poll while the channel is healthy", () => {
    const { channel } = setup();
    act(() => channel.setStatus("SUBSCRIBED"));
    router.refresh.mockClear();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("refreshes once on connect to catch anything missed since the server render", () => {
    const { channel } = setup();
    act(() => channel.setStatus("SUBSCRIBED"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to interval refresh if the channel errors, and stops once it recovers", () => {
    const { channel } = setup();
    act(() => channel.setStatus("CHANNEL_ERROR"));
    router.refresh.mockClear();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(3); // 5s, 10s, 15s

    act(() => channel.setStatus("SUBSCRIBED"));
    router.refresh.mockClear();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("opens no channel at all once the order is settled", () => {
    const { fake } = setup({ isSettled: true });
    expect(fake.channels).toHaveLength(0);
  });

  it("cleans up on unmount without starting the fallback poller", () => {
    const { fake, channel, unmount } = setup();
    act(() => channel.setStatus("SUBSCRIBED"));
    router.refresh.mockClear();

    unmount();
    expect(fake.client.removeChannel).toHaveBeenCalledWith(channel);

    // supabase-js reports CLOSED after removeChannel(); that must not start polling.
    act(() => channel.setStatus("CLOSED"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
