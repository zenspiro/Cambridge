# Fonts

The student and parent themes use our own copies of five open-source fonts, served from `public/fonts/` (latin
subset, variable weight, woff2). No outside font host is used (owner decision 5 Nov 2026: faster in Pakistan, no
third party). All five are under the SIL Open Font License 1.1, which allows bundling and serving them.

| File | Font | Theme | Source (Google Fonts) | SHA-384 |
|---|---|---|---|---|
| `inter-v20-latin.woff2` | Inter | Bold (body) | fonts.gstatic.com/s/inter/v20 | `974aa5ed0d73aaf5f992501547062370c542902c60e5d31376086c2250b7a58917eb0c041deae1d9b3ffe3201aa37226` |
| `spacegrotesk-v22-latin.woff2` | Space Grotesk | Bold (headings) | fonts.gstatic.com/s/spacegrotesk/v22 | `6c5c829d098feddcdd7339ae691851bbd5542dfb2a88cb45b221efeff141709223175c8e5a935e74e3b602f5c5d117c4` |
| `baloo2-v23-latin.woff2` | Baloo 2 | Playful (headings) | fonts.gstatic.com/s/baloo2/v23 | `25cec542451ca4ae073425be370b912067f3ec5b13646df81fe76a49bf42c4280b60b63dec62c0bba335fd84c20aef42` |
| `nunito-v32-latin.woff2` | Nunito | Playful (body) | fonts.gstatic.com/s/nunito/v32 | `4d67773c7e041a7a21aa48b61030695d23185de1f5d7b27b53d058e74a4bff87f81af036ac17e2256bf7b3548a648b2f` |
| `dmsans-v17-latin.woff2` | DM Sans | Clean (all) | fonts.gstatic.com/s/dmsans/v17 | `a5e1cf6fa26f7d674c2d6fcf11842af52d86077d2a2824615bab12f203985f405633402cab2cffb8a5878c6d20ae9426` |

The version is in the file name, so `/fonts/*` is cached for a year (`public/_headers`). To update a font, add the new
file under a new name, change its `@font-face` in `src/app/globals.css`, update this table, and remove the old file.
