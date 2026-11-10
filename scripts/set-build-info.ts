// CI only, at deploy: writes the commit being deployed and the time into wrangler.jsonc's vars, so admin Home and
// /health can say which version is live (review, 10 Nov 2026: "is my fix live" should never need guessing).
import { readFileSync, writeFileSync } from "node:fs";

const sha = process.env.GITHUB_SHA ?? "";
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error("set-build-info: GITHUB_SHA is not a commit id");
  process.exit(1);
}
const file = "wrangler.jsonc";
const text = readFileSync(file, "utf8");
const out = text.replace('"BUILD_COMMIT": ""', `"BUILD_COMMIT": "${sha}"`).replace('"BUILD_AT": ""', `"BUILD_AT": "${new Date().toISOString()}"`);
if (out === text) {
  console.error("set-build-info: BUILD_COMMIT and BUILD_AT placeholders not found in wrangler.jsonc");
  process.exit(1);
}
writeFileSync(file, out);
console.log(`set-build-info: ${sha.slice(0, 7)}`);
