"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "./Logo";
import { Spinner } from "./Spinner";

type Step = "enter-phone" | "enter-code";

/**
 * Phone number is collected as an 8-digit local Singapore number and
 * normalized to E.164 (+65XXXXXXXX) before hitting Supabase — that's the
 * format Supabase/Vonage require. Adjust the prefix here if Kopi Boy
 * expands beyond Singapore.
 */
const SG_PREFIX = "+65";

export function LoginForm() {
  const [step, setStep] = useState<Step>("enter-phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Plain state rather than useTransition: signInWithOAuth resolves as soon as
  // it has kicked off the redirect, so a transition would end (re-enabling the
  // button) while the browser is still navigating away to Google.
  const [googleLoading, setGoogleLoading] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  const fullPhone = `${SG_PREFIX}${phone.replace(/\D/g, "")}`;

  async function handleGoogleSignIn() {
    if (googleLoading) return;
    setGoogleLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
    // On success, the browser navigates away to Google — no further action needed here.
  }

  function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    startTransition(async () => {
      const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
      if (error) {
        setError(error.message);
        return;
      }
      setStep("enter-code");
    });
  }

  function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    startTransition(async () => {
      const { error } = await supabase.auth.verifyOtp({ phone: fullPhone, token: code, type: "sms" });
      if (error) {
        setError(error.message);
        return;
      }
      // Inside the transition, so the button stays on "Verifying…" until the home page has loaded.
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6" style={{ background: "var(--kb-navy)" }}>
      <div className="mb-8 flex justify-center">
        <Logo size={56} />
      </div>

      <button
        onClick={handleGoogleSignIn}
        disabled={googleLoading || loading}
        className="flex items-center justify-center gap-3 rounded-2xl bg-white py-3.5 text-[15px] font-semibold shadow-lg disabled:opacity-60"
        style={{ color: "var(--kb-ink)" }}
      >
        {googleLoading ? <Spinner size={18} /> : <GoogleIcon />}
        {googleLoading ? "Redirecting…" : "Continue with Google"}
      </button>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1" style={{ background: "var(--kb-navy-line)" }} />
        <span className="text-xs" style={{ color: "var(--kb-on-navy-soft)" }}>or</span>
        <span className="h-px flex-1" style={{ background: "var(--kb-navy-line)" }} />
      </div>

      {step === "enter-phone" ? (
        <form onSubmit={handleSendCode} className="space-y-3">
          <div
            className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3.5"
            style={{ color: "var(--kb-ink)" }}
          >
            <span className="text-[15px] font-medium" style={{ color: "var(--kb-ink-soft)" }}>
              {SG_PREFIX}
            </span>
            <input
              type="tel"
              inputMode="numeric"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="9123 4567"
              className="w-full bg-transparent text-[15px] outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || googleLoading || phone.length < 8}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
          >
            {loading && <Spinner />}
            {loading ? "Sending code…" : "Send login code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-3">
          <p className="text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
            Enter the 6-digit code we sent to <span style={{ color: "var(--kb-on-navy)" }}>{fullPhone}</span>.
          </p>
          <input
            type="text"
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="w-full rounded-2xl bg-white px-4 py-3.5 text-center text-lg tracking-[0.3em] outline-none"
            style={{ color: "var(--kb-ink)" }}
          />
          <button
            type="submit"
            disabled={loading || googleLoading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
          >
            {loading && <Spinner />}
            {loading ? "Verifying…" : "Verify & continue"}
          </button>
          <button
            type="button"
            onClick={() => setStep("enter-phone")}
            disabled={loading}
            className="w-full text-center text-sm disabled:opacity-60"
            style={{ color: "var(--kb-on-navy-soft)" }}
          >
            Use a different number
          </button>
        </form>
      )}

      {error && (
        <p className="mt-4 rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.15)", color: "#FCA5A5" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
