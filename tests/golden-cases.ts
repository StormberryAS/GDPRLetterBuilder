// The option sets the letter goldens cover (spec section 13): everything, a narrowed scope, each
// ground alone, all grounds, the extras on and off, Norway and not Norway, DPO and not, email and
// post, a paper copy, both languages. Made-up people and companies only. Shared by
// tests/letters.test.ts and tests/update-goldens.ts. Not a test file itself.

import type { LetterInput } from '#src/letters.js';

export const PERSON = {
  letterDate: '2026-10-12',
  company: 'Eksempel Handel AS',
  companyEmail: 'personvern@eksempel-handel.example',
  name: 'Kari Nordmann',
  email: 'kari.nordmann@example.no',
};

const ADDRESS = { address: 'Storgata 1\n5300 Kleppestø', companyAddress: 'Postboks 123 Sentrum\n0101 Oslo' };
const IDS = { identifiers: [{ label: 'email', value: 'kari@example.no' }, { label: 'customer', value: 'K-40213' }] };

const base: Array<[string, LetterInput]> = [
  ['access-minimal', { kind: 'access' }],
  ['access-everything', { kind: 'access', dpo: true, ...ADDRESS, ...IDS, consultations: true }],
  ['access-narrowed', { kind: 'access', scope: 'some', scopeText: 'my orders from 2024' }],
  ['access-eea', { kind: 'access', based: 'EEA' }],
  ['access-outside', { kind: 'access', based: 'OUTSIDE', dpo: true }],
  ['access-post-paper', { kind: 'access', channel: 'post', copyFormat: 'paper', replyBy: 'post', ...ADDRESS }],
  ['access-webform', { kind: 'access', channel: 'webform' }],
  ['access-post-electronic', { kind: 'access', channel: 'post', ...ADDRESS }],
  ['erasure-minimal', { kind: 'erasure' }],
  ['erasure-ground-a', { kind: 'erasure', grounds: { a: true } }],
  ['erasure-ground-b', { kind: 'erasure', grounds: { b: true } }],
  ['erasure-ground-c', { kind: 'erasure', grounds: { c: true } }],
  ['erasure-ground-d', { kind: 'erasure', grounds: { d: true }, groundDText: 'you kept my data after I closed my account.' }],
  ['erasure-ground-e', { kind: 'erasure', grounds: { e: true } }],
  ['erasure-ground-f', { kind: 'erasure', grounds: { f: true } }],
  ['erasure-all-grounds', { kind: 'erasure', grounds: { a: true, b: true, c: true, d: true, e: true, f: true } }],
  ['erasure-extras-on', { kind: 'erasure', tellRecipients: true, madePublic: true, copyFirst: true, dpo: true, ...ADDRESS, ...IDS }],
  ['erasure-extras-off', { kind: 'erasure', tellRecipients: false, madePublic: false, copyFirst: false }],
  ['erasure-narrowed-marketing', { kind: 'erasure', scope: 'some', scopeText: 'the data you use for marketing', grounds: { c: true } }],
  ['erasure-post', { kind: 'erasure', channel: 'post', replyBy: 'post', based: 'EEA', ...ADDRESS }],
];

/** One golden letter: its file name (without .txt) and the answers it is rendered from. */
export interface LetterCase { id: string; input: LetterInput }

export const CASES: LetterCase[] = [];
for (const [id, input] of base) {
  for (const lang of ['en', 'nb']) CASES.push({ id: `${id}.${lang}`, input: { ...PERSON, ...input, lang } });
}
