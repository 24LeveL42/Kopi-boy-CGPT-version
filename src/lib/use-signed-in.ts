"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Whether someone is signed in on this browser: true / false, or null while
 * the session is still being read (render neither "Sign in" nor "Sign out"
 * then, so the wrong one never flashes). Follows sign-in / sign-out live,
 * including from another tab.
 */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSignedIn((current) => current ?? !!data.session);
      })
      .catch(() => {
        if (active) setSignedIn((current) => current ?? false);
      });
    // No Supabase calls inside this callback: they can deadlock auth-js's lock.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(!!session);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return signedIn;
}
