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

// Runs before first paint so there is no flash: saved choice, else the device's preference.
const THEME_SCRIPT = `try{var t=localStorage.getItem("tally.theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;if(t==="dark"){var m=document.querySelector('meta[name="theme-color"]');m&&m.setAttribute("content","#181d1a")}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
