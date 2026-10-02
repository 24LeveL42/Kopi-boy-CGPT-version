import { LoadingStatus, Skeleton } from "@/components/Skeleton";

/** Kitchen profile skeleton: back link, name + badges, description, then menu rows. */
export default function MerchantLoading() {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)" }}>
      <LoadingStatus label="Loading menu…" />
      <div className="mx-auto max-w-2xl">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-4 h-8 w-2/3" />
        <div className="mt-2 flex gap-1.5">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-4 w-40" />
        <Skeleton className="mt-4 h-12" />

        <Skeleton className="mt-6 h-6 w-20" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow">
              <div className="flex flex-1 items-center gap-3">
                <Skeleton tone="card" className="h-12 w-12" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton tone="card" className="h-4 w-1/2" />
                  <Skeleton tone="card" className="h-4 w-16" />
                </div>
              </div>
              <Skeleton tone="card" className="h-8 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
