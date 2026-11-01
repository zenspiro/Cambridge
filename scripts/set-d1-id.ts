// CI only: looks up the D1 database id by name and writes it into wrangler.jsonc,
// so the id never has to be typed in by hand. Needs CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID in the environment (GitHub secrets).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME = "cambridge";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const raw = execFileSync("npx", ["wrangler", "d1", "list", "--json"], { encoding: "utf8" });
const list = JSON.parse(raw) as Array<{ name?: string; uuid?: string }>;
const db = list.find((d) => d.name === NAME);
if (!db?.uuid || !UUID.test(db.uuid)) {
  console.error(`set-d1-id: no D1 database named "${NAME}" in this account`);
  process.exit(1);
}
const file = "wrangler.jsonc";
const text = readFileSync(file, "utf8");
if (!text.includes(PLACEHOLDER)) {
  console.error("set-d1-id: placeholder id not found in wrangler.jsonc");
  process.exit(1);
}
writeFileSync(file, text.replace(PLACEHOLDER, db.uuid));
console.log(`set-d1-id: D1 "${NAME}" found`);
