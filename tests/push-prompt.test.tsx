import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const detectPushState = vi.fn();
const enablePush = vi.fn();

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/push-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/push-client")>();
  return { ...actual, detectPushState: () => detectPushState(), enablePush: () => enablePush() };
});

import { PushPrompt, IOS_INSTALL_HINT } from "@/components/PushNotifications";
import { PUSH_PROMPT_DISMISSED_KEY, isIosBrowserTab } from "@/lib/push-client";

beforeEach(() => {
  localStorage.clear();
  detectPushState.mockReset();
  enablePush.mockReset();
});
afterEach(cleanup);

describe("PushPrompt", () => {
  it("offers to turn notifications on", async () => {
    detectPushState.mockResolvedValue("off");
    render(<PushPrompt />);
    expect(await screen.findByRole("button", { name: "Turn on notifications" })).toBeInTheDocument();
  });

  it("never shows again after 'Not now'", async () => {
    detectPushState.mockResolvedValue("off");
    const { unmount } = render(<PushPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("push-prompt")).not.toBeInTheDocument();
    expect(localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY)).toBe("1");
    unmount();

    render(<PushPrompt />);
    await Promise.resolve();
    expect(screen.queryByTestId("push-prompt")).not.toBeInTheDocument();
  });

  it("stops asking when the browser prompt is declined", async () => {
    detectPushState.mockResolvedValue("off");
    enablePush.mockResolvedValue("blocked");
    render(<PushPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    await vi.waitFor(() => expect(screen.queryByTestId("push-prompt")).not.toBeInTheDocument());
    expect(localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY)).toBe("1");
  });

  it("shows the Home Screen hint on iPhone Safari", async () => {
    detectPushState.mockResolvedValue("needs-install");
    render(<PushPrompt />);
    expect(await screen.findByText(IOS_INSTALL_HINT)).toBeInTheDocument();
    expect(IOS_INSTALL_HINT).toBe("To get notifications on iPhone, tap Share then Add to Home Screen.");
  });

  it("shows nothing when notifications are already on, blocked or unsupported", async () => {
    for (const state of ["on", "blocked", "unsupported", "unconfigured"]) {
      detectPushState.mockResolvedValue(state);
      const { unmount } = render(<PushPrompt />);
      await Promise.resolve();
      expect(screen.queryByTestId("push-prompt")).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("isIosBrowserTab", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  it("is true in an iPhone Safari tab, false once added to the Home Screen", () => {
    expect(isIosBrowserTab(iphone, false)).toBe(true);
    expect(isIosBrowserTab(iphone, true)).toBe(false);
  });
  it("is false on Android", () => {
    expect(isIosBrowserTab("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0 Mobile Safari/537.36", false)).toBe(false);
  });
});
