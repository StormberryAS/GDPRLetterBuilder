// The letters (spec sections 3 and 13): goldens for every option set, the legal guards the
// legal-accuracy review of 12 October 2026 asked for, the tone rules, and the cleaning of what a
// person types. tests/spec-wording.test.ts checks the same templates against the spec's own text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CLAUSES, DEADLINE_EN, DEADLINE_NB, REFUSAL_EN, REFUSAL_NB, clean, missing, normalise, plan, render } from '#src/letters.js';
import { CASES, PERSON } from './golden-cases.ts';

const goldens = new URL('./goldens/', import.meta.url);

test('every golden letter is exactly what the templates write now', () => {
  for (const c of CASES) {
    const want = readFileSync(new URL(`${c.id}.txt`, goldens), 'utf8');
    assert.equal(`${render(c.input).text}\n`, want, `${c.id}: the letter changed. If the change is meant, run node tests/update-goldens.ts and read the diff.`);
  }
  // No golden left behind for a case that no longer exists.
  assert.deepEqual(readdirSync(goldens).filter((f) => f.endsWith('.txt')).sort(), CASES.map((c) => `${c.id}.txt`).sort());
  assert.equal(CASES.length, 40);
});

test('the deadline sentence always carries the extension rule, in the law\'s own words (Article 12(3))', () => {
  for (const c of CASES) {
    const t = render(c.input).text;
    assert.ok(t.includes(c.input.lang === 'nb' ? DEADLINE_NB : DEADLINE_EN), c.id);
    assert.ok(t.includes(c.input.lang === 'nb' ? REFUSAL_NB : REFUSAL_EN), c.id);
  }
  assert.match(DEADLINE_EN, /without undue delay and in any event within one month of receipt of the request\. That period may be extended by two further months only where necessary, taking into account the complexity and number of the requests/);
  assert.match(DEADLINE_NB, /uten ugrunnet opphold og senest én måned etter mottak av anmodningen\. Fristen kan ved behov forlenges med ytterligere to måneder/);
  // Article 12(4)'s own period, never "within the same period".
  assert.ok(!/within the same period/.test(REFUSAL_EN));
  assert.match(REFUSAL_EN, /without delay and at the latest within one month of receipt/);
});

test('no letter quotes a computed date or a deadline of its own (LET-1)', () => {
  for (const c of CASES) {
    const t = render(c.input).text;
    const dates = t.match(/\b\d{1,2}\.? (January|February|March|April|May|June|July|August|September|October|November|December|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember) \d{4}\b/g) || [];
    assert.deepEqual(dates, [c.input.lang === 'nb' ? '12. oktober 2026' : '12 October 2026'], `${c.id}: only the letter date`);
  }
});

test('the personopplysningsloven § 16 line: access letter only, and only for a company based in Norway', () => {
  for (const c of CASES) {
    const t = render(c.input).text;
    const has = /section 16 of the Norwegian Personal Data Act|personopplysningsloven § 16/.test(t);
    const want = c.input.kind === 'access' && (c.input.based || 'NO') === 'NO';
    assert.equal(has, want, c.id);
  }
});

test('the Article 15(3) citation after "a commonly used electronic form" appears only for email and web forms', () => {
  const s = { ...PERSON, kind: 'access' };
  assert.match(render({ ...s, channel: 'email' }).text, /in a commonly used electronic form \(Article 15\(3\)\)\./);
  assert.match(render({ ...s, channel: 'webform' }).text, /in a commonly used electronic form \(Article 15\(3\)\)\./);
  assert.match(render({ ...s, channel: 'post' }).text, /Please send the copy in a commonly used electronic form\.\n/);
  assert.match(render({ ...s, channel: 'post', lang: 'nb' }).text, /Jeg ber om å få kopien i en vanlig elektronisk form\.\n/);
  assert.match(render({ ...s, channel: 'email', lang: 'nb' }).text, /i en vanlig elektronisk form \(artikkel 15 nr\. 3\)\./);
  assert.match(render({ ...s, channel: 'email', copyFormat: 'paper' }).text, /Please send the copy on paper, by post to the address below\./);
});

