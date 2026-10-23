import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import OrderConfirmationPage, { type OrderRow } from "@/app/orders/[id]/page";
import { PaymentProofCard } from "@/components/PaymentProofCard";
import {
  formatCountdown,
  getPaymentProofState,
  getPaymentWindowMinutes,
  paymentTimeLeftMs,
  paymentWindowText,
  shortOrderId,
} from "@/lib/payment-proof";

const ORDER_ID = "3f2a9c1e-1111-2222-3333-444455556666";
const SIGNED = "https://proj.supabase.co/storage/v1/object/sign/payment-proofs";

const db = vi.hoisted(() => ({
  order: null as unknown,
  signedPaths: [] as { bucket: string; path: string }[],
  uploads: [] as { bucket: string; path: string; file: File; opts: unknown }[],
  uploadError: null as { message: string } | null,
  uploadGate: null as Promise<void> | null,
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcError: null as { message: string } | null,
  refresh: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "customer-1" } } }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          db.signedPaths.push({ bucket, path });
          return { data: { signedUrl: `${SIGNED}/${path}` }, error: null };
        },
      }),
    },
    from(table: string) {
      const result = () => {
        if (table === "orders") return { data: db.order };
        if (table === "kitchens") return { data: { business_name: "Aunty May", paynow_type: "uen", paynow_value: "201912345K" } };
        if (table === "order_items") return { data: [{ id: "i1", name: "Kopi", price: 2, quantity: 1 }] };
        return { data: [] };
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) builder[m] = () => builder;
      builder.maybeSingle = () => Promise.resolve(result());
      builder.returns = () => Promise.resolve(result());
      return builder;
    },
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: File, opts: unknown) => {
          db.uploads.push({ bucket, path, file, opts });
          if (db.uploadGate) await db.uploadGate;
          return { data: db.uploadError ? null : { path }, error: db.uploadError };
        },
      }),
    },
    rpc: async (fn: string, args: unknown) => {
      db.rpcCalls.push({ fn, args });
      return { data: null, error: db.rpcError };
    },
  }),
}));
vi.mock("@/components/OrderRealtimeRefresher", () => ({ OrderRealtimeRefresher: () => null }));
vi.mock("@/components/CancelOrderButton", () => ({ CancelOrderButton: () => null }));
vi.mock("@/components/OrderChat", () => ({ OrderChat: () => null }));
vi.mock("@/components/SupportChat", () => ({ SupportChatToggle: () => null }));
vi.mock("@/components/RateOrder", () => ({ RateOrder: () => null, OrderRating: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ refresh: db.refresh }),
}));

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    kitchen_id: "kitchen-1",
    subtotal: 12.5,
    delivery_fee_estimate: 2.8,
    order_status: "accepted",
    payment_status: "unpaid",
    preparation_status: "not_started",
    created_at: "2026-01-01T00:00:00.000Z",
    decided_at: "2026-01-01T00:05:00.000Z",
    ready_at: null,
    ...overrides,
  };
}

async function renderPage(o: OrderRow) {
  db.order = o;
  const ui = await OrderConfirmationPage({ params: Promise.resolve({ id: o.id }) });
  return render(ui);
}

function renderCard(props: Partial<React.ComponentProps<typeof PaymentProofCard>> = {}) {
  return render(
    <PaymentProofCard
      orderId={ORDER_ID}
      userId="customer-1"
      state="pay"
      paynowLine="Pay via PayNow to UEN 201912345K"
      amount={15.5}
      paymentDueAt={null}
      proofUrl={null}
      {...props}
    />
  );
}

function pick(file: File) {
  fireEvent.change(screen.getByTestId("payment-proof-input"), { target: { files: [file] } });
}

