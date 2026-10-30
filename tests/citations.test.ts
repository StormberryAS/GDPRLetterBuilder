// The citation lint (spec section 13): every article, paragraph, section or case that a rendered
// letter, the page's guides or the disclaimer names must be on the verified list in
// src/citations.js, with a source key from spec section 18. Anything that looks like a citation
// and is not on the list fails, because Datatilsynet warns that AI tools "viser ofte til feil
// eller ikke-eksisterende lovverk" [DT-KLAGE].

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CITATIONS, SOURCES, findCitations, unknownCitations } from '#src/citations.js';
import { render } from '#src/letters.js';
import { CASES } from './golden-cases.ts';
import { htmlText } from './legal-pages.ts';

// The sources by key, for lookups by a key read from the citation list.
const SRC: Record<string, { label: string; url: string } | undefined> = SOURCES;

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the list itself: every citation has a source key of spec section 18, and every source an https address', () => {
  for (const [form, key] of CITATIONS) assert.ok(SRC[key], `${form} -> ${key} has no source`);
  for (const [key, s] of Object.entries(SOURCES)) {
    assert.match(s.url, /^https:\/\//, key);
    assert.ok(s.label.length > 5, key);
  }
  // The official addresses: EUR-Lex, Lovdata, Curia, the EDPB, Datatilsynet.
  assert.match(SOURCES.GDPR.url, /^https:\/\/eur-lex\.europa\.eu\//);
  assert.match(SOURCES.POPPLYL.url, /^https:\/\/lovdata\.no\/dokument\/NL\/lov\/2018-06-15-38$/);
  for (const c of ['C-154/21', 'C-487/21', 'C-579/21', 'C-307/22', 'C-300/21', 'C-203/22', 'C-526/24']) assert.equal(SRC[c]?.url, `https://curia.europa.eu/juris/liste.jsf?num=${c}`);
});

test('the scan finds what it should, and refuses what is not on the list', () => {
  assert.deepEqual(findCitations('Article 17(1)(c) and Article 22(1) and (4); artikkel 17 nr. 1 bokstav c; personopplysningsloven § 16; §§ 3, 16 and 17; case C-154/21; paragraphs 68, 72 and 78; Examples 31 and 33; Recital 63'),
    ['Article 17(1)(c)', 'Article 22(1)', 'Recital 63', 'artikkel 17 nr. 1 bokstav c', '§ 16', '§ 3', '§ 16', '§ 17', 'C-154/21', 'paragraph 68', 'paragraph 72', 'paragraph 78', 'Example 31', 'Example 33']);
  assert.deepEqual(unknownCitations('Article 99, Article 15(9), artikkel 15 nr. 9, § 99, C-1/99, paragraph 9999, Recital 1'),
    ['Article 99', 'Article 15(9)', 'Recital 1', 'artikkel 15 nr. 9', '§ 99', 'C-1/99', 'paragraph 9999']);
});

test('every rendered letter, in both languages, cites only what is on the list', () => {
  for (const c of CASES) assert.deepEqual(unknownCitations(render(c.input).text), [], c.id);
});

test('the page: its guides, hints and sources cite only what is on the list', () => {
  const text = htmlText(read('index.html'));
  assert.deepEqual(unknownCitations(text), []);
  // And it does cite: the scan is not passing on an empty page.
  assert.ok(findCitations(text).length > 60, String(findCitations(text).length));
});

test('the disclaimer, the privacy page and the README cite only what is on the list', () => {
  assert.deepEqual(unknownCitations(read('DISCLAIMER.md')), []);
  assert.deepEqual(unknownCitations(htmlText(read('privacy.html'))), []);
  assert.deepEqual(unknownCitations(read('README.md')), []);
});

test('every source link on the page goes to an address on the list', () => {
  const html = read('index.html');
  const main = html.slice(html.indexOf('<!-- APP-UI:START -->'), html.indexOf('<!-- APP-UI:END -->'));
  const known = new Set(Object.values(SOURCES).map((s) => s.url));
  const hrefs = [...main.matchAll(/<a [^>]*href="(https:[^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 40);
  for (const h of hrefs) assert.ok(known.has(h!), h);
});
