#!/usr/bin/env node
// Browser smoke test of GDPRLetterBuilder in APP MODE: the page as the Android app loads it, driven
// over the DevTools protocol in headless Chromium with nothing but Node 24 built-ins (tests/cdp.ts).
// Modelled on CheckLink's tests/app-mode-smoke.ts (stage 3 review A3-3).
//
//   node tests/app-mode-smoke.ts [--chromium /usr/bin/chromium] [--out DIR]
//
// What it serves is what the APK holds: index.html with the one line the build injects
// (<script src="android-bridge.js"></script> before the first script, as WebAssets.inject does in
// android/app/build.gradle.kts), android/web-overlay/android-bridge.js beside it, and every response
// with the headers the app's asset handler sends (ResponseHeaders.kt: the full policy, nosniff,
// no-store and no-referrer).
//
// The app's side of the window.GLBridge channel is a stand-in (installBridgeStub below), injected before
// the page loads, as the WebView injects the real one. It records every message the page posts and
// answers as MainActivity does, in a way each check chooses (ok, refused, a cancelled or a busy save,
// a save held until the check releases it). The real android-bridge.js runs on top of it, so this
// tests the bridge script and the page together:
//   * the bridge says hello first; the website-only section stays hidden, even when its hidden
//     attribute is taken off or a new website-only part is added;
//   * Copy, Share, Print and every Save of the first letter, the follow-up letter and the cover
//     note go to the app with the box's exact text, the right print kind and the page's own file
//     name and bytes; the status lines say what the page says, and what the app answered: a
//     cancelled save clears "Saved as", a failed one says so, a busy one leaves it (E3-4);
//   * Add to calendar app sends calendar, never save, with the page's reminder, and the line under
//     it says it is opening and then what the app answered; it is disabled with Save a reminder;
//   * no email app: "Copied. Paste the letter into the message." becomes "Copied." (E3-7);
//   * a text over 100,000 characters is refused before anything is posted, with the approved line;
//     a message over 450,000 characters is never posted (A3-5, E3-6, A3-6);
//   * Back: with nothing typed the app is told to close; with something typed, or an edited
//     letter, the page's own dialog asks "Close the app? What you have typed will be lost.", and
//     only Close closes; Back on an open dialog closes it, as Cancel (E3-1);
//   * one live region: the status lines and the deadline are plain text, the announcer speaks
//     them and is emptied a few seconds later (E3-2);
//   * no request leaves the page after it has loaded, none goes to another site, no download
//     starts and the policy refuses nothing;
//   * large text enlarged the app's way (textZoom, emulated as measured on the emulator) at 1.3,
//     1.5 and 2.0, at 320 and 412 px: the notice, the letter page with a detail and a timeline row,
//     the privacy page and the disclaimer; the text grows, nothing reaches past the screen, every
//     date shows whole and the rows hold their fields and buttons (17 October 2026);
//   * the same files without the bridge (a WebView too old for it) and the website itself show
//     none of the app's parts.
// Nothing leaves the machine: the browser can reach only this server.
//
// The file name does not end in .test.ts, so `npm test` does not run it.

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inPage, launchChromium, openPage, sleep } from './cdp.ts';
import type { Page, PageOptions } from './cdp.ts';
import type { AddressInfo } from 'node:net';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const CHROMIUM = opt('--chromium', process.env.CHROMIUM || '/usr/bin/chromium');
const OUT = resolve(opt('--out', join(tmpdir(), 'gdpr-app-mode')));
const SHOTS = join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(CHROMIUM)) {
  console.error(`Chromium not found at ${CHROMIUM}. Pass --chromium PATH.`);
  process.exit(2);
}
const J = JSON.stringify;

let passes = 0;
let failures = 0;
function check(name: string, ok: unknown, detail?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail !== undefined ? `\n     ${typeof detail === 'string' ? detail : J(detail).slice(0, 1500)}` : ''}`);
}

// The app's asset handler sends these on every response (ResponseHeaders.kt, ALL).
const KT = join(ROOT, 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder');
const APP_CSP = readFileSync(join(KT, 'ResponseHeaders.kt'), 'utf8')
  .match(/CONTENT_SECURITY_POLICY =\s*([\s\S]*?)\n\n/)![1]!
  .match(/"([^"]*)"/g)!.map((s) => s.slice(1, -1)).join('');
const HEADERS = { 'Content-Security-Policy': APP_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const BRIDGE_TAG = '<script src="android-bridge.js"></script>';
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

// The bridge's own words (android-bridge.js), read from it so a change there shows here.
const BRIDGE_SRC = readFileSync(join(ROOT, 'android/web-overlay/android-bridge.js'), 'utf8');
const W = (name: string): string => BRIDGE_SRC.match(new RegExp(`var ${name} = '([^']+)';`))![1]!;
const TOO_LONG = W('TOO_LONG');
const SAVE_FAILED = W('SAVE_FAILED');
const CLOSE_QUESTION = W('CLOSE_QUESTION');
const CAL = { opening: W('CALENDAR_OPENING'), opened: W('CALENDAR_OPENED'), failed: W('CALENDAR_FAILED'), label: W('CALENDAR_LABEL') };

// WebAssets.inject: the bridge tag on its own line, before the first <script, same indent.
function inject(source: string): string {
  const first = source.indexOf('<script');
  const lineStart = source.lastIndexOf('\n', first) + 1;
  const indent = source.slice(lineStart, first);
  return `${source.slice(0, lineStart)}${indent}${BRIDGE_TAG}\n${source.slice(lineStart)}`;
}

