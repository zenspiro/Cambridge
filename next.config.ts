import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;

// Gives `next dev` access to the D1 and R2 bindings (local simulators).
initOpenNextCloudflareForDev();
