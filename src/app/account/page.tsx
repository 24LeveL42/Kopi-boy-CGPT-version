import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)", color: "var(--kb-on-navy)" }}>
      <div className="mx-auto max-w-sm">
        <h1 className="font-display text-xl font-bold">Profile</h1>

        {user ? (
          <div className="mt-6 rounded-2xl bg-white p-5 shadow-lg" style={{ color: "var(--kb-ink)" }}>
            <p className="text-sm" style={{ color: "var(--kb-ink-soft)" }}>Signed in as</p>
            <p className="mt-1 font-semibold">{user.email}</p>
            <div className="mt-5">
              <SignOutButton />
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl bg-white p-5 text-center shadow-lg" style={{ color: "var(--kb-ink)" }}>
            <p style={{ color: "var(--kb-ink-soft)" }}>You&apos;re not signed in yet.</p>
            <Link
              href="/login"
              className="mt-4 inline-block w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
