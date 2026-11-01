import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is rendered per request (nonce CSP), so no incremental cache is needed.
export default defineCloudflareConfig();
