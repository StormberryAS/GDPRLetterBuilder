#!/usr/bin/env node
// GDPRLetterBuilder in headless LibreWolf (or Firefox), driven over WebDriver BiDi with Node's own
// WebSocket: no packages (spec section 13). LibreWolf keeps its default privacy settings
// (resistFingerprinting on); only HTTPS-Only mode is turned off for this local address, and saved
// files land in the run folder without a question.
//
//   node tests/librewolf-smoke.ts [--browser /usr/bin/librewolf] [--out DIR]
//
// It checks, under the site's headers (tests/serve.py):
//   * the first-run notice: shown on a first visit, word for word; Got it closes it and stores its
//     one flag;
//   * the letter builds from typed answers, and the Bokmål letter carries lang="nb";
//   * Save a reminder and Save as text file write the files (Gecko saves blob downloads as Chromium
//     does), and the reminder holds the company and the deadline and none of the person's details;
//   * Open email app hands over the mailto: link and Print the letter (both to recording
//     stand-ins, so nothing opens);
//   * no request after load, no policy violation;
//   * the session-restore question of spec PRIV-3: does the browser write what was typed into its
//     session-restore file (sessionstore-backups/recovery.jsonlz4), and does autocomplete="off" stop
//     it? Asked twice, with LibreWolf's own setting for browser.sessionstore.privacy_level and with
//     Firefox's default (0). Nothing typed may be in it (every field carries autocomplete="off"),
//     and the page itself must still empty every field on a reload;
//   * a crash and restart at Firefox's default level: the restored tab must come back with every
//     field empty and every choice at its default (code review of 12 October 2026).
// Exits 2 (skipped) when the browser is missing. Not run by `npm test`.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAG_VALUE, GATE, gateState } from './legal-pages.ts';
import { inPage } from './cdp.ts';
import type { FromBrowser } from './cdp.ts';
import { render } from '#src/letters.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const BROWSER = opt('--browser', process.env.LIBREWOLF || '/usr/bin/librewolf');
const OUT = resolve(opt('--out', join(tmpdir(), 'gdpr-librewolf')));
if (!existsSync(BROWSER)) {
  console.log(`skipped: ${BROWSER} not found`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
// The page-side glue of run() below: the expression that gives the JSON of what code evaluates to.
const jsonOf = (code: string): string => `JSON.stringify(${code})`;

let passes = 0;
let failures = 0;
const notes: string[] = [];
const check = (name: string, ok: unknown, detail?: unknown): void => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail !== undefined ? `\n     ${J(detail).slice(0, 1500)}` : ''}`);
};
const note = (t: string): void => { notes.push(t); console.log(`note ${t}`); };

// mozlz4: "mozLz40\0", the decompressed size (uint32, little-endian), then one LZ4 block.
function mozlz4(buf: Buffer): string {
  if (buf.subarray(0, 8).toString('latin1') !== 'mozLz40\0') throw new Error('not a mozlz4 file');
  const size = buf.readUInt32LE(8);
  const src = buf.subarray(12);
  const out = Buffer.alloc(size);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++]!;
    let lit = token >> 4;
    if (lit === 15) { let b: number; do { b = src[i++]!; lit += b; } while (b === 255); }
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const off = src[i]! | (src[i + 1]! << 8);
    i += 2;
    let ml = token & 15;
    if (ml === 15) { let b: number; do { b = src[i++]!; ml += b; } while (b === 255); }
    ml += 4;
    for (let k = 0; k < ml; k++) { out[o] = out[o - off]!; o++; }
  }
  return out.subarray(0, o).toString('utf8');
}

const server = spawn('python3', [join(ROOT, 'tests', 'serve.py'), '--quiet'], { stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise<string>((res, rej) => {
  const t = setTimeout(() => rej(new Error('serve.py did not start')), 20000);
  server.stdout.on('data', (d) => {
    const m = /READY (\S+)/.exec(String(d));
    if (m) { clearTimeout(t); res(m[1]!); }
  });
});

// The stand-ins, installed before the page's own scripts: mailto: links and Print are recorded.
function preload(): void {
  const rec: Recorded = { links: [], prints: 0 };
  Object.defineProperty(window, '__rec', { value: rec });
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const href = this.getAttribute('href') || '';
    if (href.startsWith('mailto:')) { rec.links.push(href); return undefined; }
    return click.call(this);
  };
  window.print = () => { rec.prints += 1; };
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI), true);
}
/** What preload() records, on window.__rec (LibreWolf's own: links and prints only). */
interface Recorded { links: string[]; prints: number }

// existing: a profile folder to start again on (the crash and restart case); startUrl: null starts
// with no page of its own, so that only what the browser restores opens.
async function session(label: string, extraPrefs: string[], { existing = null, startUrl = 'about:blank' }: { existing?: string | null; startUrl?: string | null } = {}) {
  const profile = existing || mkdtempSync(join(OUT, `profile-${label}-`));
  const downloads = mkdtempSync(join(OUT, `downloads-${label}-`));
  writeFileSync(join(profile, 'user.js'), [
    `user_pref("browser.download.dir", ${J(downloads)});`,
    'user_pref("browser.download.folderList", 2);',
    'user_pref("browser.download.useDownloadDir", true);',
    'user_pref("browser.download.always_ask_before_handling_new_types", false);',
    'user_pref("browser.download.start_downloads_in_tmp_dir", false);',
    'user_pref("browser.download.alwaysOpenPanel", false);',
    'user_pref("dom.security.https_only_mode", false);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("remote.active-protocols", 1);',
    // Session store writes every second here instead of every 15, so the test does not wait long.
    'user_pref("browser.sessionstore.interval", 1000);',
    ...extraPrefs,
  ].join('\n'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(BROWSER, ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${port}`, ...(startUrl ? [startUrl] : [])], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1' } });
  await new Promise<void>((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error(`the browser did not start: ${buf.slice(-400)}`)), 40000);
    const on = (d: Buffer): void => { buf += d; if (/WebDriver BiDi listening/.test(buf)) { clearTimeout(t); res(); } };
    proc.stderr.on('data', on);
    proc.stdout.on('data', on);
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map<number, { res: (v: FromBrowser) => void; rej: (e: Error) => void }>();
  const events: FromBrowser[] = [];
  ws.onmessage = (ev) => {
    const m: FromBrowser = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.type === 'error') p.rej(new Error(`${m.error}: ${m.message}`));
      else p.res(m.result);
    } else if (m.type === 'event') events.push(m);
  };
  const send = (method: string, params: Record<string, unknown> = {}): Promise<FromBrowser> => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(J({ id, method, params }));
  });
  const s = await send('session.new', { capabilities: {} });
  const version = `${s.capabilities.browserName} ${s.capabilities.browserVersion}`;
  await send('session.subscribe', { events: ['network.beforeRequestSent', 'log.entryAdded'] });
  // BiDi takes the function's own text; Node has stripped its types, so it is plain JavaScript.
  await send('script.addPreloadScript', { functionDeclaration: String(preload) });
  let ctx = (await send('browsingContext.getTree', {})).contexts[0].context;
  // Calls a typed function in the page (inPage, tests/cdp.ts) and returns what it returns, as JSON:
  // BiDi hands back its own serialisation of a value, so the result is turned into JSON in the page
  // (jsonOf) and parsed here.
  const run = async <A extends readonly unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<R> => {
    const r = await send('script.evaluate', { expression: jsonOf(inPage(fn, ...args)), target: { context: ctx }, awaitPromise: true, resultOwnership: 'none', userActivation: true });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    return JSON.parse(r.result.value);
  };
  const go = async () => {
    await send('browsingContext.navigate', { context: ctx, url: base, wait: 'complete' });
    for (let i = 0; i < 100 && !(await run(() => document.documentElement.dataset.ready === 'true')); i++) await sleep(100);
    await sleep(300);
  };
  // Real typing: the field is focused, then each character is a key press.
  const type = async (selector: string, text: string): Promise<void> => {
    await run((sel: string) => { const e = document.querySelector<HTMLInputElement>(sel)!; e.focus(); if (e.select) e.select(); return true; }, selector);
    const actions = [{ type: 'keyDown', value: '\ue003' }, { type: 'keyUp', value: '\ue003' }];
    for (const ch of text) actions.push(ch === '\n' ? { type: 'keyDown', value: '\ue007' } : { type: 'keyDown', value: ch }, ch === '\n' ? { type: 'keyUp', value: '\ue007' } : { type: 'keyUp', value: ch });
    await send('input.performActions', { context: ctx, actions: [{ type: 'key', id: 'kb', actions }] });
    await sleep(80);
  };
  // A press as a person makes it: focus moves to the control, then the click. (The page undoes input
  // events that come with no press, key or focus in its first seconds: only a browser restoring a
  // session sends those.)
  const press = async (selector: string): Promise<void> => { await run((sel: string) => { const e = document.querySelector<HTMLElement>(sel)!; e.focus(); e.click(); return true; }, selector); await sleep(150); };
  const close = async () => { try { await send('browser.close'); } catch { /* gone */ } proc.kill('SIGKILL'); };
  const crash = () => proc.kill('SIGKILL');
  const use = (context: string): void => { ctx = context; };
  return { send, run, go, type, press, close, crash, use, events, profile, downloads, version };
}

