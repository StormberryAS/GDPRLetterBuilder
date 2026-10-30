/*! src/deadline.js is compiled from ts/src/deadline.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */
import { addDays, compareIso, daysInMonth, dateEn, dayMonthEn, isIsoDate, longDateEn, parseIso, toIso } from './format.js?v=57ce12f7';
import { addWorkingDays, isWorkingDay, nonWorkingReason } from './holidays-no.js?v=a2700933';
export const COUNTRIES = ['NO', 'EEA', 'OUTSIDE'];
export const POST_DAYS = { NO: 3, ABROAD: 10 };
export function addMonths(iso, n) {
    const { y, m, d } = parseIso(iso);
    const total = (m - 1) + n;
    const ty = y + Math.floor(total / 12);
    const tm = (total % 12 + 12) % 12 + 1;
    const last = daysInMonth(ty, tm);
    return { date: toIso(ty, tm, Math.min(d, last)), clipped: d > last, wanted: d };
}
export function rollForward(iso, country) {
    const skipped = [];
    let day = iso;
    while (!isWorkingDay(day, country)) {
        skipped.push({ date: day, reason: nonWorkingReason(day, country) });
        day = addDays(day, 1);
    }
    return { date: day, skipped };
}
function normCountry(country) {
    return COUNTRIES.includes(country) ? country : 'NO';
}
export function computeDeadline(received, country = 'NO') {
    if (!isIsoDate(received))
        throw new RangeError(`not a date: ${received}`);
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
export function estimatePostalReceipt(posted, country = 'NO') {
    if (!isIsoDate(posted))
        throw new RangeError(`not a date: ${posted}`);
    const days = normCountry(country) === 'NO' ? POST_DAYS.NO : POST_DAYS.ABROAD;
    return { date: addWorkingDays(posted, days, 'NO'), workingDays: days };
}
const reasonWords = (reason) => (reason === 'Saturday' || reason === 'Sunday' ? `a ${reason}` : reason);
function skippedSentence(skipped) {
    const later = (s) => {
        const day = dayMonthEn(s.date);
        return s.reason.startsWith(`${day}, `) ? `${day} is ${s.reason.slice(day.length + 2)}` : `${day} is ${reasonWords(s.reason)}`;
    };
    const parts = skipped.map((s, i) => (i === 0 ? `That is ${reasonWords(s.reason)}` : later(s)));
    let joined = parts[0];
    if (parts.length === 2)
        joined = `${parts[0]}, and ${parts[1]}`;
    if (parts.length > 2)
        joined = `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
    return `${joined}, so the deadline moves to the next working day.`;
}
const COUNTRY_NOTE = 'Public holidays in the company\'s country are not taken into account here; check them yourself.';
const EXTENSION_DIFFER = 'The law does not say exactly how the extra two months are counted, so this is the later reading.';
const EXTENSION_SAME = 'The law does not say exactly how the extra two months are counted; here both ways of counting give the same date.';
export function explainDeadline(result, { estimated = false } = {}) {
    const f = result.first;
    const headline = `Deadline: by the end of ${longDateEn(f.date)}`;
    const counted = estimated ? 'counted from an estimated delivery date.' : 'counted from the date you gave for when they received it.';
    let month;
    if (f.clipped) {
        const { y, m } = parseIso(f.raw);
        const monthName = dateEn(f.raw).split(' ')[1];
        month = `One month after they received it (${dateEn(result.received)}) would be ${f.wanted} ${monthName}, which does not exist, so the month ends on its last day, ${dayMonthEn(toIso(y, m, daysInMonth(y, m)))}.`;
    }
    else {
        month = `One month after they received it (${dateEn(result.received)}) is ${dayMonthEn(f.raw)}.`;
    }
    const lines = [month];
    if (f.skipped.length)
        lines.push(skippedSentence(f.skipped));
    if (!result.holidaysModelled)
        lines.push(COUNTRY_NOTE);
    const ext = result.extension;
    const extension = `If they extend it, which they may do only where necessary, and only if they tell you within the first month and give reasons: by the end of ${longDateEn(ext.date)}. ${ext.differ ? EXTENSION_DIFFER : EXTENSION_SAME}`;
    return { headline, counted, lines, extension };
}
export const WORDS = { COUNTRY_NOTE, EXTENSION_DIFFER, EXTENSION_SAME };
