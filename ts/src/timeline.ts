/*! src/timeline.js is compiled from ts/src/timeline.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */

// The complaint cover note (spec section 21.5, stage 2): a one-page dated timeline the person
// attaches to a complaint to Datatilsynet. Facts only (FU-9): dated events from a fixed list, the
// person's own short note on each, what is missing in their own words, what they want, and the
// attachments numbered in order. No counted deadline, no legal argument, no article numbers,
// because Datatilsynet asks for facts and warns that AI tools cite wrong or non-existent law.
//
// The wording is spec section 21.5, word for word. Pure: no DOM, no clock.

import { clean, LIMITS } from './letters.js';
import type { Kind, Lang } from './letters.js';
import { compareIso, isIsoDate, letterDate } from './format.js';

export type EventType = keyof typeof EVENTS;

/**
 * The cover note's answers as the page hands them over.
 */
export interface TimelineInput {
  lang?: string;
  kind?: string;
  /** YYYY-MM-DD */
  noteDate?: string;
  company?: string;
  name?: string;
  missingText?: string;
  events?: Array<{ date?: string; type?: string; note?: string; attach?: boolean } | null | undefined>;
}
export type Note = ReturnType<typeof normalise>;
export type Row = Note['rows'][number];

export const EVENT_TYPES: EventType[] = ['sent', 'received', 'confirmed', 'extended', 'identity', 'partial', 'answered', 'refused', 'reminder', 'followup', 'other'];

// Each event: its sentence and its attachment label, in English and Bokmål. "other" has no
// sentence: the person's note is the event.
export const EVENTS = {
  sent: { en: 'I sent my request to the company.', nb: 'Jeg sendte anmodningen til virksomheten.', attEn: 'My request', attNb: 'Anmodningen min' },
  received: { en: 'The company received my request.', nb: 'Virksomheten mottok anmodningen.', attEn: 'Proof that the company received my request', attNb: 'Dokumentasjon på at virksomheten mottok anmodningen' },
  confirmed: { en: 'The company confirmed that it had received my request.', nb: 'Virksomheten bekreftet at den hadde mottatt anmodningen.', attEn: 'The company\'s confirmation of receipt', attNb: 'Mottaksbekreftelsen fra virksomheten' },
  extended: { en: 'The company told me it was extending the time limit.', nb: 'Virksomheten informerte meg om at fristen ble forlenget.', attEn: 'The company\'s message about the extension', attNb: 'Meldingen fra virksomheten om forlengelsen' },
  identity: { en: 'The company asked for information about my identity.', nb: 'Virksomheten ba om opplysninger om identiteten min.', attEn: 'The company\'s request about my identity', attNb: 'Henvendelsen fra virksomheten om identiteten min' },
  partial: { en: 'The company answered, but not fully.', nb: 'Virksomheten svarte, men ikke fullstendig.', attEn: 'The company\'s answer', attNb: 'Svaret fra virksomheten' },
  answered: { en: 'The company answered.', nb: 'Virksomheten svarte.', attEn: 'The company\'s answer', attNb: 'Svaret fra virksomheten' },
  refused: { en: 'The company refused my request, in whole or in part.', nb: 'Virksomheten avslo anmodningen, helt eller delvis.', attEn: 'The company\'s refusal', attNb: 'Avslaget fra virksomheten' },
  reminder: { en: 'I sent a reminder.', nb: 'Jeg sendte en påminnelse.', attEn: 'My reminder', attNb: 'Påminnelsen min' },
  followup: { en: 'I sent a follow-up letter.', nb: 'Jeg sendte et oppfølgingsbrev.', attEn: 'My follow-up letter', attNb: 'Oppfølgingsbrevet mitt' },
  other: { en: '', nb: '', attEn: 'Document', attNb: 'Dokument' },
};

// The page's labels for the list (English, like the rest of the page).
export const EVENT_LABELS = {
  sent: 'I sent my request',
  received: 'They received it',
  confirmed: 'They confirmed receipt',
  extended: 'They extended the time limit',
  identity: 'They asked about my identity',
  partial: 'They answered, but not fully',
  answered: 'They answered',
  refused: 'They refused',
  reminder: 'I sent a reminder',
  followup: 'I sent a follow-up letter',
  other: 'Other',
};

const MISSING = {
  company: { en: '[Company name]', nb: '[Virksomhetens navn]' },
  name: { en: '[Your full name]', nb: '[Fullt navn]' },
};

/**
 * A note as a sentence: a comma, semicolon or colon at its end taken off, then a full stop unless
 * it already ends with one, a question mark or an exclamation mark, a closing quotation mark or
 * bracket after it included (K2-14).
 */
