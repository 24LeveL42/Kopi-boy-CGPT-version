"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useIsClient } from "@/lib/use-is-client";
import { Spinner } from "@/components/Spinner";
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
    detectPushState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
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

const STATE_NOTE: Partial<Record<PushState, string>> = {
  unconfigured: "Notifications aren't available yet.",
  unsupported: "This browser can't show notifications.",
  "needs-install": IOS_INSTALL_HINT,
  blocked: "Notifications are blocked for this site. Allow them in your browser's settings, then come back.",
};

/** On/off switch for order notifications, on /account. */
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

  const note = STATE_NOTE[state];
  return (
    <div className="kb-signout-card mt-4" data-testid="push-toggle">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p id="push-toggle-label" className="text-sm font-bold text-slate-800">
            Order notifications
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Get a notification when your order changes.</p>
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
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
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
