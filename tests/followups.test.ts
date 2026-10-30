// The follow-up letters (spec section 21): the goldens, the reply checker's lists, what each
// option adds and leaves out, the tone rules (FU-3), the dates (FU-4), the checks beside a
// reminder and an extension (FU-5), the missing-field list, the citation and copy lints.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, missing, normalise, checkItems, checkLabel, missingItems, reminderCheck, extensionCheck, followUpFileName, SITUATIONS } from '#src/followups.js';
import { render as renderFirst, accessItems } from '#src/letters.js';
import { unknownCitations } from '#src/citations.js';
import { abuseWords, copyProblems } from './legal-pages.ts';
import { CASES, PERSON } from './followup-cases.ts';
import type { FollowUpInput } from '#src/followups.js';

const FU = CASES.filter((c) => c.kind === 'followup');
const golden = (id: string): string => readFileSync(new URL(`./goldens/followup/${id}.txt`, import.meta.url), 'utf8');

test('every follow-up matches its golden, in both languages', () => {
  assert.equal(FU.length, 36);
  for (const c of FU) assert.equal(`${render(c.input).text}\n`, golden(c.id), c.id);
});

test('no situation, no letter; the five situations each give one', () => {
  assert.deepEqual(SITUATIONS, ['reminder', 'partial', 'extension', 'refusal', 'identity']);
  assert.equal(render({ ...PERSON }).text, '');
  assert.deepEqual(missing({ ...PERSON }), []);
  for (const situation of SITUATIONS) assert.ok(render({ ...PERSON, situation, extension: { noReasons: true }, refusal: { noReasons: true } }).text.length > 400, situation);
});

test('the subject and the reference follow the kind, in both languages', () => {
  const en = render({ ...PERSON, lang: 'en', situation: 'reminder' });
  assert.equal(en.subject, 'Reminder: request for access to my personal data (GDPR Article 15)');
  assert.match(en.text, /^Subject: Reminder: /m);
  assert.equal(render({ ...PERSON, lang: 'en', kind: 'erasure', situation: 'identity' }).subject, 'Follow-up: request for erasure of my personal data (GDPR Article 17)');
  const nb = render({ ...PERSON, lang: 'nb', kind: 'erasure', situation: 'reminder' });
  assert.equal(nb.subject, 'Påminnelse: sletting av personopplysninger om meg (personvernforordningen artikkel 17)');
  assert.ok(!/^Emne/m.test(nb.text) && !/^Dear|^Kjære/m.test(nb.text), 'no subject label and no salutation in Bokmål, as LET-6');
  assert.match(nb.text, /Jeg viser til anmodningen min av 12\. oktober 2026 om sletting av personopplysninger om meg, jf\. personvernforordningen \(GDPR\) artikkel 17\./);
});

test('the reply checker lists exactly what the first letter asked for (21.3)', () => {
  const ids = (input: FollowUpInput): string[] => checkItems({ ...PERSON, ...input }).map((i) => i.id);
  assert.deepEqual(ids({}), ['copy', 'purposes', 'categories', 'recipients', 'storage', 'source', 'automated', 'transfers', 'rights']);
  assert.deepEqual(ids({ consultations: true }).at(-1), 'consultations');
  assert.deepEqual(ids({ kind: 'erasure' }), ['recipients', 'kept', 'erased']);
  assert.deepEqual(ids({ kind: 'erasure', tellRecipients: false }), ['kept', 'erased']);
  assert.deepEqual(ids({ kind: 'erasure', copyFirst: true }), ['copy-first', 'recipients', 'kept', 'erased']);
  // The access items are the first letter's own words, so the follow-up asks again for exactly that.
  for (const lang of ['en', 'nb']) {
    const first = renderFirst({ ...PERSON, lang, consultations: true, scope: 'some', scopeText: 'my orders' }).text;
    for (const item of checkItems({ ...PERSON, consultations: true, scope: 'some', scopeText: 'my orders' }, lang)) assert.ok(first.includes(item.text), item.id);
    assert.deepEqual(checkItems({ ...PERSON }, lang), accessItems({ ...PERSON }, lang).slice(0, 9));
  }
  assert.equal(checkLabel('access', 'recipients'), 'The recipients, named');
  assert.equal(checkLabel('erasure', 'recipients'), 'Who the recipients are, and whether they were told');
  for (const id of ['copy', 'purposes', 'categories', 'recipients', 'storage', 'source', 'automated', 'transfers', 'rights', 'consultations']) assert.ok(checkLabel('access', id), id);
  for (const id of ['copy-first', 'recipients', 'kept', 'erased']) assert.ok(checkLabel('erasure', id), id);
});

