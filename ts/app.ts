/*! app.js is compiled from ts/app.ts by tools/build-ts.sh, which leaves out every comment but
    this one: the explanations are in the source. Edit the TypeScript, never the .js: the build
    refuses to overwrite a hand edit, and its check mode fails on one.

    What this file never does (spec section 9, checked by tests/static.test.ts):
      * open a connection: no fetch, XMLHttpRequest, WebSocket, EventSource or sendBeacon (the page's
        policy, connect-src 'none', would refuse them anyway);
      * read the address bar: no location.search or location.hash, so a link cannot prefill a letter
        (PRIV-2);
      * store anything: no localStorage, sessionStorage, IndexedDB, Cache Storage or cookie. Only the
        generated first-run notice (gate.js) keeps its one flag (PRIV-1);
      * submit a form: there is no form element (PRIV-3).
    Every field is emptied when the page starts, including what a browser restores on a reload, and
    choices a browser puts back just after the page has started are undone (PRIV-3). */

// GDPRLetterBuilder: the page. It only renders: the letters, the deadline, the calendar file, the
// email link and the warnings are pure modules under src/, tested in Node (tests/*.test.ts).

import { render, missing as missingParts } from './src/letters.js';
import { computeDeadline, estimatePostalReceipt, explainDeadline } from './src/deadline.js';
import { buildIcs, reminderDescription, reminderTitle } from './src/ics.js';
import { buildMailto, looksLikeEmail } from './src/mailto.js';
import { findSensitive, WARNINGS } from './src/personal-data.js';
import { isIsoDate, letterFileName, longDateEn, reminderFileName, toIso, dateEn } from './src/format.js';
import { render as renderFollowUp, missing as followUpMissing, checkItems, checkLabel, reminderCheck, extensionCheck, followUpFileName } from './src/followups.js';
import { render as renderTimeline, missing as timelineMissing, undatedCount, emptyOtherCount, timelineFileName } from './src/timeline.js';

// Every id app.ts looks up is in index.html, typed in ts/page.d.ts (checked against the page by
// tests/static.test.ts), so a lookup is never null.
const $ = ((id: string) => document.getElementById(id)) as PageLookup;
/**
 * Every element on the page that matches; all of them are HTML elements.
 */
const all = (sel: string): HTMLElement[] => ([...document.querySelectorAll(sel)] as HTMLElement[]);
/**
 * The value of the checked radio button of a group, or undefined when none is checked.
 */
const radio = (name: string): string | undefined => {
  const el = document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null;
  return el ? el.value : undefined;
};
const GROUNDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

let edited = false;
let lastRendered = '';
let lastSubject = '';
// What the letter was when the person first edited it: its subject, language and kind stay with
// the edited text, whatever the form says afterwards.
let editedMeta: { subject: string; kind: string | undefined; } | null = null;
let postedEstimate: string | null = null;
// A receipt date the person typed wins over the postal estimate until a new posting date is given.
let receivedByHand = false;

// Dates on this device