beforeEach(() => {
  db.signedPaths = [];
  db.uploads = [];
  db.uploadError = null;
  db.uploadGate = null;
  db.rpcCalls = [];
  db.rpcError = null;
  db.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getPaymentProofState", () => {
  const T1 = "2026-01-01T00:10:00.000Z";
  const T2 = "2026-01-01T00:12:00.000Z";
  it.each([
    ["placed, unpaid -> nothing", { order_status: "placed", payment_status: "unpaid" }, null],
    ["cancelled -> nothing", { order_status: "cancelled", payment_status: "unpaid" }, null],
    ["accepted, no proof -> pay", { order_status: "accepted", payment_status: "unpaid" }, "pay"],
    ["accepted, proof -> sent", { order_status: "accepted", payment_status: "unpaid", payment_proof_path: "p", payment_proof_uploaded_at: T1 }, "sent"],
    [
      "rejection older than the latest upload -> sent",
      { order_status: "accepted", payment_status: "unpaid", payment_proof_path: "p", payment_proof_uploaded_at: T2, payment_proof_rejected_at: T1 },
      "sent",
    ],
    [
      "rejection newer than the upload -> rejected",
      { order_status: "accepted", payment_status: "unpaid", payment_proof_path: "p", payment_proof_uploaded_at: T1, payment_proof_rejected_at: T2 },
      "rejected",
    ],
    ["paid -> paid", { order_status: "accepted", payment_status: "paid", payment_proof_path: "p", payment_proof_uploaded_at: T1 }, "paid"],
    [
      "screenshot purged after upload -> still sent, never back to pay",
      { order_status: "accepted", payment_status: "unpaid", payment_proof_path: null, payment_proof_uploaded_at: T1, payment_proof_removed_at: T2 },
      "sent",
    ],
    ["auto-cancelled -> nothing", { order_status: "cancelled", payment_status: "unpaid" }, null],
  ])("%s", (_name, o, expected) => {
    expect(getPaymentProofState(o)).toBe(expected);
  });

  it("formats the countdown and short order id", () => {
    expect(formatCountdown(5 * 60_000)).toBe("5:00");
    expect(formatCountdown(4 * 60_000 + 32_000)).toBe("4:32");
    expect(formatCountdown(61_500)).toBe("1:02");
    expect(formatCountdown(-5000)).toBe("0:00");
    expect(shortOrderId(ORDER_ID)).toBe("3F2A9C1E");
  });
});

describe("payment deadline helpers", () => {
  it("measures time left from payment_due_at only", () => {
    const now = Date.parse("2026-01-01T00:06:00.000Z");
    expect(paymentTimeLeftMs("2026-01-01T00:10:00.000Z", now)).toBe(4 * 60_000);
    expect(paymentTimeLeftMs("2026-01-01T00:05:00.000Z", now)).toBe(-60_000);
    expect(paymentTimeLeftMs(null, now)).toBeNull();
    expect(paymentTimeLeftMs(undefined, now)).toBeNull();
  });

  it("words the window from the database setting, with a fallback", () => {
    expect(paymentWindowText(5)).toBe("within 5 minutes");
    expect(paymentWindowText(1)).toBe("within 1 minute");
    expect(paymentWindowText(null)).toBe("within a few minutes");
  });

  it("reads public.payment_window_minutes() and ignores anything that isn't a positive whole number", async () => {
    const rpc = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) }) as never;
    expect(await getPaymentWindowMinutes(rpc(5))).toBe(5);
    expect(await getPaymentWindowMinutes(rpc(null, { message: "does not exist" }))).toBeNull();
    expect(await getPaymentWindowMinutes(rpc(0))).toBeNull();
    expect(await getPaymentWindowMinutes(rpc("5"))).toBeNull();
    expect(await getPaymentWindowMinutes({ rpc: () => Promise.reject(new Error("offline")) } as never)).toBeNull();
  });
});