// The main run, LibreWolf's own settings
const lw = await session('librewolf', []);
console.log(`# ${lw.version}`);
try {
  await lw.go();
  let g = await lw.run(gateState);
  check(`${lw.version}: the first-run notice shows on a first visit, word for word, with the page inert behind it`,
    g.open && g.title === GATE.title && J(g.paragraphs) === J(GATE.paragraphs) && g.ack === GATE.ack && g.button === GATE.button && g.mainInert && g.stored === null, g);
  await lw.press('.sb-gate-btn');
  g = await lw.run(gateState);
  check(`${lw.version}: Got it closes it and stores its one flag, the time it was closed`, !g.open && !g.mainInert && FLAG_VALUE.test(g.stored || '') && J(g.keys) === J([GATE.key]), { stored: g.stored, keys: g.keys });
  const loadReqs = lw.events.filter((e) => e.method === 'network.beforeRequestSent').length;

  await lw.type('#company', 'Eksempel Handel AS');
  await lw.type('#company-email', 'personvern@eksempel-handel.example');
  await lw.type('#name', 'Kari Nordmann');
  await lw.type('#email', 'kari.nordmann@example.no');
  const date = await lw.run(() => (document.getElementById('letter-date') as HTMLInputElement).value);
  let letter = await lw.run(() => (document.getElementById('letter') as HTMLInputElement).value);
  const A = { company: 'Eksempel Handel AS', companyEmail: 'personvern@eksempel-handel.example', name: 'Kari Nordmann', email: 'kari.nordmann@example.no', letterDate: date };
  check(`${lw.version}: typing builds the letter exactly as src/letters.js writes it`, letter === render(A).text, letter.slice(0, 120));
  await lw.press('#lang-nb');
  letter = await lw.run(() => (document.getElementById('letter') as HTMLInputElement).value);
  check(`${lw.version}: the Bokmål letter, with lang="nb"`, letter === render({ ...A, lang: 'nb' }).text && (await lw.run(() => document.getElementById('letter')!.lang)) === 'nb');

  await lw.press('#open-email');
  await lw.press('#print');
  const rec = await lw.run(() => window.__rec);
  check(`${lw.version}: Open email app hands over the mailto: link, Print gets the letter`,
    rec!.links.length === 1 && rec!.links[0]!.startsWith('mailto:personvern@eksempel-handel.example?subject=') && rec!.prints === 1 && (await lw.run(() => document.getElementById('print-letter')!.textContent)) === letter, rec);

  await lw.run(() => { const t = document.getElementById('received'); t!.focus(); (t as HTMLInputElement).value = '2026-03-05'; t!.dispatchEvent(new Event('input', { bubbles: true })); return true; });
  await lw.press('#save-ics');
  await lw.press('#save-txt');
  let files: string[] = [];
  for (let i = 0; i < 50; i++) {
    files = readdirSync(lw.downloads).filter((f) => !f.endsWith('.part'));
    if (files.length >= 2) break;
    await sleep(200);
  }
  check(`${lw.version}: Save a reminder and Save as text file write their files, named neutrally`, J(files.sort()) === J([`access-request-${date}.txt`, 'gdpr-deadline-2026-04-07.ics'].sort()), files);
  const ics = files.includes('gdpr-deadline-2026-04-07.ics') ? readFileSync(join(lw.downloads, 'gdpr-deadline-2026-04-07.ics'), 'utf8').replace(/\r\n[ \t]/g, '') : '';
  check(`${lw.version}: the reminder: the company and the deadline, none of the person's details`,
    ics.includes('\r\nDTSTART:20260408T120000\r\nDTEND:20260408T123000\r\n') && ics.includes('\r\nTRIGGER:-PT0M\r\n') && ics.includes('SUMMARY:Follow up: Eksempel Handel AS GDPR request (deadline 7 April 2026)') && !/Kari|kari\.nordmann|Nordmann/.test(ics), ics.slice(0, 400));
  const txt = files.includes(`access-request-${date}.txt`) ? readFileSync(join(lw.downloads, `access-request-${date}.txt`), 'utf8') : '';
  check(`${lw.version}: the text file is the letter, byte for byte`, txt === letter);

  const after = lw.events.filter((e) => e.method === 'network.beforeRequestSent').slice(loadReqs).map((e) => e.params.request.url);
  check(`${lw.version}: no request after load (saving makes none either)`, after.length === 0, after);
  const csp = await lw.run(() => window.__csp);
  const logErr = lw.events.filter((e) => e.method === 'log.entryAdded' && (e.params.level === 'error' || /Content-Security-Policy|Content Security Policy/.test(e.params.text || ''))).map((e) => e.params.text);
  check(`${lw.version}: no policy violation, no error`, csp.length === 0 && logErr.length === 0, { csp, logErr });
} catch (err) {
  check('the LibreWolf run finished', false, String((err as { stack?: string } | null) && (err as { stack?: string }).stack || err));
} finally {
  await lw.close();
}