function today() {
  const d = new Date();
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// The answers

function state() {
  return {
    kind: radio('kind'),
    lang: radio('lang'),
    letterDate: isIsoDate($('letter-date').value) ? $('letter-date').value : today(),
    company: $('company').value,
    companyEmail: $('company-email').value,
    companyAddress: $('company-address').value,
    dpo: $('dpo').checked,
    channel: radio('channel'),
    based: radio('based'),
    name: $('name').value,
    email: $('email').value,
    address: $('address').value,
    replyBy: radio('reply'),
    identifiers: all('.id-row').map((row) => ({ label: row.querySelector('.id-label').value, value: row.querySelector('.id-value').value })),
    scope: radio('scope'),
    scopeText: $('scope-text').value,
    consultations: $('consultations').checked,
    copyFormat: radio('copy'),
    grounds: Object.fromEntries(GROUNDS.map((g) => [g, $(`ground-${g}`).checked])),
    groundDText: $('ground-d-text').value,
    tellRecipients: $('tell-recipients').checked,
    madePublic: $('made-public').checked,
    copyFirst: $('copy-first').checked,
  };
}

// The follow-up (step 9) and the cover note (step 10)

const fu: { edited: boolean; lastRendered: string; lastSubject: string; editedMeta: { subject: string; situation: string | undefined; } | null; } = { edited: false, lastRendered: '', lastSubject: '', editedMeta: null };
// The new deadline and the reminder or extension check's new words in this update, so that a
// change handler's own announcement carries them instead of replacing them (verification of
// 16 October 2026, N-1; stage 3 review E3-2).
let checkNews = '';
// Set once the page has drawn itself the first time: the deadline shown at the start is not news.
let started = false;
const tl = { edited: false, lastRendered: '' };
// The reply checker's ticks, by item id, kept while the list is rebuilt for other choices.
const ticked = new Map<string, boolean>();

function followUpState() {
  const s = state();
  return {
    ...s,
    lang: radio('fu-lang'),
    letterDate: isIsoDate($('fu-date').value) ? $('fu-date').value : today(),
    situation: radio('fu-situation'),
    requestDate: $('fu-request-date').value,
    receivedDate: $('fu-received-date').value,
    answerDate: $('fu-answer-date').value,
    received: Object.fromEntries((all('.fu-item input') as HTMLInputElement[]).map((el) => [el.value, el.checked])),
    extension: { noReasons: $('fu-ext-reasons').checked, late: $('fu-ext-late').checked },
    refusal: { part: radio('fu-refused') === 'part', noReasons: $('fu-ref-reasons').checked, no16: $('fu-ref-16').checked, noComplaint: $('fu-ref-complaint').checked },
    identity: { document: radio('fu-asked') !== 'other', fromEmail: $('fu-from-email').checked, loggedIn: $('fu-logged-in').checked },
  };
}

function timelineState() {
  const s = state();
  return {
    lang: radio('tl-lang'),
    noteDate: isIsoDate($('tl-date').value) ? $('tl-date').value : today(),
    kind: s.kind,
    company: s.company,
    name: s.name,
    missingText: $('tl-missing').value,
    events: all('.tl-row').map((row) => ({
      date: row.querySelector('.tl-date').value,
      type: row.querySelector('.tl-type').value,
      note: row.querySelector('.tl-note').value,
      attach: row.querySelector('.tl-attach').checked,
    })),
  };
}

/** The reply checker: one box per item the first letter asked for, rebuilt only when the list changes. */
let lastItemsKey = '';
function updateChecker(f: ReturnType<typeof followUpState>) {
  const items = checkItems(f, 'en');
  const key = `${f.kind}|${items.map((i) => i.id).join(',')}`;
  if (key === lastItemsKey) return;
  for (const el of all('.fu-item input') as HTMLInputElement[]) ticked.set(`${lastItemsKey.split('|')[0]}:${el.value}`, el.checked);
  lastItemsKey = key;
  const box = $('fu-items');
  box.replaceChildren(...items.map((item) => {
    const label = document.createElement('label');
    label.className = 'check fu-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.id = `fu-item-${item.id}`;
    input.checked = !!ticked.get(`${f.kind}:${item.id}`);
    input.setAttribute('aria-describedby', f.kind === 'erasure' ? 'fu-items-hint fu-erased-hint' : 'fu-items-hint');
    const span = document.createElement('span');
    span.textContent = checkLabel(f.kind, item.id);
    label.append(input, ' ', span);
    return label;
  }));
}

function updateFollowUp() {
  let f = followUpState();
  const sit = f.situation;
  $('fu-body').hidden = !sit;
  for (const el of all('[data-situation]')) el.hidden = el.dataset.situation !== sit;
  $('fu-received-field').hidden = !(sit === 'reminder' || sit === 'extension');
  $('fu-received-opt').textContent = sit === 'extension' ? '(needed if they told you too late)' : '(optional)';
  $('fu-answer-field').hidden = sit === 'reminder' || !sit;
  const sixteen = f.kind === 'access' && f.based === 'NO';
  $('fu-ref-16-row').hidden = !sixteen;
  $('fu-ref-16-hint').hidden = !sixteen;
  $('fu-erased-hint').hidden = f.kind !== 'erasure';
  updateChecker(f);
  f = followUpState();

  // The check beside a reminder or an extension (FU-5): a hint, never a block. It names the pause
  // that an identity check or a narrowing request can cause, and the holidays it does not count
  // outside Norway (review of 16 October 2026, L2-3).
  const note = $('fu-check');
  const PAUSE = 'If they asked about your identity, or asked you to narrow your request, the time may have paused';
  const HOLIDAYS = f.based === 'NO' ? '' : ' Public holidays in the company\'s country are not taken into account here; check them yourself.';
  let words = '';
  if (sit === 'reminder') {
    const c = reminderCheck({ receivedDate: f.receivedDate, based: f.based, letterDate: f.letterDate });
    if (c) words = c.early
      ? `Counted from the date it reached them, the time limit ends on ${dateEn(c.deadline)}. A reminder before then may be early. ${PAUSE}, so it can end later than this.${HOLIDAYS}`
      : `Counted from the date it reached them, the time limit ended on ${dateEn(c.deadline)}. ${PAUSE}, so it may not have ended yet.${HOLIDAYS}`;
  } else if (sit === 'extension') {
    const c = extensionCheck({ receivedDate: f.receivedDate, based: f.based, answerDate: f.answerDate });
    if (c) words = c.late
      ? `Counted from the date it reached them, the first month ended on ${dateEn(c.deadline)}, before their message. ${PAUSE}, and their message may still have been in time.${HOLIDAYS}`
      : `Counted from the date it reached them, the first month ends on ${dateEn(c.deadline)}, so their message came within it.${HOLIDAYS}`;
  }
  // Shown and hidden, so it is not a live region: a change of its words is announced instead (K2-3).
  if (note.textContent !== words) {
    note.textContent = words;
    if (words) {
      checkNews = checkNews ? `${checkNews} ${words}` : words;
      announce(checkNews);
    }
  }
  note.hidden = !words;

  const letter = renderFollowUp(f);
  fu.lastRendered = letter.text;
  fu.lastSubject = letter.subject;
  if (letter.nothingMissing && $('fu-nothing').hidden) announce('Nothing is missing, so there is no follow-up to write.');
  $('fu-nothing').hidden = !letter.nothingMissing;
  $('fu-letter-wrap').hidden = !letter.text && !fu.edited;
  const box = $('fu-letter');
  if (!fu.edited) {
    box.value = letter.text;
    box.lang = letter.lang === 'nb' ? 'nb' : 'en-GB';
  }
  $('fu-edited').hidden = !fu.edited;
  describe(box, 'fu-letter-hint', 'fu-edited', fu.edited);
  $('fu-attach').hidden = fuMeta().situation !== 'reminder';
  const gaps = followUpMissing(f);
  $('fu-missing').textContent = gaps.length ? `Still to fill in: ${gaps.join(', ')}.` : '';
  $('fu-missing').hidden = !gaps.length;
}

/** The subject and situation the outputs use: the edited letter's own, once it has been edited (K2-11). */
const fuMeta = () => (fu.edited && fu.editedMeta) || { subject: fu.lastSubject, situation: radio('fu-situation') };

function updateTimeline() {
  const t = timelineState();
  for (const row of all('.tl-row')) setWarning(row.querySelector('.tl-warn'), sensitiveWarnings(row.querySelector('.tl-note').value));
  setWarning($('tl-missing-warn'), sensitiveWarnings($('tl-missing').value));
  $('tl-undated').hidden = !undatedCount(t);
  $('tl-other-empty').hidden = !emptyOtherCount(t);
  const text = renderTimeline(t);
  tl.lastRendered = text;
  const box = $('tl-text');
  if (!tl.edited) {
    box.value = text;
    box.lang = t.lang === 'nb' ? 'nb' : 'en-GB';
  }
  $('tl-edited').hidden = !tl.edited;
  describe(box, '', 'tl-edited', tl.edited);
  const gaps = timelineMissing(t);
  $('tl-missing-parts').textContent = gaps.length ? `Still to fill in: ${gaps.join(', ')}.` : '';
  $('tl-missing-parts').hidden = !gaps.length;
}

// The timeline's rows

function renumberEvents() {
  all('.tl-row').forEach((row, i) => {
    const n = i + 1;
    row.querySelector('.tl-date-label').textContent = `Event ${n}: date`;
    row.querySelector('.tl-type-label').textContent = `Event ${n}: what happened`;
    // The label's first child is its text, before the (optional) span.
    (row.querySelector('.tl-note-label').firstChild as ChildNode).textContent = `Event ${n}: your own note `;
    row.querySelector('.tl-attach-label').textContent = `I will attach a document for event ${n}`;
    row.querySelector('.tl-remove').setAttribute('aria-label', `Remove event ${n}`);
  });
}

let eventSeq = 0;
function addEvent({ focus = true } = {}) {
  eventSeq += 1;
  const frag = $('tl-row-template').content.cloneNode(true) as DocumentFragment;
  const row = frag.querySelector('.tl-row');
  const ids = { date: `tl-date-${eventSeq}`, type: `tl-type-${eventSeq}`, note: `tl-note-${eventSeq}`, warn: `tl-warn-${eventSeq}`, attach: `tl-attach-${eventSeq}` };
  row.querySelector('.tl-date').id = ids.date;
  row.querySelector('.tl-type').id = ids.type;
  row.querySelector('.tl-note').id = ids.note;
  row.querySelector('.tl-warn').id = ids.warn;
  row.querySelector('.tl-attach').id = ids.attach;
  row.querySelector('.tl-date-label').htmlFor = ids.date;
  row.querySelector('.tl-type-label').htmlFor = ids.type;
  row.querySelector('.tl-note-label').htmlFor = ids.note;
  row.querySelector('.tl-note').setAttribute('aria-describedby', ids.warn);
  row.querySelector('.tl-remove').addEventListener('click', () => {
    const rows = all('.tl-row');
    const i = rows.indexOf(row);
    row.remove();
    renumberEvents();
    update();
    announce(tl.edited ? 'Event removed.' : 'Event removed. Note updated.');
    const left = all('.tl-row');
    (left[Math.min(i, left.length - 1)]?.querySelector('.tl-date') || $('tl-add')).focus();
  });
  $('tl-rows').append(row);
  renumberEvents();
  if (focus) row.querySelector('.tl-date').focus();
  update();
}

/**
 * A box's description: its hint, and the "you have edited" notice only while that shows, because a
 * hidden element named in aria-describedby is still read out (code review of 16 October 2026, K2-5).
 * @param hint an id, or '' for none
 * @param notice an id
 */
function describe(box: HTMLElement, hint: string, notice: string, edited: boolean) {
  const ids = [hint, edited ? notice : ''].filter(Boolean).join(' ');
  if (ids) box.setAttribute('aria-describedby', ids);
  else box.removeAttribute('aria-describedby');
}

// Warnings

/**
 * Shows or hides a field's warning paragraph, which the field names in aria-describedby.
 */
function setWarning(el: HTMLElement, messages: string[]) {
  el.replaceChildren();
  if (!messages.length) {
    el.hidden = true;
    return;
  }
  const label = document.createElement('strong');
  label.textContent = 'Warning:';
  el.append(label, ` ${messages.join(' ')}`);
  el.hidden = false;
}

function sensitiveWarnings(text: string): string[] {
  const kinds = [...new Set(findSensitive(text).map((f) => f.kind))];
  return kinds.map((k) => WARNINGS[k]);
}

function updateWarnings() {
  for (const row of all('.id-row')) setWarning(row.querySelector('.id-warn'), sensitiveWarnings(row.querySelector('.id-value').value));
  setWarning($('scope-text-warn'), sensitiveWarnings($('scope-text').value));
  setWarning($('ground-d-text-warn'), sensitiveWarnings($('ground-d-text').value));
  const ce = $('company-email').value.trim();
  setWarning($('company-email-warn'), ce && !looksLikeEmail(ce) ? ['This does not look like an email address, so Send using email app will leave the recipient empty.'] : []);
  // The person's own address goes in the draft's Cc only when it passes the same check (OUT-1).
  const oe = $('email').value.trim();
  setWarning($('email-warn'), oe && !looksLikeEmail(oe) ? ['This does not look like an email address, so Send using email app will leave it out of Cc.'] : []);
}

// What shows

function updateVisibility(s: ReturnType<typeof state>) {
  for (const el of all('[data-kind]')) el.hidden = el.dataset.kind !== s.kind;
  $('scope-field').hidden = s.scope !== 'some';
  $('ground-d-field').hidden = !(s.kind === 'erasure' && s.grounds.d);
  $('outside-note').hidden = s.based !== 'OUTSIDE';
  $('posted-field').hidden = s.channel !== 'post';
}

function updateLetter(s: ReturnType<typeof state>) {
  const letter = render(s);
  lastRendered = letter.text;
  lastSubject = letter.subject;
  const box = $('letter');
  if (!edited) {
    box.value = letter.text;
    box.lang = letter.lang === 'nb' ? 'nb' : 'en-GB';
  }
  $('letter-edited').hidden = !edited;
  describe(box, 'letter-hint', 'letter-edited', edited);
  const gaps = missingParts(s);
  const miss = $('missing');
  miss.textContent = gaps.length ? `Still to fill in: ${gaps.join(', ')}.` : '';
  miss.hidden = !gaps.length;
}

/** The subject and kind the outputs use: the edited letter's own, once the person has edited it. */
const outMeta = () => (edited && editedMeta) || { subject: lastSubject, kind: radio('kind') };

// The deadline

function deadlineNow() {
  const received = $('received').value;
  if (!isIsoDate(received)) return null;
  const s = state();
  // The date field accepts dates that are real but too far ahead to count (the extension would
  // fall after 2199): no deadline then, rather than the last one left on screen.
  let result;
  try {
    result = computeDeadline(received, s.based);
  } catch {
    return null;
  }
  const estimated = s.channel === 'post' && postedEstimate === received;
  return { result, explained: explainDeadline(result, { estimated }) };
}

// The result is plain text, not a live region: Chromium on Android reads a live region out whenever
// it enters the page (at every start, and when a dialog closes), so a change of the deadline is
// announced through the page's one announcer instead (stage 3 review E3-2). It is rebuilt only when
// its words change, so typing elsewhere on the page does not announce it again.
let lastDeadline: string | null = null;
function updateDeadline() {
  const box = $('deadline-result');
  const d = deadlineNow();
  $('save-ics').disabled = !d;
  $('save-ics-ext').disabled = !d;
  const words = d ? JSON.stringify(d.explained) : '';
  if (words === lastDeadline) return;
  lastDeadline = words;
  box.replaceChildren();
  if (!d) return;
  const { explained } = d;
  const p = (text: string, cls?: string) => {
    const el = document.createElement('p');
    if (cls) el.className = cls;
    el.textContent = text;
    return el;
  };
  const first = document.createElement('p');
  const head = document.createElement('strong');
  head.className = 'deadline-head';
  head.textContent = explained.headline;
  first.append(head, `, ${explained.counted}`);
  box.append(first, ...explained.lines.map((l) => p(l)), p(explained.extension, 'deadline-ext'));
  if (started) {
    checkNews = [`${explained.headline}, ${explained.counted}`, ...explained.lines, explained.extension].join(' ');
    announce(checkNews);
  }
}

/** For post, the date they received it is estimated from the date it was posted (OUT-6). */
function updateEstimate() {
  const s = state();
  if (s.channel !== 'post') {
    // Back to email or a web form: an estimate left in the box no longer applies.
    if (postedEstimate !== null && $('received').value === postedEstimate) $('received').value = today();
    postedEstimate = null;
    return;
  }
  if (receivedByHand) return;
  const posted = $('posted').value;
  if (!isIsoDate(posted)) return;
  try {
    postedEstimate = estimatePostalReceipt(posted, s.based).date;
  } catch {
    return;
  }
  $('received').value = postedEstimate;
}

// Everything

// The page's one live region (#announcer). Every message the page speaks goes through it; the
// status lines under the buttons and the deadline are plain text. It is emptied a few seconds after
// each message (unless something newer is there by then), so nothing old is read out again when
// Chromium on Android re-reads live regions (at the start, and when a dialog or the first-run
// notice closes; stage 3 review E3-2).
const ANNOUNCE_CLEAR_MS = 4000;
let announceTimer = 0;
let announceClear = 0;
function announce(text: string) {
  window.clearTimeout(announceTimer);
  window.clearTimeout(announceClear);
  const el = $('announcer');
  el.textContent = '';
  announceTimer = window.setTimeout(() => {
    el.textContent = text;
    announceClear = window.setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, ANNOUNCE_CLEAR_MS);
  }, 50);
}