describe("/orders/[id] — payment proof card", () => {
  it("asks for the amount after the kitchen's deal, plus the delivery fee", async () => {
    const { container } = await renderPage(order({ discount_total: 2.5, food_total: 10 }));
    const card = within(container).getByTestId("payment-proof-card");
    expect(within(card).getByTestId("payment-amount")).toHaveTextContent("$12.80");
  });

  it("State A: accepted + unpaid shows the three steps, PayNow, amount incl. delivery fee, and the order ref", async () => {
    const { container } = await renderPage(order());
    const card = within(container).getByTestId("payment-proof-card");
    expect(card).toHaveAttribute("data-state", "pay");
    expect(card).toHaveTextContent("Action needed: pay and send proof of payment");
    const steps = card.querySelectorAll("ol > li");
    expect(Array.from(steps).map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Pay via PayNow",
      "Upload your proof of payment",
      "Wait for the cook to confirm",
    ]);
    expect(card).toHaveTextContent("Pay via PayNow to UEN 201912345K");
    expect(within(card).getByTestId("payment-amount")).toHaveTextContent("$15.30");
    expect(card).toHaveTextContent("Put order #3F2A9C1E in the PayNow comment.");
    expect(card).toHaveTextContent("You can crop out your account number.");
    expect(card).toHaveTextContent("The cook starts cooking once they've checked the payment.");
    expect(within(card).getByRole("button", { name: "Upload proof of payment" })).toBeEnabled();
    // Replaces the old one-line payment message.
    expect(within(container).queryByText(/Payment pending/)).toBeNull();
  });

  it("State B: proof uploaded shows the green waiting card with a signed thumbnail and a replace link", async () => {
    const path = `${ORDER_ID}/customer-1/abc.jpg`;
    const { container } = await renderPage(
      order({
        payment_proof_path: path,
        payment_proof_uploaded_at: "2026-01-01T00:10:00.000Z",
        payment_proof_rejected_at: "2026-01-01T00:08:00.000Z",
      })
    );
    const card = within(container).getByTestId("payment-proof-card");
    expect(card).toHaveAttribute("data-state", "sent");
    expect(card).toHaveTextContent("Proof sent ✓ Waiting for the cook to confirm your payment");
    expect(within(card).getByAltText("Your proof of payment")).toHaveAttribute("src", `${SIGNED}/${path}`);
    expect(db.signedPaths).toEqual([{ bucket: "payment-proofs", path }]);
    expect(within(card).getByRole("button", { name: "Replace screenshot" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Upload proof of payment" })).toBeNull();
  });

  it("State C: a rejection newer than the upload shows the red card with the upload button", async () => {
    const { container } = await renderPage(
      order({
        payment_proof_path: `${ORDER_ID}/customer-1/abc.jpg`,
        payment_proof_uploaded_at: "2026-01-01T00:10:00.000Z",
        payment_proof_rejected_at: "2026-01-01T00:12:00.000Z",
      })
    );
    const card = within(container).getByTestId("payment-proof-card");
    expect(card).toHaveAttribute("data-state", "rejected");
    expect(card).toHaveTextContent(
      "The cook couldn't find your payment. Please check your PayNow and upload your proof again"
    );
    expect(within(card).getByRole("button", { name: "Upload proof of payment" })).toBeEnabled();
    expect(db.signedPaths).toEqual([]);
  });

  it("State D: paid collapses to a small 'Payment confirmed ✓'", async () => {
    const { container } = await renderPage(order({ payment_status: "paid", preparation_status: "preparing" }));
    const card = within(container).getByTestId("payment-proof-card");
    expect(card).toHaveAttribute("data-state", "paid");
    expect(card).toHaveTextContent("Payment confirmed ✓");
    expect(within(container).queryByRole("button", { name: "Upload proof of payment" })).toBeNull();
    expect(within(container).queryByText(/Action needed/)).toBeNull();
  });

  it("counts down to payment_due_at on the order page", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-01-01T00:05:28.000Z"));
    const { container } = await renderPage(order({ payment_due_at: "2026-01-01T00:10:00.000Z" }));
    expect(within(container).getByTestId("payment-countdown")).toHaveTextContent("Pay within 4:32");
  });

  it("shows 'Proof removed after 60 days' instead of a broken image once the screenshot is purged", async () => {
    const { container } = await renderPage(
      order({
        payment_status: "paid",
        payment_proof_path: null,
        payment_proof_uploaded_at: "2026-01-01T00:10:00.000Z",
        payment_proof_removed_at: "2026-03-02T19:30:00.000Z",
      })
    );
    const card = within(container).getByTestId("payment-proof-card");
    expect(card).toHaveAttribute("data-state", "paid");
    expect(card).toHaveTextContent("Payment confirmed ✓");
    expect(card).toHaveTextContent("Proof removed after 60 days");
    expect(container.querySelector("img")).toBeNull();
    expect(db.signedPaths).toEqual([]);
  });

  it("shows the removed note, not an image, on a still-unconfirmed order whose screenshot was purged", async () => {
    const { container } = await renderPage(
      order({
        payment_proof_path: null,
        payment_proof_uploaded_at: "2026-01-01T00:10:00.000Z",
        payment_proof_removed_at: "2026-03-02T19:30:00.000Z",
      })
    );
    const card = within(container).getByTestId("payment-proof-card");
    expect(card).toHaveAttribute("data-state", "sent");
    expect(card).toHaveTextContent("Proof removed after 60 days");
    expect(card.querySelector("img")).toBeNull();
    expect(db.signedPaths).toEqual([]);
  });

  it("shows no countdown or 'time is up' once a proof was uploaded and rejected, even past the deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    const { container } = await renderPage(
      order({
        payment_due_at: "2026-01-01T00:10:00.000Z",
        payment_proof_path: `${ORDER_ID}/customer-1/abc.jpg`,
        payment_proof_uploaded_at: "2026-01-01T00:08:00.000Z",
        payment_proof_rejected_at: "2026-01-01T00:20:00.000Z",
      })
    );
    const card = within(container).getByTestId("payment-proof-card");
    expect(card).toHaveAttribute("data-state", "rejected");
    expect(within(container).queryByTestId("payment-countdown")).toBeNull();
    expect(container).not.toHaveTextContent(/will be cancelled/);
    expect(within(card).getByRole("button", { name: "Upload proof of payment" })).toBeEnabled();
  });

  it("says clearly when the order was cancelled for not paying in time", async () => {
    const { container } = await renderPage(order({ order_status: "cancelled", cancel_reason: "not_paid_in_time" }));
    expect(within(container).queryByTestId("payment-proof-card")).toBeNull();
    expect(container).toHaveTextContent("Your payment wasn't received in time, so this order was cancelled.");
    expect(container).toHaveTextContent("Cancelled — payment not received in time");
  });

  it("shows no card before the cook accepts, or on a cancelled order", async () => {
    const placed = await renderPage(order({ order_status: "placed", decided_at: null }));
    expect(within(placed.container).queryByTestId("payment-proof-card")).toBeNull();
    expect(within(placed.container).getByText(/Payment pending/)).toBeInTheDocument();
    cleanup();
    const cancelled = await renderPage(order({ order_status: "cancelled" }));
    expect(within(cancelled.container).queryByTestId("payment-proof-card")).toBeNull();
  });
});

