// The option sets the stage 2 goldens cover (spec section 21.7): every follow-up situation for
// both kinds, each option on and off, a Data Protection Officer and a reply by post, the reply
// checker's lists, and the cover note's order, notes, undated rows and attachments. Made-up
// people and companies only. Shared by tests/followups.test.ts, tests/timeline.test.ts and
// tests/update-goldens.ts. Not a test file itself.

import type { FollowUpInput } from '#src/followups.js';
import type { TimelineInput } from '#src/timeline.js';

export const PERSON = {
  letterDate: '2026-12-01',
  company: 'Eksempel Handel AS',
  companyEmail: 'personvern@eksempel-handel.example',
  name: 'Kari Nordmann',
  email: 'kari.nordmann@example.no',
  requestDate: '2026-10-12',
  receivedDate: '2026-10-12',
  answerDate: '2026-11-10',
};

const POST = { dpo: true, companyAddress: 'Postboks 123 Sentrum\n0101 Oslo', address: 'Storgata 1\n5300 Kleppestø', replyBy: 'post' };
const ALL_BUT_CONSULTATIONS = { copy: true, purposes: true, categories: true, recipients: true, storage: true, source: true, automated: true, transfers: true, rights: true };

const followups: Array<[string, FollowUpInput]> = [
  ['reminder-access', { situation: 'reminder' }],
  ['reminder-erasure-no-receipt-date', { kind: 'erasure', situation: 'reminder', receivedDate: '' }],
  ['reminder-dpo-post', { situation: 'reminder', ...POST }],
  ['partial-access-nothing-ticked', { situation: 'partial' }],
  ['partial-access-some-ticked', { situation: 'partial', received: { copy: true, purposes: true, categories: true } }],
  ['partial-access-consultations-narrowed', { situation: 'partial', consultations: true, scope: 'some', scopeText: 'my orders from 2024', received: ALL_BUT_CONSULTATIONS }],
  ['partial-erasure-extras', { kind: 'erasure', situation: 'partial', copyFirst: true, tellRecipients: true }],
  ['partial-erasure-minimal', { kind: 'erasure', situation: 'partial', tellRecipients: false, received: { kept: true } }],
  ['extension-no-reasons', { situation: 'extension', extension: { noReasons: true } }],
  ['extension-late', { situation: 'extension', answerDate: '2026-11-20', extension: { late: true } }],
  ['extension-both-erasure', { kind: 'erasure', situation: 'extension', answerDate: '2026-11-20', extension: { noReasons: true, late: true } }],
  ['refusal-all-no-reasons', { situation: 'refusal', refusal: { noReasons: true } }],
  ['refusal-part-16-complaint', { situation: 'refusal', refusal: { part: true, no16: true, noComplaint: true } }],
  ['refusal-16-ignored-eea', { situation: 'refusal', based: 'EEA', refusal: { no16: true, noComplaint: true } }],
  ['refusal-erasure-everything', { kind: 'erasure', situation: 'refusal', ...POST, refusal: { part: true, noReasons: true, no16: true, noComplaint: true } }],
  ['identity-document-email', { situation: 'identity', identity: { document: true, fromEmail: true } }],
  ['identity-other-logged-in-erasure', { kind: 'erasure', situation: 'identity', identity: { document: false, loggedIn: true } }],
  ['identity-plain', { situation: 'identity' }],
];

const TL = { noteDate: '2026-12-20', company: 'Eksempel Handel AS', name: 'Kari Nordmann' };
const timelines: Array<[string, TimelineInput]> = [
  ['timeline-full', { ...TL, missingText: 'The names of the recipients, and how long they keep my data.', events: [
    { date: '2026-11-10', type: 'partial', note: 'No recipients were named', attach: true },
    { date: '2026-10-12', type: 'sent', note: 'By email', attach: true },
    { date: '2026-10-12', type: 'received', attach: false },
    { date: '2026-12-01', type: 'followup', attach: true },
    { date: '2026-10-14', type: 'confirmed', note: 'An automatic reply.', attach: false },
  ] }],
  ['timeline-erasure-one-event', { ...TL, kind: 'erasure', events: [{ date: '2026-10-12', type: 'sent', attach: true }] }],
  ['timeline-other-undated', { ...TL, events: [
    { date: '2026-11-02', type: 'other', note: 'I called their customer service, who said they had no record of my letter' },
    { date: '', type: 'reminder', attach: true },
    { date: '2026-10-20', type: 'other', note: '' },
    { date: '2026-10-12', type: 'sent', attach: true },
    { date: '2026-11-03', type: 'reminder', attach: true },
  ] }],
];

/** One stage 2 golden: a follow-up letter or a cover note's timeline, and its answers. */
export type Stage2Case =
  | { id: string; kind: 'followup'; input: FollowUpInput }
  | { id: string; kind: 'timeline'; input: TimelineInput };

export const CASES: Stage2Case[] = [];
for (const [id, input] of followups) {
  for (const lang of ['en', 'nb']) CASES.push({ id: `${id}.${lang}`, kind: 'followup', input: { ...PERSON, ...input, lang } });
}
for (const [id, input] of timelines) {
  for (const lang of ['en', 'nb']) CASES.push({ id: `${id}.${lang}`, kind: 'timeline', input: { ...input, lang } });
}
