#!/usr/bin/env node
// End-to-end test of GDPRLetterBuilder in headless Chromium, set up to behave like production
// (spec sections 9 and 13).
//
//   node tests/e2e.ts [--out DIR] [--chromium PATH]
//
// What "like production" means here:
//  * tests/serve.py serves the repository over HTTPS with the headers the stormberry.as zone sends
//    (its Content-Security-Policy verbatim, HSTS, nosniff, the Speed Brain speculation rules), and
//    only the files GitHub Pages would publish; this harness proves the excluded ones give 404;
//  * Chromium loads the page as https://gdpr.stormberry.as/. The name is mapped to the local
//    server and the throwaway certificate is trusted by its key hash, for this browser only. Every
//    other host name is unresolvable, so nothing can leave this machine even if the page tried,
//    and any attempt is still recorded;
//  * each flow runs in a fresh browser context, as a first-time visitor.
//
// What it proves:
//  * zero requests after the page has loaded, zero fetch or XHR, zero policy violations, no errors,
//    even when what is typed is in a script the typeface does not cover;
//  * the canary audit: a marker typed into every field, every output pressed, and the marker is in
//    no request, no localStorage (beyond the notice's flag), sessionStorage, IndexedDB, Cache
//    Storage or cookie; it is gone after a reload and after Clear;
//  * the saved .txt is the letter byte for byte; the saved .ics is the reminder, with the company's
//    name and the deadline and none of the person's details;
//  * the mailto: link, read from the recording stand-in without opening anything;
//  * the page keeps working with the network cut (the public "disconnect and try it" test);
//  * hostile input in every field creates no element, opens no dialog and makes no request.
// Screenshots at 1280x900 and 390x844 go to DIR/shots. Exits 1 on any failure. Not run by
// `npm test`.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inPage, launchChromium, openPage, sleep } from './cdp.ts';
import type { FromBrowser, Page } from './cdp.ts';
import { pageState, shareStub } from './share-stub.ts';
import { FLAG_VALUE, GATE } from './legal-pages.ts';
import { render } from '#src/letters.js';
import { computeDeadline } from '#src/deadline.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const CHROMIUM = opt('--chromium', process.env.CHROMIUM || '/usr/bin/chromium');
const OUT = resolve(opt('--out', join(tmpdir(), 'gdpr-e2e')));
const SHOTS = join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(CHROMIUM)) {
  console.error(`Chromium not found at ${CHROMIUM}.`);
  process.exit(2);
}
const HOST = 'gdpr.stormberry.as';
const URL0 = `https://${HOST}/`;
const J = JSON.stringify;

