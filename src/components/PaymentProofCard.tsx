"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { orderChatPhotoPath } from "@/lib/messages";
import { useIsClient } from "@/lib/use-is-client";
import { Spinner } from "@/components/Spinner";
import {
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_TYPES,
  formatCountdown,
  paymentTimeLeftMs,
  preparePaymentProof,
  shortOrderId,
  type PaymentProofState,
} from "@/lib/payment-proof";

const ORANGE = "#F97316";

/**
 * Pay-and-upload card on the order page (see src/lib/payment-proof.ts). The
 * page re-renders with the new state via OrderRealtimeRefresher when the cook
 * confirms or rejects; after our own upload we refresh straight away.
 */
export function PaymentProofCard({
  orderId,
  userId,
  state,
  paynowLine,
  amount,
  decidedAt,
  proofUrl,
}: {
  orderId: string;
  userId: string;
  state: PaymentProofState;
  /** e.g. "Pay via PayNow to UEN 123" — the existing PayNow display. */
  paynowLine: string;
  amount: number;
  decidedAt: string | null;
  /** Signed URL of the uploaded screenshot (state "sent"). */
  proofUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pickFile() {
    inputRef.current?.click();
  }

  function handlePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!picked || busy) return;
    setError(null);
    startUpload(async () => {
      const prepared = await preparePaymentProof(picked);
      if ("error" in prepared) {
        setError(prepared.error);
        return;
      }
      const { file } = prepared;
      const supabase = createClient();
      const path = orderChatPhotoPath(orderId, userId, file.name, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setError(`Couldn't upload your screenshot: ${uploadError.message}. Please try again.`);
        return;
      }
      const { error: rpcError } = await supabase.rpc("submit_payment_proof", { p_order_id: orderId, p_path: path });
      if (rpcError) {
        setError(`Your screenshot uploaded but couldn't be sent to the cook: ${rpcError.message}. Please try again.`);
        return;
      }
      router.refresh();
    });
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={PAYMENT_PROOF_TYPES.join(",")}
      onChange={handlePicked}
      className="hidden"
      data-testid="payment-proof-input"
    />
  );

  const uploadButton = (
    <button
      type="button"
      onClick={pickFile}
      disabled={busy}
      className="mt-2 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold text-white disabled:opacity-60"
      style={{ background: `linear-gradient(100deg, var(--kb-purple) 0%, ${ORANGE} 100%)` }}
    >
      {busy && <Spinner size={18} />}
      {busy ? "Uploading…" : "Upload proof of payment"}
    </button>
  );

  const errorLine = error && (
    <p role="alert" className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.12)", color: "var(--kb-danger)" }}>
      {error}
    </p>
  );

  if (state === "paid") {
    return (
      <p
        data-testid="payment-proof-card"
        data-state="paid"
        className="mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold"
        style={{ background: "rgba(4,120,87,0.12)", color: "var(--kb-green-deep)" }}
      >
        Payment confirmed ✓
      </p>
    );
  }

  if (state === "sent") {
    return (
      <div
        data-testid="payment-proof-card"
        data-state="sent"
        className="mt-4 rounded-2xl border-2 p-4 text-left"
        style={{ borderColor: "var(--kb-green)", background: "var(--kb-green-soft)" }}
      >
        <p className="font-bold" style={{ color: "var(--kb-green-deep)" }}>
          Proof sent ✓ Waiting for the cook to confirm your payment
        </p>
        {proofUrl && (
          <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="mt-3 block w-24">
            {/* Short-lived signed URL from a private bucket — next/image can't (and shouldn't) cache it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proofUrl} alt="Your proof of payment" className="h-24 w-24 rounded-xl border object-cover" />
          </a>
        )}
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold underline disabled:opacity-60"
          style={{ color: "var(--kb-green-deep)" }}
        >
          {busy && <Spinner />}
          {busy ? "Uploading…" : "Replace screenshot"}
        </button>
        {errorLine}
        {fileInput}
      </div>
    );
  }

  if (state === "rejected") {
    return (
      <div
        data-testid="payment-proof-card"
        data-state="rejected"
        className="mt-4 rounded-2xl border-2 p-4 text-left"
        style={{ borderColor: "var(--kb-danger)", background: "rgba(239,68,68,0.08)" }}
      >
        <p className="font-bold" style={{ color: "var(--kb-danger)" }}>
          The cook couldn&apos;t find your payment. Please check your PayNow and upload your proof again
        </p>
        <p className="mt-2 text-sm">
          {paynowLine} · <span className="font-semibold">${amount.toFixed(2)}</span> · order #{shortOrderId(orderId)}
        </p>
        {uploadButton}
        {errorLine}
        {fileInput}
      </div>
    );
  }

  return (
    <div
      data-testid="payment-proof-card"
      data-state="pay"
      className="mt-4 overflow-hidden rounded-2xl border-2 text-left"
      style={{ borderColor: ORANGE, background: "var(--kb-white)" }}
    >
      <p
        className="px-4 py-3 text-base font-bold text-white"
        style={{ background: `linear-gradient(100deg, var(--kb-purple) 0%, ${ORANGE} 100%)` }}
      >
        Action needed: pay and send proof of payment
      </p>
      <div className="p-4">
        <PayCountdown decidedAt={decidedAt} />
        <ol className="space-y-4">
          <Step n={1} title="Pay via PayNow">
            <p className="font-semibold">{paynowLine}</p>
            <p className="mt-1">
              Amount to pay: <span className="text-lg font-bold" data-testid="payment-amount">${amount.toFixed(2)}</span>
            </p>
            <p className="mt-1">Put order #{shortOrderId(orderId)} in the PayNow comment.</p>
          </Step>
          <Step n={2} title="Upload your proof of payment">
            <p>Take a screenshot of your PayNow success screen and upload it here. You can crop out your account number.</p>
            {uploadButton}
            {errorLine}
            {fileInput}
          </Step>
          <Step n={3} title="Wait for the cook to confirm">
            <p>The cook starts cooking once they&apos;ve checked the payment.</p>
          </Step>
        </ol>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ background: "var(--kb-purple)" }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 text-sm" style={{ color: "var(--kb-ink)" }}>
        <p className="font-bold">{title}</p>
        <div className="mt-1" style={{ color: "var(--kb-ink-soft)" }}>
          {children}
        </div>
      </div>
    </li>
  );
}

/** Display only: counts down 15 min from decided_at. Rendered client-side only, so server and client never disagree on the seconds. */
function PayCountdown({ decidedAt }: { decidedAt: string | null }) {
  const isClient = useIsClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const left = paymentTimeLeftMs(decidedAt, now);
  if (!isClient || left === null) return null;
  if (left <= 0) {
    return (
      <p data-testid="payment-countdown" className="mb-3 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "rgba(239,68,68,0.12)", color: "var(--kb-danger)" }}>
        Payment window has passed. Please contact the cook.
      </p>
    );
  }
  return (
    <p data-testid="payment-countdown" className="mb-3 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "rgba(245,158,11,0.15)", color: "#92640A" }}>
      Pay within <span className="font-mono text-base">{formatCountdown(left)}</span>
    </p>
  );
}
