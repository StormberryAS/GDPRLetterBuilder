// The deadline (spec section 5): every row of the test table in 5.5, both readings of the
// extension, Norwegian public holidays 2026 to 2040, every month end, leap years, the postal
// estimate across Easter and Christmas, other countries with weekends only, and the words the page
// shows (5.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, computeDeadline, estimatePostalReceipt, explainDeadline, rollForward, WORDS } from '#src/deadline.js';
import { easterSunday, isNorwegianHoliday, isWorkingDay, norwegianHolidays } from '#src/holidays-no.js';
import { addDays, daysInMonth, isIsoDate, toIso, weekday } from '#src/format.js';

// Spec 5.5, plus the rows the legal-accuracy review recomputed by script (spec-review
// deadline-check.txt of 12 October 2026, an independent Python count): received, first deadline,
// extension three months from receipt, extension two months from the rolled first deadline, the
// later one.
const ROWS: Array<[string, string, string, string, string]> = [
  ['2026-03-05', '2026-04-07', '2026-06-05', '2026-06-08', '2026-06-08'],
  ['2026-08-31', '2026-09-30', '2026-11-30', '2026-11-30', '2026-11-30'],
  ['2026-11-25', '2026-12-28', '2027-02-25', '2027-03-01', '2027-03-01'],
  ['2027-01-31', '2027-03-01', '2027-04-30', '2027-05-03', '2027-05-03'],
  ['2028-01-31', '2028-02-29', '2028-05-02', '2028-05-02', '2028-05-02'],
  ['2027-04-17', '2027-05-18', '2027-07-19', '2027-07-19', '2027-07-19'],
  ['2027-02-25', '2027-03-30', '2027-05-25', '2027-05-31', '2027-05-31'],
  ['2026-04-14', '2026-05-15', '2026-07-14', '2026-07-15', '2026-07-15'],
  ['2026-10-12', '2026-11-12', '2027-01-12', '2027-01-12', '2027-01-12'],
  ['2026-09-25', '2026-10-26', '2026-12-28', '2026-12-28', '2026-12-28'],
  ['2027-01-29', '2027-03-01', '2027-04-29', '2027-05-03', '2027-05-03'],
  ['2026-12-31', '2027-02-01', '2027-03-31', '2027-04-01', '2027-04-01'],
  ['2027-03-31', '2027-04-30', '2027-06-30', '2027-06-30', '2027-06-30'],
];

test('spec 5.5: every row, the first deadline and both readings of the extension, the later one shown', () => {
  for (const [received, first, fromReceipt, fromFirst, later] of ROWS) {
    const d = computeDeadline(received, 'NO');
    assert.equal(d.first.date, first, `${received} first`);
    assert.equal(d.extension.fromReceipt.date, fromReceipt, `${received} receipt + 3 months`);
    assert.equal(d.extension.fromFirst.date, fromFirst, `${received} rolled first + 2 months`);
    assert.equal(d.extension.date, later, `${received} extension`);
    assert.equal(d.extension.differ, fromReceipt !== fromFirst);
  }
});

test('spec 5.5: the weekdays the table names', () => {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = (iso: string) => names[weekday(iso)];
  assert.equal(day('2026-04-07'), 'Tue');
  assert.equal(day('2026-06-08'), 'Mon');
  assert.equal(day('2026-09-30'), 'Wed');
  assert.equal(day('2026-12-28'), 'Mon');
  assert.equal(day('2027-03-01'), 'Mon');
  assert.equal(day('2027-05-03'), 'Mon');
  assert.equal(day('2028-02-29'), 'Tue');
  assert.equal(day('2027-05-18'), 'Tue');
  assert.equal(day('2027-03-30'), 'Tue');
  assert.equal(day('2026-05-15'), 'Fri');
  assert.equal(day('2026-11-12'), 'Thu');
  assert.equal(day('2027-01-12'), 'Tue');
  assert.equal(day('2026-10-26'), 'Mon');
});

// Easter Sunday 2026 to 2040. Two independent sources agree with the computus in
// src/holidays-no.js: the legal-accuracy review's own script (12 October 2026) and the widely
// published table of Western Easter dates. A person still has to check them against Almanakk for
// Norge before release (spec section 13, a human check).
const EASTER = {
  2026: '04-05', 2027: '03-28', 2028: '04-16', 2029: '04-01', 2030: '04-21', 2031: '04-13', 2032: '03-28', 2033: '04-17',
  2034: '04-09', 2035: '03-25', 2036: '04-13', 2037: '04-05', 2038: '04-25', 2039: '04-10', 2040: '04-01',
};

