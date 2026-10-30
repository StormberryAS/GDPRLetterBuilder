/*! src/ics.js is compiled from ts/src/ics.ts by tools/build-ts.sh, which leaves out every comment
    but this one: the explanations are in the source. Edit the TypeScript, never the .js: the build
    refuses to overwrite a hand edit, and its check mode fails on one. */

// The reminder file (spec section 5.6, OUT-3): one 30-minute event at 12.00 on the first day after
// the deadline, with an alarm when it starts, as an RFC 5545 calendar file the person saves and
// opens in their own calendar. The app keeps nothing. (Changed 2026-10-16 by Marcos: noon for 30
// minutes instead of all-day.)
//
// Never in the file: the person's name, contact details or identifiers. A calendar often syncs to
// a cloud service (our judgement). The company's name is in the title unless the person ticks
// "Leave the company name out of the reminder".
//
// Format, as the house rules for calendar files and RFC 5545 want it:
//   * CRLF line ends;
//   * lines folded at 75 octets, counted in UTF-8 bytes, never inside a character (æ, ø and å
//     are two octets each);
//   * TEXT values escaped: backslash first, then semicolon, then comma, then line breaks as \n;
//   * the start and end as floating local times (no TZID, no Z), so every calendar shows the event
//     at 12.00 in the person's own time zone and no VTIMEZONE block is needed;
//   * the alarm relative to the start of the event (TRIGGER:-PT0M), so it rings as the event starts.

import { addDays, dateEn, isIsoDate } from './format.js';
import type { Explained } from './deadline.js';

export const PRODID = '-//Stormberry AS//GDPRLetterBuilder 0.0.1//EN';

/**
 * RFC 5545 section 3.3.11 TEXT escaping.
 */
export function escapeText(text: string): string {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();
const octets = (s: string) => encoder.encode(s).length;

/**
 * Folds one content line at 75 octets (RFC 5545 section 3.1): the continuation lines start with a
 * single space, which counts towards their 75. A character is never split.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
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

const compact = (iso: string) => iso.replace(/-/g, '');

/** The event's start and end, floating local time: 12.00 to 12.30. */
export const EVENT_START = '120000';
export const EVENT_END = '123000';

/**
 * A UTC time as YYYYMMDDTHHMMSSZ, from a Date.
 */
export function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The reminder title (spec section 5.6).
 */
export function reminderTitle(company: string | null | undefined, deadlineIso: string, { leaveOut = false }: { leaveOut?: boolean; } = {}): string {
  // Cleaned as letters.ts clean() cleans a line: control characters become spaces, and zero-width
  // and direction marks go. RFC 5545 TEXT allows no control characters, and a right-to-left
  // override would turn the title round.
  const name = String(company || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const who = !leaveOut && name ? `${name} GDPR request` : 'your GDPR request';
  return `Follow up: ${who} (deadline ${dateEn(deadlineIso)})`;
}

/**
 * The whole calendar file.
 *   deadline:     YYYY-MM-DD, the deadline; the event is on the day after it
 *   title:        from reminderTitle()
 *   description:  plain text, lines joined with \n
 *   uid:          a random value from the caller (crypto.getRandomValues), without the domain
 *   dtstamp:      a Date, now
 * The event runs from 12.00 to 12.30, floating local time, on the day after the deadline.
 */
export function buildIcs({ deadline, title, description, uid, dtstamp }: { deadline: string; title: string; description: string; uid: string; dtstamp: Date; }): string {
  if (!isIsoDate(deadline)) throw new RangeError(`not a date: ${deadline}`);
  if (!/^[0-9a-f]{16,64}$/.test(uid)) throw new RangeError('uid must be 16 to 64 hex digits');
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

/**
 * The plain-text description (spec section 5.6): the deadline, how it was counted, the extension
 * rule and what to do next. extendedDate is the extended deadline in words, for that reminder.
 */
export function reminderDescription(explained: Explained, { extended = false, extendedDate = '' }: { extended?: boolean; extendedDate?: string; } = {}): string {
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
