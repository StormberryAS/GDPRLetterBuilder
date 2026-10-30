// The letters against the spec's own words (spec section 3.6, LET-5 and LET-6). When the spec is
// beside this repository (the vault: LabsIdeas/ next to GitHub/), its four template blocks are read,
// expanded here with their own bracket syntax ({...} filled from the form, [A|B] a choice, [...]
// a line or phrase that appears only when its option is on) and compared with what src/letters.js
// writes, character for character. This is a second implementation of the templates, written
// from the spec rather than from the code, so a drift in either shows up.
//
// One deliberate difference, recorded as a deviation: the spec writes the erasure grounds with ';'
// after each line and '.' after the last of all six; with only some grounds ticked the app ends the
// last ticked line with '.'. The scenarios below therefore tick all six grounds or none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { render } from '#src/letters.js';
import { dateEn, dateNb } from '#src/format.js';
import type { Answers, LetterInput } from '#src/letters.js';
import type { FollowUp, FollowUpInput } from '#src/followups.js';
import type { EventType } from '#src/timeline.js';

// A parsed template: text, a placeholder { ph }, or a bracket with its alternatives { alts }.
type TemplateNode = string | { ph?: string; alts?: Template[] };
type Template = TemplateNode[];
/** Which alternative of a bracket to take (0 or 1), or null to leave it out. */
type Decide = (content: string) => number | null;
type Rules = Array<[RegExp, () => number | null]>;
type Lang = 'en' | 'nb';
const LANGS: Lang[] = ['en', 'nb'];

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SPEC = join(dirname(dirname(ROOT)), 'LabsIdeas', 'GDPR Letter Builder - spec 2026-10-12.md');
const here = existsSync(SPEC);

function block(md: string, title: string): string {
  const i = md.indexOf(`**${title}**`);
  assert.ok(i >= 0, `no block ${title} in the spec`);
  const start = md.indexOf('```text\n', i) + '```text\n'.length;
  return md.slice(start, md.indexOf('\n```', start));
}

// Parses the bracket syntax into a tree: strings, { ph }, { alts: [tree, ...] }.
function parse(src: string): Template {
  let i = 0;
  function seq(stops: string[]): Template {
    const out: Template = [];
    let text = '';
    const flush = () => { if (text) out.push(text); text = ''; };
    while (i < src.length) {
      const c = src[i]!;
      if (stops.includes(c)) break;
      if (c === '[') {
        flush();
        i += 1;
        const alts = [seq([']', '|'])];
        while (src[i] === '|') { i += 1; alts.push(seq([']', '|'])); }
        assert.equal(src[i], ']', 'unbalanced bracket in the spec template');
        i += 1;
        out.push({ alts });
      } else if (c === '{') {
        flush();
        const end = src.indexOf('}', i);
        out.push({ ph: src.slice(i + 1, end) });
        i = end + 1;
      } else { text += c; i += 1; }
    }
    flush();
    return out;
  }
  const tree = seq([]);
  assert.equal(i, src.length);
  return tree;
}

const raw = (tree: Template): string => tree.map((n) => (typeof n === 'string' ? n : n.ph !== undefined ? `{${n.ph}}` : `[${n.alts!.map(raw).join('|')}]`)).join('');
const OMIT = '\u0001';

function expand(tree: Template, values: Record<string, string>, decide: Decide): string {
  return tree.map((n) => {
    if (typeof n === 'string') return n;
    if (n.ph !== undefined) {
      assert.ok(n.ph in values, `no value for {${n.ph}}`);
      return values[n.ph]!;
    }
    const alts = n.alts!;
    const pick = decide(raw(alts[0]!) + (alts.length > 1 ? `|${raw(alts[1]!)}` : ''));
    if (pick === null) return OMIT;
    return expand(alts[pick]!, values, decide);
  }).join('');
}

