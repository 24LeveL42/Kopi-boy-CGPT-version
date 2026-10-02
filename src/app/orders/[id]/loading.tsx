import { LoadingStatus, Skeleton } from "@/components/Skeleton";

/** Order detail skeleton: the white status card with header icon, progress bar, stage pill and items. */
export default function OrderLoading() {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)" }}>
      <LoadingStatus label="Loading your order…" />
      <div className="mx-auto max-w-sm">
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <Skeleton tone="card" className="mx-auto h-14 w-14 rounded-full" />
          <Skeleton tone="card" className="mx-auto mt-4 h-6 w-40" />
          <Skeleton tone="card" className="mx-auto mt-2 h-4 w-52" />
          <Skeleton tone="card" className="mt-6 h-2 rounded-full" />
          <Skeleton tone="card" className="mx-auto mt-4 h-6 w-56 rounded-full" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton tone="card" className="h-4 w-32" />
                <Skeleton tone="card" className="h-4 w-12" />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-between border-t pt-3" style={{ borderColor: "var(--kb-cream)" }}>
            <Skeleton tone="card" className="h-5 w-12" />
            <Skeleton tone="card" className="h-5 w-16" />
          </div>
          <Skeleton tone="card" className="mt-5 h-10 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