function update() {
  checkNews = '';
  const s = state();
  updateVisibility(s);
  updateLetter(s);
  updateWarnings();
  updateDeadline();
  updateFollowUp();
  updateTimeline();
}

// The details rows

function renumberRows() {
  all('.id-row').forEach((row, i) => {
    const n = i + 1;
    row.querySelector('.id-label-label').textContent = `Detail ${n}: what it is`;
    row.querySelector('.id-value-label').textContent = `Detail ${n}: the detail`;
    row.querySelector('.id-remove').setAttribute('aria-label', `Remove detail ${n}`);
  });
}

let rowSeq = 0;
function addRow({ focus = true } = {}) {
  rowSeq += 1;
  const frag = $('id-row-template').content.cloneNode(true) as DocumentFragment;
  const row = frag.querySelector('.id-row');
  const sel = row.querySelector('.id-label');
  const input = row.querySelector('.id-value');
  const warn = row.querySelector('.id-warn');
  sel.id = `id-label-${rowSeq}`;
  input.id = `id-value-${rowSeq}`;
  warn.id = `id-warn-${rowSeq}`;
  row.querySelector('.id-label-label').htmlFor = sel.id;
  row.querySelector('.id-value-label').htmlFor = input.id;
  input.setAttribute('aria-describedby', `ids-hint ${warn.id}`);
  row.querySelector('.id-remove').addEventListener('click', () => {
    const rows = all('.id-row');
    const i = rows.indexOf(row);
    row.remove();
    renumberRows();
    update();
    announce('Detail removed. Letter updated.');
    const left = all('.id-row');
    (left[Math.min(i, left.length - 1)]?.querySelector('.id-value') || $('id-add')).focus();
  });
  $('id-rows').append(row);
  renumberRows();
  if (focus) sel.focus();
  update();
}

