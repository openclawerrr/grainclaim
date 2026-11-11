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
  // The server reads this file from disk when the farmer adds his FSA map
  // (lib/fields/nearby-outlines.ts). A hosted deploy such as Vercel ships
  // only the files each route is traced to need, so the file is named here
  // and doesn't depend on the build working the path out from the code.
  // "/*" is every route: the file is 13 KB.
  outputFileTracingIncludes: {
    "/*": ["./sample-data/nearby-outlines.geojson"],
  },
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
