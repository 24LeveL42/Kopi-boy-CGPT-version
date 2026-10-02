import { LoadingStatus, Skeleton } from "@/components/Skeleton";

export default function AccountLoading() {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)" }}>
      <LoadingStatus label="Loading your profile…" />
      <div className="mx-auto max-w-sm">
        <Skeleton className="h-7 w-24" />
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-lg">
          <Skeleton tone="card" className="h-4 w-20" />
          <Skeleton tone="card" className="mt-2 h-5 w-48" />
          <Skeleton tone="card" className="mt-5 h-10 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
