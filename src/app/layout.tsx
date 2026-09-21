import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { StoreHydrator } from "@/components/StoreHydrator";

export const metadata: Metadata = {
  title: "Mai Lowtechie",
  description:
    "Trợ lý chief of staff của Mai: giao việc một câu, giữ lịch, tính giờ chuẩn bị + di chuyển, checklist bay.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#FFC93C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        {/* Font qua <link> như prototype — không dùng next/font để build được offline */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <StoreHydrator />
        <div className="shell">
          {children}
          <TabBar />
        </div>
      </body>
    </html>
  );
}
