/*! src/ics.js is compiled from ts/src/ics.ts by tools/build-ts.sh, which leaves out every comment
    but this one: the explanations are in the source. Edit the TypeScript, never the .js: the build
    refuses to overwrite a hand edit, and its check mode fails on one. */
import { addDays, dateEn, isIsoDate } from './format.js?v=57ce12f7';
export const PRODID = '-//Stormberry AS//GDPRLetterBuilder 0.0.1//EN';
export function escapeText(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}
const encoder = new TextEncoder();
const octets = (s) => encoder.encode(s).length;
export function foldLine(line) {
    const out = [];
    let current = '';
    let size = 0;
    let limit = 75;
    for (const ch of line) {
        const n = octets(ch);
        if (size + n > limit) {
            out.push(current);
            current = ' ';
            size = 1;
            limit = 75;
        }
        current += ch;
        size += n;
    }
    out.push(current);
    return out.join('\r\n');
}
const compact = (iso) => iso.replace(/-/g, '');
export const EVENT_START = '120000';
export const EVENT_END = '123000';
export function utcStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
export function reminderTitle(company, deadlineIso, { leaveOut = false } = {}) {
    const name = String(company || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    const who = !leaveOut && name ? `${name} GDPR request` : 'your GDPR request';
    return `Follow up: ${who} (deadline ${dateEn(deadlineIso)})`;
}
export function buildIcs({ deadline, title, description, uid, dtstamp }) {
    if (!isIsoDate(deadline))
        throw new RangeError(`not a date: ${deadline}`);
    if (!/^[0-9a-f]{16,64}$/.test(uid))
        throw new RangeError('uid must be 16 to 64 hex digits');
    const day = addDays(deadline, 1);
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${PRODID}`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}@stormberry.as`,
        `DTSTAMP:${utcStamp(dtstamp)}`,
        `DTSTART:${compact(day)}T${EVENT_START}`,
        `DTEND:${compact(day)}T${EVENT_END}`,
        `SUMMARY:${escapeText(title)}`,
        `DESCRIPTION:${escapeText(description)}`,
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(title)}`,
        'TRIGGER:-PT0M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
    ];
    return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
export function reminderDescription(explained, { extended = false, extendedDate = '' } = {}) {
    return [
        ...(extended ? [`Extended deadline: by the end of ${extendedDate}, if they told you within the first month, with reasons, that they need more time.`, ''] : []),
        `${explained.headline}, ${explained.counted}`,
        ...explained.lines,
        explained.extension,
        '',
        'What to do next:',
        '1. Check whether they have answered, or told you within the first month that they need more time.',
        '2. If not, you may send a short reminder with your first letter attached.',
        '3. You can complain to the Norwegian Data Protection Authority (Datatilsynet). Keep your letter, proof of when it reached them and every reply.',
        '',
        'Made with GDPRLetterBuilder by Stormberry AS. Information, not legal advice.',
    ].join('\n');
}
