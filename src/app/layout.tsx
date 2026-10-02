import type { Metadata } from "next";
import { CartProvider } from "@/lib/cart-context";
import { NotificationsProvider } from "@/lib/notifications-context";
import { PageChrome } from "@/components/PageChrome";
import { NotificationToasts } from "@/components/NotificationToasts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kopi Boy — From neighbourhoods to you",
  description:
    "Kopi Boy connects home cooks, hawkers, and small food businesses with customers nearby — zero food-order commission.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <CartProvider>
          <NotificationsProvider>
            <PageChrome />
            <NotificationToasts />
            {children}
          </NotificationsProvider>
        </CartProvider>
      </body>
    </html>
  );
}
