import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AddressBook } from "@/components/AddressBook";
import { createAddress, deleteAddress, lookupPostalCode, setDefaultAddress, updateAddress } from "@/lib/address-actions";
import type { SavedAddress } from "@/lib/addresses";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/address-actions", () => ({
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  setDefaultAddress: vi.fn(),
  lookupPostalCode: vi.fn(),
}));

function saved(overrides: Partial<SavedAddress>): SavedAddress {
  return { id: "a1", label: "Home", postal_code: "310123", address_line: "123 LORONG 1 TOA PAYOH", unit: null, notes: null, is_default: false, created_at: "2026-10-01T00:00:00Z", ...overrides };
}

const HOME = saved({ id: "home", unit: "#05-12", notes: "Call when you arrive", is_default: true });
const WORK = saved({ id: "work", label: "Work", postal_code: "018956", address_line: "10 BAYFRONT AVENUE" });

beforeEach(() => {
  refresh.mockReset();
  for (const fn of [createAddress, updateAddress, deleteAddress, setDefaultAddress]) vi.mocked(fn).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(lookupPostalCode).mockReset().mockResolvedValue({ ok: true, address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123" });
});
afterEach(() => cleanup());

describe("My Addresses", () => {
  it("shows a friendly empty state", () => {
    render(<AddressBook addresses={[]} />);
    expect(screen.getByText("No saved addresses yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add an address" })).toBeInTheDocument();
  });

  it("shows each card with label, address, unit, notes and a Default badge", () => {
    render(<AddressBook addresses={[HOME, WORK]} />);
    const [home, work] = screen.getAllByTestId("address-card");
    expect(home).toHaveTextContent("Home");
    expect(home).toHaveTextContent("Default");
    expect(home).toHaveTextContent("#05-12");
    expect(home).toHaveTextContent("Call when you arrive");
    // No "Set as default" on the one that already is.
    expect(within(home).queryByRole("button", { name: "Set as default" })).not.toBeInTheDocument();
    expect(work).not.toHaveTextContent("Default");
  });

  it("switches the default through the server action, then refreshes", async () => {
    render(<AddressBook addresses={[HOME, WORK]} />);
    const work = screen.getAllByTestId("address-card")[1];
    fireEvent.click(within(work).getByRole("button", { name: "Set as default" }));

    await waitFor(() => expect(setDefaultAddress).toHaveBeenCalledWith("work"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("asks for confirmation before deleting", async () => {
    render(<AddressBook addresses={[HOME, WORK]} />);
    const work = screen.getAllByTestId("address-card")[1];
    fireEvent.click(within(work).getByRole("button", { name: "Delete" }));
    expect(deleteAddress).not.toHaveBeenCalled();
    expect(within(work).getByText("Delete this address?")).toBeInTheDocument();

    fireEvent.click(within(work).getByRole("button", { name: "Keep" }));
    expect(within(work).queryByText("Delete this address?")).not.toBeInTheDocument();

    fireEvent.click(within(work).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(work).getByRole("button", { name: /Yes, delete/ }));
    await waitFor(() => expect(deleteAddress).toHaveBeenCalledWith("work"));
  });

  it("says when the address book is full instead of offering Add", () => {
    const five = Array.from({ length: 5 }, (_, i) => saved({ id: `a${i}`, is_default: i === 0 }));
    render(<AddressBook addresses={five} />);
    expect(screen.queryByRole("button", { name: /Add a new address/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("address-limit")).toHaveTextContent("You can save up to 5 addresses");
  });

  it("adds an address: Check postal code shows Found, then saves", async () => {
    render(<AddressBook addresses={[HOME]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a new address" }));
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "310123" } });
    fireEvent.click(screen.getByRole("button", { name: "Check postal code" }));
    expect(await screen.findByText("Found: 123 LORONG 1 TOA PAYOH SINGAPORE 310123")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Unit/), { target: { value: "#02-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(createAddress).toHaveBeenCalledWith({ label: "Work", postalCode: "310123", unit: "#02-01", notes: "" }));
  });

  it("shows the server's message when saving fails", async () => {
    vi.mocked(createAddress).mockResolvedValue({ ok: false, message: "You can save up to 5 addresses. Delete one to add another." });
    render(<AddressBook addresses={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add an address" }));
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "310123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can save up to 5 addresses.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("edits an existing address with its values prefilled", async () => {
    render(<AddressBook addresses={[HOME]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Postal code")).toHaveValue("310123");
    expect(screen.getByLabelText(/^Unit/)).toHaveValue("#05-12");
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() =>
      expect(updateAddress).toHaveBeenCalledWith("home", { label: "Home", postalCode: "310123", unit: "#05-12", notes: "Call when you arrive" })
    );
  });
});
