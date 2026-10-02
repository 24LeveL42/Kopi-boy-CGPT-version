import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kopi Boy",
    short_name: "Kopi Boy",
    description: "From neighbourhoods to you — order from home cooks, hawkers and small food businesses nearby.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#7BCF6B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