// Outputs

/** The line under step 6's buttons. */
const status = (text: string) => say('out-status', text);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function selectLetter() {
  const box = $('letter');
  box.focus();
  box.select();
}

/**
 * Opens a link the way a press on a link would, without leaving the page (mailto:).
 */
function openLink(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener noreferrer';
  a.click();
}

/**
 * A file the person saves (MetadataScrubber's Save pattern): a blob in the page's own memory.
 */
function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function onCopy() {
  if (await copyText($('letter').value)) status('Copied.');
  else {
    selectLetter();
    status('Your browser did not allow copying. The letter is selected: press Ctrl+C, or Cmd+C on a Mac.');
  }
}

// Some email apps may read only the start of a long mailto: link, so the person checks the draft.
const DRAFT_HINT = 'Your email app should open a draft. Check that the whole letter is in it before you press Send.';

/**
 * Send using email app (OUT-1): a draft in the person's own email app with the letter as it
 * stands, to the company's privacy email, with their own email address as Cc when they gave one.
 * Nothing is copied: the whole letter is in the draft.
 */
function onEmail() {
  const to = $('company-email').value;
  openLink(buildMailto({ to, cc: $('email').value, subject: outMeta().subject, body: $('letter').value }));
  const noTo = looksLikeEmail(to) ? '' : ' Add the company\'s privacy email in step 2 to fill in the recipient.';
  status(`${DRAFT_HINT}${noTo}`);
}

