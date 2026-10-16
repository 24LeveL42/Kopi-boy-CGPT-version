import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser side of order-update Web Push (same shape as the Partner app's
 * push-client). Subscriptions are saved to public.customer_push_subscriptions
 * through the register_customer_push_subscription RPC
 * (docs/supabase-customer-push.sql).
 */

export type PushState =
  | "loading"
  | "unconfigured" // no VAPID public key in this build
  | "unsupported" // browser can't do Web Push
  | "needs-install" // iPhone/iPad Safari tab: push only works once added to the Home Screen
  | "blocked" // the browser permission was denied
  | "off"
  | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** Set once the customer says "Not now" (or dismisses the iPhone hint): the prompt never shows again. */
export const PUSH_PROMPT_DISMISSED_KEY = "kb-push-prompt-dismissed";

function urlBase64ToUint8Array(base64: string) {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushApisPresent() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iPhone/iPad Safari not running from the Home Screen, where Web Push isn't available. */
export function isIosBrowserTab(userAgent: string, standalone: boolean) {
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const ios = /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  return ios && !standalone;
}

function runningStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function promptDismissed(): boolean {
  try {
    return localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPromptDismissed(dismissed: boolean) {
  try {
    if (dismissed) localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "1");
    else localStorage.removeItem(PUSH_PROMPT_DISMISSED_KEY);
  } catch {
    // private mode etc. — worst case the prompt can show again
  }
}

async function registerServiceWorker() {
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("Service worker registration failed:", err);
    return null;
  }
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function saveSubscription(supabase: SupabaseClient, sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await supabase.rpc("register_customer_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw error;
}

async function deleteSubscriptionRow(supabase: SupabaseClient, endpoint: string) {
  // RLS limits this to the caller's own rows.
  await supabase.from("customer_push_subscriptions").delete().eq("endpoint", endpoint);
}

/** What the notifications switch / prompt should show right now. */
export async function detectPushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (!pushApisPresent()) return isIosBrowserTab(navigator.userAgent, runningStandalone()) ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "granted" && (await currentSubscription())) return "on";
  return "off";
}

/** Must run from a tap: browsers reject permission prompts that aren't user-initiated. */
export async function enablePush(supabase: SupabaseClient): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (!pushApisPresent()) return isIosBrowserTab(navigator.userAgent, runningStandalone()) ? "needs-install" : "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));
  await saveSubscription(supabase, sub);
  return "on";
}

export async function disablePush(supabase: SupabaseClient): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await deleteSubscriptionRow(supabase, sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}

/**
 * On sign-in: if this browser already has push on, (re)assign its
 * subscription to whoever is signed in now, so a shared phone never keeps
 * getting the previous account's order updates.
 */
export async function syncPushSubscription(supabase: SupabaseClient) {
  if (!VAPID_PUBLIC_KEY || !pushApisPresent() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await saveSubscription(supabase, sub);
}

/** On sign-out (while still signed in): stop this device getting the account's updates. */
export async function removeDeviceSubscription(supabase: SupabaseClient) {
  try {
    if (!pushApisPresent()) return;
    const sub = await currentSubscription();
    if (sub) await deleteSubscriptionRow(supabase, sub.endpoint);
  } catch {
    // best effort — sign-out must never be blocked by this
  }
}
