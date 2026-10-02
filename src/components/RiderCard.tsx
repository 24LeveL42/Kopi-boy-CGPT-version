import Image from "next/image";

export interface RiderInfo {
  full_name: string | null;
  photo_url: string | null;
}

/**
 * Riders set their own photo_url, so treat it as untrusted: only render it if
 * it points at this project's public Storage bucket path (the one place
 * next.config.ts lets next/image load from). Anything else — another host, a
 * malformed string — falls back to the initial avatar rather than crashing
 * the page or showing arbitrary external content to a customer.
 */
export function isTrustedPhotoUrl(url: string | null): url is string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !base) return false;
  try {
    const photo = new URL(url);
    return photo.origin === new URL(base).origin && photo.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}

/** "Your rider: {name}" with their photo, shown once a rider has accepted the delivery. */
export function RiderCard({ rider }: { rider: RiderInfo }) {
  const name = rider.full_name?.trim() || null;
  const showPhoto = isTrustedPhotoUrl(rider.photo_url);

  return (
    <div
      data-testid="rider-card"
      className="mx-auto mt-3 flex w-fit max-w-full items-center gap-3 rounded-xl px-3 py-2"
      style={{ background: "var(--kb-cream)" }}
    >
      <div
        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold"
        style={{ background: "var(--kb-green-deep)", color: "white" }}
      >
        {showPhoto ? (
          <Image src={rider.photo_url!} alt={name ? `Photo of ${name}` : "Photo of your rider"} fill sizes="40px" className="object-cover" />
        ) : (
          <span aria-hidden>{name ? name[0].toUpperCase() : "R"}</span>
        )}
      </div>
      <p className="min-w-0 text-left text-sm" style={{ color: "var(--kb-ink)" }}>
        Your rider{name && <>: <span className="font-semibold">{name}</span></>}
      </p>
    </div>
  );
}
