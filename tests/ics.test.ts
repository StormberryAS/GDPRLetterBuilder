// The reminder file (spec section 5.6, OUT-3): a golden file, CRLF line ends, folding at 75 octets
// with æ, ø and å at the fold, TEXT escaping, the event at 12.00 for 30 minutes (floating local
// time) on the day after the deadline with an alert when it starts, and never a personal detail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIcs, escapeText, foldLine, PRODID, reminderDescription, reminderTitle, utcStamp } from '#src/ics.js';
import { computeDeadline, explainDeadline } from '#src/deadline.js';
import { longDateEn } from '#src/format.js';

const octets = (s: string): number => Buffer.byteLength(s, 'utf8');
const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');
const unescapeText = (v: string): string => v.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');

function sample({ company = 'Eksempel Handel AS', leaveOut = false, extended = false } = {}) {
  const result = computeDeadline('2026-03-05', 'NO');
  const date = extended ? result.extension.date : result.first.date;
  const explained = explainDeadline(result);
  return buildIcs({
    deadline: date,
    title: reminderTitle(company, date, { leaveOut }),
    description: reminderDescription(explained, { extended, extendedDate: longDateEn(result.extension.date) }),
    uid: '0123456789abcdef0123456789abcdef',
    dtstamp: new Date(Date.UTC(2026, 9, 12, 10, 30, 0)),
  });
}

test('the golden reminder file, byte for byte', () => {
  const want = readFileSync(new URL('./goldens/reminder-2026-03-05.ics', import.meta.url), 'utf8');
  assert.equal(sample(), want);
});

test('RFC 5545 shape: CRLF everywhere, the required properties, 12.00 to 12.30 floating time on the day after the deadline', () => {
  const ics = sample();
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends in CRLF');
  const lines = unfold(ics).split('\r\n').slice(0, -1);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-1), 'END:VCALENDAR');
  for (const l of ['VERSION:2.0', `PRODID:${PRODID}`, 'METHOD:PUBLISH', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'END:VEVENT', 'TRANSP:TRANSPARENT',
    'UID:0123456789abcdef0123456789abcdef@stormberry.as', 'DTSTAMP:20261012T103000Z', 'DTSTART:20260408T120000', 'DTEND:20260408T123000',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT0M', 'END:VALARM']) assert.ok(lines.includes(l), l);
  // Changed 2026-10-16 by Marcos: noon for 30 minutes instead of all-day. Floating local time (no
  // TZID, no Z, no VTIMEZONE), so every calendar shows 12.00 in its own zone; one alert, at the start.
  assert.equal(lines.filter((l) => /^(DTSTART|DTEND)/.test(l)).length, 2);
  assert.ok(!lines.some((l) => /VALUE=DATE|TZID|VTIMEZONE/.test(l)), 'no all-day value and no time zone');
  assert.equal(lines.filter((l) => l.startsWith('TRIGGER')).length, 1);
  assert.equal(lines.filter((l) => l === 'BEGIN:VALARM').length, 1);
  assert.equal(PRODID, '-//Stormberry AS//GDPRLetterBuilder 0.0.1//EN');
  // The deadline is Tuesday 7 April 2026, so the event is on Wednesday 8 April.
  const summary = unescapeText(lines.find((l) => l.startsWith('SUMMARY:'))!.slice(8));
  assert.equal(summary, 'Follow up: Eksempel Handel AS GDPR request (deadline 7 April 2026)');
  // Nesting balanced.
  const depth = lines.reduce((d, l) => d + (l.startsWith('BEGIN:') ? 1 : l.startsWith('END:') ? -1 : 0), 0);
  assert.equal(depth, 0);
});

test('every physical line is at most 75 octets, and no character is split across a fold', () => {
  for (const company of ['Eksempel Handel AS', 'Blåbærsyltetøy og Ærlige Øl Østfold Ålesund AS Ærøy Ølbryggeri Æsj', 'x'.repeat(60) + 'æøå'.repeat(30)]) {
    const ics = sample({ company });
    for (const l of ics.split('\r\n')) {
      assert.ok(octets(l) <= 75, `${octets(l)}: ${l}`);
      assert.ok(!l.includes('�'));
    }
    // Unfolding gives the title back exactly.
    assert.match(unfold(ics), new RegExp(`SUMMARY:Follow up: ${escapeText(company).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')} GDPR request`));
  }
  // A fold right at a two-octet character: 73 ASCII then "æ" would end at 75; 74 then "æ" must fold before it.
  const a = foldLine(`${'a'.repeat(73)}æb`);
  assert.equal(a.split('\r\n')[0], `${'a'.repeat(73)}æ`);
  const b = foldLine(`${'a'.repeat(74)}æb`);
  assert.deepEqual(b.split('\r\n'), ['a'.repeat(74), ' æb']);
  // Continuation lines count their leading space.
  const long = foldLine('ø'.repeat(100));
  for (const l of long.split('\r\n')) assert.ok(octets(l) <= 75);
  assert.equal(long.replace(/\r\n /g, ''), 'ø'.repeat(100));
});

