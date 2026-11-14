import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type AuthCallback = (event: string, session: unknown) => void;

const auth = vi.hoisted(() => ({
  session: null as unknown,
  getSessionPending: false,
  listeners: [] as AuthCallback[],
  signOut: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () =>
        auth.getSessionPending ? new Promise(() => {}) : Promise.resolve({ data: { session: auth.session } }),
      onAuthStateChange: (cb: AuthCallback) => {
        auth.listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => (auth.listeners = auth.listeners.filter((l) => l !== cb)) } } };
      },
      signOut: auth.signOut,
    },
  }),
}));
vi.mock("@/lib/push-client", () => ({
  removeDeviceSubscription: vi.fn(async () => {
    auth.order.push("removeDeviceSubscription");
  }),
}));
vi.mock("@/lib/notifications-context", () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { TopBar } from "@/components/TopBar";
import { SignOutButton } from "@/components/SignOutButton";

const SESSION = { user: { id: "u1" } };
const replace = vi.fn();
const originalLocation = window.location;

function openMenu() {
  render(<TopBar />);
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
}
const emit = (event: string, session: unknown) => act(() => auth.listeners.forEach((l) => l(event, session)));

beforeEach(() => {
  auth.session = null;
  auth.getSessionPending = false;
  auth.listeners = [];
  auth.order = [];
  auth.signOut.mockReset().mockImplementation(async () => {
    auth.order.push("signOut");
    return { error: null };
  });
  replace.mockReset().mockImplementation(() => auth.order.push("replace"));
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("TopBar menu — Sign in / Sign out", () => {
  it("shows Sign out (and no Sign in) when signed in", async () => {
    auth.session = SESSION;
    openMenu();
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("shows a Sign in link to /login (and no Sign out) when signed out", async () => {
    openMenu();
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("shows neither while the session is still being checked", () => {
    auth.getSessionPending = true;
    openMenu();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("flips live on SIGNED_OUT and SIGNED_IN", async () => {
    auth.session = SESSION;
    openMenu();
    await screen.findByRole("button", { name: "Sign out" });
    emit("SIGNED_OUT", null);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    emit("SIGNED_IN", SESSION);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("closes the menu when Sign in is tapped", async () => {
    openMenu();
    fireEvent.click(await screen.findByRole("link", { name: "Sign in" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SignOutButton", () => {
  it("removes the push subscription, signs out, then hard-replaces to home", async () => {
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(auth.order).toEqual(["removeDeviceSubscription", "signOut", "replace"]);
  });

  it("still goes home when signOut throws", async () => {
    auth.signOut.mockRejectedValue(new Error("network"));
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
