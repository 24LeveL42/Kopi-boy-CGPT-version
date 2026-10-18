import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  inserts: [] as unknown[],
  insertError: null as { message: string; hint?: string } | null,
  filters: [] as [string, unknown][],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "admin_messages") throw new Error(`unexpected table ${table}`);
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          db.filters.push([col, val]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        returns: () => Promise.resolve({ data: db.rows, error: null }),
        insert: (values: unknown) => {
          db.inserts.push(values);
          return Promise.resolve({ error: db.insertError });
        },
      };
      return builder;
    },
  }),
}));

import { SupportMessageForm } from "@/components/SupportMessageForm";
import { validateSupportMessage } from "@/lib/support-messages";

beforeEach(() => {
  db.rows = [];
  db.inserts = [];
  db.insertError = null;
  db.filters = [];
});
afterEach(cleanup);

describe("Help — Message Kopi Boy", () => {
  it("sends the trimmed message as the signed-in customer only", async () => {
    render(<SupportMessageForm userId="customer-1" />);
    fireEvent.change(screen.getByLabelText("Message Kopi Boy"), { target: { value: "  Where is my refund?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText(/Message sent/)).toBeInTheDocument();
    // Nothing else: the database trigger sets role, status and time.
    expect(db.inserts).toEqual([{ sender_id: "customer-1", message: "Where is my refund?" }]);
  });

  it("loads only this customer's own messages, with Kopi Boy's reply", async () => {
    db.rows = [
      { id: "m1", message: "Hello", admin_reply: "Hi there", replied_at: "2026-10-18T03:00:00Z", status: "replied", created_at: "2026-10-18T02:00:00Z" },
    ];
    render(<SupportMessageForm userId="customer-1" />);
    expect(await screen.findByText("Hi there")).toBeInTheDocument();
    expect(screen.getByText("Replied")).toBeInTheDocument();
    expect(db.filters).toContainEqual(["sender_id", "customer-1"]);
  });

  it("shows the daily limit message from the database as is", async () => {
    db.insertError = { message: "You can send up to 5 messages to the admin every 24 hours.", hint: "admin_messages_rate_limit" };
    render(<SupportMessageForm userId="customer-1" />);
    fireEvent.change(screen.getByLabelText("Message Kopi Boy"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can send up to 5 messages");
  });

  it("hides raw database errors", async () => {
    db.insertError = { message: "permission denied for table admin_messages" };
    render(<SupportMessageForm userId="customer-1" />);
    fireEvent.change(screen.getByLabelText("Message Kopi Boy"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("couldn't be sent"));
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it("validates empty and over-long messages", () => {
    expect(validateSupportMessage("   ")).toMatchObject({ ok: false });
    expect(validateSupportMessage("x".repeat(501))).toMatchObject({ ok: false, error: expect.stringMatching(/500/) });
    expect(validateSupportMessage("😀".repeat(500))).toMatchObject({ ok: true });
  });
});
