"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useIsClient } from "@/lib/use-is-client";
import { Spinner } from "@/components/Spinner";
import { BRAND_NAME } from "@/lib/brand";
import {
  detectPushState,
  disablePush,
  enablePush,
  promptDismissed,
  setPromptDismissed,
  syncPushSubscription,
  type PushState,
} from "@/lib/push-client";

export const IOS_INSTALL_HINT = "To get notifications on iPhone, tap Share then Add to Home Screen.";

function usePushState() {
  const [state, setState] = useState<PushState>("loading");
  useEffect(() => {
    let alive = true;
    const detect = () =>
      detectPushState()
        .then((s) => alive && setState(s))
        .catch(() => alive && setState("unsupported"));
    detect();
    // Coming back from the browser's settings (e.g. after unblocking): look again.
    const onVisible = () => document.visibilityState === "visible" && detect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return [state, setState] as const;
}

/**
 * "Turn on notifications" card on the order page — so it first appears right
 * after the customer's first order, never on a first visit. Once they say
 * "Not now" (or deny the browser prompt, or dismiss the iPhone hint) it never
 * shows again on this device; the switch on /account is still there.
 */
export function PushPrompt() {
  const isClient = useIsClient();
  const [state, setState] = usePushState();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startEnable] = useTransition();

  if (!isClient || hidden || promptDismissed()) return null;
  if (state !== "off" && state !== "needs-install") return null;

  function dismiss() {
    setPromptDismissed(true);
    setHidden(true);
  }

  function turnOn() {
    setError(null);
    startEnable(async () => {
      try {
        const next = await enablePush(createClient());
        // Anything but "on" means they declined in the browser prompt: don't ask again.
        if (next !== "on") setPromptDismissed(true);
        setState(next);
      } catch {
        setError("Couldn't turn on notifications. Please try again.");
      }
    });
  }

  return (
    <div data-testid="push-prompt" className="mt-4 rounded-xl p-3 text-left" style={{ background: "var(--kb-cream)" }}>
      {state === "needs-install" ? (
        <>
          <p className="text-sm">{IOS_INSTALL_HINT}</p>
          <button type="button" onClick={dismiss} className="mt-2 text-xs font-semibold" style={{ color: "var(--kb-green-deep)" }}>
            Got it
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">Get updates on your order</p>
          <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            We&apos;ll let you know when it&apos;s accepted, paid for and on its way, even with the app closed.
          </p>
          {error && (
            <p className="mt-2 text-xs" style={{ color: "var(--kb-danger)" }}>
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={turnOn} disabled={busy} className="kb-primary-button flex-1 px-3 disabled:opacity-60">
              {busy && <Spinner />}
              Turn on notifications
            </button>
            <button type="button" onClick={dismiss} disabled={busy} className="px-3 text-sm font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export const PUSH_STATUS_TEXT: Record<PushState, string> = {
  loading: "Checking…",
  on: "On. You'll get a notification when your order changes.",
  off: "Off. Switch on to hear about your order even with the app closed.",
  blocked: "Blocked in your browser settings.",
  "needs-install": `Add ${BRAND_NAME} to your Home Screen first.`,
  insecure: `Only available on the secure (https://) ${BRAND_NAME} site.`,
  unsupported: "This browser can't show notifications.",
  unconfigured: `Notifications aren't set up for ${BRAND_NAME} yet. Please check back soon.`,
};

/** Step-by-step help for the states the customer can fix themselves. */
const STATE_HELP: Partial<Record<PushState, string[]>> = {
  blocked: [
    "Android (Chrome): tap the icon to the left of the web address, then Permissions or Site settings, then Notifications, and choose Allow.",
    `If you added ${BRAND_NAME} to your Home Screen: press and hold its icon, tap App info, then Notifications, and switch them on.`,
    `iPhone (Home Screen app): open Settings, then Notifications, then ${BRAND_NAME}, and turn on Allow Notifications.`,
    "Then come back to this page.",
  ],
  "needs-install": [IOS_INSTALL_HINT, `Then open ${BRAND_NAME} from the Home Screen and switch notifications on here.`],
  unsupported: [
    `On iPhone or iPad: open ${BRAND_NAME} in Safari, tap Share, then Add to Home Screen, and open it from there.`,
    `On Android: open ${BRAND_NAME} in Chrome itself, not inside another app such as WhatsApp or Instagram.`,
  ],
};

/** On/off switch for order notifications, on /account/notifications. */
export function PushToggle() {
  const [state, setState] = usePushState();
  const [error, setError] = useState<string | null>(null);
  const [busy, startChange] = useTransition();
  const on = state === "on";
  const usable = state === "on" || state === "off";

  function toggle() {
    setError(null);
    startChange(async () => {
      try {
        const supabase = createClient();
        if (on) {
          setState(await disablePush(supabase));
          // Switching off is a "no": the order-page prompt stays away.
          setPromptDismissed(true);
        } else {
          setState(await enablePush(supabase));
        }
      } catch {
        setError("Couldn't change notifications. Please try again.");
      }
    });
  }

  const help = STATE_HELP[state];
  return (
    <div className="kb-signout-card mt-4" data-testid="push-toggle">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p id="push-toggle-label" className="text-sm font-bold text-slate-800">
            Order notifications
          </p>
          <p data-testid="push-status" data-state={state} className="mt-0.5 text-xs text-slate-500">
            {PUSH_STATUS_TEXT[state]}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="push-toggle-label"
          disabled={!usable || busy}
          onClick={toggle}
          className="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50"
          style={{ background: on ? "var(--kb-green-deep)" : "#D5D9E0" }}
        >
          <span
            aria-hidden
            className="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all"
            style={{ left: on ? "1.5rem" : "0.25rem" }}
          />
        </button>
      </div>
      {help && (
        <ul data-testid="push-help" className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-500">
          {help.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--kb-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Hands this device's existing subscription to whoever signs in, so a shared
 * phone never keeps getting the previous account's order updates. Renders nothing.
 */
export function PushSync() {
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session || (event !== "SIGNED_IN" && event !== "INITIAL_SESSION")) return;
      // Out of the auth callback: awaiting supabase calls inside it can deadlock.
      setTimeout(() => {
        syncPushSubscription(supabase).catch(() => {});
      }, 0);
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
