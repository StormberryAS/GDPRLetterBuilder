/*! src/deadline.js is compiled from ts/src/deadline.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */

// The deadline for the company's answer (spec section 5). Pure: dates in, dates and words out.
//
// The rule: information on action taken "without undue delay and in any event within one month
// of receipt of the request" [GDPR 12(3)]. Counted as the EDPB says, by Regulation 1182/71 [EDPB
// para 160]:
//   * the day of receipt is not counted [R1182 Art. 3(1)];
//   * the period ends at the end of the day in the next month with the same date [R1182 Art.
//     3(2)(c)], or on the last day of that month when there is no such date [R1182 Art. 3(2)(c);
//     EDPB Example 33];
//   * weekends and holidays inside the period count [R1182 Art. 3(3)];
//   * a last day on a Saturday, Sunday or public holiday moves to the next working day [R1182
//     Art. 3(4); EDPB para 161].
// Whose holidays: the company's country, as "the Member State in which action is to be taken"
// [R1182 Art. 2(1)] (our reading). Only Norway's are modelled (SCOPE-5); elsewhere weekends only.
//
// The extension (OUT-7): two further months "where necessary" [GDPR 12(3)]. The sources do not say
// how they are counted, so both readings are computed, three months from receipt and two months
// from the rolled first deadline, and the later one is shown, with the weekend and holiday rule.
//
// Post (OUT-6): receipt is estimated as 3 Norwegian working days after posting to a company in
// Norway and 10 to a company abroad, the upper ends of Posten's guideline times [POSTEN].

import { addDays, compareIso, daysInMonth, dateEn, dayMonthEn, isIsoDate, longDateEn, parseIso, toIso } from './format.js';
import { addWorkingDays, isWorkingDay, nonWorkingReason } from './holidays-no.js';

/**
 * One day the count moved past, and why.
 */
export type Skipped = { date: string; reason: string };
export type Deadline = ReturnType<typeof computeDeadline>;
export type Explained = ReturnType<typeof explainDeadline>;

export const COUNTRIES = ['NO', 'EEA', 'OUTSIDE'];
export const POST_DAYS = { NO: 3, ABROAD: 10 };

/**
 * The date n months after iso by Regulation 1182/71 Art. 3(2)(c): the same date, or the last day
 * of the month when that month is shorter. Returns { date, clipped }.
 */
export function addMonths(iso: string, n: number): { date: string; clipped: boolean; wanted: number; } {
  const { y, m, d } = parseIso(iso);
  const total = (m - 1) + n;
  const ty = y + Math.floor(total / 12);
  const tm = (total % 12 + 12) % 12 + 1;
  const last = daysInMonth(ty, tm);
  return { date: toIso(ty, tm, Math.min(d, last)), clipped: d > last, wanted: d };
}

/**
 * Moves a last day off a Saturday, Sunday or public holiday to the next working day. Returns the
 * date and the days skipped, each with its reason.
 */
export function rollForward(iso: string, country?: string): { date: string; skipped: Skipped[]; } {
  const skipped: Skipped[] = [];
  let day = iso;
  while (!isWorkingDay(day, country)) {
    // A day that is not a working day always has a reason (holidays-no.ts gives null only for a
    // working day).
    skipped.push({ date: day, reason: nonWorkingReason(day, country) as string });
    day = addDays(day, 1);
  }
  return { date: day, skipped };
}

function normCountry(country: string): string {
  return COUNTRIES.includes(country) ? country : 'NO';
}

/**
 * The full count for a receipt date. Throws on a date that is not real.
 * @param received YYYY-MM-DD
 * @param country 'NO', 'EEA' or 'OUTSIDE'; anything else counts as 'NO'
 */