test('clause 10 asks for information about consultations, never "a copy of the log" (C-579/21)', () => {
  for (const c of CASES) {
    const t = render(c.input).text.toLowerCase();
    assert.ok(!t.includes('copy of the log') && !t.includes('kopi av loggen'), c.id);
  }
  const on = render({ ...PERSON, consultations: true }).text;
  assert.match(on, /10\. information about any consultations \(look-ups\) of my personal data, with the date and purpose of each \(Court of Justice of the European Union, case C-579\/21\)\./);
  assert.match(on, /9\. information about my rights[^\n]*supervisory authority;\n10\./);
  const off = render({ ...PERSON }).text;
  assert.ok(!/\n10\./.test(off));
  assert.match(off, /9\. information about my rights[^\n]*supervisory authority\.\n/);
});

test('clause 7 is limited to decisions referred to in Article 22(1) and (4); identity uses the law\'s "necessary"', () => {
  const en = render({ ...PERSON }).text;
  assert.match(en, /of the kind referred to in Article 22\(1\) and \(4\)/);
  assert.match(en, /what additional information is necessary to confirm it \(Article 12\(6\)\)/);
  const nb = render({ ...PERSON, lang: 'nb' }).text;
  assert.match(nb, /som nevnt i artikkel 22 nr\. 1 og 4/);
  assert.match(nb, /som er nødvendige for å bekrefte identiteten min/);
});

test('erasure: the grounds are optional, mapped one to one, the 21(2) line in the words of 17(1)(c), "what you keep" always there', () => {
  const none = render({ ...PERSON, kind: 'erasure' });
  assert.ok(!none.clauses.includes('erasure-grounds'));
  assert.match(none.text, /Under Article 17 of the General Data Protection Regulation \(GDPR\), I ask you to erase, without undue delay, all the personal data you hold about me\.\n/);
  // The deadline phrase stands before the scope, so it cannot be read as part of it (review of 12 October 2026).
  const some = render({ ...PERSON, kind: 'erasure', scope: 'some', scopeText: 'the data used for marketing.' }).text;
  assert.match(some, /I ask you to erase, without undue delay, the following personal data about me: the data used for marketing\.\n/);
  assert.ok(!/marketing without undue delay|marketing\.\./.test(some));
  const nbAll = render({ ...PERSON, lang: 'nb', kind: 'erasure' }).text;
  assert.match(nbAll, /\n\nJeg ber om at dere uten ugrunnet opphold sletter alle personopplysningene dere behandler om meg, jf\. personvernforordningen \(GDPR\) artikkel 17\.\n/);
  const nbSome = render({ ...PERSON, lang: 'nb', kind: 'erasure', scope: 'some', scopeText: 'opplysningene som brukes til markedsføring' }).text;
  assert.match(nbSome, /\n\nEtter personvernforordningen \(GDPR\) artikkel 17 ber jeg om at dere uten ugrunnet opphold sletter disse personopplysningene om meg: opplysningene som brukes til markedsføring\.\n/);
  // The keep sentence speaks of the data this request covers, so a narrowed request is not widened.
  assert.match(some, /If you do not erase some or all of the personal data this request covers,/);
  assert.match(nbSome, /Hvis dere ikke sletter alle personopplysningene denne anmodningen gjelder,/);
  // Article 12(3) once in the erasure letter's deadline paragraph, not twice in a row.
  assert.match(none.text, /tell me in writing what you have done\. Under Article 12\(3\), you must/);
  assert.ok(!/\(Article 12\(3\)\)\. Under Article 12\(3\)/.test(none.text));
  assert.ok(!/\(artikkel 12 nr\. 3\)\. Etter artikkel 12 nr\. 3/.test(nbAll));
  assert.match(none.text, /please tell me which data you keep, what you rely on and why \(Article 12\(4\)\)\./);
  const map = { a: 'Article 17(1)(a)', b: 'Article 17(1)(b)', c: 'Article 17(1)(c)', d: 'Article 17(1)(d)', e: 'Article 17(1)(e)', f: 'Article 17(1)(f)' };
  for (const [g, cite] of Object.entries(map)) {
    const t = render({ ...PERSON, kind: 'erasure', grounds: { [g]: true } }).text;
    const block = t.slice(t.indexOf('The grounds that apply:'));
    const lines = block.split('\n\n')[0]!.split('\n').slice(1);
    assert.equal(lines.length, 1, g);
    assert.ok(lines[0]!.includes(cite) && lines[0]!.endsWith('.'), `${g}: ${lines[0]}`);
  }
  const c = render({ ...PERSON, kind: 'erasure', grounds: { c: true } }).text;
  assert.match(c, /an objection under Article 21\(2\) is a ground for erasure under Article 17\(1\)\(c\)\./);
  assert.ok(!/Article 17\(1\)\(c\) applies/.test(c));
  assert.ok(!c.includes('C-26/22'));
  const all = render({ ...PERSON, kind: 'erasure', grounds: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 } as unknown as Record<string, boolean> }).text;
  const lines = all.slice(all.indexOf('The grounds that apply:')).split('\n\n')[0]!.split('\n').slice(1);
  assert.equal(lines.length, 6);
  assert.ok(lines.slice(0, -1).every((l) => l.startsWith('- ') && l.endsWith(';')) && lines[5]!.endsWith('.'));
  // § 16 never in an erasure letter (it covers information and access only).
  assert.ok(!/section 16|§ 16/.test(all));
});

