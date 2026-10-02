import { LoadingStatus, Skeleton } from "@/components/Skeleton";

/** Order history skeleton: a few order rows shaped like the real list. */
export default function OrdersLoading() {
  return (
    <div className="min-h-screen px-4 pb-28 pt-8 sm:px-6" style={{ background: "var(--kb-navy)" }}>
      <LoadingStatus label="Loading your orders…" />
      <div className="mx-auto max-w-sm">
        <Skeleton className="h-7 w-32" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-2xl bg-white p-4 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-1.5">
                  <Skeleton tone="card" className="h-4 w-2/3" />
                  <Skeleton tone="card" className="h-3 w-1/3" />
                </div>
                <Skeleton tone="card" className="h-4 w-12" />
              </div>
              <Skeleton tone="card" className="mt-3 h-5 w-40 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