let passes = 0;
let failures = 0;
function check(name: string, ok: unknown, detail?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail !== undefined ? `\n     ${typeof detail === 'string' ? detail : J(detail).slice(0, 2000)}` : ''}`);
}

const server = spawn('python3', [join(ROOT, 'tests', 'serve.py'), '--tls', '--log', join(OUT, 'server.log')], { stdio: ['ignore', 'pipe', 'inherit'] });
const ready = await new Promise<{ url: string; spki: string }>((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('serve.py did not start')), 30000);
  server.stdout.on('data', (d) => {
    buf += d;
    const m = /READY (\S+) spki=(\S+)/.exec(buf);
    if (m) { clearTimeout(t); res({ url: m[1]!, spki: m[2]! }); }
  });
});
const PORT = new URL(ready.url).port;
const browser = await launchChromium({ chromium: CHROMIUM, out: OUT, args: [
  `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}, MAP * ~NOTFOUND`,
  `--ignore-certificate-errors-spki-list=${ready.spki}`,
  '--lang=en-GB',
] });

// A GET from Node to the local server, as the site would answer it (for the 404 checks).
function get(path: string): Promise<number | undefined> {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method: 'GET', servername: HOST, headers: { Host: HOST }, rejectUnauthorized: false }, (r) => {
      r.resume();
      r.on('end', () => res(r.statusCode));
    });
    req.on('error', rej);
    req.end();
  });
}

const pages: Page[] = [];
try {
  // What is published
  for (const path of ['/README.md', '/DISCLAIMER.md', '/LICENSE', '/NOTICE', '/bump_assets.py', '/tests/serve.py', '/_config.yml', '/.gitignore', '/android/app/build.gradle.kts', '/android/web-overlay/android-bridge.js',
    // The files the move to TypeScript deleted on 29 October 2026 (the old type check's and the
    // old test files), kept as guards: they pass trivially while the files are absent, and fail if
    // a stale copy ever comes back and is served
    '/tests/e2e.mjs', '/jsconfig.json', '/types/page.d.ts', '/types/stamped-imports.d.ts',
    // The TypeScript sources and tooling (29 October 2026): only the compiled app.js and src/*.js are published
    '/package.json', '/package-lock.json', '/tests/e2e.ts', '/tests/tsconfig.json', '/ts/app.ts', '/ts/page.d.ts', '/ts/src/letters.ts', '/tsconfig.json', '/tsconfig.src.json', '/tools/build-ts.sh',
    '/.npmrc', '/.gitattributes', '/.build-ts.last', '/android/web-overlay/android-bridge.ts', '/android/web-overlay/tsconfig.json', '/node_modules/typescript/package.json', '/node_modules/@types/node/package.json']) {
    check(`not published: ${path} gives 404`, (await get(path)) === 404);
  }
  for (const path of ['/', '/privacy.html', '/disclaimer.html', '/disclaimer.css', '/gate.js', '/gate.css', '/og-image.png', '/src/letters.js', '/licences/Inter-OFL-1.1.txt', '/switcher-icons/gdpr.svg', '/favicon.svg', '/apple-touch-icon.png']) {
    check(`published: ${path} gives 200`, (await get(path)) === 200);
  }

  // Load, notice, no requests after load
  const downloads = mkdtempSync(join(OUT, 'downloads-'));
  const p = await openPage(browser, URL0, { width: 1280, height: 900, init: shareStub(), gate: 'keep', downloads });
  pages.push(p);
  check('the page loads as https://gdpr.stormberry.as/ with the notice up', p.gateShown && (await p.run(() => location.href)) === URL0);
  await p.viewShot(join(SHOTS, 'notice-1280.png'));
  await p.click('.sb-gate-btn');
  await p.until(3000, () => !document.querySelector('.sb-gate-overlay'));
  // Wait for the fonts, then everything from here on counts as "after load".
  await p.run(() => document.fonts.ready.then(() => true));
  await sleep(500);
  const loaded = p.log.requests.length;
  // data: addresses here are Chromium's own pictures for the date field's calendar button, drawn by
  // the browser, not loaded by the page (its policy allows no data: images).
  const loadUrls = p.log.requests.map((r) => r.url.replace(URL0, '/')).filter((u) => !u.startsWith('data:image/svg+xml'));
  check('the load fetches only the page\'s own files', loadUrls.every((u) => u.startsWith('/')) && p.log.offsite.length === 0, loadUrls);

  // The canary audit
  const M = 'CANARY7Q4';
  const A = {
    company: `${M}company AS`, companyEmail: `privacy@${M.toLowerCase()}.example`, companyAddress: `${M} street 1\n0101 Oslo`,
    name: `Kari ${M}name`, email: `kari@${M.toLowerCase()}mail.example`, address: `${M}vei 2\n5300 Kleppestø`,
  };
  await p.type('#company', A.company);
  await p.type('#company-email', A.companyEmail);
  await p.type('#company-address', A.companyAddress);
  await p.click('#dpo');
  await p.type('#name', A.name);
  await p.type('#email', A.email);
  await p.type('#address', A.address);
  await p.click('#id-add');
  await p.type('.id-row .id-value', `${M}id-01019012480`);
  await p.click('#scope-some');
  await p.type('#scope-text', `${M}scope`);
  await p.click('#consultations');
  await p.click('#kind-erasure');
  await p.click('#ground-d');
  await p.type('#ground-d-text', `${M}reason`);
  await p.click('#kind-access');
  await p.setDate('#received', '2026-03-05');
  await p.shot(join(SHOTS, 'filled-1280.png'));
  let st = await p.run(pageState);
  const date = await p.run(() => (document.getElementById('letter-date') as HTMLInputElement).value);
  const want = render({ ...A, dpo: true, identifiers: [{ label: 'email', value: `${M}id-01019012480` }], scope: 'some', scopeText: `${M}scope`, consultations: true, grounds: { d: true }, groundDText: `${M}reason`, letterDate: date }).text;
  check('the letter carries what was typed, exactly as src/letters.js writes it', st.letter === want, st.letter.slice(0, 200));

  // Every output.
  await p.click('#copy-letter');
  await p.click('#open-email');
  await p.click('#print');
  await p.click('#share');
  await p.click('#save-txt');
  await p.click('#save-ics');
  await p.run(() => (document.querySelectorAll('details.guide')[1] as HTMLDetailsElement).open = true);
  await p.click('#save-ics-ext');
  await sleep(1500);
  st = await p.run(pageState);
  check('Copy, Send using email app, Save as PDF and Share each handed over the letter once (the email button copies nothing)', st.rec.clipboard.length === 1 && st.rec.links.length === 1 && st.rec.prints === 1 && st.rec.share.length === 1, st.rec);
  const link = st.rec.links[0];
  check('the mailto: link: to the privacy email, Cc the person\'s own address, the subject and the whole letter, nothing else',
    link === `mailto:privacy@${M.toLowerCase()}.example?cc=kari@${M.toLowerCase()}mail.example&subject=${encodeURIComponent('Request for access to my personal data (GDPR Article 15)')}&body=${encodeURIComponent(st.letter.replace(/\n/g, '\r\n'))}`, (link || '').slice(0, 200));
  // The saved files, byte for byte.
  const files = readdirSync(downloads);
  check('Save as text file and the two reminders saved three files, named neutrally', files.length === 3, files);
  const named = p.log.downloads.filter((d) => d.begin).map((d) => d.begin).sort();
  check('the file names: the kind of request and dates, never the company', J(named) === J([`access-request-${date}.txt`, 'gdpr-deadline-2026-04-07.ics', 'gdpr-deadline-2026-06-08.ics'].sort()) && named.every((n) => !n.includes(M)), named);
  const byName: Record<string, FromBrowser> = Object.fromEntries(p.log.downloads.filter((d) => d.begin).map((d) => [d.begin, d]));
  // allowAndName saves each download under a GUID of its own: tell them apart by content.
  const contents = files.map((f) => readFileSync(join(downloads, f), 'utf8'));
  const txt = contents.find((c) => !c.startsWith('BEGIN:VCALENDAR'));
  const ics = contents.filter((c) => c.startsWith('BEGIN:VCALENDAR'));
  check('the .txt is the letter, byte for byte, in UTF-8', txt === st.letter && Buffer.byteLength(txt) === Buffer.byteLength(st.letter), txt && txt.slice(0, 80));
  const first = computeDeadline('2026-03-05', 'NO');
  const unfold = (s: string): string => s.replace(/\r\n[ \t]/g, '');
  const icsFirst = ics.map(unfold).find((c) => c.includes('\r\nDTSTART:20260408T120000\r\nDTEND:20260408T123000\r\n'));
  const icsExt = ics.map(unfold).find((c) => c.includes('\r\nDTSTART:20260609T120000\r\nDTEND:20260609T123000\r\n'));
  check('the reminder: 12.00 to 12.30 (floating time) the day after the deadline (Tuesday 7 April 2026), the company named, the alert when it starts',
    !!icsFirst && icsFirst.includes(`SUMMARY:Follow up: ${M}company AS GDPR request (deadline 7 April 2026)`) && icsFirst.includes('\r\nTRIGGER:-PT0M\r\n') && !/VALUE=DATE|TZID|VTIMEZONE/.test(icsFirst) && first.first.date === '2026-04-07', icsFirst && icsFirst.slice(0, 600));
  check('the extended reminder: 12.00 to 12.30 the day after Monday 8 June 2026, the later reading, the alert when it starts', !!icsExt && icsExt.includes('(deadline 8 June 2026)') && icsExt.includes('\r\nTRIGGER:-PT0M\r\n'), ics.length);
  const personal = [`${M}name`, `${M.toLowerCase()}mail`, `${M}vei`, `${M}id`, `${M}scope`, `${M}reason`, `${M} street`, `privacy@${M.toLowerCase()}`];
  check('the reminders hold none of the person\'s details, nor the letter', ics.every((c) => personal.every((x) => !c.includes(x)) && !c.includes('Yours faithfully')), personal.filter((x) => ics.some((c) => c.includes(x))));
  check('the downloads came from the page\'s own memory (blob:), not from a server', Object.values(byName).every((d) => d.url && d.url.startsWith(`blob:${URL0.slice(0, -1)}`)), Object.values(byName).map((d) => d.url));

  // Leave the company out of the reminder.
  await p.click('#ics-leave-out');
  await p.click('#save-ics');
  await sleep(1000);
  const leaveOut = readdirSync(downloads).map((f) => readFileSync(join(downloads, f), 'utf8')).filter((c) => c.startsWith('BEGIN:VCALENDAR')).map(unfold).find((c) => c.includes('SUMMARY:Follow up: your GDPR request'));
  check('"Leave the company name out of the reminder": the title says "your GDPR request" and the name is nowhere', !!leaveOut && !leaveOut.includes(M), leaveOut && leaveOut.slice(0, 400));

  // Stage 2 (spec 21.7, FU-11): the follow-up and the cover note carry the marker through every
  // output too, and it must go nowhere either.
  await p.click('#fu-reminder');
  await p.setDate('#fu-request-date', '2026-03-02');
  await p.setDate('#fu-received-date', '2026-03-05');
  await p.click('#tl-add');
  await p.setDate('.tl-row .tl-date', '2026-03-02');
  await p.type('.tl-row .tl-note', `${M}event`);
  await p.click('.tl-row .tl-attach');
  await p.type('#tl-missing', `${M}missing`);
  await p.click('#fu-copy');
  await p.click('#fu-email');
  await p.click('#fu-save');
  await p.click('#tl-copy');
  await p.click('#tl-save');
  await sleep(1000);
  const st2 = await p.run(() => ({ fu: (document.getElementById('fu-letter') as HTMLInputElement).value, tl: (document.getElementById('tl-text') as HTMLInputElement).value }));
  check('stage 2: the follow-up and the cover note carry the typed details', st2.fu.includes(`${M}name`) && st2.tl.includes(`${M}event.`) && st2.tl.includes(`${M}missing`));
  const named2 = p.log.downloads.filter((d) => d.begin).map((d) => d.begin);
  check('stage 2: the follow-up and the cover note save under neutral names, from the page\'s own memory',
    named2.includes(`follow-up-${date}.txt`) && named2.includes(`timeline-${date}.txt`) && named2.every((n) => !n.includes(M))
    && p.log.downloads.filter((d) => d.begin && /^(follow-up|timeline)-/.test(d.begin)).every((d) => d.url.startsWith(`blob:${URL0.slice(0, -1)}`)), named2);

  // Where the canary went: nowhere.
  const after = p.log.requests.slice(loaded);
  const leaked = p.log.requests.filter((r) => [r.url, r.postData, J(r.headers)].some((x) => x.includes(M) || x.includes(M.toLowerCase())));
  check('zero requests after load, and none of any kind carries the marker', after.length === 0 && leaked.length === 0, { after: after.map((r) => `${r.type} ${r.url}`), leaked: leaked.length });
  check('zero fetch, XHR, beacon, EventSource or WebSocket', !p.log.requests.some((r) => ['Fetch', 'XHR', 'Ping', 'EventSource', 'WebSocket'].includes(r.type)));
  const store = await p.run(async () => ({
    local: Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
    session: sessionStorage.length,
    idb: indexedDB.databases ? (await indexedDB.databases()).length : 0,
    caches: (await caches.keys()).length,
    cookie: document.cookie,
  }));
  check('the canary is in no storage: localStorage holds only the notice\'s flag, nothing in sessionStorage, IndexedDB, Cache Storage or cookies',
    store.local.length === 1 && store.local[0]![0] === GATE.key && FLAG_VALUE.test(store.local[0]![1]!) && store.session === 0 && store.idb === 0 && store.caches === 0 && store.cookie === '', store);
  const cookies = await p.s('Network.getCookies', {});
  check('no cookie for the site at all', cookies.cookies.length === 0, cookies.cookies);
  check('no policy violations and no errors', p.log.csp.length === 0 && p.log.errors.length === 0 && (await p.run(() => window.__csp.length)) === 0, { csp: p.log.csp, errors: p.log.errors });

  // A reload empties every field, whatever the browser restores.
  await p.load();
  st = await p.run(pageState);
  const html = await p.run(() => [...document.querySelectorAll('input, textarea, select')].map((e) => (e as HTMLInputElement).value).join('\n') + document.body.innerText);
  check('after a reload the marker is gone: every field empty, the letter back to its gaps', !html.includes(M) && st.letter.startsWith('[Company name]') && st.rows === 0, { letter: st.letter.slice(0, 40) });
  check('after a reload the notice stays closed (its flag survives, nothing else)', !(await p.run(() => !!document.querySelector('.sb-gate-overlay'))) && (await p.run(() => Object.keys(localStorage).length)) === 1);

  // Clear empties it on demand.
  await p.type('#company', `${M}again`);
  await p.type('#name', `${M}again`);
  await p.click('#fu-identity');
  await p.click('#tl-add');
  await p.type('.tl-row .tl-note', `${M}again`);
  await p.type('#tl-missing', `${M}again`);
  await p.click('#clear');
  await p.click('#confirm-ok');
  await sleep(100);
  const cleared = await p.run(() => [...document.querySelectorAll('input, textarea')].map((e) => (e as HTMLInputElement).value).join('\n') + document.body.innerText);
  check('after Clear the marker is gone', !cleared.includes(M));

  // A script the typeface does not cover: typing it fetches nothing. The page names only
  // InterVariable, so a missing glyph falls back to the system's fonts and never to a font file
  // loaded after load (code review of 12 October 2026).
  await p.run(() => document.fonts.ready.then(() => true));
  const beforeFonts = p.log.requests.length;
  await p.type('#name', '\u738b\u5c0f\u660e \u{1F600} \u0645\u062d\u0645\u062f \u0e2a\u0e21\u0e0a\u0e32\u0e22');
  await p.run(() => document.fonts.ready.then(() => true));
  await sleep(800);
  const lateFonts = p.log.requests.slice(beforeFonts).map((r) => r.url);
  check('typing Chinese, an emoji, Arabic and Thai makes no request: no font file is fetched for them', lateFonts.length === 0, lateFonts);

  // Disconnect and try it
  await p.s('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const before = p.log.requests.length;
  await p.type('#company', 'Offline Test AS');
  await p.type('#name', 'Kari Nordmann');
  await p.click('#lang-nb');
  await p.click('#copy-letter');
  await p.setDate('#received', '2026-11-25');
  st = await p.run(pageState);
  check('offline: the letter, the copy and the deadline all still work, with no request at all',
    st.letter.startsWith('Offline Test AS\n\n') && st.letterLang === 'nb' && st.rec.clipboard.length === 1 && st.deadline.includes('Monday 28 December 2026') && p.log.requests.length === before,
    { letter: st.letter.slice(0, 40), deadline: st.deadline.slice(0, 80), requests: p.log.requests.slice(before).map((r) => r.url) });
  await p.s('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // The phone
  const ph = await openPage(browser, URL0, { width: 390, height: 844, init: shareStub() });
  pages.push(ph);
  await ph.type('#company', 'Eksempel Handel AS');
  await ph.type('#name', 'Kari Nordmann');
  await ph.type('#email', 'kari.nordmann@example.no');
  await ph.click('#kind-erasure');
  await ph.click('#ground-c');
  await ph.shot(join(SHOTS, 'erasure-390.png'));
  const phs = await ph.run(pageState);
  check('the phone: the erasure letter builds, nothing sideways, no errors, no requests to other sites', phs.letter.includes('Article 17(1)(c)') && phs.sw <= phs.vw + 1 && ph.log.errors.length === 0 && ph.log.offsite.length === 0 && ph.log.csp.length === 0,
    { sw: phs.sw, vw: phs.vw, errors: ph.log.errors, offsite: ph.log.offsite });

  // Hostile input: markup, script and direction marks typed into every field create no element, open
  // no dialog, make no request and break no policy; the letter holds them as plain text, direction
  // marks removed (code review of 12 October 2026).
  const watch = (): void => {
    window.__added = []; window.__dialogs = 0; window.__armed = false;
    for (const k of ['alert', 'confirm', 'prompt']) (window as unknown as Record<string, () => void>)[k] = () => { window.__dialogs += 1; };
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (window.__armed && n.nodeType === 1 && /^(IMG|SCRIPT|IFRAME|OBJECT|EMBED|SVG|LINK|STYLE|FORM|BASE|META)$/i.test((n as Element).tagName)) window.__added.push((n as Element).outerHTML.slice(0, 120)); })
      .observe(document, { childList: true, subtree: true });
  };
  const hp = await openPage(browser, URL0, { width: 1280, height: 900, init: [shareStub(), inPage(watch)].join(';\n') });
  pages.push(hp);
  await hp.run(() => document.fonts.ready.then(() => true));
  await sleep(300);
  const hostileBefore = hp.log.requests.length;
  await hp.run(() => window.__armed = true);
  await hp.click('#scope-some');
  await hp.click('#kind-erasure');
  await hp.click('#ground-d');
  await hp.click('#id-add');
  // Stage 2: the follow-up and the cover note render the same answers, plus their own fields.
  await hp.click('#fu-identity');
  await hp.click('#tl-add');
  await hp.setDate('.tl-row .tl-date', '2026-10-12');
  const HOSTILE = ['<img src=xss1 onerror=alert(1)>', '"><svg onload=alert(2)>', '</textarea><script>alert(3)</script>', 'javascript:alert(4)',
    "${alert(5)}{{constructor.constructor('alert(6)')()}}", 'x‮evil‬​y'];
  const hostileFields = ['#company', '#company-email', '#company-address', '#name', '#email', '#address', '#scope-text', '#ground-d-text', '.id-row .id-value', '.tl-row .tl-note', '#tl-missing'];
  let hostileLetters = '';
  let hostileOthers = '';
  for (const pl of HOSTILE) {
    for (const f of hostileFields) await hp.type(f, `${pl} ${f.replace(/\W/g, '')}`);
    hostileLetters += await hp.run(() => (document.getElementById('letter') as HTMLInputElement).value);
    hostileOthers += await hp.run(() => (document.getElementById('fu-letter') as HTMLInputElement).value + (document.getElementById('tl-text') as HTMLInputElement).value);
  }
  const hs = await hp.run(() => ({ added: window.__added, dialogs: window.__dialogs, csp: window.__csp.length }));
  check('hostile input in every field: no element created, no dialog, no request, no policy violation, no error',
    hs.added.length === 0 && hs.dialogs === 0 && hs.csp === 0 && hp.log.csp.length === 0 && hp.log.errors.length === 0 && hp.log.requests.length === hostileBefore,
    { ...hs, requests: hp.log.requests.slice(hostileBefore).map((r) => r.url), errors: hp.log.errors });
  check('hostile input: the letter holds it as plain text, direction and zero-width marks removed',
    hostileLetters.includes('<img src=xss1 onerror=alert(1)> company') && hostileLetters.includes('</textarea><script>alert(3)</script> name') && hostileLetters.includes('xevily')
    && !/[​-‏‪-‮⁦-⁩]/.test(hostileLetters));
  check('hostile input: the follow-up and the cover note hold it as plain text too, marks removed',
    hostileOthers.includes('<img src=xss1 onerror=alert(1)> company') && hostileOthers.includes('</textarea><script>alert(3)</script> tlrowtlnote.') && hostileOthers.includes('"><svg onload=alert(2)> tlmissing')
    && !/[​-‏‪-‮⁦-⁩]/.test(hostileOthers));

  // The legal pages over HTTPS
  for (const path of ['privacy.html', 'disclaimer.html']) {
    const lp = await openPage(browser, URL0 + path, { width: 1280, height: 900, gate: 'keep' });
    pages.push(lp);
    await sleep(300);
    const reqs = lp.log.requests.map((r) => r.url.replace(URL0, '/'));
    const errors = lp.log.errors.filter((e) => !(/status of 404/.test(e) && reqs.includes('/favicon.ico')));
    check(`${path} over HTTPS: only its own files, no violations, no errors`, lp.log.offsite.length === 0 && lp.log.csp.length === 0 && errors.length === 0 && !reqs.some((u) => /\.js(\?|$)/.test(u)), { reqs, csp: lp.log.csp, errors });
    await lp.shot(join(SHOTS, `${path.replace('.html', '')}-1280.png`));
  }
} catch (err) {
  const e = err as { stack?: string } | null;
  check('the run finished', false, String(e && e.stack || err));
} finally {
  for (const pg of pages) await pg.close().catch(() => {});
  await browser.close();
  server.kill();
}

console.log(`\n${passes} passed, ${failures} failed. Screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);

declare global {
  interface Window {
    /** The hostile-input watch (watch, above): elements the page added once armed, dialogs opened. */
    __added: string[];
    __dialogs: number;
    __armed: boolean;
  }
}