function finish(text: string): string {
  return text.split('\n').filter((l) => l !== OMIT).join('\n').replaceAll(OMIT, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Which way each bracket goes, from the answers (the spec's prose under 3.6 and 3.2 to 3.4).
function decider(s: Answers): Decide {
  const any = (['a', 'b', 'c', 'd', 'e', 'f'] as const).some((g) => s.grounds[g]);
  const electronic = s.channel === 'email' || s.channel === 'webform';
  const rules: Rules = [
    [/^(For the attention of the Data Protection Officer|Att\.: personvernombudet)$/, () => (s.dpo ? 0 : null)],
    [/^\{(Company postal address|Virksomhetens postadresse)\}$/, () => (s.companyAddress ? 0 : null)],
    [/^Data Protection Officer\|Sir or Madam$/, () => (s.dpo ? 0 : 1)],
    [/^(all the personal data you hold about me|alle personopplysningene dere behandler om meg)\|/, () => (s.scope === 'all' ? 0 : 1)],
    [/^Jeg ber om at dere uten ugrunnet opphold sletter alle personopplysningene\b[^|]*\|Etter personvernforordningen/, () => (s.scope === 'all' ? 0 : 1)],
    [/^(;\n10\. information about any consultations|10\. opplysninger om oppslag)/, () => (s.consultations ? 0 : null)],
    [/^(in a commonly used electronic form|i en vanlig elektronisk form)/, () => (s.copyFormat === 'paper' ? 1 : 0)],
    [/^ \((Article 15\(3\)|artikkel 15 nr\. 3)\)$/, () => (electronic ? 0 : null)],
    [/^(These details may help you find my data:|Dette kan hjelpe dere å finne opplysningene om meg:)/, () => (s.identifiers.length ? 0 : null)],
    [/^ (If you refuse access under section 16|Hvis dere nekter innsyn etter personopplysningsloven § 16)/, () => (s.kind === 'access' && s.based === 'NO' ? 0 : null)],
    [/^\{(email|e-post)\}\|(the postal address below|postadressen nedenfor)$/, () => (s.replyBy === 'email' ? 0 : 1)],
    [/^\{(Email|E-post)\}$/, () => (s.email ? 0 : null)],
    [/^\{(Postal address|Postadresse)\}$/, () => (s.address ? 0 : null)],
    [/^(The grounds that apply:|Grunnlaget for anmodningen:)/, () => (any ? 0 : null)],
    [/^- (the data are no longer|opplysningene er ikke lenger)/, () => (s.grounds.a ? 0 : null)],
    [/^- (I withdraw|jeg trekker)/, () => (s.grounds.b ? 0 : null)],
    [/^- (I object|jeg protesterer)/, () => (s.grounds.c ? 0 : null)],
    [/^- (I believe|jeg mener)/, () => (s.grounds.d ? 0 : null)],
    [/^: \{(explanation|forklaring)\}$/, () => (s.groundDText ? 0 : null)],
    [/^- (erasure is needed|sletting er nødvendig)/, () => (s.grounds.e ? 0 : null)],
    [/^- (the data were collected|opplysningene ble samlet)/, () => (s.grounds.f ? 0 : null)],
    [/^(Before you erase anything|Før dere sletter noe)/, () => (s.copyFirst ? 0 : null)],
    [/^(Please tell each recipient|Jeg ber dere underrette)/, () => (s.tellRecipients ? 0 : null)],
    [/^(If you have made my personal data public|Hvis dere har offentliggjort)/, () => (s.madePublic ? 0 : null)],
  ];
  return (content) => {
    const hit = rules.find(([re]) => re.test(content));
    assert.ok(hit, `no rule for the bracket [${content.slice(0, 60)}]`);
    return hit[1]();
  };
}

const LABEL = { en: 'Customer number', nb: 'Kundenummer' };
function values(s: Answers): Record<string, string> {
  const id = s.identifiers[0] || { value: '' };
  return {
    Company: s.company, Virksomhet: s.company,
    'Company postal address': s.companyAddress, 'Virksomhetens postadresse': s.companyAddress,
    'Letter date': dateEn(s.letterDate!), Dato: dateNb(s.letterDate!),
    scope: s.scopeText, omfang: s.scopeText,
    Label: LABEL.en, value: id.value, Etikett: LABEL.nb, verdi: id.value,
    email: s.email, 'e-post': s.email,
    'Full name': s.name, 'Fullt navn': s.name,
    Email: s.email, 'E-post': s.email,
    'Postal address': s.address, Postadresse: s.address,
    explanation: s.groundDText, forklaring: s.groundDText,
  };
}

const PERSON = { letterDate: '2026-10-12', company: 'Eksempel Handel AS', name: 'Kari Nordmann', email: 'kari.nordmann@example.no' };
const FULL = { ...PERSON, dpo: true, companyAddress: 'Postboks 123 Sentrum\n0101 Oslo', address: 'Storgata 1\n5300 Kleppestø', identifiers: [{ label: 'customer', value: 'K-40213' }] };
const SCENARIOS: Array<[string, LetterInput]> = [
  ['access, everything on, Norway', { ...FULL, kind: 'access', consultations: true }],
  ['access, post, paper copy, reply by post, another EEA country, narrowed', { ...PERSON, kind: 'access', channel: 'post', copyFormat: 'paper', replyBy: 'post', based: 'EEA', scope: 'some', scopeText: 'my orders from 2024', address: 'Storgata 1\n5300 Kleppestø' }],
  ['access, web form, outside the EEA, no DPO', { ...PERSON, kind: 'access', channel: 'webform', based: 'OUTSIDE' }],
  ['erasure, all six grounds with a reason, every extra on', { ...FULL, kind: 'erasure', grounds: { a: true, b: true, c: true, d: true, e: true, f: true }, groundDText: 'you sold my data', tellRecipients: true, madePublic: true, copyFirst: true }],
  ['erasure, no ground, extras off, post, narrowed', { ...PERSON, kind: 'erasure', channel: 'post', replyBy: 'post', scope: 'some', scopeText: 'the data you use for marketing', tellRecipients: false, address: 'Storgata 1\n5300 Kleppestø' }],
];

test('the four letters are the spec\'s section 3.6 templates, character for character', { skip: !here && 'the spec is not beside this repository' }, async () => {
  const { normalise } = await import('#src/letters.js');
  const md = readFileSync(SPEC, 'utf8');
  const templates: Record<string, Template> = {
    'access.en': parse(block(md, 'English, access')),
    'erasure.en': parse(block(md, 'English, erasure')),
    'access.nb': parse(block(md, 'Bokmål, innsyn (access)')),
    'erasure.nb': parse(block(md, 'Bokmål, sletting (erasure)')),
  };
  let compared = 0;
  for (const [name, input] of SCENARIOS) {
    for (const lang of LANGS) {
      const s = normalise({ ...input, lang });
      const want = finish(expand(templates[`${s.kind}.${lang}`]!, values(s), decider(s)));
      const got = render(s).text;
      assert.equal(got, want, `${name} (${lang})`);
      compared += 1;
    }
  }
  assert.equal(compared, 10);
});

test('the identifier labels are the spec\'s, in both languages', { skip: !here && 'the spec is not beside this repository' }, async () => {
  const { IDENTIFIER_LABELS } = await import('#src/letters.js');
  const md = readFileSync(SPEC, 'utf8');
  const en = md.match(/- English: (.+)\.\n/)![1]!.match(/"([^"]+)"/g)!.map((q) => q.slice(1, -1));
  const nb = md.match(/- Bokmål: (.+)\.\n/)![1]!.match(/"([^"]+)"/g)!.map((q) => q.slice(1, -1));
  assert.deepEqual(Object.values(IDENTIFIER_LABELS).map((l) => l.en), en);
  assert.deepEqual(Object.values(IDENTIFIER_LABELS).map((l) => l.nb), nb);
});

// Stage 2 (spec section 21.4 and 21.5): the ten follow-up templates and the two cover-note
// templates, expanded here from the spec's own words, and compared with src/followups.js and
// src/timeline.js character for character. The access items come from the first letter (checked
// above); the erasure items, the event sentences and the attachment labels are read from the spec.

const FU_BLOCKS: Record<string, [string, string]> = {
  reminder: ['English, reminder', 'Bokmål, påminnelse (reminder)'],
  partial: ['English, not fully', 'Bokmål, ikke fullstendig (not fully)'],
  extension: ['English, extension', 'Bokmål, forlengelse (extension)'],
  refusal: ['English, refusal', 'Bokmål, avslag (refusal)'],
  identity: ['English, identity', 'Bokmål, identitet (identity)'],
};

function fuDecider(f: FollowUp): Decide {
  const s16 = f.no16 && f.kind === 'access' && f.based === 'NO';
  const rules: Rules = [
    [/^(For the attention of the Data Protection Officer|Att\.: personvernombudet)$/, () => (f.dpo ? 0 : null)],
    [/^\{(Company postal address|Virksomhetens postadresse)\}$/, () => (f.companyAddress ? 0 : null)],
    [/^Data Protection Officer\|Sir or Madam$/, () => (f.dpo ? 0 : 1)],
    [/^(access to\|erasure of|innsyn i\|sletting av|15\|17)$/, () => (f.kind === 'access' ? 0 : 1)],
    [/^ (My request reached you on|Anmodningen kom fram til dere)/, () => (f.receivedDate ? 0 : null)],
    [/^(Your message does not give the reasons|Meldingen deres inneholder ingen begrunnelse)/, () => (f.noReasonsExt ? 0 : null)],
    [/^(My request reached you|Anmodningen min kom fram)/, () => (f.late ? 0 : null)],
    [/^(my request\|part of my request|anmodningen\|deler av anmodningen)$/, () => (f.refusedPart ? 1 : 0)],
    [/^(Your answer does not give your reasons|Svaret deres inneholder ingen begrunnelse)/, () => (f.noReasons ? 0 : null)],
    [/^(Under section 16|Etter personopplysningsloven § 16)/, () => (s16 ? 0 : null)],
    [/^(Your answer does not tell me|Svaret deres sier ikke)/, () => (f.noComplaint ? 0 : null)],
    [/^(a copy of an identity document|en kopi av et identitetsdokument)\|/, () => (f.idDocument ? 0 : 1)],
    [/^(I sent my request from the email|Jeg sendte anmodningen fra)/, () => (f.fromEmail ? 0 : null)],
    [/^(I sent my request through|Jeg sendte anmodningen gjennom)/, () => (f.loggedIn ? 0 : null)],
    [/^\{(email|e-post)\}\|(the postal address below|postadressen nedenfor)$/, () => (f.replyBy === 'email' ? 0 : 1)],
    [/^\{(Email|E-post)\}$/, () => (f.email ? 0 : null)],
    [/^\{(Postal address|Postadresse)\}$/, () => (f.address ? 0 : null)],
  ];
  return (content) => {
    const hit = rules.find(([re]) => re.test(content));
    assert.ok(hit, `no rule for the bracket [${content.slice(0, 60)}]`);
    return hit[1]();
  };
}

// The erasure checker items, as spec 21.3 quotes them (English first, then Bokmål).
function erasureItemsFromSpec(md: string): Record<string, Record<Lang, string>> {
  const sec = md.slice(md.indexOf('### 21.3'), md.indexOf('### 21.4'));
  const q = (label: string): string[] => [...sec.match(new RegExp(`  - ${label}: (.+)\\.\\n`))![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const ids = ['copy-first', 'recipients', 'kept', 'erased'];
  const en = q('English');
  const nb = q('Bokmål');
  return Object.fromEntries(ids.map((id, i) => [id, { en: en[i]!, nb: nb[i]! }]));
}

const FU_PERSON = { letterDate: '2026-12-01', company: 'Eksempel Handel AS', name: 'Kari Nordmann', email: 'kari.nordmann@example.no', requestDate: '2026-10-12', receivedDate: '2026-10-12', answerDate: '2026-11-10' };
const FU_FULL = { ...FU_PERSON, dpo: true, companyAddress: 'Postboks 123 Sentrum\n0101 Oslo', address: 'Storgata 1\n5300 Kleppestø' };
const FU_SCENARIOS: Array<[string, FollowUpInput]> = [
  ['reminder, access, everything on', { ...FU_FULL, situation: 'reminder' }],
  ['reminder, erasure, no receipt date, reply by post', { ...FU_PERSON, kind: 'erasure', situation: 'reminder', receivedDate: '', replyBy: 'post', address: 'Storgata 1\n5300 Kleppestø' }],
  ['not fully, access, some ticked, consultations', { ...FU_FULL, situation: 'partial', consultations: true, received: { copy: true, storage: true } }],
  ['not fully, erasure, every extra', { ...FU_PERSON, kind: 'erasure', situation: 'partial', copyFirst: true, received: { erased: true } }],
  ['extension, both', { ...FU_FULL, situation: 'extension', extension: { noReasons: true, late: true } }],
  ['extension, late only, erasure', { ...FU_PERSON, kind: 'erasure', situation: 'extension', extension: { late: true } }],
  ['refusal, part, all three, Norway', { ...FU_FULL, situation: 'refusal', refusal: { part: true, noReasons: true, no16: true, noComplaint: true } }],
  ['refusal, all, § 16 ticked but not Norway', { ...FU_PERSON, situation: 'refusal', based: 'EEA', refusal: { no16: true, noComplaint: true } }],
  ['identity, document, both ways', { ...FU_FULL, situation: 'identity', identity: { document: true, fromEmail: true, loggedIn: true } }],
  ['identity, other, erasure', { ...FU_PERSON, kind: 'erasure', situation: 'identity', identity: { document: false } }],
];

test('the ten follow-up letters are the spec\'s section 21.4 templates, character for character', { skip: !here && 'the spec is not beside this repository' }, async () => {
  const { normalise: fuNormalise, render: fuRender } = await import('#src/followups.js');
  const { accessItems } = await import('#src/letters.js');
  const md = readFileSync(SPEC, 'utf8');
  const erasure = erasureItemsFromSpec(md);
  let compared = 0;
  for (const [name, input] of FU_SCENARIOS) {
    for (const lang of LANGS) {
      const f = fuNormalise({ ...input, lang });
      const tree = parse(block(md, FU_BLOCKS[f.situation!]![lang === 'en' ? 0 : 1]));
      const d = (iso: string): string => (iso ? (lang === 'en' ? dateEn(iso) : dateNb(iso)) : (lang === 'en' ? '[date]' : '[dato]'));
      // The items: the first letter's (access) or the spec's (erasure), less what was ticked.
      const all = f.kind === 'access'
        ? accessItems(f, lang)
        : ['copy-first', 'recipients', 'kept', 'erased'].filter((id) => (id === 'copy-first' ? f.copyFirst : id === 'recipients' ? f.tellRecipients : true)).map((id) => ({ id, text: erasure[id]![lang] }));
      const left = all.filter((i) => !f.received[i.id]).map((i) => i.text);
      const items = left.map((t, i) => `${i + 1}. ${t}${lang === 'nb' ? '' : (i === left.length - 1 ? '.' : ';')}`).join('\n');
      const values: Record<string, string> = {
        Company: f.company, Virksomhet: f.company,
        'Company postal address': f.companyAddress, 'Virksomhetens postadresse': f.companyAddress,
        'Letter date': d(f.letterDate), Dato: d(f.letterDate),
        'Request date': d(f.requestDate), Anmodningsdato: d(f.requestDate),
        'Received date': d(f.receivedDate), Mottatt: d(f.receivedDate),
        'Answer date': d(f.answerDate), Svardato: d(f.answerDate),
        email: f.email, 'e-post': f.email,
        'Full name': f.name, 'Fullt navn': f.name,
        Email: f.email, 'E-post': f.email,
        'Postal address': f.address, Postadresse: f.address,
        Items: items, Punkter: items,
      };
      const want = finish(expand(tree, values, fuDecider(f)));
      assert.equal(fuRender(f).text, want, `${name} (${lang})`);
      compared += 1;
    }
  }
  assert.equal(compared, 20);
});

test('the reply checker\'s erasure items and the cover note\'s events are the spec\'s, in both languages', { skip: !here && 'the spec is not beside this repository' }, async () => {
  const { checkItems } = await import('#src/followups.js');
  const { EVENTS, EVENT_TYPES } = await import('#src/timeline.js');
  const md = readFileSync(SPEC, 'utf8');
  const erasure = erasureItemsFromSpec(md);
  for (const lang of LANGS) {
    const got = checkItems({ kind: 'erasure', copyFirst: true, tellRecipients: true }, lang);
    assert.deepEqual(got.map((i) => i.text), ['copy-first', 'recipients', 'kept', 'erased'].map((id) => erasure[id]![lang]));
  }
  const sec = md.slice(md.indexOf('### 21.5'), md.indexOf('**English, timeline**'));
  const lines = [...sec.matchAll(/^ {2}- "([^"]*)" \/ "([^"]*)" \(([^/]+) \/ ([^)]+)\)$/gm)];
  const other = sec.match(/^ {2}- "Other" \/ "Annet": the note alone \((\w+) \/ (\w+)\)$/m);
  assert.equal(lines.length, 10);
  assert.ok(other);
  EVENT_TYPES.forEach((t, i) => {
    if (t === 'other') {
      assert.deepEqual([EVENTS.other.attEn, EVENTS.other.attNb], [other![1], other![2]]);
      return;
    }
    const m = lines[i]!;
    assert.deepEqual([EVENTS[t].en, EVENTS[t].nb, EVENTS[t].attEn, EVENTS[t].attNb], [m[1], m[2], m[3], m[4]], t);
  });
});

test('the cover note is the spec\'s section 21.5 template, character for character', { skip: !here && 'the spec is not beside this repository' }, async () => {
  const { render: tlRender, EVENTS } = await import('#src/timeline.js');
  const md = readFileSync(SPEC, 'utf8');
  const input: { noteDate: string; company: string; name: string; missingText: string; events: Array<{ date: string; type: EventType; note?: string; attach?: boolean }> } = { noteDate: '2026-12-20', company: 'Eksempel Handel AS', name: 'Kari Nordmann', missingText: 'Navn på mottakerne', events: [
    { date: '2026-11-10', type: 'partial', note: 'No recipients were named', attach: true },
    { date: '2026-10-12', type: 'sent', attach: true },
    { date: '2026-10-14', type: 'confirmed', note: 'Automatic reply.' },
  ] };
  const sorted = [input.events[1]!, input.events[2]!, input.events[0]!];
  for (const lang of LANGS) {
    for (const kind of ['access', 'erasure']) {
      for (const withMissing of [true, false]) {
        const src = block(md, lang === 'en' ? 'English, timeline' : 'Bokmål, tidslinje (timeline)');
        const d = (iso: string): string => (lang === 'en' ? dateEn(iso) : dateNb(iso));
        // The event line and the attachment line repeat, once per event and once per attachment.
        const evLine = src.split('\n').find((l) => l.startsWith('- {'))!;
        const attLine = src.split('\n').find((l) => l.startsWith('{n}. '))!.replace(/\]$/, '');
        let n = 0;
        const evText = sorted.map((e) => {
          const att = e.attach ? (n += 1) : 0;
          const note = e.note ? (/[.!?]$/.test(e.note) ? e.note : `${e.note}.`) : '';
          return evLine
            .replace(/\{(Event date|Hendelsesdato)\}/, d(e.date))
            .replace(/\{(Event|Hendelse)\}/, EVENTS[e.type][lang])
            .replace(/\[ \{(Note|Merknad)\}\]/, note ? ` ${note}` : '')
            .replace(/\[ \((Attachment|vedlegg) \{n\}\)\]/, (_m0: string, w: string) => (att ? ` (${w} ${att})` : ''));
        }).join('\n');
        let k = 0;
        const attText = sorted.filter((e) => e.attach).map((e) => attLine.replace('{n}', String(k += 1))
          .replace(/\{(Attachment label|Vedleggsnavn)\}/, lang === 'en' ? EVENTS[e.type].attEn : EVENTS[e.type].attNb)
          .replace(/\{(Event date|Hendelsesdato)\}/, d(e.date))).join('\n');
        const rest = src.replace(evLine, '\u0002').replace(attLine, '\u0003');
        const values = { Company: input.company, Virksomhet: input.company, 'Full name': input.name, 'Fullt navn': input.name, 'Note date': d(input.noteDate), Notatdato: d(input.noteDate), Missing: input.missingText, Mangler: input.missingText };
        const decide: Decide = (content) => {
          if (/^(access to\|erasure of|innsyn i\|sletting av|access to the personal data|å få innsyn)/.test(content)) return kind === 'access' ? 0 : 1;
          if (/^(What is missing|Hva som mangler)/.test(content)) return withMissing ? 0 : null;
          if (/^(Attachments|Vedlegg):/.test(content)) return 0;
          throw new Error(`no rule for [${content.slice(0, 40)}]`);
        };
        const want = finish(expand(parse(rest), values, decide)).replace('\u0002', evText).replace('\u0003', attText);
        const got = tlRender({ ...input, lang, kind, missingText: withMissing ? input.missingText : '' });
        assert.equal(got, want, `${lang} ${kind} ${withMissing}`);
      }
    }
  }
});
