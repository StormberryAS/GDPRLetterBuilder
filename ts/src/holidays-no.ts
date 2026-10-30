/*! src/holidays-no.js is compiled from ts/src/holidays-no.ts by tools/build-ts.sh, which leaves out
    every comment but this one: the explanations are in the source. Edit the TypeScript, never the
    .js: the build refuses to overwrite a hand edit, and its check mode fails on one. */

// Norwegian public holidays and working days (spec section 5.1).
//
//   * Helligdagsloven (LOV-1995-02-24-12) § 2: all Sundays, 1 January, Maundy Thursday, Good
//     Friday, Easter Sunday, Easter Monday, Ascension Day (the sixth Thursday after Easter
//     Sunday), Whit Sunday (the seventh Sunday after Easter Sunday), Whit Monday, and 25 and 26
//     December [HELLIG § 2].
//   * Lov om 1 og 17 mai som høgtidsdager (LOV-1947-04-26-1) § 1: 1 and 17 May, "jamstelt med
//     søndager" [MAI § 1].
//
// Easter Sunday by the Gregorian computus (the anonymous Gregorian algorithm, also called the
// Meeus/Jones/Butcher algorithm). The statute words Easter astronomically ("første søndag etter
// første fullmåne som inntreffer på eller etter 21. mars"), and the two can differ in rare years;
// Norway's observed dates follow the computus as far as the research found. The unit tests pin
// 2026 to 2040 against a fixed table, which a person still has to check against Almanakk for
// Norge before release (spec section 13).

import { addDays, parseIso, toIso, weekday } from './format.js';

/**
 * Easter Sunday of a year, as YYYY-MM-DD.
 */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

const cache: Map<number, Map<string, string>> = new Map();

/**
 * The named public holidays of a year, as a Map from YYYY-MM-DD to the English name. Sundays are
 * holidays too, but are not listed: isNorwegianHoliday() covers them.
 */
export function norwegianHolidays(year: number): Map<string, string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const list: Array<[string,string]> = [
    [toIso(year, 1, 1), 'New Year\'s Day'],
    [addDays(easter, -3), 'Maundy Thursday'],
    [addDays(easter, -2), 'Good Friday'],
    [easter, 'Easter Sunday'],
    [addDays(easter, 1), 'Easter Monday'],
    [toIso(year, 5, 17), 'Constitution Day'],
    [addDays(easter, 39), 'Ascension Day'],
    [addDays(easter, 49), 'Whit Sunday'],
    [addDays(easter, 50), 'Whit Monday'],
    // After Ascension Day, which can fall on it (2008, 2160): "Ascension Day and 1 May, a public
    // holiday".
    [toIso(year, 5, 1), '1 May, a public holiday'],
    [toIso(year, 12, 25), 'Christmas Day'],
    [toIso(year, 12, 26), 'Boxing Day'],
  ];
  const map: Map<string, string> = new Map();
  // Two can fall on one day (17 May 2027 is also Whit Monday): keep both names.
  for (const [iso, name] of list) map.set(iso, map.has(iso) ? `${map.get(iso)} and ${name}` : name);
  cache.set(year, map);
  return map;
}

/**
 * The holiday's name, or null. Sundays answer 'Sunday'.
 */
export function norwegianHolidayName(iso: string): string | null {
  const { y } = parseIso(iso);
  const named = norwegianHolidays(y).get(iso);
  if (named) return named;
  return weekday(iso) === 0 ? 'Sunday' : null;
}

export function isNorwegianHoliday(iso: string): boolean {
  return norwegianHolidayName(iso) !== null;
}

/**
 * A working day: Monday to Friday, and in Norway not a public holiday. For a company outside
 * Norway only weekends are known here (SCOPE-5): its own holidays are not modelled.
 * @param country 'NO' for Norway; anything else gives weekends only
 */
export function isWorkingDay(iso: string, country?: string): boolean {
  const wd = weekday(iso);
  if (wd === 0 || wd === 6) return false;
  if (country === 'NO') return !isNorwegianHoliday(iso);
  return true;
}

/**
 * Why a day is not a working day, in English, or null when it is one.
 */
export function nonWorkingReason(iso: string, country?: string): string | null {
  const wd = weekday(iso);
  if (country === 'NO') {
    const name = norwegianHolidayName(iso);
    if (name && name !== 'Sunday') return name;
  }
  if (wd === 6) return 'Saturday';
  if (wd === 0) return 'Sunday';
  return null;
}

/**
 * The working day that is n working days after iso (iso itself is not counted).
 */
export function addWorkingDays(iso: string, n: number, country?: string): string {
  let day = iso;
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    if (isWorkingDay(day, country)) left -= 1;
  }
  return day;
}