test('Easter Sunday 2026 to 2040, and the holidays hung on it (helligdagsloven § 2)', () => {
  for (const [y, md] of Object.entries(EASTER)) {
    const e = `${y}-${md}`;
    assert.equal(easterSunday(Number(y)), e, y);
    const h = norwegianHolidays(Number(y));
    assert.equal(h.get(addDays(e, -3)), 'Maundy Thursday', y);
    assert.equal(h.get(addDays(e, -2)), 'Good Friday', y);
    assert.equal(h.get(addDays(e, 1)), 'Easter Monday', y);
    assert.ok(h.get(addDays(e, 39))!.includes('Ascension Day'), String(y));
    assert.equal(weekday(addDays(e, 39)), 4, `${y}: Ascension Day is a Thursday`);
    assert.ok(h.get(addDays(e, 49))!.includes('Whit Sunday'), String(y));
    assert.ok(h.get(addDays(e, 50))!.includes('Whit Monday'), String(y));
  }
  // The full list for one year, by hand.
  assert.deepEqual([...norwegianHolidays(2026).keys()].sort(), [
    '2026-01-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-17',
    '2026-05-24', '2026-05-25', '2026-12-25', '2026-12-26']);
  // 17 May 2027 is both Constitution Day and Whit Monday.
  assert.equal(norwegianHolidays(2027).get('2027-05-17'), 'Constitution Day and Whit Monday');
  assert.equal(norwegianHolidays(2027).size, 11);
});

test('fixed holidays and Sundays: 1 January, 1 and 17 May, 25 and 26 December, every Sunday (MAI § 1, HELLIG § 2)', () => {
  for (let y = 2026; y <= 2040; y++) {
    for (const md of ['01-01', '05-01', '05-17', '12-25', '12-26']) assert.ok(isNorwegianHoliday(`${y}-${md}`), `${y}-${md}`);
    // Christmas Eve and New Year's Eve are not public holidays (unless they fall on a Sunday).
    for (const md of ['12-24', '12-31']) if (weekday(`${y}-${md}`) !== 0) assert.ok(!isNorwegianHoliday(`${y}-${md}`), `${y}-${md}`);
  }
  let d = '2026-01-01';
  while (d < '2027-01-01') {
    if (weekday(d) === 0) assert.ok(isNorwegianHoliday(d), d);
    d = addDays(d, 1);
  }
});

test('one month later: the same date, or the last day of a shorter month, for every month end of 2026 to 2032 (R1182 Art. 3(2)(c))', () => {
  for (let y = 2026; y <= 2032; y++) {
    for (let m = 1; m <= 12; m++) {
      for (const d of [28, 29, 30, 31]) {
        if (d > daysInMonth(y, m)) continue;
        const iso = toIso(y, m, d);
        const r = addMonths(iso, 1);
        const ny = m === 12 ? y + 1 : y;
        const nm = m === 12 ? 1 : m + 1;
        assert.equal(r.date, toIso(ny, nm, Math.min(d, daysInMonth(ny, nm))), iso);
        assert.equal(r.clipped, d > daysInMonth(ny, nm), iso);
      }
    }
  }
});

test('leap years 2028 and 2032: 29 February exists and is reached; 2100 is not a leap year', () => {
  assert.equal(addMonths('2028-01-29', 1).date, '2028-02-29');
  assert.equal(addMonths('2028-01-31', 1).date, '2028-02-29');
  assert.equal(addMonths('2032-01-30', 1).date, '2032-02-29');
  assert.equal(addMonths('2027-01-29', 1).date, '2027-02-28');
  assert.equal(addMonths('2028-02-29', 1).date, '2028-03-29');
  assert.equal(addMonths('2028-11-30', 3).date, '2029-02-28');
  assert.equal(addMonths('2031-11-30', 3).date, '2032-02-29');
  assert.ok(isIsoDate('2028-02-29') && isIsoDate('2032-02-29'));
  assert.ok(!isIsoDate('2027-02-29') && !isIsoDate('2100-02-29'));
  assert.equal(computeDeadline('2032-01-31').first.date, '2032-03-01', '29 February 2032 is a Sunday');
});

test('the roll: Saturday, Sunday and Norwegian holidays move a last day on, and say why', () => {
  assert.deepEqual(rollForward('2026-12-25', 'NO'), { date: '2026-12-28', skipped: [
    { date: '2026-12-25', reason: 'Christmas Day' }, { date: '2026-12-26', reason: 'Boxing Day' }, { date: '2026-12-27', reason: 'Sunday' }] });
  assert.deepEqual(rollForward('2026-11-12', 'NO'), { date: '2026-11-12', skipped: [] });
  assert.equal(rollForward('2027-05-01', 'NO').skipped[0]?.reason, '1 May, a public holiday');
  // 1 May named by its date reads naturally first and later in the sentence, and with Ascension Day.
  assert.equal(explainDeadline(computeDeadline('2027-04-01')).lines[1], 'That is 1 May, a public holiday, and 2 May is a Sunday, so the deadline moves to the next working day.');
  assert.equal(explainDeadline(computeDeadline('2022-03-30')).lines[1], 'That is a Saturday, and 1 May is a public holiday, so the deadline moves to the next working day.');
  assert.equal(explainDeadline(computeDeadline('2008-04-01')).lines[1], 'That is Ascension Day and 1 May, a public holiday, so the deadline moves to the next working day.');
});

