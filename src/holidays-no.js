/*! src/holidays-no.js is compiled from ts/src/holidays-no.ts by tools/build-ts.sh, which leaves out
    every comment but this one: the explanations are in the source. Edit the TypeScript, never the
    .js: the build refuses to overwrite a hand edit, and its check mode fails on one. */
import { addDays, parseIso, toIso, weekday } from './format.js?v=57ce12f7';
export function easterSunday(year) {
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
const cache = new Map();
export function norwegianHolidays(year) {
    const cached = cache.get(year);
    if (cached)
        return cached;
    const easter = easterSunday(year);
    const list = [
        [toIso(year, 1, 1), 'New Year\'s Day'],
        [addDays(easter, -3), 'Maundy Thursday'],
        [addDays(easter, -2), 'Good Friday'],
        [easter, 'Easter Sunday'],
        [addDays(easter, 1), 'Easter Monday'],
        [toIso(year, 5, 17), 'Constitution Day'],
        [addDays(easter, 39), 'Ascension Day'],
        [addDays(easter, 49), 'Whit Sunday'],
        [addDays(easter, 50), 'Whit Monday'],
        [toIso(year, 5, 1), '1 May, a public holiday'],
        [toIso(year, 12, 25), 'Christmas Day'],
        [toIso(year, 12, 26), 'Boxing Day'],
    ];
    const map = new Map();
    for (const [iso, name] of list)
        map.set(iso, map.has(iso) ? `${map.get(iso)} and ${name}` : name);
    cache.set(year, map);
    return map;
}
export function norwegianHolidayName(iso) {
    const { y } = parseIso(iso);
    const named = norwegianHolidays(y).get(iso);
    if (named)
        return named;
    return weekday(iso) === 0 ? 'Sunday' : null;
}
export function isNorwegianHoliday(iso) {
    return norwegianHolidayName(iso) !== null;
}
export function isWorkingDay(iso, country) {
    const wd = weekday(iso);
    if (wd === 0 || wd === 6)
        return false;
    if (country === 'NO')
        return !isNorwegianHoliday(iso);
    return true;
}
export function nonWorkingReason(iso, country) {
    const wd = weekday(iso);
    if (country === 'NO') {
        const name = norwegianHolidayName(iso);
        if (name && name !== 'Sunday')
            return name;
    }
    if (wd === 6)
        return 'Saturday';
    if (wd === 0)
        return 'Sunday';
    return null;
}
export function addWorkingDays(iso, n, country) {
    let day = iso;
    let left = n;
    while (left > 0) {
        day = addDays(day, 1);
        if (isWorkingDay(day, country))
            left -= 1;
    }
    return day;
}
