import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tally", template: "%s · Tally" },
  description: "Personal expenses, income and education loan.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#24563f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
