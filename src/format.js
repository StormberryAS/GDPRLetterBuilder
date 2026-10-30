/*! src/format.js is compiled from ts/src/format.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
const MONTHS_NB = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august',
    'september', 'oktober', 'november', 'desember'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_NB = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(text) {
    const m = ISO_RE.exec(String(text || ''));
    if (!m)
        return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 1900 || y > 2199 || mo < 1 || mo > 12 || d < 1)
        return false;
    return d <= daysInMonth(y, mo);
}
export function parseIso(text) {
    if (!isIsoDate(text))
        throw new RangeError(`not a date: ${text}`);
    const m = ISO_RE.exec(text);
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
export function toIso(y, m, d) {
    return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}
export function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addDays(iso, n) {
    const { y, m, d } = parseIso(iso);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function weekday(iso) {
    const { y, m, d } = parseIso(iso);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function compareIso(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
export function dateEn(iso) {
    const { y, m, d } = parseIso(iso);
    return `${d} ${MONTHS_EN[m - 1]} ${y}`;
}
export function longDateEn(iso) {
    return `${DAYS_EN[weekday(iso)]} ${dateEn(iso)}`;
}
export function dateNb(iso) {
    const { y, m, d } = parseIso(iso);
    return `${d}. ${MONTHS_NB[m - 1]} ${y}`;
}
export function longDateNb(iso) {
    return `${DAYS_NB[weekday(iso)]} ${dateNb(iso)}`;
}
export function dayMonthEn(iso) {
    const { m, d } = parseIso(iso);
    return `${d} ${MONTHS_EN[m - 1]}`;
}
export function weekdayEn(iso) {
    return DAYS_EN[weekday(iso)];
}
export function letterDate(iso, lang) {
    return lang === 'nb' ? dateNb(iso) : dateEn(iso);
}
export function letterFileName(kind, iso) {
    return `${kind === 'erasure' ? 'erasure' : 'access'}-request-${iso}.txt`;
}
export function reminderFileName(deadlineIso) {
    return `gdpr-deadline-${deadlineIso}.ics`;
}