test('TEXT escaping: backslash first, then semicolon, comma and line breaks', () => {
  assert.equal(escapeText('a\\b;c,d\ne\r\nf'), 'a\\\\b\\;c\\,d\\ne\\nf');
  const ics = sample({ company: 'Smith, Jones; and Co \\ Ltd' });
  assert.ok(unfold(ics).includes(String.raw`SUMMARY:Follow up: Smith\, Jones\; and Co \\ Ltd GDPR request (deadline 7 April 2026)` + '\r\n'));
});

test('the title: the company\'s name, or "your GDPR request" when left out or empty', () => {
  assert.equal(reminderTitle('Eksempel AS', '2026-11-12'), 'Follow up: Eksempel AS GDPR request (deadline 12 November 2026)');
  assert.equal(reminderTitle('Eksempel AS', '2026-11-12', { leaveOut: true }), 'Follow up: your GDPR request (deadline 12 November 2026)');
  assert.equal(reminderTitle('   ', '2026-11-12'), 'Follow up: your GDPR request (deadline 12 November 2026)');
  // Control characters and direction marks never reach the calendar file (RFC 5545 TEXT allows no
  // control characters, and U+202E would turn the title round), cleaned as letters.js clean() cleans.
  const t = reminderTitle('A\u0001\u202eevil\u0007 \u200b Co\u007f\u2066', '2026-11-12');
  assert.equal(t, 'Follow up: A evil Co GDPR request (deadline 12 November 2026)');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/.test(t));
  assert.equal(reminderTitle('\u0001\u202e', '2026-11-12'), 'Follow up: your GDPR request (deadline 12 November 2026)');
  assert.ok(!sample({ leaveOut: true }).includes('Eksempel'));
});

test('the description: the deadline, how it was counted, the extension rule and three next steps, in plain text', () => {
  const d = unescapeText(unfold(sample()).match(/\r\nDESCRIPTION:(.*?)\r\n/)![1]!);
  assert.match(d, /^Deadline: by the end of Tuesday 7 April 2026, counted from the date you gave for when they received it\.\n/);
  assert.match(d, /That is Easter Sunday, and 6 April is Easter Monday/);
  assert.match(d, /If they extend it, which they may do only where necessary/);
  assert.match(d, /What to do next:\n1\. [^\n]+\n2\. [^\n]+\n3\. [^\n]+Datatilsynet/);
  assert.match(d, /Information, not legal advice\.$/);
  const ext = unescapeText(unfold(sample({ extended: true })).match(/\r\nDESCRIPTION:(.*?)\r\n/)![1]!);
  assert.match(ext, /^Extended deadline: by the end of Monday 8 June 2026, if they told you within the first month, with reasons, that they need more time\.\n/);
  assert.match(unfold(sample({ extended: true })), /\r\nDTSTART:20260609T120000\r\nDTEND:20260609T123000\r\n/);
  assert.match(unfold(sample({ extended: true })), /\r\nTRIGGER:-PT0M\r\n/);
});

test('never a personal detail: the builder takes none, and its inputs come only from the company name and the dates', () => {
  // buildIcs has no parameter for a name, an address, an email or an identifier.
  assert.deepEqual(Object.keys({ deadline: 0, title: 0, description: 0, uid: 0, dtstamp: 0 }).sort(),
    buildIcs.toString().match(/\{ ([^}]+) \}/)![1]!.split(', ').sort());
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const start = src.indexOf('function onSaveIcs');
  const fn = src.slice(start, src.indexOf('\nfunction ', start + 1));
  assert.ok(fn.length > 200 && fn.includes('reminderTitle'), 'onSaveIcs found');
  for (const field of ["'name'", "'email'", "'address'", 'identifiers', "'letter'", 'state()']) assert.ok(!fn.includes(field), `onSaveIcs reads ${field}`);
});

test('bad input is refused: a date that is not real, a uid that is not hex', () => {
  const base = { deadline: '2026-04-07', title: 't', description: 'd', uid: '0123456789abcdef', dtstamp: new Date(0) };
  assert.ok(buildIcs(base));
  assert.throws(() => buildIcs({ ...base, deadline: '2026-02-30' }), RangeError);
  assert.throws(() => buildIcs({ ...base, uid: 'not-hex' }), RangeError);
  assert.equal(utcStamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678))), '20260102T030405Z');
});

test('the event is the same 12.00 to 12.30 whatever the device\'s own clock says (floating time)', () => {
  // The file has no time zone in it, so it is the same bytes on any device: the old 09:00 alert was
  // worked out from the device's clock, this one is not. A year-end and a leap day as well.
  for (const [deadline, day] of [['2026-12-31', '20270101'], ['2028-02-28', '20280229'], ['2026-03-28', '20260329']] as const) {
    const ics = unfold(buildIcs({ deadline, title: 't', description: 'd', uid: '0123456789abcdef', dtstamp: new Date(0) }));
    assert.ok(ics.includes(`\r\nDTSTART:${day}T120000\r\nDTEND:${day}T123000\r\n`), deadline);
  }
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(!/nineOClock|alarm:/.test(src), 'app.js no longer works out an alert time');
  // The step 7 hint says the same.
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(page.includes('The reminder is a 30-minute calendar event at 12.00 on the day after the deadline, with an alert when it starts. It holds the company\'s name, unless you leave it out, and the deadline.'));
  assert.ok(!page.includes('alert at 09.00'));
});
