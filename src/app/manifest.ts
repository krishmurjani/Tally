import type { MetadataRoute } from "next";

/** Installable PWA (no offline sync). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tally",
    short_name: "Tally",
    description: "Personal expenses, income and education loan.",
    start_url: "/expenses",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f5ef",
    theme_color: "#24563f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
