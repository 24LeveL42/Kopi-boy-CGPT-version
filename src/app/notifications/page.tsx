import type { Metadata } from "next";
import { NotificationsInbox } from "@/components/NotificationsInbox";

export const metadata: Metadata = {
  title: "Notifications — Kopi Boy",
};

export default function NotificationsPage() {
  return <NotificationsInbox />;
}
