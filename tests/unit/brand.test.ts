// Brand settings (owner, 5 Nov 2026): name, wording, default theme and pictures come from /admin/brand.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brandDefaults, checkBrandText, findBrandImage, footerText, frameBrand, getBrand, imageType, readBrand,
  removeBrandImage, saveBrandImage, saveBrandText,
} from "../../src/lib/brand.ts";
import { BRAND } from "../../src/lib/config.ts";
import { testBucket, testDb } from "./helpers/d1.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const PNG2 = new Uint8Array([...PNG, 9]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');

test("text fields: needed, one line, length limits, a real theme", () => {
  const ok = checkBrandText({ name: "  Prep  Hub ", shortName: "Prep", description: "", footer: "{name} is independent.", defaultTheme: "b" });
  assert.deepEqual(ok, { name: "Prep Hub", shortName: "Prep", description: "", footer: "{name} is independent.", defaultTheme: "b" });
  const base = { name: "A", shortName: "A", description: "", footer: "", defaultTheme: "a" };
  assert.equal(checkBrandText({ ...base, name: "" }), null);
  assert.equal(checkBrandText({ ...base, shortName: "x".repeat(BRAND.maxShortNameLength + 1) }), null);
  assert.equal(checkBrandText({ ...base, defaultTheme: "z" }), null);
  assert.equal(checkBrandText({ ...base, footer: "bad\u0007bell" }), null);
  assert.equal(checkBrandText({ ...base, footer: "two\nlines" })?.footer, "two lines");
});

test("a damaged stored value falls back part by part; the footer fills in the name", () => {
  const b = readBrand({ name: "Prep Hub", shortName: "", images: { logo: { file: "../x.png", type: "image/png", bytes: 3 } } }, "Fallback");
  assert.equal(b.name, "Fallback"); // the whole text set is checked together, so a bad short name keeps the defaults
  assert.deepEqual(b.images, {});
  assert.deepEqual(readBrand("nonsense", "Fallback"), brandDefaults("Fallback"));
  assert.match(footerText(brandDefaults("Prep Hub")), /^Prep Hub is independent/);
});

test("pictures are recognised by their bytes; SVG and anything else is refused", () => {
  assert.equal(imageType(PNG)?.type, "image/png");
  assert.equal(imageType(JPG)?.type, "image/jpeg");
  assert.equal(imageType(WEBP)?.type, "image/webp");
  assert.equal(imageType(SVG), null);
  assert.equal(imageType(new Uint8Array(4)), null);
});

test("upload, replace and remove a picture; only the current file is served", async () => {
  const db = testDb();
  const bucket = testBucket();
  assert.equal(await saveBrandImage(db, bucket, "logo", SVG, "F", "platform-admin"), "bad_type");
  assert.equal(await saveBrandImage(db, bucket, "logo", new Uint8Array(BRAND.maxImageBytes + 1), "F", "platform-admin"), "too_big");
  assert.equal(await saveBrandImage(db, bucket, "logo", PNG, "F", "platform-admin"), "ok_image");
  const first = (await getBrand(db, "F")).images.logo!;
  assert.match(first.file, /^logo-[0-9a-f]{16}\.png$/);
  assert.equal(bucket.objects.size, 1);
  assert.equal(await saveBrandImage(db, bucket, "logo", PNG2, "F", "platform-admin"), "ok_image");
  const b = await getBrand(db, "F");
  assert.notEqual(b.images.logo!.file, first.file);
  assert.equal(bucket.objects.size, 1, "the old file is deleted");
  assert.equal(findBrandImage(b, first.file), null);
  assert.equal(findBrandImage(b, b.images.logo!.file)?.type, "image/png");
  assert.equal(findBrandImage(b, "../../etc/passwd"), null);
  assert.equal(frameBrand(b).logoUrl, `/brand/${b.images.logo!.file}`);
  await removeBrandImage(db, bucket, "logo", "F", "platform-admin");
  assert.deepEqual((await getBrand(db, "F")).images, {});
  assert.equal(bucket.objects.size, 0);
  const audits = db.raw.prepare("SELECT action FROM audit_log WHERE entity_id = 'brand' ORDER BY rowid").all() as { action: string }[];
  assert.deepEqual(audits.map((a) => a.action), ["brand.logo", "brand.logo", "brand.logo.remove"]);
});

test("saving the wording keeps the pictures", async () => {
  const db = testDb();
  const bucket = testBucket();
  await saveBrandImage(db, bucket, "favicon", JPG, "F", "platform-admin");
  await saveBrandText(db, { name: "Prep Hub", shortName: "Prep", description: "d", footer: "f", defaultTheme: "c" }, "F", "platform-admin");
  const b = await getBrand(db, "F");
  assert.equal(b.name, "Prep Hub");
  assert.equal(b.defaultTheme, "c");
  assert.equal(b.images.favicon?.type, "image/jpeg");
});