// PRIV-3: what session restore keeps
const cfg = ['/usr/lib/librewolf/librewolf.cfg', '/usr/share/librewolf/librewolf.cfg'].find((f) => existsSync(f));
const lwLevel = cfg ? (readFileSync(cfg, 'utf8').match(/browser\.sessionstore\.privacy_level["'],\s*(\d)/) || [])[1] : undefined;
note(`LibreWolf's own browser.sessionstore.privacy_level: ${lwLevel ?? 'not set in its config, so Firefox\'s default 0'} (${cfg || 'no librewolf.cfg found'})`);
for (const [label, prefs] of [['librewolf-defaults', []], ['firefox-default-level-0', ['user_pref("browser.sessionstore.privacy_level", 0);']]] as Array<[string, string[]]>) {
  const b = await session(label, prefs);
  try {
    await b.go();
    await b.press('.sb-gate-btn');
    const M = 'SESSIONCANARY';
    const fields = { company: '#company', name: '#name', email: '#email', address: '#address', scope: '#scope-text', letter: '#letter', fuletter: '#fu-letter', tlnote: '.tl-note', tlmissing: '#tl-missing', tltext: '#tl-text' };
    await b.press('#scope-some');
    // Stage 2's own fields (FU-11): the follow-up letter, an event note, what is missing, the cover note.
    await b.press('#fu-identity');
    await b.press('#tl-add');
    await b.type('#fu-letter', `${M}fuletter`);
    await b.type('.tl-note', `${M}tlnote`);
    await b.type('#tl-missing', `${M}tlmissing`);
    await b.type('#tl-text', `${M}tltext`);
    await b.type('#company', `${M}company`);
    await b.type('#name', `${M}name`);
    await b.type('#email', `${M.toLowerCase()}@example.no`);
    await b.type('#address', `${M}address`);
    await b.type('#scope-text', `${M}scope`);
    await b.type('#letter', `${M}letter`);
    // Session store collects form data shortly after typing and writes every second here: wait
    // eight seconds, so the file read is one written well after the last key press.
    await b.run(() => ((document.activeElement as HTMLElement).blur(), true));
    await sleep(8000);
    let text = '';
    const store = join(b.profile, 'sessionstore-backups', 'recovery.jsonlz4');
    if (existsSync(store)) {
      try { text = mozlz4(readFileSync(store)); } catch { text = ''; }
    }
    const found = Object.entries(fields).filter(([k]) => text.includes(k === 'email' ? M.toLowerCase() : `${M}${k}`)).map(([k]) => k);
    const ids = (() => { try { return Object.keys(JSON.parse(text).windows[0].tabs.at(-1).formdata?.id || {}); } catch { return []; } })();
    note(`${label}: the session-restore file ${text ? `exists; typed values kept from: ${found.length ? found.join(', ') : 'none of the ten fields'}; form fields it records: ${ids.length ? ids.join(', ') : 'none'}` : 'was not written'}`
      + ' (autocomplete="off" on every field)');
    // privacy.html says that what is typed was left out of that file in our tests.
    check(`${label}: nothing typed is in the session-restore file`, found.length === 0, found);
    writeFileSync(join(OUT, `sessionstore-${label}.json`), text || '');
    // Whatever the browser keeps, the page itself empties every field on a reload.
    await b.go();
    const values = await b.run(() => [...document.querySelectorAll('input, textarea')].map((e) => (e as HTMLInputElement).value).join(' '));
    check(`${label}: after a reload every field the page owns is empty again`, !values.includes(M), values.slice(0, 200));
  } catch (err) {
    check(`the ${label} session-restore run finished`, false, String((err as { stack?: string } | null) && (err as { stack?: string }).stack || err));
  } finally {
    await b.close();
  }
}

// PRIV-3: a crash and restart, Firefox's default session-restore level
// With browser.sessionstore.privacy_level 0, Firefox restores a crashed tab with the form as it
// was: text fields that allow autocomplete, and radios and checkboxes, some 30 ms after the page has
// started, with input events. The page must come back empty: no typed value kept (every field has
// autocomplete="off"), and every choice back at its default (the page undoes the restored ones).
{
  const label = 'firefox-default-level-0-crash';
  const prefs = [
    'user_pref("browser.sessionstore.privacy_level", 0);', 'user_pref("browser.sessionstore.resume_from_crash", true);',
    'user_pref("browser.sessionstore.max_resumed_crashes", 5);', 'user_pref("browser.startup.page", 3);',
    'user_pref("browser.sessionstore.resume_session_once", false);', 'user_pref("browser.sessionstore.restore_on_demand", false);',
    'user_pref("privacy.clearOnShutdown.history", false);', 'user_pref("privacy.sanitize.sanitizeOnShutdown", false);',
    'user_pref("privacy.clearOnShutdown_v2.historyFormDataAndDownloads", false);', 'user_pref("privacy.clearOnShutdown.sessions", false);',
    'user_pref("privacy.clearOnShutdown.formdata", false);',
  ];
  const M = 'CRASHCANARY';
  const state = () => { const $ = <T extends HTMLElement = HTMLInputElement>(id: string): T => document.getElementById(id) as T; return { ready: document.documentElement.dataset.ready, company: $<HTMLInputElement>('company').value, name: $<HTMLInputElement>('name').value, email: $<HTMLInputElement>('email').value, address: $<HTMLTextAreaElement>('address').value, kind: document.querySelector<HTMLInputElement>('input[name=kind]:checked')!.value, based: document.querySelector<HTMLInputElement>('input[name=based]:checked')!.value, f: $<HTMLInputElement>('ground-f').checked, letter: $<HTMLTextAreaElement>('letter').value, fu: ((document.querySelector('input[name=fu-situation]:checked') || {} as HTMLInputElement) as HTMLInputElement).value || null, fuReasons: $<HTMLInputElement>('fu-ref-reasons').checked, tlLang: document.querySelector<HTMLInputElement>('input[name=tl-lang]:checked')!.value }; };
  let b = await session(label, prefs);
  try {
    await b.go();
    await b.press('.sb-gate-btn');
    await b.type('#company', `${M}company`);
    await b.type('#name', `${M}name`);
    await b.type('#email', `${M.toLowerCase()}@example.no`);
    await b.type('#address', `${M}address`);
    await b.press('#kind-erasure');
    await b.run(() => ((document.querySelector('details.less') as HTMLDetailsElement).open = true, true));
    await b.press('#ground-f');
    await b.press('#based-eea');
    await b.press('#fu-refusal');
    await b.press('#fu-ref-reasons');
    await b.press('#tl-lang-en');
    await b.run(() => ((document.activeElement as HTMLElement).blur(), true));
    const before = await b.run(state);
    // Session store writes every second here: wait, so the file read is one written after the last press.
    await sleep(6000);
    let text = '';
    const store = join(b.profile, 'sessionstore-backups', 'recovery.jsonlz4');
    if (existsSync(store)) {
      try { text = mozlz4(readFileSync(store)); } catch { text = ''; }
    }
    const ids = (() => { try { return Object.keys(JSON.parse(text).windows[0].tabs.at(-1).formdata?.id || {}); } catch { return []; } })();
    note(`${label}: before the crash the session-restore file records: ${ids.length ? ids.join(', ') : 'nothing'}; typed values in it: ${text.includes(M) || text.includes(M.toLowerCase()) ? 'yes' : 'none'}`);
    check(`${label}: before the crash, the letter was built from what was typed, and step 9 and the note had choices made`, before.kind === 'erasure' && before.f && before.letter.includes(`${M}name`) && before.fu === 'refusal' && before.fuReasons && before.tlLang === 'en', { kind: before.kind, f: before.f, fu: before.fu });
    b.crash();
    await sleep(1500);
    b = await session(label, prefs, { existing: b.profile, startUrl: null });
    let restored = null;
    for (let i = 0; i < 60 && !restored; i++) {
      restored = (await b.send('browsingContext.getTree', {})).contexts.find((c: FromBrowser) => c.url.startsWith(base));
      if (!restored) await sleep(500);
    }
    check(`${label}: the browser restored the crashed tab`, !!restored);
    if (restored) {
      b.use(restored.context);
      for (let i = 0; i < 60; i++) {
        try { if (await b.run(() => document.readyState === 'complete' && document.documentElement.dataset.ready === 'true')) break; } catch { /* still loading */ }
        await sleep(500);
      }
      // Past the page's three seconds, so that anything restored late would still show.
      await sleep(4000);
      const st = await b.run(state);
      const kept = (['company', 'name', 'email', 'address'] as const).filter((k) => String(st[k]).toLowerCase().includes(M.toLowerCase()));
      check(`${label}: after the restart every field is empty and every choice at its default, and the letter is back to its gaps`,
        kept.length === 0 && st.kind === 'access' && st.based === 'NO' && !st.f && st.letter.startsWith('[Company name]') && !st.letter.toLowerCase().includes(M.toLowerCase())
        && st.fu === null && !st.fuReasons && st.tlLang === 'nb',
        { kept, kind: st.kind, based: st.based, f: st.f, letter: st.letter.slice(0, 60), fu: st.fu, fuReasons: st.fuReasons, tlLang: st.tlLang });
    }
  } catch (err) {
    check(`the ${label} run finished`, false, String((err as { stack?: string } | null) && (err as { stack?: string }).stack || err));
  } finally {
    await b.close();
  }
}

server.kill();
console.log(`\n${passes} passed, ${failures} failed${notes.length ? `, ${notes.length} notes` : ''}.`);
process.exit(failures ? 1 : 0);