test('ticked items leave the letter; all ticked means no letter, and the page says why', () => {
  const some = render({ ...PERSON, situation: 'partial', received: { copy: true, rights: true } }).text;
  assert.ok(!some.includes('a copy of all the personal data'));
  assert.match(some, /^1\. the purposes of the processing;$/m);
  assert.match(some, /^7\. if my data are transferred outside the EEA.*\(Article 15\(2\)\)\.$/m);
  const all = Object.fromEntries(checkItems({ ...PERSON }).map((i) => [i.id, true]));
  const none = render({ ...PERSON, situation: 'partial', received: all });
  assert.equal(none.text, '');
  assert.equal(none.nothingMissing, true);
  assert.deepEqual(missingItems({ ...PERSON, received: all }), []);
  // Bokmål items carry no end punctuation, as in the first letter.
  const nb = render({ ...PERSON, lang: 'nb', situation: 'partial' }).text;
  assert.match(nb, /^1\. en kopi av alle personopplysningene dere behandler om meg \(artikkel 15 nr\. 3\)$/m);
});

test('each option adds its own paragraph and nothing else', () => {
  const base = { ...PERSON, lang: 'en' };
  const ext = (extension: FollowUpInput['extension']): string => render({ ...base, situation: 'extension', extension }).text;
  assert.ok(ext({ noReasons: true }).includes('Your message does not give the reasons for the delay.'));
  assert.ok(!ext({ noReasons: true }).includes('one-month period had ended'));
  assert.ok(ext({ late: true }).includes('My request reached you on 12 October 2026, and the one-month period had ended before you told me of the extension.'));
  const ref = (refusal: FollowUpInput['refusal'], more: FollowUpInput = {}): string => render({ ...base, ...more, situation: 'refusal', refusal }).text;
  assert.ok(ref({ noReasons: true }).includes('in which you refused my request.'));
  assert.ok(ref({ part: true, noReasons: true }).includes('in which you refused part of my request.'));
  assert.ok(ref({ no16: true }).includes('section 16 of the Norwegian Personal Data Act'));
  // The § 16 line only for access to a company in Norway, as the first letter (spec 3.4).
  assert.ok(!ref({ no16: true }, { based: 'EEA' }).includes('section 16'));
  assert.ok(!ref({ no16: true }, { kind: 'erasure' }).includes('section 16'));
  assert.ok(!render({ ...PERSON, lang: 'nb', kind: 'erasure', situation: 'refusal', refusal: { no16: true } }).text.includes('§ 16'));
  const id = (identity: FollowUpInput['identity']): string => render({ ...base, situation: 'identity', identity }).text;
  assert.ok(id({}).includes('a copy of an identity document'));
  assert.ok(id({ document: false }).includes('more information about my identity'));
  assert.ok(id({ fromEmail: true }).includes('I sent my request from the email address I use with you. You can confirm that it is me by sending a confirmation link or code to that address.'));
  assert.ok(!id({}).includes('I sent my request from'));
  assert.ok(id({ loggedIn: true }).includes('while logged in'));
});

test('dates: only those typed, in the letter\'s own form, and a visible gap where one is missing (FU-4)', () => {
  const t = render({ ...PERSON, lang: 'en', situation: 'reminder' }).text;
  assert.ok(t.includes('my request of 12 October 2026') && t.includes('My request reached you on 12 October 2026.'));
  assert.ok(t.startsWith('Eksempel Handel AS\n\n1 December 2026\n\n'));
  assert.ok(!render({ ...PERSON, receivedDate: '', situation: 'reminder' }).text.includes('My request reached you'));
  // No date on the letter: a visible gap, never a crash (K2-9).
  assert.ok(render({ ...PERSON, letterDate: '', situation: 'reminder' }).text.startsWith('Eksempel Handel AS\n\n[date]\n\n'));
  assert.ok(render({ ...PERSON, requestDate: '', situation: 'reminder' }).text.includes('my request of [date] for'));
  assert.ok(render({ ...PERSON, lang: 'nb', answerDate: 'not a date', situation: 'identity' }).text.includes('meldingen deres av [dato]'));
  // No deadline date is ever computed into a letter.
  for (const c of FU) {
    const typed = ['2026-12-01', '2026-10-12', '2026-11-10', '2026-11-20'];
    const dates = [...render(c.input).text.matchAll(/\b(\d{1,2})\.? (January|February|March|April|May|June|July|August|September|October|November|December|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember) (\d{4})\b/g)];
    for (const d of dates) assert.ok(typed.some((iso) => Number(iso.slice(8)) === Number(d[1])), `${c.id}: ${d[0]}`);
  }
});

