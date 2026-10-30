/*! src/letters.js is compiled from ts/src/letters.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */
import { letterDate } from './format.js?v=57ce12f7';
export const KINDS = ['access', 'erasure'];
export const LANGS = ['en', 'nb'];
export const CHANNELS = ['email', 'webform', 'post'];
export const GROUNDS = ['a', 'b', 'c', 'd', 'e', 'f'];
export const LIMITS = { line: 200, text: 1000 };
export const IDENTIFIER_LABELS = {
    email: { en: 'Email address I use with you', nb: 'E-postadresse jeg bruker hos dere' },
    username: { en: 'Username', nb: 'Brukernavn' },
    customer: { en: 'Customer number', nb: 'Kundenummer' },
    order: { en: 'Order number', nb: 'Ordrenummer' },
    membership: { en: 'Membership or loyalty number', nb: 'Medlemsnummer' },
    other: { en: 'Other', nb: 'Annet' },
};
const MISSING = {
    company: { en: '[Company name]', nb: '[Virksomhetens navn]' },
    name: { en: '[Your full name]', nb: '[Fullt navn]' },
    scope: { en: '[what it covers]', nb: '[hva det gjelder]' },
    email: { en: '[your email address]', nb: '[e-postadresse]' },
};
export function clean(value, { multiline = false, max = LIMITS.line } = {}) {
    let s = String(value ?? '');
    s = s.replace(/\r\n?/g, '\n');
    s = multiline ? s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, '') : s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
    s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
    if (multiline)
        s = s.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    else
        s = s.replace(/\s+/g, ' ').trim();
    return [...s].slice(0, max).join('');
}
export function normalise(input = {}) {
    const pick = (v, list, d) => (list.includes(v) ? v : d);
    const s = {
        kind: pick(input.kind, KINDS, 'access'),
        lang: pick(input.lang, LANGS, 'en'),
        letterDate: input.letterDate,
        company: clean(input.company),
        companyEmail: clean(input.companyEmail),
        companyAddress: clean(input.companyAddress, { multiline: true, max: LIMITS.text }),
        dpo: !!input.dpo,
        channel: pick(input.channel, CHANNELS, 'email'),
        based: pick(input.based, ['NO', 'EEA', 'OUTSIDE'], 'NO'),
        name: clean(input.name),
        email: clean(input.email),
        address: clean(input.address, { multiline: true, max: LIMITS.text }),
        replyBy: pick(input.replyBy, ['email', 'post'], 'email'),
        identifiers: (Array.isArray(input.identifiers) ? input.identifiers : [])
            .map((r) => ({ label: pick(r && r.label, Object.keys(IDENTIFIER_LABELS), 'other'), value: clean(r && r.value) }))
            .filter((r) => r.value),
        scope: pick(input.scope, ['all', 'some'], 'all'),
        scopeText: clean(input.scopeText, { max: LIMITS.text }).replace(/[.;:,\s]+$/, ''),
        consultations: !!input.consultations,
        copyFormat: pick(input.copyFormat, ['electronic', 'paper'], 'electronic'),
        grounds: Object.fromEntries(GROUNDS.map((g) => [g, !!(input.grounds && input.grounds[g])])),
        groundDText: clean(input.groundDText, { max: LIMITS.text }).replace(/[.;:,\s]+$/, ''),
        tellRecipients: input.tellRecipients === undefined ? true : !!input.tellRecipients,
        madePublic: !!input.madePublic,
        copyFirst: !!input.copyFirst,
    };
    return s;
}
const electronicChannel = (s) => s.channel === 'email' || s.channel === 'webform';
const or = (value, lang, key) => value || MISSING[key][lang];
const replyByEmail = (s) => s.replyBy === 'email';
export const SUBJECTS = {
    access: {
        en: 'Request for access to my personal data (GDPR Article 15)',
        nb: 'Innsyn i personopplysninger om meg (personvernforordningen artikkel 15)',
    },
    erasure: {
        en: 'Request for erasure of my personal data (GDPR Article 17)',
        nb: 'Sletting av personopplysninger om meg (personvernforordningen artikkel 17)',
    },
};
export const CLAUSES = {
    header: {
        cites: [],
        en: (s) => [or(s.company, 'en', 'company'), ...(s.dpo ? ['For the attention of the Data Protection Officer'] : []), ...(s.companyAddress ? [s.companyAddress] : [])].join('\n'),
        nb: (s) => [or(s.company, 'nb', 'company'), ...(s.dpo ? ['Att.: personvernombudet'] : []), ...(s.companyAddress ? [s.companyAddress] : [])].join('\n'),
    },
    date: {
        cites: [],
        en: (s) => letterDate(s.letterDate, 'en'),
        nb: (s) => letterDate(s.letterDate, 'nb'),
    },
    subject: {
        cites: ['Article 15', 'Article 17', 'artikkel 15', 'artikkel 17'],
        en: (s) => `Subject: ${SUBJECTS[s.kind].en}`,
        nb: (s) => SUBJECTS[s.kind].nb,
    },
    salutation: {
        cites: [],
        en: (s) => `Dear ${s.dpo ? 'Data Protection Officer' : 'Sir or Madam'},`,
        nb: null,
    },
    'access-opening': {
        cites: ['Article 15', 'artikkel 15'],
        en: () => 'I am asking for access to my personal data under Article 15 of the General Data Protection Regulation (GDPR).',
        nb: () => 'Jeg ber om innsyn i personopplysninger om meg, jf. personvernforordningen (GDPR) artikkel 15.',
    },
    'access-confirm': {
        cites: [],
        en: () => 'Please confirm whether you process personal data about me. If you do, please give me:',
        nb: () => 'Jeg ber dere bekrefte om dere behandler personopplysninger om meg. Hvis dere gjør det, ber jeg om:',
    },
    'access-items': {
        cites: ['Article 15(3)', 'C-154/21', 'Article 22(1)', 'Article 15(2)', 'C-579/21', 'artikkel 15 nr. 3', 'artikkel 22 nr. 1', 'artikkel 15 nr. 2'],
        en: (s) => numbered(accessItems(s, 'en').map((i) => i.text), 'en'),
        nb: (s) => numbered(accessItems(s, 'nb').map((i) => i.text), 'nb'),
    },
    'access-format': {
        cites: ['Article 15(3)', 'artikkel 15 nr. 3'],
        en: (s) => `Please send the copy ${s.copyFormat === 'paper' ? 'on paper, by post to the address below' : `in a commonly used electronic form${electronicChannel(s) ? ' (Article 15(3))' : ''}`}.`,
        nb: (s) => `Jeg ber om å få kopien ${s.copyFormat === 'paper' ? 'på papir, sendt til postadressen nedenfor' : `i en vanlig elektronisk form${electronicChannel(s) ? ' (artikkel 15 nr. 3)' : ''}`}.`,
    },
    'erasure-opening': {
        cites: ['Article 17', 'artikkel 17'],
        en: (s) => `Under Article 17 of the General Data Protection Regulation (GDPR), I ask you to erase, without undue delay, ${s.scope === 'all' ? 'all the personal data you hold about me' : `the following personal data about me: ${or(s.scopeText, 'en', 'scope')}`}.`,
        nb: (s) => (s.scope === 'all'
            ? 'Jeg ber om at dere uten ugrunnet opphold sletter alle personopplysningene dere behandler om meg, jf. personvernforordningen (GDPR) artikkel 17.'
            : `Etter personvernforordningen (GDPR) artikkel 17 ber jeg om at dere uten ugrunnet opphold sletter disse personopplysningene om meg: ${or(s.scopeText, 'nb', 'scope')}.`),
    },
    'erasure-grounds': {
        cites: ['Article 17(1)(a)', 'Article 17(1)(b)', 'Article 21(2)', 'Article 21(3)', 'Article 17(1)(c)', 'Article 17(1)(d)', 'Article 17(1)(e)', 'Article 17(1)(f)', 'Article 8(1)',
            'artikkel 17 nr. 1 bokstav a', 'artikkel 17 nr. 1 bokstav b', 'artikkel 21 nr. 2', 'artikkel 21 nr. 3', 'artikkel 17 nr. 1 bokstav c', 'artikkel 17 nr. 1 bokstav d', 'artikkel 17 nr. 1 bokstav e', 'artikkel 17 nr. 1 bokstav f', 'artikkel 8 nr. 1'],
        en: (s) => {
            const lines = [];
            if (s.grounds.a)
                lines.push('the data are no longer necessary for the purposes for which you collected or otherwise processed them (Article 17(1)(a))');
            if (s.grounds.b)
                lines.push('I withdraw my consent, and as far as I know there is no other legal ground for the processing (Article 17(1)(b))');
            if (s.grounds.c)
                lines.push('I object to the processing of my personal data for direct marketing, including profiling to the extent that it is related to such marketing (Article 21(2)). Under Article 21(3) my data may then no longer be processed for such purposes, and an objection under Article 21(2) is a ground for erasure under Article 17(1)(c)');
            if (s.grounds.d)
                lines.push(`I believe my personal data have been processed unlawfully (Article 17(1)(d))${s.groundDText ? `: ${s.groundDText}` : ''}`);
            if (s.grounds.e)
                lines.push('erasure is needed to comply with a legal obligation you are subject to (Article 17(1)(e))');
            if (s.grounds.f)
                lines.push('the data were collected in connection with an online service (an information society service) offered directly to me as a child (Article 17(1)(f) and Article 8(1))');
            return ['The grounds that apply:', ...lines.map((t, i) => `- ${t}${i === lines.length - 1 ? '.' : ';'}`)].join('\n');
        },
        nb: (s) => {
            const lines = [];
            if (s.grounds.a)
                lines.push('opplysningene er ikke lenger nødvendige for formålet de ble samlet inn eller behandlet for (artikkel 17 nr. 1 bokstav a)');
            if (s.grounds.b)
                lines.push('jeg trekker tilbake samtykket mitt, og så vidt jeg vet finnes det ikke noe annet rettslig grunnlag for behandlingen (artikkel 17 nr. 1 bokstav b)');
            if (s.grounds.c)
                lines.push('jeg protesterer mot behandling av personopplysninger om meg til direkte markedsføring, herunder profilering i den grad den er knyttet til slik markedsføring (artikkel 21 nr. 2). Etter artikkel 21 nr. 3 skal opplysningene da ikke lenger behandles for slike formål, og en protest etter artikkel 21 nr. 2 er et grunnlag for sletting etter artikkel 17 nr. 1 bokstav c');
            if (s.grounds.d)
                lines.push(`jeg mener at personopplysningene mine er behandlet ulovlig (artikkel 17 nr. 1 bokstav d)${s.groundDText ? `: ${s.groundDText}` : ''}`);
            if (s.grounds.e)
                lines.push('sletting er nødvendig for å oppfylle en rettslig forpliktelse som dere er underlagt (artikkel 17 nr. 1 bokstav e)');
            if (s.grounds.f)
                lines.push('opplysningene ble samlet inn i forbindelse med en nettjeneste (informasjonssamfunnstjeneste) som ble tilbudt direkte til meg som barn (artikkel 17 nr. 1 bokstav f, jf. artikkel 8 nr. 1)');
            return ['Grunnlaget for anmodningen:', ...lines.map((t) => `- ${t}`)].join('\n');
        },
    },
    'erasure-copy-first': {
        cites: ['Article 15(3)', 'artikkel 15 nr. 3'],
        en: () => 'Before you erase anything, please send me a copy of the personal data you hold about me (Article 15(3)).',
        nb: () => 'Før dere sletter noe, ber jeg om en kopi av personopplysningene dere behandler om meg (artikkel 15 nr. 3).',
    },
    'erasure-recipients': {
        cites: ['Article 19', 'artikkel 19'],
        en: () => 'Please tell each recipient to whom you have disclosed my personal data about the erasure, and tell me who those recipients are (Article 19).',
        nb: () => 'Jeg ber dere underrette alle mottakere som har fått utlevert personopplysninger om meg, om slettingen, og opplyse meg om hvem disse mottakerne er (artikkel 19).',
    },
    'erasure-public': {
        cites: ['Article 17(2)', 'artikkel 17 nr. 2'],
        en: () => 'If you have made my personal data public, please take reasonable steps to inform other controllers processing them that I have asked for any links to, copies of or replications of them to be erased (Article 17(2)).',
        nb: () => 'Hvis dere har offentliggjort personopplysningene, ber jeg dere treffe rimelige tiltak for å underrette andre behandlingsansvarlige som behandler dem, om at jeg har bedt om sletting av alle lenker til, kopier eller reproduksjoner av opplysningene (artikkel 17 nr. 2).',
    },
    'erasure-keep': {
        cites: ['Article 17(3)', 'Article 12(4)', 'artikkel 17 nr. 3', 'artikkel 12 nr. 4'],
        en: () => 'If you do not erase some or all of the personal data this request covers, for example because you consider that an exception in Article 17(3) applies, please tell me which data you keep, what you rely on and why (Article 12(4)).',
        nb: () => 'Hvis dere ikke sletter alle personopplysningene denne anmodningen gjelder, for eksempel fordi dere mener at et av unntakene i artikkel 17 nr. 3 gjelder, ber jeg dere oppgi hvilke opplysninger dere beholder, hva dere bygger på, og hvorfor (artikkel 12 nr. 4).',
    },
    identifiers: {
        cites: [],
        en: (s) => ['These details may help you find my data:', ...s.identifiers.map((r) => `${IDENTIFIER_LABELS[r.label].en}: ${r.value}`)].join('\n'),
        nb: (s) => ['Dette kan hjelpe dere å finne opplysningene om meg:', ...s.identifiers.map((r) => `${IDENTIFIER_LABELS[r.label].nb}: ${r.value}`)].join('\n'),
    },
    identity: {
        cites: ['Article 12(6)', 'artikkel 12 nr. 6'],
        en: () => 'If you have reasonable doubts about my identity, please tell me what additional information is necessary to confirm it (Article 12(6)).',
        nb: () => 'Hvis dere har rimelig tvil om hvem jeg er, ber jeg dere gi meg beskjed om hvilke ytterligere opplysninger som er nødvendige for å bekrefte identiteten min (artikkel 12 nr. 6).',
    },
    deadline: {
        cites: ['Article 12(3)', 'artikkel 12 nr. 3'],
        en: (s) => `${s.kind === 'erasure' ? 'Please confirm that you have received this request, and tell me in writing what you have done.' : 'Please confirm that you have received this request.'} ${DEADLINE_EN}`,
        nb: (s) => `${s.kind === 'erasure' ? 'Jeg ber dere bekrefte at dere har mottatt anmodningen, og opplyse skriftlig hva dere har gjort.' : 'Jeg ber dere bekrefte at dere har mottatt anmodningen.'} ${DEADLINE_NB}`,
    },
    refusal: {
        cites: ['Article 12(4)', 'section 16', 'artikkel 12 nr. 4', '§ 16'],
        en: (s) => `${REFUSAL_EN}${section16(s) ? ' If you refuse access under section 16 of the Norwegian Personal Data Act (personopplysningsloven), please give your reasons in writing with a precise reference to the provision you rely on.' : ''}`,
        nb: (s) => `${REFUSAL_NB}${section16(s) ? ' Hvis dere nekter innsyn etter personopplysningsloven § 16, ber jeg om en skriftlig begrunnelse med en presis henvisning til unntakshjemmelen.' : ''}`,
    },
    reply: {
        cites: [],
        en: (s) => `Please reply to ${replyByEmail(s) ? or(s.email, 'en', 'email') : 'the postal address below'}.`,
        nb: (s) => `Send svaret til ${replyByEmail(s) ? or(s.email, 'nb', 'email') : 'postadressen nedenfor'}.`,
    },
    closing: {
        cites: [],
        en: () => 'Yours faithfully,',
        nb: () => 'Med vennlig hilsen',
    },
    signature: {
        cites: [],
        en: (s) => [or(s.name, 'en', 'name'), ...(s.email ? [s.email] : []), ...(s.address ? [s.address] : [])].join('\n'),
        nb: (s) => [or(s.name, 'nb', 'name'), ...(s.email ? [s.email] : []), ...(s.address ? [s.address] : [])].join('\n'),
    },
};
export const DEADLINE_EN = 'Under Article 12(3), you must give me information on the action taken on this request without undue delay and in any event within one month of receipt of the request. That period may be extended by two further months only where necessary, taking into account the complexity and number of the requests, and you must tell me of any extension, with the reasons for the delay, within one month of receipt.';
export const DEADLINE_NB = 'Etter artikkel 12 nr. 3 skal dere informere meg om hvilke tiltak dere har truffet på grunnlag av anmodningen, uten ugrunnet opphold og senest én måned etter mottak av anmodningen. Fristen kan ved behov forlenges med ytterligere to måneder, idet det tas hensyn til antall anmodninger og anmodningenes kompleksitet, og i så fall skal dere informere meg om forlengelsen, sammen med en begrunnelse for forsinkelsen, senest én måned etter mottak av anmodningen.';
export const REFUSAL_EN = 'If you decide not to act on all or part of this request, please tell me your reasons without delay and at the latest within one month of receipt, together with information on the possibility of lodging a complaint with a supervisory authority and seeking a judicial remedy (Article 12(4)).';
export const REFUSAL_NB = 'Hvis dere ikke vil etterkomme hele eller deler av anmodningen, ber jeg dere opplyse meg om årsakene uten opphold og senest én måned etter mottak av anmodningen, og om muligheten for å inngi klage til en tilsynsmyndighet og for rettslig prøving (artikkel 12 nr. 4).';
function section16(s) {
    return s.kind === 'access' && s.based === 'NO';
}
export const ACCESS_ITEM_IDS = ['copy', 'purposes', 'categories', 'recipients', 'storage', 'source', 'automated', 'transfers', 'rights', 'consultations'];
export function accessItems(input, lang) {
    const s = normalise(input);
    const en = lang !== 'nb';
    const what = en
        ? (s.scope === 'all' ? 'all the personal data you hold about me' : `the personal data you hold about me that concern ${or(s.scopeText, 'en', 'scope')}`)
        : (s.scope === 'all' ? 'alle personopplysningene dere behandler om meg' : `personopplysningene dere behandler om meg som gjelder ${or(s.scopeText, 'nb', 'scope')}`);
    const texts = en ? [
        `a copy of ${what} (Article 15(3))`,
        'the purposes of the processing',
        'the categories of personal data concerned',
        'the recipients to whom my personal data have been or will be disclosed, named individually (Court of Justice of the European Union, case C-154/21), including any recipients outside the EEA and any international organisations',
        'how long you plan to store the data or, if that is not possible, the criteria you use to decide',
        'where the data were not collected from me, any available information about their source',
        'whether you make automated decisions about me, including profiling, of the kind referred to in Article 22(1) and (4), and if so, meaningful information about the logic involved and about the significance and the envisaged consequences for me',
        'if my data are transferred outside the EEA or to an international organisation, the safeguards that apply to the transfer (Article 15(2))',
        'information about my rights to ask for rectification or erasure, to ask for restriction of processing and to object to processing, and about my right to complain to a supervisory authority',
        'information about any consultations (look-ups) of my personal data, with the date and purpose of each (Court of Justice of the European Union, case C-579/21)',
    ] : [
        `en kopi av ${what} (artikkel 15 nr. 3)`,
        'formålene med behandlingen',
        'hvilke kategorier av personopplysninger det gjelder',
        'hvem opplysningene er blitt eller vil bli utlevert til, med navn på hver mottaker (EU-domstolen, sak C-154/21), også mottakere utenfor EØS og internasjonale organisasjoner',
        'hvor lenge opplysningene vil bli lagret, eller, hvis det ikke er mulig å si, hvilke kriterier som brukes for å fastsette lagringstiden',
        'all tilgjengelig informasjon om hvor opplysningene kommer fra, dersom de ikke er samlet inn fra meg',
        'om det treffes automatiserte avgjørelser om meg, herunder profilering, som nevnt i artikkel 22 nr. 1 og 4, og i så fall relevant informasjon om den underliggende logikken samt om betydningen og de forventede konsekvensene for meg',
        'hvilke garantier som gjelder, dersom opplysningene overføres til land utenfor EØS eller til en internasjonal organisasjon (artikkel 15 nr. 2)',
        'informasjon om retten til å be om retting eller sletting, til å be om begrensning av behandlingen og til å protestere mot den, og om retten til å klage til en tilsynsmyndighet',
        'opplysninger om oppslag i personopplysningene mine, med dato og formål for hvert oppslag (EU-domstolen, sak C-579/21)',
    ];
    const items = ACCESS_ITEM_IDS.map((id, i) => ({ id, text: texts[i] }));
    return s.consultations ? items : items.slice(0, 9);
}
export function numbered(texts, lang) {
    return texts.map((t, i) => `${i + 1}. ${t}${lang === 'nb' ? '' : (i === texts.length - 1 ? '.' : ';')}`).join('\n');
}
export function plan(input) {
    const s = normalise(input);
    const ids = ['header', 'date', 'subject'];
    if (s.lang === 'en')
        ids.push('salutation');
    if (s.kind === 'access') {
        ids.push('access-opening', 'access-confirm', 'access-items', 'access-format');
    }
    else {
        ids.push('erasure-opening');
        if (GROUNDS.some((g) => s.grounds[g]))
            ids.push('erasure-grounds');
        if (s.copyFirst)
            ids.push('erasure-copy-first');
        if (s.tellRecipients)
            ids.push('erasure-recipients');
        if (s.madePublic)
            ids.push('erasure-public');
        ids.push('erasure-keep');
    }
    if (s.identifiers.length)
        ids.push('identifiers');
    ids.push('identity', 'deadline', 'refusal', 'reply', 'closing', 'signature');
    return ids;
}
export function render(input) {
    const s = normalise(input);
    const ids = plan(s);
    const parts = ids.map((id) => CLAUSES[id][s.lang](s));
    return { text: parts.join('\n\n'), subject: SUBJECTS[s.kind][s.lang], lang: s.lang, kind: s.kind, clauses: ids };
}
export function missing(input) {
    const s = normalise(input);
    const out = [];
    if (!s.company)
        out.push('the company\'s name');
    if (!s.name)
        out.push('your full name');
    if (!s.email && !s.address)
        out.push('your email address or postal address');
    else if (s.replyBy === 'email' && !s.email)
        out.push('your email address, or choose a reply by post');
    if (s.scope === 'some' && !s.scopeText)
        out.push('what the letter covers');
    if (s.email && (s.replyBy === 'post' || (s.kind === 'access' && s.copyFormat === 'paper')) && !s.address)
        out.push('your postal address');
    if (s.channel === 'post' && !s.companyAddress)
        out.push('the company\'s postal address');
    return out;
}