// What the print style sheet shows: the first letter, unless a print button of the follow-up or
// the cover note asked for theirs. It goes back to the first letter only after printing, because
// some browsers return from print() before they fire beforeprint (code review of 16 October 2026,
// K2-1). The browser's own print command (Ctrl+P) prints the first letter.
let printSource: 'letter' | 'fu-letter' | 'tl-text' = 'letter';
// Save as PDF (OUT-4) opens the browser's print window, where the person picks the PDF.
// Browsers name that choice differently (Save as PDF, Save to PDF, PDF), so the hint names none.
const PRINT_HINT = 'In the print window, choose to save as PDF instead of a printer.';
function fillPrint() {
  const p = $('print-letter');
  p.textContent = $(printSource).value;
  p.lang = $(printSource).lang;
}

function onPrint() {
  printSource = 'letter';
  fillPrint();
  status(PRINT_HINT);
  window.print();
}

function printBox(id: 'fu-letter' | 'tl-text', statusId: 'fu-status' | 'tl-status') {
  printSource = id;
  fillPrint();
  say(statusId, PRINT_HINT);
  window.print();
}

/**
 * A status line under a set of output buttons: plain text that stays on screen, announced through
 * the announcer each time (E3-2), so the same words twice are read out twice.
 */
function say(id: 'out-status' | 'ics-status' | 'ext-status' | 'fu-status' | 'tl-status', text: string) {
  $(id).textContent = text;
  announce(text);
}

