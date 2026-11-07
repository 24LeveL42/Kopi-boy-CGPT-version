import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Terms of Use · ${BRAND_NAME}`,
};

export default function TermsPage() {
  return <LegalPage doc="terms" />;
}