test('the tone rules hold (FU-3, spec 3.5): no threat, no reserved rights, no time limit of our own, no reasons for the request', () => {
  for (const c of FU) {
    const t = render(c.input).text;
    assert.deepEqual(abuseWords(t), [], c.id);
    assert.ok(!/reserve the right|without prejudice|in return for|forbeholder meg|legal action|lawyer|advokat|Datatilsynet|\bcourts?\b(?! of Justice)|two weeks|14 days|to uker|14 dager|otherwise|ellers/i.test(t), c.id);
    // Complaints are named only where Article 12(4) obliges the company to tell the person about them.
    for (const m of t.matchAll(/complaint|klage/g)) {
      const around = t.slice(Math.max(0, m.index - 160), m.index + 160);
      assert.match(around, /supervisory authority|tilsynsmyndighet/, c.id);
    }
  }
});

test('the citation lint and the copy rules hold for every follow-up', () => {
  for (const c of FU) {
    const t = render(c.input).text;
    assert.deepEqual(unknownCitations(t), [], c.id);
    assert.deepEqual(copyProblems(t), [], c.id);
  }
});

test('normalising is idempotent, a spread copy keeps its options, and odd input never throws (K2-8, K2-9)', () => {
  const n = normalise({ ...PERSON, situation: 'refusal', refusal: { part: true, noReasons: true } });
  assert.equal(normalise(n), n);
  assert.equal(render(n).text, render({ ...n }).text);
  assert.ok(render({ ...n, lang: 'nb' }).text.includes('der dere avslo deler av anmodningen.'));
  assert.ok(render({ ...n, noComplaint: true }).text.includes('Your answer does not tell me'));
  for (const bad of [null, undefined, {}, { lang: 'fr', situation: 'reminder' }, { situation: 'partial', received: null }, { situation: 'identity', identity: null }]) {
    // Odd input on purpose (null where an object goes, a language there is no letter in).
    assert.doesNotThrow(() => render(bad as FollowUpInput), String(JSON.stringify(bad)));
    assert.doesNotThrow(() => missing(bad as FollowUpInput));
  }
});

test('what is still missing, per situation', () => {
  const blank = { situation: 'reminder' };
  assert.deepEqual(missing(blank), ['the company\'s name (step 2)', 'your full name (step 3)', 'the date on the letter', 'your email address or postal address (step 3)', 'the date of your first letter']);
  // A narrowed first letter with no words for what it covered (K2-6).
  assert.deepEqual(missing({ ...PERSON, situation: 'partial', scope: 'some' }), ['what your first letter covered (step 4)']);
  assert.deepEqual(missing({ ...PERSON, situation: 'partial', scope: 'some', received: { copy: true } }), []);
  assert.deepEqual(missing({ ...PERSON, situation: 'reminder' }), []);
  assert.deepEqual(missing({ ...PERSON, situation: 'partial', answerDate: '' }), ['the date of their answer']);
  assert.deepEqual(missing({ ...PERSON, situation: 'extension' }), ['what was wrong with the extension']);
  assert.deepEqual(missing({ ...PERSON, situation: 'extension', receivedDate: '', extension: { late: true } }), ['the date your letter reached them (one you can show)']);
  assert.deepEqual(missing({ ...PERSON, situation: 'refusal' }), ['what their answer left out']);
  // The § 16 tick does not count where the § 16 line cannot appear.
  assert.deepEqual(missing({ ...PERSON, situation: 'refusal', based: 'EEA', refusal: { no16: true } }), ['what their answer left out']);
  assert.deepEqual(missing({ ...PERSON, situation: 'identity', replyBy: 'post' }), ['your postal address (step 3)']);
});

test('the check beside a reminder and an extension counts from the date it reached them (FU-5)', () => {
  // 5 March 2026 reached them: the month ends on Easter Monday 6 April 2026, so the deadline is Tuesday 7 April (spec 5.5).
  assert.deepEqual(reminderCheck({ receivedDate: '2026-03-05', letterDate: '2026-04-06' }), { deadline: '2026-04-07', early: true });
  assert.equal(reminderCheck({ receivedDate: '2026-03-05', letterDate: '2026-04-08' })?.early, false);
  assert.equal(reminderCheck({ receivedDate: '', letterDate: '2026-04-08' }), null);
  assert.deepEqual(extensionCheck({ receivedDate: '2026-10-12', answerDate: '2026-11-12' }), { deadline: '2026-11-12', late: false });
  assert.equal(extensionCheck({ receivedDate: '2026-10-12', answerDate: '2026-11-13' })?.late, true);
  assert.equal(extensionCheck({ receivedDate: '2026-10-12', answerDate: '' }), null);
  assert.equal(followUpFileName('2026-12-01'), 'follow-up-2026-12-01.txt');
});