test('erasure extras: recipients on by default, made public and copy first off by default', () => {
  const s = normalise({ kind: 'erasure' });
  assert.equal(s.tellRecipients, true);
  assert.equal(s.madePublic, false);
  assert.equal(s.copyFirst, false);
  assert.deepEqual(plan({ kind: 'erasure' }).filter((id) => id.startsWith('erasure-')), ['erasure-opening', 'erasure-recipients', 'erasure-keep']);
  assert.deepEqual(plan({ kind: 'erasure', copyFirst: true, madePublic: true, grounds: { a: true } }).filter((id) => id.startsWith('erasure-')),
    ['erasure-opening', 'erasure-grounds', 'erasure-copy-first', 'erasure-recipients', 'erasure-public', 'erasure-keep']);
});

test('defaults: access, English, email, Norway, everything, an electronic copy; the Bokmål letter has no salutation', () => {
  const s = normalise({});
  assert.deepEqual([s.kind, s.lang, s.channel, s.based, s.scope, s.copyFormat, s.replyBy], ['access', 'en', 'email', 'NO', 'all', 'electronic', 'email']);
  assert.ok(plan({ lang: 'en' }).includes('salutation'));
  assert.ok(!plan({ lang: 'nb' }).includes('salutation'));
  assert.match(render({ ...PERSON, dpo: true }).text, /^Eksempel Handel AS\nFor the attention of the Data Protection Officer\n\n12 October 2026\n\nSubject: [^\n]+\n\nDear Data Protection Officer,\n/);
  assert.match(render({ ...PERSON }).text, /\n\nDear Sir or Madam,\n/);
  assert.match(render({ ...PERSON, lang: 'nb', dpo: true }).text, /^Eksempel Handel AS\nAtt\.: personvernombudet\n\n12\. oktober 2026\n\nInnsyn i personopplysninger om meg \(personvernforordningen artikkel 15\)\n\nJeg ber om innsyn/);
  assert.match(render({ ...PERSON, lang: 'nb' }).text, /\n\nMed vennlig hilsen\n\nKari Nordmann\nkari\.nordmann@example\.no$/);
  assert.match(render({ ...PERSON }).text, /\n\nYours faithfully,\n\nKari Nordmann\nkari\.nordmann@example\.no$/);
});