async function copyBox(id: 'fu-letter' | 'tl-text', statusId: 'fu-status' | 'tl-status') {
  if (await copyText($(id).value)) say(statusId, 'Copied.');
  else {
    $(id).focus();
    $(id).select();
    say(statusId, 'Your browser did not allow copying. The text is selected: press Ctrl+C, or Cmd+C on a Mac.');
  }
}

function onFuEmail() {
  const to = $('company-email').value;
  openLink(buildMailto({ to, cc: $('email').value, subject: fuMeta().subject, body: $('fu-letter').value }));
  const noTo = looksLikeEmail(to) ? '' : ' Add the company\'s privacy email in step 2 to fill in the recipient.';
  const attach = fuMeta().situation === 'reminder' ? ' Remember to attach your first letter.' : '';
  say('fu-status', `${DRAFT_HINT}${attach}${noTo}`);
}

function onFuSave() {
  const name = followUpFileName(isIsoDate($('fu-date').value) ? $('fu-date').value : today());
  saveFile(name, $('fu-letter').value, 'text/plain;charset=utf-8');
  say('fu-status', `Saved as ${name}.`);
}

function onTlSave() {
  const name = timelineFileName(isIsoDate($('tl-date').value) ? $('tl-date').value : today());
  saveFile(name, $('tl-text').value, 'text/plain;charset=utf-8');
  say('tl-status', `Saved as ${name}.`);
}

async function shareBox(id: 'fu-letter' | 'tl-text') {
  try {
    await navigator.share({ text: $(id).value });
  } catch {
    /* Closed by the person, or refused: nothing to say. */
  }
}

function onSaveTxt() {
  const s = state();
  const name = letterFileName(outMeta().kind, s.letterDate);
  saveFile(name, $('letter').value, 'text/plain;charset=utf-8');
  status(`Saved as ${name}.`);
}

async function onShare() {
  try {
    await navigator.share({ text: $('letter').value });
  } catch {
    /* Closed by the person, or refused: nothing to say. */
  }
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function onSaveIcs(extended: boolean) {
  const d = deadlineNow();
  if (!d) {
    say(extended ? 'ext-status' : 'ics-status', 'Fill in the date they received it, in step 7, first.');
    return;
  }
  const date = extended ? d.result.extension.date : d.result.first.date;
  const title = reminderTitle($('company').value, date, { leaveOut: $('ics-leave-out').checked });
  const description = reminderDescription(d.explained, { extended, extendedDate: longDateEn(d.result.extension.date) });
  const ics = buildIcs({ deadline: date, title, description, uid: randomHex(16), dtstamp: new Date() });
  const name = reminderFileName(date);
  saveFile(name, ics, 'text/calendar;charset=utf-8');
  say(extended ? 'ext-status' : 'ics-status', `Saved as ${name}. Open it to add the reminder to your calendar.`);
}

// Confirm, rebuild, clear

function confirmFirst(text: string, okLabel: string): Promise<boolean> {
  const dlg = $('confirm-dialog');
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    const done = (answer: boolean) => {
      $('confirm-ok').removeEventListener('click', yes);
      $('confirm-cancel').removeEventListener('click', no);
      dlg.removeEventListener('cancel', no);
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    const yes = () => done(true);
    const no = () => done(false);
    $('confirm-ok').addEventListener('click', yes);
    $('confirm-cancel').addEventListener('click', no);
    dlg.addEventListener('cancel', no);
    dlg.showModal();
    $('confirm-cancel').focus();
  });
}

