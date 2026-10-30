// The deadline against an independent implementation (spec section 5; added after the code review
// of 12 October 2026, from the reviewer's property test). tests/deadline.test.ts pins tables; this
// file recomputes every receipt date from 2000 to 2100 another way and compares:
//   * Easter by the Oudin algorithm, 1900 to 2199, against the computus in holidays-no.js;
//   * Norwegian non-working days from that Easter and the fixed holidays, written out again here;
//   * one month later by Regulation 1182/71 Art. 3(2)(c) through Date.UTC, the roll to a working
//     day, both readings of the extension and the later one shown;
//   * the postal estimate, 3 or 10 Norwegian working days;
//   * the words: no undefined, NaN or null, no dash;
//   * the edge of the date fields: every receipt and posting date up to 2199-09-30 (the fields' max)
//     computes without throwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeadline, estimatePostalReceipt, explainDeadline } from '#src/deadline.js';
import { easterSunday } from '#src/holidays-no.js';
import { longDateEn, parseIso, toIso } from '#src/format.js';

function easterOudin(y: number): string {
  const g = y % 19;
  const c = Math.floor(y / 100);
  const h = (c - Math.floor(c / 4) - Math.floor((8 * c + 13) / 25) + 19 * g + 15) % 30;
  const i = h - Math.floor(h / 28) * (1 - Math.floor(29 / (h + 1)) * Math.floor((21 - g) / 11));
  const j = (y + Math.floor(y / 4) + i + 2 - c + Math.floor(c / 4)) % 7;
  const l = i - j;
  const m = 3 + Math.floor((l + 40) / 44);
  const d = l + 28 - 31 * Math.floor(m / 4);
  return toIso(y, m, d);
}
const dayNum = (iso: string): number => { const { y, m, d } = parseIso(iso); return Date.UTC(y, m - 1, d) / 864e5; };
const isoOf = (n: number): string => { const t = new Date(n * 864e5); return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
function working(iso: string, country: string): boolean {
  const n = dayNum(iso);
  const wd = new Date(n * 864e5).getUTCDay();
  if (wd === 0 || wd === 6) return false;
  if (country !== 'NO') return true;
  const { y } = parseIso(iso);
  if ([toIso(y, 1, 1), toIso(y, 5, 1), toIso(y, 5, 17), toIso(y, 12, 25), toIso(y, 12, 26)].includes(iso)) return false;
  const e = dayNum(easterOudin(y));
  return ![-3, -2, 0, 1, 39, 49, 50].map((k) => e + k).includes(n);
}
function addMonthsUtc(iso: string, k: number): string {
  const { y, m, d } = parseIso(iso);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, Math.min(d, last));
}
const roll = (iso: string, c: string): string => { let n = dayNum(iso); while (!working(isoOf(n), c)) n++; return isoOf(n); };

const START = dayNum('2000-01-01');
const END = dayNum('2100-12-31');

test('Easter 1900 to 2199: the computus agrees with the Oudin algorithm', () => {
  for (let y = 1900; y <= 2199; y++) assert.equal(easterSunday(y), easterOudin(y), `year ${y}`);
});

for (const c of ['NO', 'EEA', 'OUTSIDE']) {
  test(`${c}: every receipt date from 2000 to 2100 gives the independent count`, () => {
    let prevFirst = null;
    let prevExt = null;
    for (let n = START; n <= END; n++) {
      const r = isoOf(n);
      const res = computeDeadline(r, c);
      const raw = addMonthsUtc(r, 1);
      const first = roll(raw, c);
      assert.equal(res.first.raw, raw, `raw ${r}`);
      assert.equal(res.first.date, first, `first ${r}`);
      assert.equal(res.first.skipped.length, dayNum(first) - dayNum(raw), `skipped ${r}`);
      assert.ok(dayNum(first) - dayNum(raw) <= 5, `roll ${r}`);
      const a = roll(addMonthsUtc(r, 3), c);
      const b = roll(addMonthsUtc(first, 2), c);
      assert.equal(res.extension.date, a > b ? a : b, `extension ${r}`);
      assert.equal(res.extension.differ, a !== b, `differ ${r}`);
      const gap = dayNum(first) - n;
      assert.ok(gap >= 28 && gap <= 36, `gap ${gap} ${r}`);
      if (prevFirst) assert.ok(res.first.date >= prevFirst, `first goes back ${r}`);
      if (prevExt) assert.ok(res.extension.date >= prevExt, `extension goes back ${r}`);
      prevFirst = res.first.date;
      prevExt = res.extension.date;
      if (c !== 'NO') for (const s of res.first.skipped) assert.ok(s.reason === 'Saturday' || s.reason === 'Sunday', r);
      const words = JSON.stringify(explainDeadline(res));
      assert.ok(words.includes(longDateEn(first)), r);
      assert.ok(!/undefined|NaN|null/.test(words), `words ${r}`);
      assert.ok(!/[\u2013\u2014]/.test(words) && !words.includes('-'.repeat(2)), `dash ${r}`);
    }
  });
}

test('the postal estimate: 3 Norwegian working days to Norway, 10 abroad, every posting date from 2000 to 2100', () => {
  for (let n = START; n <= END; n++) {
    const p = isoOf(n);
    for (const c of ['NO', 'EEA']) {
      let k = n;
      let left = c === 'NO' ? 3 : 10;
      while (left > 0) { k++; if (working(isoOf(k), 'NO')) left--; }
      assert.equal(estimatePostalReceipt(p, c).date, isoOf(k), `${p} ${c}`);
    }
  }
});

test('the edge of the date fields: every date up to 2199-09-30 (their max) computes without throwing', () => {
  for (let n = dayNum('2199-01-01'); n <= dayNum('2199-09-30'); n++) {
    const r = isoOf(n);
    for (const c of ['NO', 'EEA', 'OUTSIDE']) {
      assert.doesNotThrow(() => computeDeadline(r, c), `${r} ${c}`);
      assert.doesNotThrow(() => estimatePostalReceipt(r, c), `post ${r} ${c}`);
    }
  }
  // Past it, the module refuses rather than guessing; the page then shows no deadline.
  assert.throws(() => computeDeadline('2199-12-31', 'NO'), RangeError);
});
