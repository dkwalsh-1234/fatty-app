import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // A stray lockfile higher up the tree would otherwise be picked as the root.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Label and meal photos are downscaled to about 1,024 px in the browser, so uploads stay small.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
