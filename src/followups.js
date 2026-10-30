/*! src/followups.js is compiled from ts/src/followups.ts by tools/build-ts.sh, which leaves out
    every comment but this one: the explanations are in the source. Edit the TypeScript, never the
    .js: the build refuses to overwrite a hand edit, and its check mode fails on one. */
import { CLAUSES, accessItems, normalise as normaliseLetter, numbered } from './letters.js?v=11895179';
import { isIsoDate, letterDate } from './format.js?v=57ce12f7';
import { computeDeadline } from './deadline.js?v=ed38cf9e';
export const SITUATIONS = ['reminder', 'partial', 'extension', 'refusal', 'identity'];
export const ERASURE_ITEM_IDS = ['copy-first', 'recipients', 'kept', 'erased'];
export const CHECK_LABELS = {
    copy: 'A copy of my data',
    purposes: 'The purposes',
    categories: 'The categories of data',
    recipients: 'The recipients, named',
    storage: 'How long they keep it',
    source: 'Where the data came from',
    automated: 'Automated decisions',
    transfers: 'Safeguards for transfers outside the EEA',
    rights: 'My rights and how to complain',
    consultations: 'Consultations (look-ups)',
    'copy-first': 'A copy before erasure',
    'erasure-recipients': 'Who the recipients are, and whether they were told',
    kept: 'What they keep, and why',
    erased: 'What they have erased',
};
const ERASURE_TEXTS = {
    'copy-first': {
        en: 'a copy of the personal data you hold about me, before you erase anything (Article 15(3))',
        nb: 'en kopi av personopplysningene dere behandler om meg, før dere sletter noe (artikkel 15 nr. 3)',
    },
    recipients: {
        en: 'the recipients to whom you have disclosed my personal data (Article 19), and whether you have told them about the erasure',
        nb: 'hvilke mottakere som har fått utlevert personopplysninger om meg (artikkel 19), og om dere har underrettet dem om slettingen',
    },
    kept: {
        en: 'if you keep any of the personal data this request covers: which data, what you rely on and why (Article 12(4))',
        nb: 'hvis dere beholder noen av personopplysningene anmodningen gjelder: hvilke opplysninger, hva dere bygger på, og hvorfor (artikkel 12 nr. 4)',
    },
    erased: {
        en: 'a written confirmation of what you have erased',
        nb: 'en skriftlig bekreftelse på hva dere har slettet',
    },
};
const DATE_MISSING = { en: '[date]', nb: '[dato]' };
const NORMALISED = new WeakSet();
export function normalise(input) {
    if (input && NORMALISED.has(input))
        return input;
    const given = input || {};
    const iso = (v) => (isIsoDate(v) ? v : '');
    const s = normaliseLetter(given);
    const flag = (group, k, flat = k) => {
        const options = given[group];
        return !!((options && options[k]) || given[flat] === true);
    };
    const out = {
        ...s,
        letterDate: iso(given.letterDate),
        situation: SITUATIONS.includes(given.situation) ? given.situation : null,
        requestDate: iso(given.requestDate),
        receivedDate: iso(given.receivedDate),
        answerDate: iso(given.answerDate),
        received: Object.fromEntries(Object.entries(given.received || {}).map(([k, v]) => [k, !!v])),
        noReasonsExt: flag('extension', 'noReasons', 'noReasonsExt'),
        late: flag('extension', 'late'),
        refusedPart: flag('refusal', 'part', 'refusedPart'),
        noReasons: flag('refusal', 'noReasons'),
        no16: flag('refusal', 'no16') && s.kind === 'access' && s.based === 'NO',
        noComplaint: flag('refusal', 'noComplaint'),
        idDocument: given.identity ? given.identity.document !== false : given.idDocument !== false,
        fromEmail: flag('identity', 'fromEmail'),
        loggedIn: flag('identity', 'loggedIn'),
    };
    NORMALISED.add(out);
    return out;
}
const date = (iso, lang) => (iso ? letterDate(iso, lang) : DATE_MISSING[lang]);
export function checkItems(input, lang = 'en') {
    return itemsOf(normalise(input), lang);
}
function itemsOf(s, lang) {
    if (s.kind === 'access')
        return accessItems(s, lang);
    const ids = [...(s.copyFirst ? ['copy-first'] : []), ...(s.tellRecipients ? ['recipients'] : []), 'kept', 'erased'];
    return ids.map((id) => ({ id, text: ERASURE_TEXTS[id][lang === 'nb' ? 'nb' : 'en'] }));
}
export function checkLabel(kind, id) {
    return CHECK_LABELS[(kind === 'erasure' && id === 'recipients' ? 'erasure-recipients' : id)];
}
export function missingItems(input, lang = 'en') {
    return leftOut(normalise(input), lang);
}
function leftOut(s, lang) {
    return itemsOf(s, lang).filter((i) => !s.received[i.id]);
}
const SUBJECT = {
    en: (s) => `${s.situation === 'reminder' ? 'Reminder' : 'Follow-up'}: request for ${s.kind === 'erasure' ? 'erasure of' : 'access to'} my personal data (GDPR Article ${s.kind === 'erasure' ? 17 : 15})`,
    nb: (s) => `${s.situation === 'reminder' ? 'Påminnelse' : 'Oppfølging'}: ${s.kind === 'erasure' ? 'sletting av' : 'innsyn i'} personopplysninger om meg (personvernforordningen artikkel ${s.kind === 'erasure' ? 17 : 15})`,
};
const COMPLAINT_EN = 'together with information on the possibility of lodging a complaint with a supervisory authority and seeking a judicial remedy (Article 12(4))';
const COMPLAINT_NB = 'og om muligheten for å inngi klage til en tilsynsmyndighet og for rettslig prøving (artikkel 12 nr. 4)';
function body(s, lang) {
    const en = lang === 'en';
    const what = en ? (s.kind === 'erasure' ? 'erasure of' : 'access to') : (s.kind === 'erasure' ? 'sletting av' : 'innsyn i');
    const art = s.kind === 'erasure' ? 17 : 15;
    const ref = en
        ? `I refer to my request of ${date(s.requestDate, 'en')} for ${what} my personal data under Article ${art} of the General Data Protection Regulation (GDPR)`
        : `Jeg viser til anmodningen min av ${date(s.requestDate, 'nb')} om ${what} personopplysninger om meg, jf. personvernforordningen (GDPR) artikkel ${art}`;
    const answer = date(s.answerDate, lang);
    const out = [];
    switch (s.situation) {
        case 'reminder':
            if (en) {
                out.push(`${ref}. A copy is attached.${s.receivedDate ? ` My request reached you on ${date(s.receivedDate, 'en')}.` : ''}`);
                out.push('I have not received an answer, and you have not told me of an extension of the time limit. Under Article 12(3), you must give me information on the action taken on my request without undue delay and in any event within one month of receipt of the request. Please answer my request without further delay.');
                out.push(`If you decide not to act on my request, please tell me your reasons, ${COMPLAINT_EN}.`);
            }
            else {
                out.push(`${ref}. Kopi av anmodningen er vedlagt.${s.receivedDate ? ` Anmodningen kom fram til dere ${date(s.receivedDate, 'nb')}.` : ''}`);
                out.push('Jeg har ikke fått svar, og dere har ikke informert meg om at fristen er forlenget. Etter artikkel 12 nr. 3 skal dere informere meg om hvilke tiltak dere har truffet på grunnlag av anmodningen, uten ugrunnet opphold og senest én måned etter mottak av anmodningen. Jeg ber dere besvare anmodningen min uten ytterligere opphold.');
                out.push(`Hvis dere ikke vil etterkomme anmodningen, ber jeg dere opplyse meg om årsakene ${COMPLAINT_NB}.`);
            }
            break;
        case 'partial': {
            const list = numbered(leftOut(s, lang).map((i) => i.text), lang);
            if (en) {
                out.push(`${ref}, and thank you for your answer of ${answer}.`);
                out.push(`Your answer does not include the following, which I asked for:\n${list}`);
                out.push(`Please send me this without undue delay. If you decide not to provide some or all of it, please tell me which parts and your reasons, ${COMPLAINT_EN}.`);
            }
            else {
                out.push(`${ref}, og takker for svaret deres av ${answer}.`);
                out.push(`Svaret inneholder ikke følgende, som jeg ba om:\n${list}`);
                out.push('Jeg ber dere sende meg dette uten ugrunnet opphold. Hvis det er noe av dette dere ikke vil gi meg, ber jeg dere opplyse meg om hva det gjelder, om årsakene og om muligheten for å inngi klage til en tilsynsmyndighet og for rettslig prøving (artikkel 12 nr. 4).');
            }
            break;
        }
        case 'extension':
            if (en) {
                out.push(`${ref}, and to your message of ${answer}, in which you extended the time limit for answering my request.`);
                out.push('Under Article 12(3), the time limit may be extended by two further months only where necessary, taking into account the complexity and number of the requests, and you must tell me of any extension, with the reasons for the delay, within one month of receipt of the request.');
                if (s.noReasonsExt)
                    out.push('Your message does not give the reasons for the delay. Please tell me what they are.');
                if (s.late)
                    out.push(`My request reached you on ${date(s.receivedDate, 'en')}, and the one-month period had ended before you told me of the extension. Please answer my request without further delay.`);
            }
            else {
                out.push(`${ref}, og til meldingen deres av ${answer}, der dere forlenget fristen for å besvare anmodningen.`);
                out.push('Etter artikkel 12 nr. 3 kan fristen ved behov forlenges med ytterligere to måneder, idet det tas hensyn til antall anmodninger og anmodningenes kompleksitet, og dere skal informere meg om forlengelsen, sammen med en begrunnelse for forsinkelsen, senest én måned etter mottak av anmodningen.');
                if (s.noReasonsExt)
                    out.push('Meldingen deres inneholder ingen begrunnelse for forsinkelsen. Jeg ber dere opplyse meg om årsakene til forsinkelsen.');
                if (s.late)
                    out.push(`Anmodningen min kom fram til dere ${date(s.receivedDate, 'nb')}, og fristen på én måned var ute før dere informerte meg om forlengelsen. Jeg ber dere besvare anmodningen min uten ytterligere opphold.`);
            }
            break;
        case 'refusal':
            if (en) {
                out.push(`${ref}, and to your answer of ${answer}, in which you refused ${s.refusedPart ? 'part of my request' : 'my request'}.`);
                out.push('Under Article 12(4), if you do not take action on a request, you must tell me the reasons for not taking action and inform me of the possibility of lodging a complaint with a supervisory authority and seeking a judicial remedy.');
                if (s.noReasons)
                    out.push('Your answer does not give your reasons.');
                if (s.no16)
                    out.push('Under section 16 of the Norwegian Personal Data Act (personopplysningsloven), a refusal of access under the first paragraph of that section must be explained in writing, with a precise reference to the exception relied on. Your answer does not give that reference.');
                if (s.noComplaint)
                    out.push('Your answer does not tell me about the possibility of lodging a complaint with a supervisory authority and seeking a judicial remedy.');
                out.push('Please send me what is missing.');
            }
            else {
                out.push(`${ref}, og til svaret deres av ${answer}, der dere avslo ${s.refusedPart ? 'deler av anmodningen' : 'anmodningen'}.`);
                out.push('Etter artikkel 12 nr. 4 skal dere, dersom dere ikke treffer tiltak på anmodningen, informere meg om årsakene til dette og om muligheten for å inngi klage til en tilsynsmyndighet og for rettslig prøving.');
                if (s.noReasons)
                    out.push('Svaret deres inneholder ingen begrunnelse.');
                if (s.no16)
                    out.push('Etter personopplysningsloven § 16 må den som nekter å gi innsyn i medhold av paragrafens første ledd, begrunne dette skriftlig og gi en presis henvisning til unntakshjemmelen. Svaret deres inneholder ingen slik henvisning.');
                if (s.noComplaint)
                    out.push('Svaret deres sier ikke noe om muligheten for å inngi klage til en tilsynsmyndighet og for rettslig prøving.');
                out.push('Jeg ber dere sende meg det som mangler.');
            }
            break;
        case 'identity':
            if (en) {
                out.push(`${ref}, and to your message of ${answer}, in which you asked me for ${s.idDocument ? 'a copy of an identity document' : 'more information about my identity'} before answering my request.`);
                out.push('Under Article 12(6), you may ask for additional information only where you have reasonable doubts concerning my identity, and only the information necessary to confirm it.');
                if (s.fromEmail)
                    out.push('I sent my request from the email address I use with you. You can confirm that it is me by sending a confirmation link or code to that address.');
                if (s.loggedIn)
                    out.push('I sent my request through my account with you, while logged in.');
                out.push('Please explain why the information you ask for is necessary to confirm my identity, or answer my request on the basis of the details I have already given.');
            }
            else {
                out.push(`${ref}, og til meldingen deres av ${answer}, der dere ba meg om ${s.idDocument ? 'en kopi av et identitetsdokument' : 'ytterligere opplysninger om identiteten min'} før dere besvarer anmodningen.`);
                out.push('Etter artikkel 12 nr. 6 kan dere anmode om ytterligere opplysninger bare dersom det hersker rimelig tvil om identiteten min, og bare om opplysninger som er nødvendige for å kunne bekrefte den.');
                if (s.fromEmail)
                    out.push('Jeg sendte anmodningen fra e-postadressen jeg bruker hos dere. Dere kan bekrefte at det er meg, ved å sende en bekreftelseslenke eller en kode til denne adressen.');
                if (s.loggedIn)
                    out.push('Jeg sendte anmodningen gjennom kontoen min hos dere, mens jeg var innlogget.');
                out.push('Jeg ber dere forklare hvorfor opplysningene dere etterspør, er nødvendige for å bekrefte identiteten min, eller besvare anmodningen på grunnlag av opplysningene jeg allerede har gitt.');
            }
            break;
        default:
            break;
    }
    return out;
}
export function render(input) {
    const s = normalise(input);
    const base = { subject: '', lang: s.lang, kind: s.kind, situation: s.situation, nothingMissing: false };
    if (!s.situation)
        return { ...base, text: '' };
    if (s.situation === 'partial' && !leftOut(s, s.lang).length)
        return { ...base, text: '', nothingMissing: true };
    const subject = SUBJECT[s.lang](s);
    const L = s.lang;
    const parts = [
        CLAUSES.header[L](s),
        date(s.letterDate, L),
        L === 'en' ? `Subject: ${subject}` : subject,
        ...(L === 'en' ? [CLAUSES.salutation.en(s)] : []),
        ...body(s, L),
        CLAUSES.reply[L](s),
        CLAUSES.closing[L](),
        CLAUSES.signature[L](s),
    ];
    return { ...base, text: parts.join('\n\n'), subject };
}
export function missing(input) {
    const s = normalise(input);
    if (!s.situation)
        return [];
    const out = [];
    if (!s.company)
        out.push('the company\'s name (step 2)');
    if (!s.name)
        out.push('your full name (step 3)');
    if (!s.letterDate)
        out.push('the date on the letter');
    if (!s.email && !s.address)
        out.push('your email address or postal address (step 3)');
    else if (s.replyBy === 'email' && !s.email)
        out.push('your email address, or choose a reply by post (step 3)');
    else if (s.replyBy === 'post' && !s.address)
        out.push('your postal address (step 3)');
    if (!s.requestDate)
        out.push('the date of your first letter');
    if (s.situation !== 'reminder' && !s.answerDate)
        out.push('the date of their answer');
    if (s.situation === 'extension') {
        if (!s.noReasonsExt && !s.late)
            out.push('what was wrong with the extension');
        if (s.late && !s.receivedDate)
            out.push('the date your letter reached them (one you can show)');
    }
    if (s.situation === 'refusal' && !s.noReasons && !s.no16 && !s.noComplaint)
        out.push('what their answer left out');
    if (s.situation === 'partial' && s.kind === 'access' && s.scope === 'some' && !s.scopeText && !s.received.copy)
        out.push('what your first letter covered (step 4)');
    return out;
}
export function reminderCheck({ receivedDate, based = 'NO', letterDate: on }) {
    if (!isIsoDate(receivedDate) || !isIsoDate(on))
        return null;
    let first;
    try {
        first = computeDeadline(receivedDate, based).first.date;
    }
    catch {
        return null;
    }
    return { deadline: first, early: first >= on };
}
export function extensionCheck({ receivedDate, based = 'NO', answerDate }) {
    if (!isIsoDate(receivedDate) || !isIsoDate(answerDate))
        return null;
    let first;
    try {
        first = computeDeadline(receivedDate, based).first.date;
    }
    catch {
        return null;
    }
    return { deadline: first, late: answerDate > first };
}
export function followUpFileName(iso) {
    return `follow-up-${iso}.txt`;
}
