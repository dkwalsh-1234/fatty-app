import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fatty",
    short_name: "Fatty",
    start_url: "/",
    display: "standalone",
    background_color: "#0D2F23",
    theme_color: "#0D2F23",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