describe("PaymentProofCard — countdown", () => {
  it("counts down to payment_due_at, live", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
    renderCard({ paymentDueAt: "2026-01-01T00:10:00.000Z" });
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent("Pay within 4:00");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent("Pay within 3:55");
  });

  it("says time is up at zero, and keeps the upload button (a proof still counts until the order is cancelled)", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-01-01T00:20:00.000Z"));
    renderCard({ paymentDueAt: "2026-01-01T00:10:00.000Z" });
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent(
      "Time to pay is up. Upload your proof now, or your order will be cancelled."
    );
    expect(screen.getByRole("button", { name: "Upload proof of payment" })).toBeEnabled();
  });

  it("shows no countdown on an order without a deadline (accepted before the timer existed)", () => {
    renderCard({ paymentDueAt: null });
    expect(screen.queryByTestId("payment-countdown")).toBeNull();
  });
});

describe("PaymentProofCard — upload", () => {
  it("uploads to payment-proofs/<order>/<user>/<random>.<ext>, then calls submit_payment_proof with the same path and refreshes", async () => {
    renderCard();
    // jsdom can't decode images, so this also covers the "shrink failed, use the original" fallback.
    const file = new File(["png-bytes"], "Screenshot.PNG", { type: "image/png" });
    pick(file);
    await waitFor(() => expect(db.refresh).toHaveBeenCalledTimes(1));
    expect(db.uploads).toHaveLength(1);
    const [up] = db.uploads;
    expect(up.bucket).toBe("payment-proofs");
    expect(up.path).toMatch(new RegExp(`^${ORDER_ID}/customer-1/[0-9a-f-]{36}\\.png$`));
    expect(up.file).toBe(file);
    expect(up.opts).toEqual({ contentType: "image/png", upsert: false });
    expect(db.rpcCalls).toEqual([{ fn: "submit_payment_proof", args: { p_order_id: ORDER_ID, p_path: up.path } }]);
  });

  it("shrinks a large image to 1600px JPEG before uploading", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 2000, close })));
    const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(["jpeg-bytes"], { type: "image/jpeg" }));
      });
    renderCard();
    pick(new File(["big"], "pay.png", { type: "image/png" }));
    await waitFor(() => expect(db.refresh).toHaveBeenCalled());
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8);
    expect(close).toHaveBeenCalled();
    const [up] = db.uploads;
    expect(up.file.type).toBe("image/jpeg");
    expect(up.path).toMatch(/\.jpg$/);
    expect(up.opts).toEqual({ contentType: "image/jpeg", upsert: false });
  });

  it("rejects a non-image without uploading", async () => {
    renderCard();
    pick(new File(["%PDF"], "receipt.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please choose a JPEG, PNG, WebP or HEIC screenshot.");
    expect(db.uploads).toEqual([]);
  });

  it("rejects an over-5MB file that can't be shrunk", async () => {
    renderCard();
    pick(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.heic", { type: "image/heic" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("over 5 MB");
    expect(db.uploads).toEqual([]);
  });

  it("shows the real storage error and doesn't call the RPC", async () => {
    db.uploadError = { message: "new row violates row-level security policy" };
    renderCard();
    pick(new File(["x"], "pay.jpg", { type: "image/jpeg" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't upload your screenshot: new row violates row-level security policy"
    );
    expect(db.rpcCalls).toEqual([]);
    expect(db.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Upload proof of payment" })).toBeEnabled();
  });

  it("shows the RPC error if submitting fails", async () => {
    db.rpcError = { message: "order is not awaiting payment" };
    renderCard({ state: "rejected" });
    pick(new File(["x"], "pay.jpg", { type: "image/jpeg" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("order is not awaiting payment");
    expect(db.refresh).not.toHaveBeenCalled();
  });

  it("says plainly when the order was auto-cancelled before the proof arrived, and refreshes to show it", async () => {
    db.rpcError = { message: "This order was cancelled because payment wasn't received in time" };
    renderCard();
    pick(new File(["x"], "pay.jpg", { type: "image/jpeg" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/^This order was cancelled because payment wasn't received in time\.$/);
    expect(alert).not.toHaveTextContent(/try again/i);
    expect(db.refresh).toHaveBeenCalledTimes(1);
  });

  it("disables the button and shows a busy state while uploading", async () => {
    let finish: () => void = () => {};
    db.uploadGate = new Promise<void>((r) => (finish = r));
    renderCard();
    pick(new File(["x"], "pay.jpg", { type: "image/jpeg" }));
    const busy = await screen.findByRole("button", { name: "Uploading…" });
    expect(busy).toBeDisabled();
    expect(within(busy).getByTestId("spinner")).toBeInTheDocument();
    await act(async () => finish());
    await waitFor(() => expect(db.refresh).toHaveBeenCalled());
  });
});
