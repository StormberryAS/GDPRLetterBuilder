/*! src/format.js is compiled from ts/src/format.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */

// Dates in the forms the letters and the page show, and the neutral file names (spec sections
// 3.6, 6 and 11). Pure functions: no Date.now(), no locale lookups, so Node and every browser give
// the same text. Dates travel as ISO strings, YYYY-MM-DD, and are worked on in UTC so that a time
// zone or a daylight-saving change can never move a day.

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const MONTHS_NB = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august',
  'september', 'oktober', 'november', 'desember'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_NB = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a real calendar date written YYYY-MM-DD (years 1900 to 2199).
 * @param text anything: a field's value, undefined or null (only a string can pass, short
 *   of an object whose toString() writes a date, which nothing here passes)
 */
export function isIsoDate(text: unknown): text is string {
  const m = ISO_RE.exec(String(text || ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2199 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/**
 * { y, m, d } from YYYY-MM-DD; throws on anything else.
 */
export function parseIso(text: string): { y: number; m: number; d: number; } {
  if (!isIsoDate(text)) throw new RangeError(`not a date: ${text}`);
  // isIsoDate has just matched the same expression.
  const m = ISO_RE.exec(text) as RegExpExecArray;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number, w: number = 2) => String(n).padStart(w, '0');

/**
 * YYYY-MM-DD from year, month (1 to 12) and day.
 */
export function toIso(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/**
 * Days in a month of the Gregorian calendar (month 1 to 12).
 */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The ISO date n days after (or before, for negative n) the one given.
 */
export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseIso(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Day of the week, 0 for Sunday to 6 for Saturday.
 */
export function weekday(iso: string): number {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Compares two ISO dates as text, which orders them correctly.
 */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * "12 October 2026"
 */
export function dateEn(iso: string): string {
  const { y, m, d } = parseIso(iso);
  return `${d} ${MONTHS_EN[m - 1]} ${y}`;
}

/**
 * "Tuesday 7 April 2026"
 */
export function longDateEn(iso: string): string {
  return `${DAYS_EN[weekday(iso)]} ${dateEn(iso)}`;
}

/**
 * "12. oktober 2026"
 */
export function dateNb(iso: string): string {
  const { y, m, d } = parseIso(iso);
  return `${d}. ${MONTHS_NB[m - 1]} ${y}`;
}

/**
 * "tirsdag 7. april 2026"
 */
export function longDateNb(iso: string): string {
  return `${DAYS_NB[weekday(iso)]} ${dateNb(iso)}`;
}

/**
 * "5 April", the day and month only, for the deadline explanation.
 */
export function dayMonthEn(iso: string): string {
  const { m, d } = parseIso(iso);
  return `${d} ${MONTHS_EN[m - 1]}`;
}

export function weekdayEn(iso: string): string {
  return DAYS_EN[weekday(iso)]!;
}

/**
 * A date for a letter in its own language.
 * @param lang 'nb' for Bokmål; anything else gives English
 */
export function letterDate(iso: string, lang: string): string {
  return lang === 'nb' ? dateNb(iso) : dateEn(iso);
}

/**
 * Neutral file names (OUT-2): the kind of request and the date, never the company's name, which
 * would show in download lists and backups.
 * @param kind 'erasure', or anything else for an access request
 */
export function letterFileName(kind: string | undefined, iso: string): string {
  return `${kind === 'erasure' ? 'erasure' : 'access'}-request-${iso}.txt`;
}

export function reminderFileName(deadlineIso: string): string {
  return `gdpr-deadline-${deadlineIso}.ics`;
}
