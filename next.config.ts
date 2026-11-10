import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    serverActions: {
      // Ticket photos are sent to a server action, whose default limit is
      // 1 MB. A photo may be up to 20 MB (the `photos` bucket's limit); the
      // extra megabyte is for the form around it.
      bodySizeLimit: "21mb",
    },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
