"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";

export function SignOutButton() {
  const supabase = createClient();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
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
