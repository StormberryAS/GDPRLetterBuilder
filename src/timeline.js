/*! src/timeline.js is compiled from ts/src/timeline.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */
import { clean, LIMITS } from './letters.js?v=11895179';
import { compareIso, isIsoDate, letterDate } from './format.js?v=57ce12f7';
export const EVENT_TYPES = ['sent', 'received', 'confirmed', 'extended', 'identity', 'partial', 'answered', 'refused', 'reminder', 'followup', 'other'];
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
function sentence(note) {
    const t = String(note || '').replace(/[,;:\s]+$/, '');
    if (!t)
        return '';
    return /[.!?]["'\u201d\u2019\u00bb)\]]*$/.test(t) ? t : `${t}.`;
}
export function normalise(input) {
    input = input || {};
    const lang = input.lang === 'en' ? 'en' : 'nb';
    const rows = (Array.isArray(input.events) ? input.events : []).map((e, i) => ({
        i,
        date: e && isIsoDate(e.date) ? e.date : '',
        type: EVENT_TYPES.includes((e && e.type)) ? (e && e.type) : 'other',
        note: clean(e && e.note),
        attach: !!(e && e.attach),
    }));
    return {
        lang,
        kind: (input.kind === 'erasure' ? 'erasure' : 'access'),
        noteDate: isIsoDate(input.noteDate) ? input.noteDate : '',
        company: clean(input.company),
        name: clean(input.name),
        missingText: clean(input.missingText, { multiline: true, max: LIMITS.text }),
        rows,
    };
}
export function orderedEvents(input) {
    return eventsOf(normalise(input));
}
function eventsOf(s) {
    const kept = s.rows.filter((r) => r.date && (r.type !== 'other' || r.note));
    kept.sort((a, b) => compareIso(a.date, b.date) || a.i - b.i);
    let n = 0;
    return kept.map((r) => ({ ...r, attachment: r.attach ? (n += 1) : 0 }));
}
export function undatedCount(input) {
    return normalise(input).rows.filter((r) => !r.date && (r.type !== 'other' || r.note)).length;
}
export function emptyOtherCount(input) {
    return normalise(input).rows.filter((r) => r.date && r.type === 'other' && !r.note).length;
}
export function render(input) {
    const s = normalise(input);
    const en = s.lang === 'en';
    const L = s.lang;
    const company = s.company || MISSING.company[L];
    const name = s.name || MISSING.name[L];
    const events = eventsOf(s);
    const when = (iso) => letterDate(iso, L);
    const line = (e) => {
        const text = e.type === 'other' ? sentence(e.note) : `${EVENTS[e.type][L]}${e.note ? ` ${sentence(e.note)}` : ''}`;
        const att = e.attachment ? (en ? ` (Attachment ${e.attachment})` : ` (vedlegg ${e.attachment})`) : '';
        return `- ${when(e.date)}: ${text}${att}`;
    };
    const parts = [];
    parts.push(en
        ? `Timeline: request for ${s.kind === 'erasure' ? 'erasure of' : 'access to'} my personal data, ${company}`
        : `Tidslinje: anmodning om ${s.kind === 'erasure' ? 'sletting av' : 'innsyn i'} personopplysninger om meg, ${company}`);
    parts.push(en
        ? `From: ${name}\nCompany: ${company}\nDate: ${s.noteDate ? when(s.noteDate) : '[date]'}`
        : `Fra: ${name}\nVirksomhet: ${company}\nDato: ${s.noteDate ? when(s.noteDate) : '[dato]'}`);
    parts.push([en ? 'What happened:' : 'Hva som har skjedd:', ...events.map(line)].join('\n'));
    if (s.missingText)
        parts.push(`${en ? 'What is missing:' : 'Hva som mangler:'}\n${s.missingText}`);
    parts.push(en
        ? `What I want: ${s.kind === 'erasure' ? 'erasure of the personal data my request covers' : 'access to the personal data my request covers and the information I asked for'}.`
        : `Hva jeg ønsker: ${s.kind === 'erasure' ? 'at virksomheten sletter personopplysningene anmodningen gjelder' : 'å få innsyn i personopplysningene anmodningen gjelder og informasjonen jeg ba om'}.`);
    const att = events.filter((e) => e.attachment);
    if (att.length) {
        parts.push([en ? 'Attachments:' : 'Vedlegg:', ...att.map((e) => `${e.attachment}. ${en ? EVENTS[e.type].attEn : EVENTS[e.type].attNb} (${when(e.date)})`)].join('\n'));
    }
    return parts.join('\n\n');
}
export function missing(input) {
    const s = normalise(input);
    const out = [];
    if (!s.company)
        out.push('the company\'s name (step 2)');
    if (!s.name)
        out.push('your full name (step 3)');
    if (!eventsOf(s).length)
        out.push('at least one dated event');
    return out;
}
export function timelineFileName(iso) {
    return `timeline-${iso}.txt`;
}
