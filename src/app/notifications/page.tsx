import type { Metadata } from "next";
import { NotificationsInbox } from "@/components/NotificationsInbox";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Notifications — ${BRAND_NAME}`,
};

export default function NotificationsPage() {
  return <NotificationsInbox />;
}
