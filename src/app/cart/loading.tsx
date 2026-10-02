import { PageSpinner } from "@/components/Spinner";

/** Only the auth check runs server-side here; the cart itself renders from local state, so a spinner is enough. */
export default function CartLoading() {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)" }}>
      <PageSpinner label="Loading your cart…" />
    </div>
  );
}
