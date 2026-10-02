/**
 * The rider's proof-of-delivery photo, shown once the delivery is completed.
 * The chat itself closes at that point; this one message stays readable by
 * the customer (Partner app's docs/supabase-messages.sql §7). `photoUrl` is a
 * short-lived signed URL made on the server for this render.
 */
export function ProofOfDeliveryCard({ photoUrl, deliveredAt }: { photoUrl: string; deliveredAt: string | null }) {
  return (
    <div data-testid="proof-of-delivery" className="mt-3 overflow-hidden rounded-xl text-left" style={{ background: "var(--kb-cream)" }}>
      <p className="px-3 pt-2 text-xs font-semibold uppercase" style={{ color: "var(--kb-green-deep)" }}>
        Proof of delivery
      </p>
      {deliveredAt && (
        <p className="px-3 text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
          {deliveredAt}
        </p>
      )}
      <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
        {/* Short-lived signed URL from a private bucket — next/image can't (and shouldn't) cache it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="Photo the rider took on delivery" className="max-h-64 w-full object-cover" />
      </a>
    </div>
  );
}