async function onRebuild() {
  if (!(await confirmFirst('Rebuild the letter from the form? Your own changes to the letter will be lost.', 'Rebuild'))) {
    $('rebuild').focus();
    return;
  }
  edited = false;
  editedMeta = null;
  update();
  announce('Letter rebuilt from the form.');
  $('letter').focus();
}

async function onRebuildBox(which: 'fu' | 'tl') {
  const isFu = which === 'fu';
  const button = isFu ? 'fu-rebuild' : 'tl-rebuild';
  const what = isFu ? 'letter' : 'note';
  if (!(await confirmFirst(`Rebuild the ${what} from the form? Your own changes to the ${what} will be lost.`, 'Rebuild'))) {
    $(button).focus();
    return;
  }
  if (isFu) {
    fu.edited = false;
    fu.editedMeta = null;
  } else tl.edited = false;
  update();
  // Nothing missing: there is no letter to go back to, so focus and the message go to the note
  // that says so (K2-4).
  if (isFu && $('fu-letter-wrap').hidden) {
    announce('Nothing is missing, so there is no follow-up to write.');
    $('fu-nothing').focus();
    return;
  }
  announce(`${isFu ? 'Letter' : 'Note'} rebuilt from the form.`);
  $(isFu ? 'fu-letter' : 'tl-text').focus();
}

function defaultLang() {
  const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).map((l) => String(l).toLowerCase());
  const first = langs[0] || '';
  return /^(nb|nn|no)(-|$)/.test(first) ? 'nb' : 'en';
}

/** Every field back to its default. Runs when the page starts and on Clear. */
function reset() {
  for (const el of all('main input[type="text"], main input[type="email"], main textarea') as Array<HTMLInputElement | HTMLTextAreaElement>) el.value = '';
  for (const el of all('main input[type="checkbox"]') as HTMLInputElement[]) el.checked = false;
  $('tell-recipients').checked = true;
  for (const id of ['kind-access', 'channel-email', 'based-no', 'reply-email', 'scope-all', 'copy-electronic'] as const) $(id).checked = true;
  $(defaultLang() === 'nb' ? 'lang-nb' : 'lang-en').checked = true;
  $('id-rows').replaceChildren();
  const t = today();
  $('letter-date').value = t;
  $('posted').value = t;
  $('received').value = t;
  postedEstimate = null;
  receivedByHand = false;
  edited = false;
  editedMeta = null;
  // Step 9 and the cover note: no situation chosen, every date but the letter's own empty.
  for (const el of all('input[name="fu-situation"]') as HTMLInputElement[]) el.checked = false;
  for (const id of ['fu-request-date', 'fu-received-date', 'fu-answer-date'] as const) $(id).value = '';
  for (const id of ['fu-refused-all', 'fu-asked-document', 'tl-lang-nb'] as const) $(id).checked = true;
  $(defaultLang() === 'nb' ? 'fu-lang-nb' : 'fu-lang-en').checked = true;
  $('fu-date').value = t;
  $('tl-date').value = t;
  ticked.clear();
  lastItemsKey = '';
  $('fu-items').replaceChildren();
  $('tl-rows').replaceChildren();
  Object.assign(fu, { edited: false, editedMeta: null });
  tl.edited = false;
  for (const d of all('main details') as HTMLDetailsElement[]) d.open = false;
  for (const id of ['out-status', 'ics-status', 'ext-status', 'fu-status', 'tl-status'] as const) $(id).textContent = '';
}

async function onClear() {
  if (!(await confirmFirst('Clear everything you have typed, and the letter?', 'Clear'))) {
    $('clear').focus();
    return;
  }
  reset();
  update();
  status('Cleared.');
  $('company').focus();
}

// Wiring

