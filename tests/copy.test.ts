// The writing rules (spec sections 3.5, 13 and 15, and the Stormberry copy rules): no em or en
// dashes and no double hyphens anywhere, code comments included; no exclamation marks; British
// spelling; no claims the app cannot back; no verdicts; and, in the letters, none of the words that
// can make a request read as abusive (C-526/24).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '#src/letters.js';
import { CASES } from './golden-cases.ts';
import { GATE, abuseWords, copyProblems, htmlText } from './legal-pages.ts';
import { WARNINGS } from '#src/personal-data.js';
import { computeDeadline, explainDeadline } from '#src/deadline.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// Every text file in the repository, the third-party font files and licence text left out.
function textFiles(dir = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (/^(fonts|licences)(\/|$)|^\.git(\/|$)/.test(rel)) continue;
    // TypeScript for the type check (npm ci), third-party and ignored (.gitignore).
    if (rel === 'node_modules') continue;
    // Stage 3: the Android build's output and machine-local files (android/.gitignore), and the
    // third-party files the Android project carries verbatim: Gradle's wrapper and the Apache
    // licence text, kept as published like the Inter licence above.
    if (/^android\/(\.gradle|build|app\/build|\.kotlin|local\.properties|licences|gradlew|gradlew\.bat|gradle\/wrapper\/gradle-wrapper\.jar)(\/|$)/.test(rel)) continue;
    if (statSync(p).isDirectory()) out.push(...textFiles(p));
    else if (!/\.(png|woff2?)$/.test(name)) out.push(rel);
  }
  return out;
}

test('no em or en dash, and no double hyphen used as a dash, in any file of the repository, code comments included', () => {
  const files = textFiles();
  assert.ok(files.length > 40);
  for (const f of files) {
    const text = read(f).replace(/<!--|-->/g, '').replace(/^---$/gm, '');
    assert.ok(!/[\u2013\u2014]/.test(text), `${f} has an em or en dash`);
    assert.ok(!/(^|[\s(])--(?=[\s).,]|$)/m.test(text), `${f} uses a double hyphen as a dash`);
  }
});

test('the page, the privacy page and the README: no exclamation marks, British spelling, no claims, no verdicts', () => {
  for (const f of ['index.html', 'privacy.html']) assert.deepEqual(copyProblems(htmlText(read(f))), [], f);
  // The README's commands keep their flags (--out, --check): code is left out of the copy rules.
  const readme = read('README.md').replace(/^ {4}.*$/gm, '').replace(/`[^`]*`/g, '');
  assert.deepEqual(copyProblems(readme), []);
});

test('the disclaimer\'s own section, the notice, the warnings and the deadline words follow the same rules', () => {
  const md = read('DISCLAIMER.md');
  const own = md.slice(md.indexOf('## Specific to GDPRLetterBuilder'), md.indexOf('## No warranty'));
  assert.deepEqual(copyProblems(own.replace(/\s+/g, ' ')), []);
  assert.deepEqual(copyProblems([GATE.title, ...GATE.paragraphs, GATE.ack].join('\n')), []);
  assert.deepEqual(copyProblems(Object.values(WARNINGS).join('\n')), []);
  const e = explainDeadline(computeDeadline('2026-03-05'));
  assert.deepEqual(copyProblems([e.headline, e.counted, ...e.lines, e.extension].join('\n')), []);
});

test('the letters: no dashes, no exclamation marks, British spelling, and none of the abuse-risk words', () => {
  for (const c of CASES) {
    const t = render(c.input).text;
    assert.deepEqual(copyProblems(t), [], c.id);
    assert.deepEqual(abuseWords(t), [], c.id);
    assert.ok(!/reserve the right|without prejudice|in return for|forbeholder meg/i.test(t), c.id);
  }
});

test('the lint catches what it should (so a pass means something)', () => {
  assert.equal(copyProblems('A \u2014 B').length, 1);
  assert.equal(copyProblems(`A ${'-'.repeat(2)} B`).length, 1);
  assert.equal(copyProblems('Done!').length, 1);
  assert.equal(copyProblems('the color and the center').length, 2);
  assert.equal(copyProblems('We guarantee a safe, official, legally binding letter').length >= 1, true);
  assert.equal(copyProblems('They are late and the company has broken the law. You are entitled to it.').length, 3);
  assert.deepEqual(copyProblems('It does not tell you whether a company has broken the law.'), []);
  assert.deepEqual(copyProblems('colour, organise, licence, the safeguards that apply, grey, centre'), []);
  assert.deepEqual(abuseWords('I want compensation and damages, or I will sue. Jeg krever erstatning.'), ['compensation', 'damages', 'sue', 'erstatning']);
});

test('the page says "information, not legal advice" where the spec puts it, and "Save", never "Download"', () => {
  const html = read('index.html');
  const text = htmlText(html);
  assert.ok(text.includes('Information, not legal advice. This page sends nothing: you send the letter yourself.'));
  assert.ok(text.includes('A standard letter. Read it, change anything that is not right, and send it yourself.'));
  assert.ok(text.includes('The letters are fixed texts checked against the sources listed below. Nothing is written by AI while you use this page.'));
  assert.ok(text.includes('Nothing you type is sent anywhere by this page. Disconnect and try it.'));
  assert.ok(text.includes('Runs entirely on your device: our own code and the Inter typeface. Nothing is sent.'));
  assert.ok(text.includes('Law and guidance checked on 12 October 2026.'));
  assert.ok(read('README.md').includes('**Information, not legal advice.**'));
  const main = htmlText(html.slice(html.indexOf('<!-- APP-UI:START -->'), html.indexOf('<!-- APP-UI:END -->')));
  assert.ok(!/\bdownload/i.test(main), 'Save, never Download (OUT-9)');
  assert.ok(!/\bdownload/i.test(read('app.js').replace(/a\.download|\bdownload =/g, '')), 'no Download in the app\'s words');
});

test('English first, the Norwegian name in brackets, for the authority and the act', () => {
  const text = htmlText(read('index.html'));
  assert.ok(text.includes('Norwegian Data Protection Authority (Datatilsynet)'));
  assert.ok(text.includes('Norwegian Personal Data Act') || text.includes('the Personal Data Act'));
  assert.ok(!/Datatilsynet \(Norwegian Data Protection Authority\)/.test(text));
  assert.ok(!/\bBergen\b/.test(text), 'Stormberry is placed in Askøy, Norway');
});
