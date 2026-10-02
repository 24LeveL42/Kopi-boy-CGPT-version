import { LoadingStatus, Skeleton } from "@/components/Skeleton";

/** Marketplace skeleton while getLiveMerchants() runs: top bar, logo card, search, categories, then cards. */
export default function MarketplaceLoading() {
  return (
    <div className="min-h-screen pb-28" style={{ background: "var(--kb-navy)" }}>
      <LoadingStatus label="Loading kitchens…" />
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4 sm:max-w-lg sm:px-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-md space-y-4 px-4 py-6 sm:max-w-lg sm:px-6">
        <Skeleton className="h-6 w-44" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <MerchantCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}

function MerchantCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
      <Skeleton tone="card" className="h-40 rounded-none sm:h-44" />
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-2">
          <Skeleton tone="card" className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton tone="card" className="h-4 w-2/3" />
            <Skeleton tone="card" className="h-3 w-1/3" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <Skeleton tone="card" className="h-6 w-24 rounded-full" />
          <Skeleton tone="card" className="h-6 w-24 rounded-full" />
        </div>
      </div>
    </div>
  );
}
