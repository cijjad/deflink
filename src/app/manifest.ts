import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DefLink — Global Procurement & Sourcing",
    short_name: "DefLink",
    description: "Tell us what you need. We help you source it.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#0c1a30",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
