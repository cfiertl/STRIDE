import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stride",
    short_name: "Stride",
    description: "Your personal running planner.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#f6f7fb",
    // "any" is stated rather than left to default: an icon with no purpose is
    // eligible for both, so a launcher may mask the unpadded one and shave it.
    // The maskable variant is a genuinely different file (scripts/gen-icons.mjs
    // draws it smaller to survive the adaptive-icon crop), not the same bytes
    // relabelled.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}