test('other countries: weekends only, and the page says their holidays are not counted (SCOPE-5)', () => {
  // 25 December 2026 is a Friday: a working day where only weekends are known.
  assert.equal(computeDeadline('2026-11-25', 'EEA').first.date, '2026-12-25');
  assert.equal(computeDeadline('2026-11-25', 'OUTSIDE').first.date, '2026-12-25');
  // Easter Monday 2026 counts as a working day there.
  assert.equal(computeDeadline('2026-03-05', 'EEA').first.date, '2026-04-06');
  assert.equal(computeDeadline('2026-10-24', 'EEA').first.date, '2026-11-24');
  assert.equal(computeDeadline('2026-09-26', 'EEA').first.date, '2026-10-26', '26 October 2026 is a Monday; 26 September was a Saturday');
  assert.ok(!isWorkingDay('2026-10-24', 'EEA') && !isWorkingDay('2026-10-25', 'EEA'));
  assert.ok(isWorkingDay('2026-12-25', 'EEA') && !isWorkingDay('2026-12-25', 'NO'));
  const e = explainDeadline(computeDeadline('2026-11-25', 'EEA'));
  assert.ok(e.lines.includes(WORDS.COUNTRY_NOTE));
  // "Not taken into account", never "not counted": holidays inside the period do count (R1182 Art. 3(3)).
  assert.equal(WORDS.COUNTRY_NOTE, 'Public holidays in the company\'s country are not taken into account here; check them yourself.');
  assert.ok(!explainDeadline(computeDeadline('2026-11-25', 'NO')).lines.includes(WORDS.COUNTRY_NOTE));
});

test('the postal estimate: 3 Norwegian working days in Norway, 10 abroad, across Easter and Christmas (OUT-6)', () => {
  assert.deepEqual(estimatePostalReceipt('2026-10-12', 'NO'), { date: '2026-10-15', workingDays: 3 });
  assert.deepEqual(estimatePostalReceipt('2026-10-16', 'NO'), { date: '2026-10-21', workingDays: 3 });
  // Posted on Wednesday 1 April 2026: Maundy Thursday, Good Friday, the weekend and Easter Monday do not count.
  assert.equal(estimatePostalReceipt('2026-04-01', 'NO').date, '2026-04-09');
  // Posted on 23 December 2026: 24 December counts (not a public holiday), 25 and 26 do not, nor the weekend.
  assert.equal(estimatePostalReceipt('2026-12-23', 'NO').date, '2026-12-29');
  // Abroad: 10 Norwegian working days.
  assert.deepEqual(estimatePostalReceipt('2026-10-12', 'EEA'), { date: '2026-10-26', workingDays: 10 });
  assert.equal(estimatePostalReceipt('2026-12-22', 'OUTSIDE').date, '2027-01-07');
  // Posted on Monday 30 March 2026 to a company abroad: 31 March and 1 April count, Easter does not.
  assert.equal(estimatePostalReceipt('2026-03-30', 'EEA').date, '2026-04-16');
});

test('spec 5.4: the words the page shows for a letter received on 5 March 2026', () => {
  const e = explainDeadline(computeDeadline('2026-03-05', 'NO'));
  assert.equal(e.headline, 'Deadline: by the end of Tuesday 7 April 2026');
  assert.equal(e.counted, 'counted from the date you gave for when they received it.');
  assert.deepEqual(e.lines, [
    'One month after they received it (5 March 2026) is 5 April.',
    'That is Easter Sunday, and 6 April is Easter Monday, so the deadline moves to the next working day.',
  ]);
  assert.equal(e.extension, 'If they extend it, which they may do only where necessary, and only if they tell you within the first month and give reasons: by the end of Monday 8 June 2026. The law does not say exactly how the extra two months are counted, so this is the later reading.');
  assert.equal(explainDeadline(computeDeadline('2026-03-05'), { estimated: true }).counted, 'counted from an estimated delivery date.');
  // When both readings agree, it says so instead.
  assert.match(explainDeadline(computeDeadline('2026-10-12')).extension, /here both ways of counting give the same date\.$/);
  // A month with no such date.
  assert.equal(explainDeadline(computeDeadline('2027-01-31')).lines[0], 'One month after they received it (31 January 2027) would be 31 February, which does not exist, so the month ends on its last day, 28 February.');
  assert.equal(explainDeadline(computeDeadline('2026-11-25')).lines[1], 'That is Christmas Day, 26 December is Boxing Day, and 27 December is a Sunday, so the deadline moves to the next working day.');
});

test('bad dates are refused, never guessed', () => {
  for (const bad of ['', '2026-02-30', '2026-13-01', '26-10-12', '2026-10-12T00:00', null, undefined]) {
    // computeDeadline takes a string; the refused values include what a form or a caller may pass instead.
    assert.throws(() => computeDeadline(bad as string), RangeError, String(bad));
  }
  assert.throws(() => estimatePostalReceipt('2026-02-30'), RangeError);
});