test('what the person types is cleaned: control characters, direction marks, length caps; it is never read as markup', () => {
  assert.equal(clean('a\u0000b\u0007c'), 'a b c');
  assert.equal(clean('  Kari \t Nordmann  '), 'Kari Nordmann');
  assert.equal(clean('x\u202ey\u200bz\ufeff'), 'xyz');
  assert.equal(clean('Line 1\r\nLine 2\n\n\n\nLine 3', { multiline: true }), 'Line 1\nLine 2\n\nLine 3');
  assert.equal([...clean('ø'.repeat(500))].length, 200);
  assert.equal([...clean('ø'.repeat(5000), { max: 1000 })].length, 1000);
  const t = render({ ...PERSON, company: '<script>alert(1)</script> & Co', name: 'Ola "Test" Nordmann' }).text;
  assert.ok(t.startsWith('<script>alert(1)</script> & Co\n'), 'kept as plain text, never interpreted: the page puts it in a textarea value');
  // A ground (d) reason ends without stray punctuation before the line's own.
  assert.match(render({ ...PERSON, kind: 'erasure', grounds: { d: true }, groundDText: 'you sold my data.;  ' }).text, /\(Article 17\(1\)\(d\)\): you sold my data\.\n/);
  // So does the scope, which ends a sentence or runs into a citation.
  assert.equal(normalise({ scope: 'some', scopeText: 'my orders from 2024. ' }).scopeText, 'my orders from 2024');
  assert.match(render({ ...PERSON, scope: 'some', scopeText: 'my orders from 2024.' }).text, /that concern my orders from 2024 \(Article 15\(3\)\);/);
});

test('missing answers show as bracketed gaps in the letter and in a list', () => {
  const t = render({ letterDate: '2026-10-12', scope: 'some' }).text;
  for (const gap of ['[Company name]', '[Your full name]', '[what it covers]', '[your email address]']) assert.ok(t.includes(gap), gap);
  const nb = render({ letterDate: '2026-10-12', lang: 'nb' }).text;
  for (const gap of ['[Virksomhetens navn]', '[Fullt navn]', '[e-postadresse]']) assert.ok(nb.includes(gap), gap);
  assert.deepEqual(missing({ letterDate: '2026-10-12', scope: 'some', channel: 'post', copyFormat: 'paper' }),
    ['the company\'s name', 'your full name', 'your email address or postal address', 'what the letter covers', 'the company\'s postal address']);
  assert.deepEqual(missing({ ...PERSON, email: '', address: 'Storgata 1' }), ['your email address, or choose a reply by post']);
  assert.deepEqual(missing({ ...PERSON, email: '', address: 'Storgata 1', replyBy: 'post' }), []);
  assert.deepEqual(missing({ ...PERSON, copyFormat: 'paper' }), ['your postal address']);
  assert.deepEqual(missing({ ...PERSON }), []);
});

test('identifiers: the spec\'s labels in both languages, one line each, empty rows left out', () => {
  const ids = [{ label: 'email', value: 'a@b.example' }, { label: 'username', value: 'kari82' }, { label: 'customer', value: '1' }, { label: 'order', value: '2' }, { label: 'membership', value: '3' }, { label: 'other', value: '4' }, { label: 'username', value: '   ' }];
  assert.match(render({ ...PERSON, identifiers: ids }).text, /These details may help you find my data:\nEmail address I use with you: a@b\.example\nUsername: kari82\nCustomer number: 1\nOrder number: 2\nMembership or loyalty number: 3\nOther: 4\n\n/);
  assert.match(render({ ...PERSON, lang: 'nb', identifiers: ids }).text, /Dette kan hjelpe dere å finne opplysningene om meg:\nE-postadresse jeg bruker hos dere: a@b\.example\nBrukernavn: kari82\nKundenummer: 1\nOrdrenummer: 2\nMedlemsnummer: 3\nAnnet: 4\n\n/);
  assert.ok(!render({ ...PERSON, identifiers: [{ label: 'other', value: ' ' }] }).clauses.includes('identifiers'));
});

test('every clause names the citations it prints, and prints no other', async () => {
  const { findCitations, CITATIONS } = await import('#src/citations.js');
  for (const c of CASES) {
    const s = normalise(c.input);
    for (const id of plan(s)) {
      const fn = CLAUSES[id][s.lang];
      if (!fn) continue;
      for (const cite of findCitations(fn(s))) {
        assert.ok((CLAUSES[id].cites as readonly string[]).includes(cite), `${c.id}/${id} prints ${cite} without naming it`);
        assert.ok(CITATIONS.has(cite), `${cite} is not on the verified list`);
      }
    }
  }
});
