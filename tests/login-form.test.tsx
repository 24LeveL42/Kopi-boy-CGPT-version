import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const signInWithOAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithOAuth } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/login", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { LoginForm, AUTH_FAILED_MESSAGE, IN_APP_BROWSER_TIP, isInAppBrowser } from "@/components/LoginForm";
import LoginPage from "@/app/login/page";

const CHROME_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const INSTAGRAM_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_0; en_SG)";
const FACEBOOK_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]";

let userAgent = CHROME_UA;
const uaSpy = vi.spyOn(window.navigator, "userAgent", "get");

const pageProps = (searchParams: Record<string, string>) =>
  ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }) as PageProps<"/login">;

function openCard(ui = <LoginForm />) {
  render(ui);
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

beforeEach(() => {
  userAgent = CHROME_UA;
  uaSpy.mockImplementation(() => userAgent);
  signInWithOAuth.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe("Login — Google only", () => {
  it("shows Continue with Google and nothing of the old phone sign-in", () => {
    openCard();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByText(/Sign in with your Google account/)).toBeInTheDocument();
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("+65")).toBeNull();
    expect(screen.queryByText("OR")).toBeNull();
    expect(screen.queryByText(/Continue with phone|6-digit|Verify & continue|different number/)).toBeNull();
  });

  it("starts Google sign-in back through /auth/callback and shows Redirecting…", async () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {}));
    openCard();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    expect(await screen.findByRole("button", { name: /Redirecting…/ })).toBeDisabled();
  });

  it("shows a Google error and lets the customer try again", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "Provider is not enabled" } });
    openCard();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider is not enabled");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });
});

describe("Login — in-app browser tip", () => {
  it.each([
    ["Instagram", INSTAGRAM_UA, true],
    ["Facebook", FACEBOOK_UA, true],
    ["Chrome", CHROME_UA, false],
    ["Safari", SAFARI_UA, false],
  ])("detects %s correctly", (_name, ua, expected) => {
    expect(isInAppBrowser(ua)).toBe(expected);
  });

  it("shows the tip inside Instagram, below a still-working Google button", async () => {
    userAgent = INSTAGRAM_UA;
    openCard();
    const tip = await screen.findByRole("note");
    expect(tip).toHaveTextContent(IN_APP_BROWSER_TIP);
    const google = screen.getByRole("button", { name: "Continue with Google" });
    expect(google).toBeEnabled();
    expect(google.compareDocumentPosition(tip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(google);
    expect(signInWithOAuth).toHaveBeenCalled();
  });

  it("shows the tip inside Facebook", async () => {
    userAgent = FACEBOOK_UA;
    openCard();
    expect(await screen.findByRole("note")).toHaveTextContent(IN_APP_BROWSER_TIP);
  });

  it.each([["Chrome", CHROME_UA], ["Safari", SAFARI_UA]])("does not show the tip in %s", async (_name, ua) => {
    userAgent = ua;
    openCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument());
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/Opened from Facebook or Instagram/)).toBeNull();
  });
});

describe("Login — ?error=auth-failed", () => {
  it("opens straight on the sign-in card with the message", async () => {
    render(await LoginPage(pageProps({ error: "auth-failed" })));
    expect(screen.getByRole("alert")).toHaveTextContent(AUTH_FAILED_MESSAGE);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("clears the message when Google is tapped again", () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {}));
    render(<LoginForm authFailed />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([[{}], [{ error: "something-else" }]])("shows no message and the welcome screen for %o", async (params) => {
    render(await LoginPage(pageProps(params)));
    expect(screen.queryByText(AUTH_FAILED_MESSAGE)).toBeNull();
    expect(screen.getByRole("button", { name: "Get Started" })).toBeInTheDocument();
  });
});

describe("Phone OTP is gone from the source", () => {
  const root = process.cwd();
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("no src file calls signInWithOtp / verifyOtp or uses an sms OTP", () => {
    for (const file of files(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/signInWithOtp|verifyOtp|type:\s*"sms"/);
    }
  });

  it("globals.css has no phone or code input styles", () => {
    const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
    expect(css).not.toMatch(/kb-phone-input|kb-code-input/);
  });

  it("postal-code 6-digit checks are still there", () => {
    expect(readFileSync(path.join(root, "src/lib/addresses.ts"), "utf8")).toContain("Enter a 6-digit postal code.");
    expect(readFileSync(path.join(root, "src/lib/order-actions.ts"), "utf8")).toContain("Enter a 6-digit delivery postal code.");
  });
});