// /app/... is the APK's copy, /web/... the website, both from the same files; anything else (the
// footer carousel's /switcher-icons/...) is the website's.
const server = createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  let path = decodeURIComponent(url.pathname);
  const app = path.startsWith('/app/');
  if (!app && !path.startsWith('/web/')) path = `/web${path}`;
  const rel = path.replace(/^\/(app|web)\//, '/');
  let body: Buffer | null = null;
  let type: string | null = null;
  if (app && rel === '/android-bridge.js') {
    body = Buffer.from(BRIDGE_SRC);
    type = TYPES['.js']!;
  } else {
    const file = normalize(join(ROOT, rel.endsWith('/') ? `${rel}index.html` : rel));
    if (req.method === 'GET' && file.startsWith(ROOT) && !file.includes('/android/') && !file.includes('/tests/') && existsSync(file) && statSync(file).isFile()) {
      body = readFileSync(file);
      type = TYPES[extname(file)] || 'application/octet-stream';
      if (app && file === join(ROOT, 'index.html')) body = Buffer.from(inject(body.toString('utf8')));
    }
  }
  if (!body) {
    res.writeHead(404, HEADERS);
    res.end('');
    return;
  }
  res.writeHead(200, { ...HEADERS, 'Content-Type': type! });
  res.end(body);
});
await new Promise<void>((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', () => r()); });
const ORIGIN = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// The app's side of GLBridge, as MainActivity answers it. window.__gl: posted (every message, in
// order), mode (per type: 'ok' or 'fail'; for save also 'cancel', 'busy' or 'hold'), held (save ids
// held back), mailto (the mailto: links the page opened, which reach the app as navigations),
// send(msg) (a message from the app), release(answer) (answers every held save), back() (Android's
// Back as a numbered query; the stub agrees to the page's ask as BackQuery.kt does, unless the
// query has timed out), timeOut() (the app's 1.5 s passed: it shows its own dialog and drops any
// later answer to that query).
function installBridgeStub(): void {
  const gl = window.__gl = { posted: [], mode: {}, held: [], mailto: [] } as unknown as Gl;
  let listen: ((ev: { data: string }) => void) | null = null;
  const deliver = (msg: object) => setTimeout(() => { if (listen) listen({ data: JSON.stringify(msg) }); }, 0);
  gl.send = deliver;
  gl.q = 0; gl.waiting = 0; gl.granted = 0; gl.closed = 0;
  gl.back = () => { gl.q += 1; gl.waiting = gl.q; gl.granted = 0; deliver({ t: 'back', q: gl.q }); return gl.q; };
  gl.timeOut = () => { gl.waiting = 0; gl.granted = 0; };
  gl.release = (answer: object) => { const h = gl.held; gl.held = []; h.forEach((id) => deliver(Object.assign({ t: 'reply', id }, answer))); };
  (window as unknown as { GLBridge: unknown }).GLBridge = {
    postMessage(text: string) {
      const m: Posted = JSON.parse(text);
      m.length = text.length;
      gl.posted.push(m);
      if (m.t === 'close' || m.t === 'stay' || m.t === 'ask') {
        const current = m.id === gl.waiting;
        if (current) gl.waiting = 0;
        if (m.t === 'ask' && current) { gl.granted = m.id!; deliver({ t: 'ask-ok', q: m.id }); }
        if (m.t === 'close' && (current || m.id === gl.granted)) gl.closed = m.id!;
        return;
      }
      const mode = gl.mode[m.t] || 'ok';
      if (m.t === 'save' && mode === 'hold') { gl.held.push(m.id!); return; }
      const reply: { t: string; id?: number; ok: boolean; cancelled?: boolean; busy?: boolean } = { t: 'reply', id: m.id, ok: mode === 'ok' };
      if (mode === 'cancel') reply.cancelled = true;
      if (mode === 'busy') reply.busy = true;
      deliver(reply);
    },
    addEventListener(type: string, fn: (ev: { data: string }) => void) { if (type === 'message') listen = fn; },
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const href = this.getAttribute('href') || '';
    if (href.startsWith('mailto:')) { gl.mailto.push(href); return undefined; }
    return click.call(this);
  };
}
/** A message the page posted, as the stand-in recorded it (with its length in characters). */
interface Posted { t: string; id?: number; text?: string; name?: string; mime?: string; data?: string; kind?: string; length: number; [k: string]: unknown }
/** The stand-in's state, on window.__gl (installBridgeStub). */
interface Gl {
  posted: Posted[];
  mode: Record<string, string>;
  held: number[];
  mailto: string[];
  q: number; waiting: number; granted: number; closed: number;
  send: (msg: object) => unknown;
  back: () => number;
  timeOut: () => void;
  release: (answer: object) => void;
}
declare global {
  interface Window {
    __gl: Gl;
    /** The texts a status line showed, in order (recorded by a check). */
    __lines: string[];
  }
}

// A message's data field as text: the bytes the app would write, decoded as UTF-8.
const decode = (m: { data?: string }): string => new TextDecoder().decode(Uint8Array.from(atob(m.data!), (c) => c.charCodeAt(0)));
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const browser = await launchChromium({ chromium: CHROMIUM, out: OUT, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--lang=en-GB'] });
const pages: Page[] = [];
const open = async (mode = 'app', opts: PageOptions = {}) => {
  const init = mode === 'app' ? inPage(installBridgeStub) : null;
  const p = await openPage(browser, `${ORIGIN}/${mode === 'web' ? 'web' : 'app'}/index.html`, { width: 412, height: 915, init, downloads: join(OUT, 'downloads'), ...opts });
  pages.push(p);
  return Object.assign(p, {
    posted: () => p.run(() => window.__gl.posted.map((m) => Object.assign({}, m, { data: m.data ? m.data.length : undefined }))),
    count: () => p.run(() => window.__gl.posted.length),
    since: (n: number) => p.run((from: number) => window.__gl.posted.slice(from), n),
    text: (id: string) => p.run((el: string) => document.getElementById(el)!.textContent, id),
    value: (id: string) => p.run((el: string) => (document.getElementById(el) as HTMLInputElement).value, id),
  });
};
type AppPage = Awaited<ReturnType<typeof open>>;
/** Whether the element is on screen: present, not hidden, inside nothing hidden, with a box. Runs in the page. */
const visible = (sel: string): boolean => { const el = document.querySelector<HTMLElement>(sel); return !!el && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0; };
const A = { company: 'Eksempel Handel AS', companyEmail: 'personvern@eksempel-handel.example', name: 'Kari Nordmann', email: 'kari.nordmann@example.no', address: 'Storgata 1\n5300 Kleppestø' };
async function fill(p: Page, a = A): Promise<void> {
  await p.type('#company', a.company);
  await p.type('#company-email', a.companyEmail);
  await p.type('#name', a.name);
  await p.type('#email', a.email);
  await p.type('#address', a.address);
}

/** One press on an output button: the messages it posted, and the status line once settled. */
async function press(p: AppPage, sel: string, statusId: string | null, settle = 250) {
  const n = await p.count();
  await p.click(sel);
  await sleep(settle);
  return { sent: await p.since(n), status: statusId ? await p.text(statusId) : null, announcer: await p.text('announcer') };
}

try {
  // ---- The letter page in the app: hello, the website-only parts, the calendar buttons
  {
    const p = await open('app');
    const first = (await p.posted())[0];
    check('the bridge says hello first, so the app can reach the page', first && first.t === 'hello' && first.id === 1, first);
    check('the website-only Android section is hidden in the app', !(await p.run(visible, '#android-app')));
    await p.run(() => { document.getElementById('android-app')!.hidden = false; document.getElementById('android-app')!.removeAttribute('hidden'); });
    await sleep(50);
    await p.run(() => { const d = document.createElement('div'); d.id = 'late-web-only'; d.setAttribute('data-web-only', ''); d.textContent = 'x'; document.querySelector('main')!.append(d); });
    await sleep(50);
    check('a website-only part stays hidden when its attribute is taken off, and one added later is hidden', (await p.run(() => document.getElementById('android-app')!.hidden && document.getElementById('late-web-only')!.hidden)));
    const cal = await p.run(() => ['save-ics-calendar', 'save-ics-ext-calendar'].map((id) => { const b = document.getElementById(id); return b && { text: b.textContent, after: b.previousElementSibling && b.previousElementSibling.id, cls: b.className }; }));
    check('Add to calendar app sits beside both Save a reminder buttons', cal[0] && cal[0].text === CAL.label && cal[0].after === 'save-ics' && cal[1] && cal[1].after === 'save-ics-ext' && /btn-secondary/.test(cal[0].cls), cal);
    check('Share shows in the app (navigator.share is the bridge\'s)', (await p.run(visible, '#share')) && (await p.run(() => typeof navigator.share === 'function')));
    check('one live region: the status lines and the deadline are plain text', (await p.run(() => [...document.querySelectorAll('[aria-live], [role=status]')].map((e) => e.id).join(','))) === 'announcer');
    await p.viewShot(join(SHOTS, 'app-start.png'));
  }

  // ---- Step 6: Copy, Share, Save, Print, Open email app
  {
    const p = await open('app');
    await fill(p);
    const letter = await p.value('letter');
    const loaded = p.log.requests.length;
    let r = await press(p, '#copy-letter', 'out-status');
    check('Copy: the letter goes to the app as copy, exactly', r.sent.length === 1 && r.sent[0]!.t === 'copy' && r.sent[0]!.text === letter, r.sent.map((m) => m.t));
    check('Copy: the line says "Copied." and the announcer says it', r.status === 'Copied.' && (await p.until(1000, () => document.getElementById('announcer')!.textContent === 'Copied.')), r);
    check('the announcer is emptied a few seconds later; the line stays', (await p.until(6000, () => document.getElementById('announcer')!.textContent === '')) && (await p.text('out-status')) === 'Copied.');
    await p.run(() => window.__gl.mode.copy = 'fail');
    r = await press(p, '#copy-letter', 'out-status');
    check('Copy refused by the app: the page\'s own fallback (the letter selected, its message)', /did not allow copying/.test(r.status!) && (await p.run(() => document.activeElement!.id === 'letter')), r.status);
    await p.run(() => window.__gl.mode.copy = 'ok');

    r = await press(p, '#share', 'out-status');
    check('Share: the letter goes to the app as share', r.sent.length === 1 && r.sent[0]!.t === 'share' && r.sent[0]!.text === letter, r.sent.map((m) => m.t));

    r = await press(p, '#save-txt', 'out-status');
    const name = `access-request-${TODAY}.txt`;
    const saved = r.sent[0] && (await p.run(decode, r.sent[0]));
    check('Save as text file: the app gets save with the page\'s name, type and the letter\'s exact bytes', r.sent.length === 1 && r.sent[0]!.t === 'save' && r.sent[0]!.name === name && r.sent[0]!.mime === 'text/plain;charset=utf-8' && saved === letter, { sent: r.sent.map((m) => [m.t, m.name, m.mime]), same: saved === letter });
    check('Save, written: the line keeps "Saved as ..."', r.status === `Saved as ${name}.`, r.status);
    for (const [mode, want, label] of [['cancel', '', 'cancelled on the save screen: the "Saved as" line is cleared'], ['fail', SAVE_FAILED, 'not written: the line says so'], ['busy', `Saved as ${name}.`, 'another save still waiting: the line is left alone']] as Array<[string, string, string]>) {
      await p.run((mode) => window.__gl.mode.save = mode, mode);
      r = await press(p, '#save-txt', 'out-status');
      check(`Save ${label} (E3-4)`, r.sent.length === 1 && r.sent[0]!.t === 'save' && r.status === want, r.status);
    }
    await p.run(() => window.__gl.mode.save = 'hold');
    r = await press(p, '#save-txt', 'out-status', 9000);
    check('Save waits for the save screen as long as it is open: no answer after 9 seconds is no failure', r.status === `Saved as ${name}.`, r.status);
    await p.run(() => window.__gl.release({ ok: false, cancelled: true }));
    check('and the late answer still reaches the line', await p.until(1000, () => document.getElementById('out-status')!.textContent === ''));
    await p.run(() => window.__gl.mode.save = 'ok');

    r = await press(p, '#print', 'out-status');
    check('Print: the first letter goes to the app as print, kind letter', r.sent.length === 1 && r.sent[0]!.t === 'print' && r.sent[0]!.kind === 'letter' && r.sent[0]!.text === letter, r.sent.map((m) => [m.t, m.kind]));

    // Open email app: the letter is longer than a mailto: link may carry, so it is copied first.
    check('the letter is long enough for the copy-first email button', (await p.text('open-email')) === 'Copy letter and open email app');
    r = await press(p, '#open-email', 'out-status');
    check('Open email app: the letter is copied through the app, and the mailto: link opened', r.sent.length === 1 && r.sent[0]!.t === 'copy' && r.sent[0]!.text === letter && (await p.run(() => window.__gl.mailto.length)) === 1 && r.status === 'Copied. Paste the letter into the message.', r);
    await p.run(() => window.__gl.send({ t: 'no-email-app' }));
    check('no email app: the line says only "Copied." (E3-7)', await p.until(1000, () => document.getElementById('out-status')!.textContent === 'Copied.'), await p.text('out-status'));

    check('step 6 outputs: no request after load, none elsewhere, no download, no policy refusal, no error',
      p.log.requests.length === loaded && p.log.offsite.length === 0 && p.log.downloads.length === 0 && p.log.csp.length === 0 && (await p.run(() => window.__csp.length)) === 0 && p.log.errors.length === 0,
      { after: p.log.requests.slice(loaded).map((x) => x.url), offsite: p.log.offsite, downloads: p.log.downloads, csp: p.log.csp, errors: p.log.errors });
  }

  // ---- Step 7 and step 8: Save a reminder and Add to calendar app
  {
    const p = await open('app');
    await p.type('#company', A.company);
    await p.setDate('#received', '2026-03-05');
    const loaded = p.log.requests.length;
    let r = await press(p, '#save-ics', 'ics-status');
    const ics = r.sent[0] && (await p.run(decode, r.sent[0]));
    check('Save a reminder: save with the page\'s .ics name and type, and the reminder itself', r.sent.length === 1 && r.sent[0]!.t === 'save' && r.sent[0]!.name === 'gdpr-deadline-2026-04-07.ics' && r.sent[0]!.mime === 'text/calendar;charset=utf-8' && /^BEGIN:VCALENDAR\r\n/.test(ics!) && ics!.includes('Eksempel Handel AS'), r.sent.map((m) => [m.t, m.name]));
    check('Save a reminder: the page\'s line', r.status === 'Saved as gdpr-deadline-2026-04-07.ics. Open it to add the reminder to your calendar.', r.status);
    await p.run(() => window.__gl.mode.save = 'cancel');
    r = await press(p, '#save-ics', 'ics-status');
    check('Save a reminder cancelled: the line is cleared (E3-4)', r.status === '', r.status);
    await p.run(() => window.__gl.mode.save = 'ok');

    const n = await p.count();
    // Every text the line shows, in order (each write replaces the line's text node).
    await p.run(() => { window.__lines = []; new MutationObserver((rs) => rs.forEach((r) => r.addedNodes.forEach((a) => window.__lines.push((a as Text).data)))).observe(document.getElementById('ics-status')!, { childList: true }); });
    await p.click('#save-ics-calendar');
    await sleep(300);
    const lines = await p.run(() => window.__lines);
    const sent = await p.since(n);
    const calIcs = sent[0] && sent[0].t === 'calendar' && (await p.run(decode, sent[0]));
    check('Add to calendar app: calendar with the page\'s reminder, never save', sent.length === 1 && sent[0]!.t === 'calendar' && /^BEGIN:VCALENDAR\r\n/.test(calIcs || '') && (calIcs as string).includes('\r\nDTSTART:20260408T120000\r\nDTEND:20260408T123000\r\n'), sent.map((m) => m.t));
    // The page writes its "Saved as" line first, in the same press; the bridge replaces it at once.
    check('Add to calendar app: the line says it is opening, then what the app did', J(lines.slice(-2)) === J([CAL.opening, CAL.opened]) && (await p.text('ics-status')) === CAL.opened, lines);
    check('and the announcer says it', (await p.text('announcer')) === CAL.opened, await p.text('announcer'));
    await p.run(() => window.__gl.mode.calendar = 'fail');
    r = await press(p, '#save-ics-calendar', 'ics-status');
    check('no calendar app: calendar sent, and the line says to save the reminder instead', r.sent.length === 1 && r.sent[0]!.t === 'calendar' && r.status === CAL.failed, r.status);
    await p.run(() => window.__gl.mode.calendar = 'ok');

    // The extended deadline, inside step 8's "They extended the deadline" card.
    await p.run(() => document.getElementById('save-ics-ext')!.closest('details')!.open = true);
    r = await press(p, '#save-ics-ext-calendar', 'ext-status');
    const extIcs = r.sent[0] && r.sent[0].t === 'calendar' && (await p.run(decode, r.sent[0]));
    check('Add to calendar app for the extended deadline: calendar with that reminder, its own line', r.sent.length === 1 && r.sent[0]!.t === 'calendar' && /\r\nDTSTART:202606\d\dT120000\r\nDTEND:202606\d\dT123000\r\n/.test(extIcs || '') && r.status === CAL.opened, { sent: r.sent.map((m) => m.t), status: r.status });
    r = await press(p, '#save-ics-ext', 'ext-status');
    check('Save a reminder for the extended deadline: save with its own name', r.sent.length === 1 && r.sent[0]!.t === 'save' && /^gdpr-deadline-2026-06-\d\d\.ics$/.test(r.sent[0]!.name!), r.sent.map((m) => [m.t, m.name]));

    // No receipt date: no deadline, so neither button can do anything.
    await p.setDate('#received', '');
    await sleep(100);
    const off = await p.run(() => ['save-ics', 'save-ics-calendar', 'save-ics-ext', 'save-ics-ext-calendar'].map((id) => (document.getElementById(id) as HTMLInputElement).disabled));
    const before = await p.count();
    await p.run(() => document.getElementById('save-ics-calendar')!.click());
    await sleep(200);
    check('no receipt date: Save a reminder and Add to calendar app are both disabled, and a press sends nothing', off.every(Boolean) && (await p.count()) === before, off);
    check('reminders: no request after load, no download, no policy refusal, no error',
      p.log.requests.length === loaded && p.log.offsite.length === 0 && p.log.downloads.length === 0 && p.log.csp.length === 0 && p.log.errors.length === 0,
      { after: p.log.requests.slice(loaded).map((x) => x.url), errors: p.log.errors });
  }

  // ---- Step 9 (follow-up) and step 10 (cover note)
  {
    const p = await open('app');
    await fill(p);
    await p.click('#fu-partial');
    await p.setDate('#fu-request-date', '2026-09-01');
    await p.setDate('#fu-answer-date', '2026-10-01');
    await p.click('#fu-item-copy');
    await p.click('#fu-item-purposes');
    const fu = await p.value('fu-letter');
    check('the follow-up letter is written', fu.length > 200, fu.length);
    let r = await press(p, '#fu-copy', 'fu-status');
    check('follow-up Copy: copy with the follow-up, "Copied."', r.sent.length === 1 && r.sent[0]!.t === 'copy' && r.sent[0]!.text === fu && r.status === 'Copied.', r.status);
    r = await press(p, '#fu-share', 'fu-status');
    check('follow-up Share: share with the follow-up', r.sent.length === 1 && r.sent[0]!.t === 'share' && r.sent[0]!.text === fu);
    r = await press(p, '#fu-save', 'fu-status');
    const fuBytes = r.sent[0] && (await p.run(decode, r.sent[0]));
    check('follow-up Save: save as follow-up-<date>.txt with its exact bytes', r.sent.length === 1 && r.sent[0]!.name === `follow-up-${TODAY}.txt` && fuBytes === fu && r.status === `Saved as follow-up-${TODAY}.txt.`, r.sent.map((m) => m.name));
    await p.run(() => window.__gl.mode.save = 'fail');
    r = await press(p, '#fu-save', 'fu-status');
    check('follow-up Save not written: its own line says so', r.status === SAVE_FAILED && (await p.text('out-status')) === '', r.status);
    await p.run(() => window.__gl.mode.save = 'ok');
    r = await press(p, '#fu-print', 'fu-status');
    check('follow-up Print: print, kind follow-up, the follow-up\'s text', r.sent.length === 1 && r.sent[0]!.t === 'print' && r.sent[0]!.kind === 'follow-up' && r.sent[0]!.text === fu, r.sent.map((m) => m.kind));
    r = await press(p, '#print', 'out-status');
    check('then step 6\'s Print prints the first letter again', r.sent.length === 1 && r.sent[0]!.kind === 'letter' && r.sent[0]!.text === (await p.value('letter')));
    check('the follow-up\'s email button is the copy-first one for this long letter', (await p.text('fu-email')) === 'Copy letter and open email app');
    r = await press(p, '#fu-email', 'fu-status');
    await p.run(() => window.__gl.send({ t: 'no-email-app' }));
    check('follow-up, no email app: its line says only "Copied." (E3-7)', r.sent[0] && r.sent[0].t === 'copy' && (await p.until(1000, () => document.getElementById('fu-status')!.textContent === 'Copied.')), await p.text('fu-status'));

    await p.click('#tl-add');
    await p.setDate('#tl-date-1', '2026-09-01');
    await p.type('#tl-note-1', 'Sent by email');
    const tl = await p.value('tl-text');
    check('the cover note is written', tl.includes('Sent by email'), tl.slice(0, 200));
    r = await press(p, '#tl-copy', 'tl-status');
    check('cover note Copy: copy with the note, "Copied."', r.sent.length === 1 && r.sent[0]!.t === 'copy' && r.sent[0]!.text === tl && r.status === 'Copied.');
    r = await press(p, '#tl-share', 'tl-status');
    check('cover note Share: share with the note', r.sent.length === 1 && r.sent[0]!.t === 'share' && r.sent[0]!.text === tl);
    r = await press(p, '#tl-save', 'tl-status');
    const tlBytes = r.sent[0] && (await p.run(decode, r.sent[0]));
    check('cover note Save: save as timeline-<date>.txt with its exact bytes', r.sent.length === 1 && r.sent[0]!.name === `timeline-${TODAY}.txt` && tlBytes === tl && r.status === `Saved as timeline-${TODAY}.txt.`);
    r = await press(p, '#tl-print', 'tl-status');
    check('cover note Print: print, kind timeline, the note\'s text', r.sent.length === 1 && r.sent[0]!.t === 'print' && r.sent[0]!.kind === 'timeline' && r.sent[0]!.text === tl, r.sent.map((m) => m.kind));
    check('steps 9 and 10: no request to another site, no download, no policy refusal, no error', p.log.offsite.length === 0 && p.log.downloads.length === 0 && p.log.csp.length === 0 && p.log.errors.length === 0, p.log.errors);
    await p.shot(join(SHOTS, 'app-steps-9-10.png'));
  }

  // ---- Too long to hand over (A3-5, E3-6, A3-6)
  {
    const p = await open('app');
    await fill(p);
    await p.run(() => { const t = document.getElementById('letter'); t!.focus(); (t as HTMLInputElement).value = 'x'.repeat(100001); t!.dispatchEvent(new Event('input', { bubbles: true })); });
    for (const sel of ['#copy-letter', '#share', '#save-txt', '#print', '#open-email']) {
      await p.run(() => document.getElementById('out-status')!.textContent = '');
      const r = await press(p, sel, 'out-status');
      check(`a letter of 100,001 characters: ${sel} sends nothing and says it is too long`, r.sent.length === 0 && r.status === TOO_LONG && r.announcer === TOO_LONG && (await p.run(() => window.__gl.mailto.length)) === 0, r);
    }
    // 100,000 characters pass the length check, but these escape to 600,000 characters of JSON.
    await p.run(() => { const t = document.getElementById('letter'); (t as HTMLInputElement).value = '\u0001'.repeat(100000); t!.dispatchEvent(new Event('input', { bubbles: true })); });
    const r = await press(p, '#copy-letter', 'out-status');
    check('a message over 450,000 characters is never posted, and the line says it is too long', r.sent.length === 0 && r.status === TOO_LONG, r);
    const longest = await p.run(() => Math.max(...window.__gl.posted.map((m) => m.length)));
    check('no message the page posted is longer than 450,000 characters', longest <= 450000, longest);
  }

  // ---- Back (E3-1)
  {
    let p = await open('app');
    let n = await p.count();
    await p.run(() => window.__gl.back());
    await sleep(200);
    let sent = await p.since(n);
    check('Back with nothing typed: the app is told to close at once, with the Back query\'s number', sent.length === 1 && sent[0]!.t === 'close' && sent[0]!.id === 1, sent);

    p = await open('app');
    await p.type('#company', 'Eksempel Handel AS');
    await p.run(() => document.getElementById('company')!.blur());
    n = await p.count();
    await p.run(() => window.__gl.back());
    await sleep(200);
    let d: { open: boolean; text: string | null; ok: string | null; cancel?: string | null; focus?: string } = await p.run(() => { const g = document.getElementById('confirm-dialog'); return { open: (g as HTMLDialogElement).open, text: document.getElementById('confirm-text')!.textContent, ok: document.getElementById('confirm-ok')!.textContent, cancel: document.getElementById('confirm-cancel')!.textContent, focus: document.activeElement!.id }; });
    sent = await p.since(n);
    check('Back with something typed: the page asks the app first, and once it agrees its own dialog asks, Cancel focused',
      d.open && d.text === CLOSE_QUESTION && d.ok === 'Close' && d.cancel === 'Cancel' && d.focus === 'confirm-cancel' && sent.length === 1 && sent[0]!.t === 'ask' && sent[0]!.id === (await p.run(() => window.__gl.q)), { d, sent });
    await p.viewShot(join(SHOTS, 'app-back-dialog.png'));
    await p.click('#confirm-cancel');
    await sleep(150);
    sent = await p.since(n);
    check('Cancel: the dialog closes, the app stays, the company is still there', !(await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && sent.length === 1 && (await p.value('company')) === 'Eksempel Handel AS');
    n = await p.count();
    await p.run(() => window.__gl.back());
    await sleep(200);
    await p.run(() => window.__gl.back());
    await sleep(200);
    sent = await p.since(n);
    check('Back on the open dialog closes it, as Cancel does, and the app stays', !(await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && sent.map((m) => m.t).join() === 'ask,stay', sent.map((m) => m.t));
    n = await p.count();
    await p.run(() => window.__gl.back());
    await sleep(200);
    await p.click('#confirm-ok');
    await sleep(150);
    sent = await p.since(n);
    check('Close: the app is told to close, for the Back it agreed to', sent.map((m) => m.t).join() === 'ask,close' && sent[1]!.id === sent[0]!.id && (await p.run(() => window.__gl.closed)) === sent[0]!.id, sent);

    // The page's own Clear dialog keeps its own words afterwards, and Back closes it as Cancel.
    await p.click('#clear');
    await sleep(150);
    d = await p.run(() => ({ open: (document.getElementById('confirm-dialog') as HTMLDialogElement).open, text: document.getElementById('confirm-text')!.textContent, ok: document.getElementById('confirm-ok')!.textContent }));
    check('the page\'s own Clear dialog still says its own words', d.open && d.text === 'Clear everything you have typed, and the letter?' && d.ok === 'Clear', d);
    n = await p.count();
    await p.run(() => window.__gl.back());
    await sleep(250);
    sent = await p.since(n);
    check('Back on the Clear dialog: closed as Cancel, nothing cleared, the app stays', !(await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && (await p.value('company')) === 'Eksempel Handel AS' && sent.map((m) => m.t).join() === 'stay', sent.map((m) => m.t));

    // Only the letter edited: that is typed too.
    p = await open('app');
    await p.type('#letter', 'My own letter', { replace: false });
    n = await p.count();
    await p.run(() => window.__gl.back());
    await sleep(200);
    sent = await p.since(n);
    check('Back with only the letter edited: the page asks first', (await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && sent.map((m) => m.t).join() === 'ask', sent.map((m) => m.t));

    // The Back timing race (stage 3 verification): the page answers after the app's 1.5 s, when
    // the app has already shown its own dialog. Its late ask is dropped, so its dialog never opens.
    p = await open('app');
    await p.type('#company', 'Eksempel Handel AS');
    await p.run(() => document.getElementById('company')!.blur());
    n = await p.count();
    // The page is still busy as Back arrives; the app times out before the page reads the message.
    await p.run(() => { window.__gl.back(); window.__gl.timeOut(); });
    await sleep(400);
    sent = await p.since(n);
    check('a late answer to Back: the page only asks, the app does not agree, and the page\'s dialog never opens (one dialog, the app\'s)',
      sent.map((m) => m.t).join() === 'ask' && !(await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && (await p.run(() => window.__gl.closed)) === 0, sent);
    // A reply from the app for another Back (an older, stale one) cannot open it either.
    await p.run(() => window.__gl.send({ t: 'ask-ok', q: window.__gl.q + 5 }));
    await p.run(() => window.__gl.send({ t: 'ask-ok', q: window.__gl.q - 1 }));
    await p.run(() => window.__gl.send({ t: 'ask-ok' }));
    await sleep(300);
    check('an ask-ok for any other Back, or with no number, opens nothing', !(await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && (await p.since(n)).length === 1);
    // A truly blocked page: Back arrives while a 2 s script runs, and the app's 1.5 s pass (its
    // watchdog runs outside the page, so here it is marked at the end of the block).
    n = await p.count();
    await p.run(() => { setTimeout(() => { const until = Date.now() + 2000; while (Date.now() < until) {} window.__gl.timeOut(); }, 0); window.__gl.back(); });
    await sleep(2600);
    sent = await p.since(n);
    check('a page blocked for 2 s as Back arrives: still no second dialog', !(await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && sent.every((m) => m.t === 'ask'), sent.map((m) => m.t));
    // And the next Back, answered in time, is the page's own dialog as usual.
    n = await p.count();
    await p.run(() => window.__gl.back());
    await sleep(300);
    sent = await p.since(n);
    check('the next Back, answered in time, asks in the page\'s dialog once', (await p.run(() => (document.getElementById('confirm-dialog') as HTMLDialogElement).open)) && sent.map((m) => m.t).join() === 'ask', sent.map((m) => m.t));
  }

  // ---- Large text, enlarged the app's way (17 October 2026)
  // The app enlarges text with WebView textZoom (MainActivity.applyTextZoom): every font size
  // times Android's font scale, while lengths in rem keep the 16 px default. Chromium has no text
  // zoom of its own, so textZoom sets each element's own font size to its computed size times the
  // scale, leaving html alone so that rem stays 16 px. On the emulator (sb-phone, WebView 133)
  // this matched textZoom within 2 px on every measure taken (body and title sizes, the notice,
  // the select and date widths, the check boxes) at 1.3, 1.5 and 2.0 at 320 and 393 dp. One
  // difference: a length in em on something other than a font grows here and not under textZoom.
  // It is applied again after rows are added. Known and left to the shared generators (not this
  // repository's files): the notice's title, the one word "GDPRLetterBuilder", is wider than the
  // notice on a 320 px screen from 1.5 and on a 412 px screen at 2.0 (build-gates.py); and at 2.0
  // the disclaimer's "(personopplysningsloven)." is wider than the screen (build-disclaimers.py).
  // The chosen option in a full-width select is cut from 1.3 (the list itself shows it whole), on
  // the website at the same text size too.
  {
    const textZoom = (f: number): number => { const els = ([...document.querySelectorAll('body, body *')] as HTMLElement[]).filter((e) => !(e instanceof SVGElement));
      for (const e of els) e.style.removeProperty('font-size');
      const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
      els.forEach((e, i) => e.style.setProperty('font-size', (sizes[i]! * f) + 'px', 'important'));
      return els.length; };
    // What reaches past the screen, ignoring what is hidden and the footer's app carousel (it
    // scrolls sideways by design, and the app hides it anyway).
    const past = (scope: string, knownRe = '(?!)') => { const KNOWN = new RegExp(knownRe, 'i'); const vw = document.documentElement.clientWidth; const out: string[] = [];
      for (const n of document.querySelectorAll(scope)) {
        if (n.closest('.app-switcher-track, .app-switcher-marquee, .visually-hidden, template, [hidden]') || !n.getClientRects().length) continue;
        const r = n.getBoundingClientRect(); if (!r.width) continue;
        if (r.right > vw + 0.5 || r.left < -0.5) out.push(n.tagName + (n.id ? '#' + n.id : '') + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      }
      // Text runs too, word by word, so that a single word too long for its line is named.
      const known: string[] = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let t: Node | null;
      while ((t = w.nextNode())) {
        if (!t.textContent!.trim() || t.parentElement!.closest('.app-switcher-track, .app-switcher-marquee, .visually-hidden, [hidden]')) continue;
        for (const m of t.textContent!.matchAll(/\S+/g)) {
          const rg = document.createRange(); rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length);
          for (const b of rg.getClientRects()) if (b.width && (b.right > vw + 0.5 || b.left < -0.5)) (KNOWN.test(m[0]) ? known : out).push('word ' + JSON.stringify(m[0]));
        }
      }
      return { vw, sw: document.documentElement.scrollWidth, out: [...new Set(out)].slice(0, 8), known: [...new Set(known)] }; };
    for (const width of [320, 412]) {
      for (const scale of [1.3, 1.5, 2]) {
        const tag = `${width} px, the app's text at ${scale}`;
        const p = await open('app', { width, height: 800, gate: 'keep' });
        // The sizes before the zoom, to compare with.
        const base = await p.run(() => ({ p: parseFloat(getComputedStyle(document.querySelector('.sb-gate-body p')!).fontSize), lede: parseFloat(getComputedStyle(document.querySelector('.hero-lede')!).fontSize) }));
        await p.run(textZoom, scale);
        await sleep(200);
        const g = await p.run(() => { const t = document.querySelector('.sb-gate-title'); const b = document.querySelector('.sb-gate-btn');
          b!.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = b!.getBoundingClientRect();
          return { body: parseFloat(getComputedStyle(document.body).fontSize), p: parseFloat(getComputedStyle(document.querySelector('.sb-gate-body p')!).fontSize), titleWhole: t!.scrollWidth <= t!.clientWidth + 1, titleText: t!.textContent,
            btnTop: r.top, btnBottom: r.bottom, btnWidth: r.width, vh: innerHeight, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }; });
        const titleKnown = /GDPRLetterBuilder/.test(g.titleText) && ((width === 320 && scale >= 1.5) || scale >= 2);
        check(`notice ${tag}: its text grows, Got it can be reached inside it, no sideways scroll; the title whole${titleKnown ? ' (or, as noted, only GDPRLetterBuilder too long)' : ''}`,
          Math.abs(g.body - 16 * scale) < 0.1 && Math.abs(g.p - base.p * scale) < 0.1 && g.btnTop >= 0 && g.btnBottom <= g.vh && g.btnWidth > 40 && g.sw <= g.vw + 1 && (g.titleWhole || titleKnown), g);
        if (width === 320 && scale === 2) await p.viewShot(join(SHOTS, 'large-text-notice-320-2.0.png'));
        await p.click('.sb-gate-btn');
        await p.until(3000, () => !document.querySelector('.sb-gate-overlay'));

        // A detail row and a timeline row, each with its longest option and a date.
        await p.run(() => { document.getElementById('id-add')!.click(); document.getElementById('tl-add')!.click();
          for (const s of document.querySelectorAll<HTMLSelectElement>('.id-row select, .tl-row select')) { let best = 0; [...s.options].forEach((o, i) => { if (o.text.length > s.options[best]!.text.length) best = i; }); s.selectedIndex = best; s.dispatchEvent(new Event('change', { bubbles: true })); }
          for (const d of document.querySelectorAll('input[type=date]')) { (d as HTMLInputElement).value = '2026-10-17'; d.dispatchEvent(new Event('input', { bubbles: true })); }
          return 1; });
        await sleep(150);
        await p.run(textZoom, scale);
        await sleep(200);
        const st = await p.run(() => { const h = document.querySelector('h1'); const hr = h!.getBoundingClientRect();
          // A date field shows its date whole when the date's text and the arrow fit inside its
          // padding. The WebView draws a date field as a plain box with a small arrow and keeps
          // about 1em for it (measured from the emulator's shots, where a date at 1.5 cut in a
          // box 1em too narrow); desktop Chromium's own date field is wider, so it is not used.
          const c = document.createElement('canvas').getContext('2d');
          const dates = [...document.querySelectorAll('input[type=date]')].filter((d) => d.getClientRects().length).map((d) => { const s = getComputedStyle(d); c!.font = s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
            const need = c!.measureText(new Date(2026, 9, 17).toLocaleDateString('en-US')).width + parseFloat(s.fontSize);
            return { id: d.id || d.className, need: Math.round(need), room: Math.round(d.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)) }; });
          const rows = [...document.querySelectorAll('.id-row, .tl-row')].filter((r) => r.getClientRects().length);
          const outside: string[] = []; for (const row of rows) { const rr = row.getBoundingClientRect(); for (const n of row.querySelectorAll<HTMLInputElement>('input, select, button, label')) { if (!n.getClientRects().length || n.type === 'checkbox') continue; const r = n.getBoundingClientRect(); if (r.left < rr.left - 0.5 || r.right > rr.right + 0.5) outside.push((n.id || n.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' in ' + Math.round(rr.left) + '..' + Math.round(rr.right)); } }
          return { body: parseFloat(getComputedStyle(document.body).fontSize), lede: parseFloat(getComputedStyle(document.querySelector('.hero-lede')!).fontSize), titleWhole: h!.scrollWidth <= h!.clientWidth + 0.5 && hr.left >= -0.5 && hr.right <= document.documentElement.clientWidth + 0.5,
            rem: parseFloat(getComputedStyle(document.documentElement).fontSize), rows: rows.length, dates, datesCut: dates.filter((d) => d.need > d.room), outside }; });
        const pastNow = await p.run(past, 'main *, header *, footer *');
        check(`letter page ${tag}: the text grows (rem stays 16 px), the title whole, no sideways scroll, nothing past the screen`,
          Math.abs(st.body - 16 * scale) < 0.1 && Math.abs(st.lede - base.lede * scale) < 0.1 && st.rem === 16 && st.titleWhole && pastNow.sw <= pastNow.vw && pastNow.out.length === 0, { ...st, past: pastNow });
        check(`letter page ${tag}: every date shows whole, and every field and button of the rows stays inside its row (${st.rows} rows, ${st.dates.length} dates)`,
          st.rows === 2 && st.dates.length >= 3 && st.datesCut.length === 0 && st.outside.length === 0, { datesCut: st.datesCut, outside: st.outside });
        check(`letter page ${tag}: no error, nothing refused`, p.log.errors.length === 0 && p.log.csp.length === 0, { errors: p.log.errors, csp: p.log.csp });
        if (width === 320 && scale === 2) {
          await p.run(() => { const r = document.querySelector('#tl-rows .tl-row')!.getBoundingClientRect(); scrollTo({ top: scrollY + r.top - 8, behavior: 'instant' }); return 1; });
          await sleep(200);
          await p.viewShot(join(SHOTS, 'large-text-timeline-320-2.0.png'));
        }
        await p.close();

        // The privacy page and the disclaimer, as the app's second WebView shows them (no script,
        // the app's headers), with the same text zoom.
        for (const side of ['privacy', 'disclaimer']) {
          const s = await openPage(browser, `${ORIGIN}/app/${side}.html`, { width, height: 800 });
          pages.push(s);
          const sBase = await s.run(() => parseFloat(getComputedStyle(document.querySelector('main p')!).fontSize));
          await s.run(textZoom, scale);
          await sleep(200);
          const sp = await s.run(() => { const h = document.querySelector('h1'); const hr = h!.getBoundingClientRect(); const para = document.querySelector('main p');
            return { body: parseFloat(getComputedStyle(document.body).fontSize), para: parseFloat(getComputedStyle(para!).fontSize), titleWhole: h!.scrollWidth <= h!.clientWidth + 0.5 && hr.right <= document.documentElement.clientWidth + 0.5 }; });
          // Only the disclaimer at 2.0 may have a word wider than the screen, and only one of the
          // two long words noted above.
          const knownWords = side === 'disclaimer' && scale >= 2;
          const sPast = knownWords ? await s.run(past, 'body *', '^\\(?(personopplysningsloven|GDPRLetterBuilder)\\)?[.,]?$') : await s.run(past, 'body *');
          check(`${side} ${tag}: the text grows, the title whole, ${knownWords ? 'nothing past the screen but the long words noted' : 'no sideways scroll'}`,
            Math.abs(sp.body - 16 * scale) < 0.1 && Math.abs(sp.para - sBase * scale) < 0.1 && sp.titleWhole && sPast.out.length === 0 && (knownWords || sPast.sw <= sPast.vw), { ...sp, past: sPast });
          check(`${side} ${tag}: no error, nothing refused`, s.log.errors.filter((e) => !/status of 404/.test(e)).length === 0 && s.log.csp.length === 0, { errors: s.log.errors, csp: s.log.csp });
          if (width === 320 && scale === 2) await s.viewShot(join(SHOTS, `large-text-${side}-320-2.0.png`));
          await s.close();
        }
      }
    }
  }

  // ---- The same files without the bridge, and the website
  {
    const p = await open('nobridge');
    const st = await p.run(() => ({ cal: !!document.getElementById('save-ics-calendar'), web: document.getElementById('android-app')!.hidden, gl: typeof (window as unknown as { GLBridge?: unknown }).GLBridge, ready: document.documentElement.dataset.ready }));
    check('a WebView too old for the bridge: no calendar button, the website-only section hidden, the page works', !st.cal && st.web && st.gl === 'undefined' && st.ready === 'true', st);
    const w = await open('web');
    const ws = await w.run(() => ({ cal: !!document.getElementById('save-ics-calendar'), bridge: !!document.querySelector('script[src="android-bridge.js"]'), share: typeof navigator.share, shareShown: !document.getElementById('share')!.hidden }));
    check('the website: no bridge script, no calendar button, Share only where the browser has it', !ws.cal && !ws.bridge && ws.shareShown === (ws.share === 'function'), ws);
  }
} catch (err) {
  const e = err as { stack?: string } | null;
  check('the run finished', false, String(e && e.stack || err));
} finally {
  for (const p of pages) await p.close().catch(() => {});
  await browser.close();
  server.close();
}

console.log(`\n${passes} passed, ${failures} failed. Screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