export function computeDeadline(received: string, country: string = 'NO') {
  if (!isIsoDate(received)) throw new RangeError(`not a date: ${received}`);
  const c = normCountry(country);
  const raw = addMonths(received, 1);
  const first = rollForward(raw.date, c);
  const a = addMonths(received, 3);
  const aRolled = rollForward(a.date, c);
  const b = addMonths(first.date, 2);
  const bRolled = rollForward(b.date, c);
  const later = compareIso(bRolled.date, aRolled.date) > 0 ? bRolled : aRolled;
  return {
    received,
    country: c,
    holidaysModelled: c === 'NO',
    first: { raw: raw.date, clipped: raw.clipped, wanted: raw.wanted, date: first.date, skipped: first.skipped },
    extension: {
      fromReceipt: { raw: a.date, date: aRolled.date },
      fromFirst: { raw: b.date, date: bRolled.date },
      date: later.date,
      skipped: later.skipped,
      differ: aRolled.date !== bRolled.date,
    },
  };
}

/**
 * Estimated day the company receives a posted letter (OUT-6).
 * @param posted YYYY-MM-DD
 */
export function estimatePostalReceipt(posted: string, country: string = 'NO'): { date: string; workingDays: number; } {
  if (!isIsoDate(posted)) throw new RangeError(`not a date: ${posted}`);
  const days = normCountry(country) === 'NO' ? POST_DAYS.NO : POST_DAYS.ABROAD;
  return { date: addWorkingDays(posted, days, 'NO'), workingDays: days };
}

const reasonWords = (reason: string) => (reason === 'Saturday' || reason === 'Sunday' ? `a ${reason}` : reason);

/**
 * @param skipped at least one day
 */
function skippedSentence(skipped: Skipped[]): string {
  // "That is Easter Sunday, and 6 April is Easter Monday, so the deadline moves to the next
  // working day." The first skipped day is the one the sentence before has just named.
  // A holiday named by its date ("1 May, a public holiday") is not named twice after the first.
  const later = (s: Skipped) => {
    const day = dayMonthEn(s.date);
    return s.reason.startsWith(`${day}, `) ? `${day} is ${s.reason.slice(day.length + 2)}` : `${day} is ${reasonWords(s.reason)}`;
  };
  const parts = skipped.map((s, i) => (i === 0 ? `That is ${reasonWords(s.reason)}` : later(s)));
  let joined = parts[0];
  if (parts.length === 2) joined = `${parts[0]}, and ${parts[1]}`;
  if (parts.length > 2) joined = `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `${joined}, so the deadline moves to the next working day.`;
}

// "Not taken into account", never "not counted": holidays inside the period do count [R1182 Art.
// 3(3)]; what is left out is moving a last day off another country's holiday.
const COUNTRY_NOTE = 'Public holidays in the company\'s country are not taken into account here; check them yourself.';
const EXTENSION_DIFFER = 'The law does not say exactly how the extra two months are counted, so this is the later reading.';
const EXTENSION_SAME = 'The law does not say exactly how the extra two months are counted; here both ways of counting give the same date.';

/**
 * The words the page shows under "Remember the deadline" (spec section 5.4), in English.
 * estimated: true when the receipt date is the postal estimate.
 */
export function explainDeadline(result: Deadline, { estimated = false }: { estimated?: boolean; } = {}) {
  const f = result.first;
  const headline = `Deadline: by the end of ${longDateEn(f.date)}`;
  const counted = estimated ? 'counted from an estimated delivery date.' : 'counted from the date you gave for when they received it.';
  let month;
  if (f.clipped) {
    const { y, m } = parseIso(f.raw);
    const monthName = dateEn(f.raw).split(' ')[1];
    month = `One month after they received it (${dateEn(result.received)}) would be ${f.wanted} ${monthName}, which does not exist, so the month ends on its last day, ${dayMonthEn(toIso(y, m, daysInMonth(y, m)))}.`;
  } else {
    month = `One month after they received it (${dateEn(result.received)}) is ${dayMonthEn(f.raw)}.`;
  }
  const lines = [month];
  if (f.skipped.length) lines.push(skippedSentence(f.skipped));
  if (!result.holidaysModelled) lines.push(COUNTRY_NOTE);
  const ext = result.extension;
  const extension = `If they extend it, which they may do only where necessary, and only if they tell you within the first month and give reasons: by the end of ${longDateEn(ext.date)}. ${ext.differ ? EXTENSION_DIFFER : EXTENSION_SAME}`;
  return { headline, counted, lines, extension };
}

export const WORDS = { COUNTRY_NOTE, EXTENSION_DIFFER, EXTENSION_SAME };