function wire() {
  const main = $('main');
  // Typing updates the letter quietly; a change of option says "Letter updated" once.
  main.addEventListener('input', (ev) => {
    // Only the form's own fields fire input and change events inside main.
    const t = ev.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (t.id === 'letter') {
      if (!edited && t.value !== lastRendered) editedMeta = { subject: lastSubject, kind: radio('kind') };
      if (t.value !== lastRendered) edited = true;
      $('letter-edited').hidden = !edited;
      describe(t, 'letter-hint', 'letter-edited', edited);
      return;
    }
    if (t.id === 'fu-letter') {
      if (!fu.edited && t.value !== fu.lastRendered) fu.editedMeta = { subject: fu.lastSubject, situation: radio('fu-situation') };
      if (t.value !== fu.lastRendered) fu.edited = true;
      $('fu-edited').hidden = !fu.edited;
      describe(t, 'fu-letter-hint', 'fu-edited', fu.edited);
      return;
    }
    if (t.id === 'tl-text') {
      if (t.value !== tl.lastRendered) tl.edited = true;
      $('tl-edited').hidden = !tl.edited;
      describe(t, '', 'tl-edited', tl.edited);
      return;
    }
    if (t.id === 'received') receivedByHand = true;
    if (t.id === 'posted') {
      // A new posting date means a new estimate.
      receivedByHand = false;
      updateEstimate();
    }
    if (t.matches('input[type="text"], input[type="email"], textarea, input[type="date"]')) update();
  });
  main.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (t.id === 'letter' || t.id === 'fu-letter' || t.id === 'tl-text') return;
    // The same rule as on input, for a browser that sends only change from a date field.
    if (t.id === 'received') receivedByHand = true;
    if (t.id === 'posted') receivedByHand = false;
    if (t.name === 'channel' || t.name === 'based' || t.id === 'posted') updateEstimate();
    if (t.matches('input[type="radio"], input[type="checkbox"], select')) {
      update();
      let said = '';
      if (t.closest('#followup')) {
        if (!fu.edited && fu.lastRendered) said = 'Follow-up letter updated.';
      } else if (t.closest('.tl-row') || t.name === 'tl-lang') {
        if (!tl.edited) said = 'Note updated.';
      } else if (t.id !== 'ics-leave-out' && !edited) said = 'Letter updated.';
      if (said) announce(checkNews ? `${said} ${checkNews}` : said);
    } else update();
  });
  $('id-add').addEventListener('click', () => addRow());
  $('copy-letter').addEventListener('click', onCopy);
  $('open-email').addEventListener('click', onEmail);
  $('print').addEventListener('click', onPrint);
  $('save-txt').addEventListener('click', onSaveTxt);
  $('share').addEventListener('click', onShare);
  $('save-ics').addEventListener('click', () => onSaveIcs(false));
  $('save-ics-ext').addEventListener('click', () => onSaveIcs(true));
  $('rebuild').addEventListener('click', onRebuild);
  $('fu-rebuild').addEventListener('click', () => onRebuildBox('fu'));
  $('tl-rebuild').addEventListener('click', () => onRebuildBox('tl'));
  $('fu-copy').addEventListener('click', () => copyBox('fu-letter', 'fu-status'));
  $('fu-email').addEventListener('click', onFuEmail);
  $('fu-print').addEventListener('click', () => printBox('fu-letter', 'fu-status'));
  $('fu-save').addEventListener('click', onFuSave);
  $('fu-share').addEventListener('click', () => shareBox('fu-letter'));
  $('tl-add').addEventListener('click', () => addEvent());
  $('tl-copy').addEventListener('click', () => copyBox('tl-text', 'tl-status'));
  $('tl-print').addEventListener('click', () => printBox('tl-text', 'tl-status'));
  $('tl-save').addEventListener('click', onTlSave);
  $('tl-share').addEventListener('click', () => shareBox('tl-text'));
  $('clear').addEventListener('click', onClear);
  window.addEventListener('beforeprint', fillPrint);
  window.addEventListener('afterprint', () => { printSource = 'letter'; });
  for (const id of ['share', 'fu-share', 'tl-share'] as const) $(id).hidden = typeof navigator.share !== 'function';
}

reset();
wire();
update();
started = true;
// A browser that restores a page from its back-forward cache keeps the page in memory only; one
// that restores the fields on a reload is undone by reset() above.
//
// Firefox's session restore (after a crash, at its standard privacy level) puts radios and
// checkboxes back some 30 ms after load, firing input events; the text fields carry
// autocomplete="off", so it keeps none of what was typed. Until the person has pressed a key or a
// pointer, or moved focus into the form, such an event can only be the browser restoring: undo it.
// Only in the first three seconds, so that a later activation by an assistive technology that
// fires no pointer, key or focus event is never undone (PRIV-3; code review of 12 October 2026).
let interacted = false;
const loadedAt = performance.now();
const touched = () => { interacted = true; };
for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, touched, { capture: true, passive: true });
$('main').addEventListener('focusin', touched, true);
$('main').addEventListener('input', (ev) => {
  if (interacted || ['letter', 'fu-letter', 'tl-text'].includes((ev.target as HTMLElement).id) || performance.now() - loadedAt > 3000) return;
  ev.stopPropagation();
  reset();
  update();
}, true);
document.documentElement.dataset.ready = 'true';
