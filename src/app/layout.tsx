import type { Metadata } from "next";
import { CartProvider } from "@/lib/cart-context";
import { NotificationsProvider } from "@/lib/notifications-context";
import { PageChrome } from "@/components/PageChrome";
import { NotificationToasts } from "@/components/NotificationToasts";
import { PushSync } from "@/components/PushNotifications";
import "./globals.css";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND_NAME} — From neighbourhoods to you`,
  description:
    `${BRAND_NAME} connects home cooks, hawkers, and small food businesses with customers nearby — zero food-order commission.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <CartProvider>
          <NotificationsProvider>
            <PageChrome />
            <NotificationToasts />
            <PushSync />
            {children}
          </NotificationsProvider>
        </CartProvider>
      </body>
    </html>
  );
}
