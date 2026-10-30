// The cover note (spec section 21.5): the goldens, the order of events, the notes, undated and
// empty rows, the attachment numbers, facts only (FU-9), and the missing-field list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, missing, orderedEvents, undatedCount, emptyOtherCount, timelineFileName, EVENT_TYPES, EVENTS, EVENT_LABELS } from '#src/timeline.js';
import { findCitations } from '#src/citations.js';
import { abuseWords, copyProblems } from './legal-pages.ts';
import { CASES } from './followup-cases.ts';

const TL = CASES.filter((c) => c.kind === 'timeline');
const golden = (id: string): string => readFileSync(new URL(`./goldens/followup/${id}.txt`, import.meta.url), 'utf8');

test('every cover note matches its golden, in both languages', () => {
  assert.equal(TL.length, 6);
  for (const c of TL) assert.equal(`${render(c.input)}\n`, golden(c.id), c.id);
});

test('the events: a fixed list with a sentence and an attachment label in both languages, and a label on the page', () => {
  assert.equal(EVENT_TYPES.length, 11);
  for (const t of EVENT_TYPES) {
    assert.ok(EVENT_LABELS[t], t);
    assert.ok(EVENTS[t].attEn && EVENTS[t].attNb, t);
    if (t !== 'other') assert.ok(/\.$/.test(EVENTS[t].en) && /\.$/.test(EVENTS[t].nb), t);
  }
});

test('order: by date, and rows on the same date in the order they were added; undated and empty rows left out', () => {
  const ev = orderedEvents({ events: [
    { date: '2026-11-01', type: 'answered' },
    { date: '2026-10-12', type: 'sent', attach: true },
    { date: '2026-10-12', type: 'received', attach: true },
    { date: '', type: 'reminder', attach: true },
    { date: '2026-10-20', type: 'other', note: '' },
    { date: '2026-13-01', type: 'answered' },
  ] });
  assert.deepEqual(ev.map((e) => e.type), ['sent', 'received', 'answered']);
  assert.deepEqual(ev.map((e) => e.attachment), [1, 2, 0]);
  assert.equal(undatedCount({ events: [{ date: '', type: 'sent' }, { date: '', type: 'other', note: '' }, { date: '2026-10-12', type: 'sent' }] }), 1);
});

test('a note becomes a sentence; an unknown type becomes "other"', () => {
  const t = render({ lang: 'en', events: [{ date: '2026-10-12', type: 'sent', note: 'By email' }, { date: '2026-10-13', type: 'nonsense', note: 'Called them?' }] });
  assert.ok(t.includes('- 12 October 2026: I sent my request to the company. By email.'));
  assert.ok(t.includes('- 13 October 2026: Called them?'));
});

test('a note ends cleanly: a stray comma, semicolon or colon taken off, an end mark inside quotes kept (K2-14)', () => {
  const line = (note: string) => render({ lang: 'en', events: [{ date: '2026-10-12', type: 'sent', note }] }).split('\n').find((l) => l.startsWith('- '));
  assert.equal(line('They wrote "received."'), '- 12 October 2026: I sent my request to the company. They wrote "received."');
  assert.equal(line('Reference:'), '- 12 October 2026: I sent my request to the company. Reference.');
  assert.equal(line('By email,'), '- 12 October 2026: I sent my request to the company. By email.');
  assert.equal(line('(see the receipt)'), '- 12 October 2026: I sent my request to the company. (see the receipt).');
  assert.equal(line('Really?'), '- 12 October 2026: I sent my request to the company. Really?');
});

test('a dated "Other" row without a note is counted, so the page can say why it is left out (K2-2)', () => {
  const events = [{ date: '2026-10-12', type: 'other', note: '', attach: true }, { date: '2026-10-13', type: 'sent', attach: true }];
  assert.equal(emptyOtherCount({ events }), 1);
  assert.deepEqual(orderedEvents({ events }).map((e) => e.attachment), [1]);
  assert.equal(emptyOtherCount({ events: [{ date: '', type: 'other' }] }), 0);
  assert.doesNotThrow(() => render(null));
  assert.doesNotThrow(() => missing(null));
});

test('the note starts in Bokmål, and leaves gaps visible', () => {
  const t = render({});
  assert.ok(t.startsWith('Tidslinje: anmodning om innsyn i personopplysninger om meg, [Virksomhetens navn]'));
  assert.ok(t.includes('Fra: [Fullt navn]') && t.includes('Dato: [dato]'));
  assert.ok(!t.includes('Vedlegg:'), 'no attachment list without attachments');
  assert.ok(!t.includes('Hva som mangler'), 'no missing section without text');
});

test('facts only (FU-9): no article, no case, no legal argument, none of the abuse-risk words, the copy rules', () => {
  for (const c of TL) {
    const t = render(c.input);
    assert.deepEqual(findCitations(t), [], c.id);
    assert.ok(!/GDPR|personvernforordningen|unlawful|ulovlig|breach|brudd/i.test(t), c.id);
    assert.deepEqual(abuseWords(t), [], c.id);
    assert.deepEqual(copyProblems(t), [], c.id);
  }
});

test('what is still missing', () => {
  assert.deepEqual(missing({}), ['the company\'s name (step 2)', 'your full name (step 3)', 'at least one dated event']);
  assert.deepEqual(missing({ company: 'A', name: 'B', events: [{ date: '2026-10-12', type: 'sent' }] }), []);
  assert.equal(timelineFileName('2026-12-20'), 'timeline-2026-12-20.txt');
});
