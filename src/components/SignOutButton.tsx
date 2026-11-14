"use client";

import { useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";
import { removeDeviceSubscription } from "@/lib/push-client";

export function SignOutButton() {
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      try {
        // While still signed in: RLS only lets the owner delete the subscription.
        await removeDeviceSubscription(supabase);
        await supabase.auth.signOut();
      } catch {
        // signOut removes the local session even when the server call fails;
        // go home regardless rather than leave the button stuck.
      }
      // A full load of home (not router.push): it drops the router's cached
      // signed-in pages and all in-memory state, and replace() takes the
      // signed-in page out of history so Back can't return to it.
      window.location.replace("/");
    });
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={isPending}
      className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
      style={{ background: "var(--kb-cream)", color: "var(--kb-ink)" }}
    >
      {isPending && <Spinner />}
      {isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}
