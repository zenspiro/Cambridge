// Countries for pickers (ISO 3166-1 alpha-2). Names come from the platform's own Intl data, so nothing is translated
// or typed by hand here. No imports beyond config (unit tested).
import { CONSENT } from "./config.ts";

const CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

const SET = new Set(CODES);
export const isCountry = (c: unknown): c is string => typeof c === "string" && SET.has(c);

let names: Intl.DisplayNames | null = null;
/** "Pakistan" for "PK". */
export function countryName(code: string): string {
  names ??= new Intl.DisplayNames(["en"], { type: "region" });
  return names.of(code) ?? code;
}

/** Launch markets first, then every other country by name. */
export function countryOptions(): { code: string; name: string }[] {
  const top = CONSENT.topCountries.map((c) => ({ code: c as string, name: countryName(c) }));
  const rest = CODES.filter((c) => !(CONSENT.topCountries as readonly string[]).includes(c))
    .map((c) => ({ code: c, name: countryName(c) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return [...top, ...rest];
}
