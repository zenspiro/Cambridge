import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;

// Gives `next dev` access to the D1 and R2 bindings (local simulators). Remote bindings stay off:
// Workers AI has no local simulator, and builds (CI, this container) have no Cloudflare login.
// Locally the AI endpoint answers 503 and the agent uses its rules.
initOpenNextCloudflareForDev({ remoteBindings: false });