function sentence(note: string): string {
  const t = String(note || '').replace(/[,;:\s]+$/, '');
  if (!t) return '';
  return /[.!?]["'\u201d\u2019\u00bb)\]]*$/.test(t) ? t : `${t}.`;
}

/**
 * The answers the note is built from, cleaned.
 */
export function normalise(input?: TimelineInput | null) {
  input = input || {};
  const lang: Lang = input.lang === 'en' ? 'en' : 'nb';
  const rows = (Array.isArray(input.events) ? input.events : []).map((e, i) => ({
    i,
    date: e && isIsoDate(e.date) ? e.date : '',
    type: EVENT_TYPES.includes((e && e.type) as EventType) ? ((e && e.type) as EventType) : 'other',
    note: clean(e && e.note),
    attach: !!(e && e.attach),
  }));
  return {
    lang,
    kind: (input.kind === 'erasure' ? 'erasure' : 'access') as Kind,
    noteDate: isIsoDate(input.noteDate) ? input.noteDate : '',
    company: clean(input.company),
    name: clean(input.name),
    missingText: clean(input.missingText, { multiline: true, max: LIMITS.text }),
    rows,
  };
}

/**
 * The events that go into the note: dated ones, by date, rows on the same date in the order they
 * were added; an "other" row needs a note. Each carries its attachment number, or 0.
 */
export function orderedEvents(input?: TimelineInput | null) {
  return eventsOf(normalise(input));
}

function eventsOf(s: Note): Array<Row&{ attachment: number; }> {
  const kept = s.rows.filter((r) => r.date && (r.type !== 'other' || r.note));
  kept.sort((a, b) => compareIso(a.date, b.date) || a.i - b.i);
  let n = 0;
  return kept.map((r) => ({ ...r, attachment: r.attach ? (n += 1) : 0 }));
}

/**
 * How many rows the note leaves out for want of a date (the page says so).
 */
export function undatedCount(input?: TimelineInput | null): number {
  return normalise(input).rows.filter((r) => !r.date && (r.type !== 'other' || r.note)).length;
}

/**
 * How many dated "Other" rows the note leaves out for want of a note (the page says so, K2-2).
 */
export function emptyOtherCount(input?: TimelineInput | null): number {
  return normalise(input).rows.filter((r) => r.date && r.type === 'other' && !r.note).length;
}

/**
 * The cover note as text, with \n line ends and no trailing line break.
 */
export function render(input?: TimelineInput | null): string {
  const s = normalise(input);
  const en = s.lang === 'en';
  const L = s.lang;
  const company = s.company || MISSING.company[L];
  const name = s.name || MISSING.name[L];
  const events = eventsOf(s);
  const when = (iso: string) => letterDate(iso, L);
  const line = (e: Row&{ attachment: number; }) => {
    const text = e.type === 'other' ? sentence(e.note) : `${EVENTS[e.type][L]}${e.note ? ` ${sentence(e.note)}` : ''}`;
    const att = e.attachment ? (en ? ` (Attachment ${e.attachment})` : ` (vedlegg ${e.attachment})`) : '';
    return `- ${when(e.date)}: ${text}${att}`;
  };
  const parts: string[] = [];
  parts.push(en
    ? `Timeline: request for ${s.kind === 'erasure' ? 'erasure of' : 'access to'} my personal data, ${company}`
    : `Tidslinje: anmodning om ${s.kind === 'erasure' ? 'sletting av' : 'innsyn i'} personopplysninger om meg, ${company}`);
  parts.push(en
    ? `From: ${name}\nCompany: ${company}\nDate: ${s.noteDate ? when(s.noteDate) : '[date]'}`
    : `Fra: ${name}\nVirksomhet: ${company}\nDato: ${s.noteDate ? when(s.noteDate) : '[dato]'}`);
  parts.push([en ? 'What happened:' : 'Hva som har skjedd:', ...events.map(line)].join('\n'));
  if (s.missingText) parts.push(`${en ? 'What is missing:' : 'Hva som mangler:'}\n${s.missingText}`);
  parts.push(en
    ? `What I want: ${s.kind === 'erasure' ? 'erasure of the personal data my request covers' : 'access to the personal data my request covers and the information I asked for'}.`
    : `Hva jeg ønsker: ${s.kind === 'erasure' ? 'at virksomheten sletter personopplysningene anmodningen gjelder' : 'å få innsyn i personopplysningene anmodningen gjelder og informasjonen jeg ba om'}.`);
  const att = events.filter((e) => e.attachment);
  if (att.length) {
    parts.push([en ? 'Attachments:' : 'Vedlegg:', ...att.map((e) => `${e.attachment}. ${en ? EVENTS[e.type].attEn : EVENTS[e.type].attNb} (${when(e.date)})`)].join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * What is still missing for a note someone can attach, as short English phrases.
 */
export function missing(input?: TimelineInput | null): string[] {
  const s = normalise(input);
  const out: string[] = [];
  if (!s.company) out.push('the company\'s name (step 2)');
  if (!s.name) out.push('your full name (step 3)');
  if (!eventsOf(s).length) out.push('at least one dated event');
  return out;
}

/**
 * A neutral file name (FU-12): the note's date only.
 */
export function timelineFileName(iso: string): string {
  return `timeline-${iso}.txt`;
}
