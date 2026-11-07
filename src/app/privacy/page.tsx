import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy Policy · ${BRAND_NAME}`,
};

export default function PrivacyPage() {
  return <LegalPage doc="privacy" />;
}
