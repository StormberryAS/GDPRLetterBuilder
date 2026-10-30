// A small driver for headless Chromium over the DevTools protocol, with nothing but Node 24
// built-ins (its own WebSocket). Shared by tests/ui-smoke.ts, tests/e2e.ts and
// tests/app-mode-smoke.ts; the same approach as CheckLink's suites, which carry their driver
// inline. Not a test file itself.
//
// Every page opens in a fresh browser context, as a first-time visitor, so the first-run notice
// is up when the page has loaded; openPage closes it with a real press on Got it unless the test is
// about the notice itself (gate: 'keep'). Everything the page requests, logs or is refused by its
// policy is recorded on page.log.
//
// TypeScript since 29 October 2026 (the "in TS" rule): typed as EclipseTracker's tests/cdp.ts,
// itself copied from this file, with UsernameGenerator's rule that code which runs inside the page
// is TypeScript too. It is written as typed functions with the DOM library behind them, which the
// strict check reads, and sent with inPage(), which serialises the function (Node strips the types
// when it loads this file, so what is sent is the same text with them blanked out) and the JSON of
// its arguments. A function sent that way has no closure: it may use only its parameters and the
// page's own globals. tests/static.test.ts holds the tests to it (S-2): no string literal is handed
// to ev, waitFor, Runtime.evaluate or an init script.
//
// Types: what comes back over the DevTools protocol is JSON from the browser, outside anything tsc
// can know. It is typed FromBrowser (any) in this one place on purpose, so the checks read it as
// they always have; a value a typed function returns is typed by that function.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** JSON from the browser (a protocol result, an event, an evaluated value): untyped on purpose. */
export type FromBrowser = any;
type Send = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<FromBrowser>;
type Listener = (message: FromBrowser) => void;

/** A running Chromium: send a protocol command, listen to every message, close it. */
export interface Browser {
  readonly send: Send;
  readonly listeners: Set<Listener>;
  readonly close: () => Promise<void>;
  readonly profile: string;
}

/** What a page recorded: errors, requests (and those off the origin), policy refusals, the console, downloads. */
export interface PageLog {
  readonly errors: string[];
  readonly requests: Array<{ url: string; type: string; method: string; postData: string; headers: Record<string, string>; t: number }>;
  readonly offsite: string[];
  readonly csp: string[];
  readonly console: string[];
  readonly downloads: FromBrowser[];
}

export interface PageOptions {
  width?: number;
  height?: number;
  /** A script run before the page's own: the result of inPage(). */
  init?: string | null;
  gate?: 'close' | 'keep';
  mobile?: boolean;
  downloads?: string | null;
  base?: string | null;
}

export type Key = 'Tab' | 'Space' | 'Enter' | 'Escape' | 'ArrowDown' | 'ArrowUp' | 'Backspace';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

declare global {
  interface Window {
    /** Policy violations the page reported (cdp.ts), "directive blockedURI". */
    __csp: string[];
  }
}

/**
 * The JavaScript that calls fn(...args) in the page: a typed function of the tests, serialised
 * (Node blanks its types out when it loads the file, so toString() is plain JavaScript) with its
 * arguments as JSON. fn must not use anything outside itself but its parameters and the page's
 * globals.
 */
export const inPage = <A extends readonly unknown[]>(fn: (...args: A) => unknown, ...args: A): string =>
  `(${fn.toString()})(...${JSON.stringify(args)})`;

/** Records the page's policy violations on window.__csp. Runs before the page's own scripts. */
const watchPolicy = (): void => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI), true);
};

export async function launchChromium({ chromium = '/usr/bin/chromium', out, args = [] }: { chromium?: string; out: string; args?: readonly string[] }): Promise<Browser> {
  mkdirSync(out, { recursive: true });
  const profile = mkdtempSync(join(out, 'profile-'));
  const proc = spawn(chromium, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-breakpad', '--disable-crash-reporter',
    '--disable-features=Translate,OptimizationHints,MediaRouter', ...args, 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    // Keeps Chromium's own folders inside the throwaway profile instead of the person's ~/.config/chromium.
    env: { ...process.env, XDG_CONFIG_HOME: join(profile, 'xdg-config'), CHROME_CONFIG_HOME: join(profile, 'xdg-config'), XDG_CACHE_HOME: join(profile, 'xdg-cache') },
  });
  const wsUrl = await new Promise<string>((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('Chromium did not start')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m && m[1]) { clearTimeout(t); res(m[1]); }
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map<number, { res: (v: FromBrowser) => void; rej: (e: Error) => void }>();
  const listeners = new Set<Listener>();
  ws.addEventListener('message', (ev) => {
    const m: FromBrowser = JSON.parse(String(ev.data));
    const p = m.id ? pending.get(m.id) : undefined;
    if (p) {
      pending.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error)));
      else p.res(m.result);
    } else for (const fn of listeners) fn(m);
  });
  const send: Send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const close = async (): Promise<void> => {
    try { await send('Browser.close'); } catch { /* already gone */ }
    proc.kill('SIGKILL');
  };
  return { send, listeners, close, profile };
}

/**
 * Opens url in a new context. Options: width, height, init (a script run before the page's own,
 * made with inPage), gate ('close' | 'keep'), mobile, downloads (a folder for real downloads),
 * base (the origin that counts as the page's own).
 */
export async function openPage(browser: Browser, url: string, { width = 1280, height = 900, init = null, gate = 'close', mobile = width < 600, downloads = null, base = null }: PageOptions = {}) {
  const { send, listeners } = browser;
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m: string, p?: Record<string, unknown>): Promise<FromBrowser> => send(m, p, sessionId);
  const origin = new URL(base || url).origin;
  const log: PageLog = { errors: [], requests: [], offsite: [], csp: [], console: [], downloads: [] };
  const onMsg: Listener = (m) => {
    if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') log.downloads.push(m.params);
    if (m.method === 'Browser.downloadWillBegin') log.downloads.push({ begin: m.params.suggestedFilename, url: m.params.url });
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') log.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a: FromBrowser) => a.value ?? a.description).join(' ');
      log.console.push(`${m.params.type}: ${text}`);
      if (m.params.type === 'error') log.errors.push(text);
    }
    if (m.method === 'Log.entryAdded') {
      if (/Content Security Policy|Refused to/i.test(m.params.entry.text)) log.csp.push(m.params.entry.text);
      else if (m.params.entry.level === 'error') log.errors.push(`${m.params.entry.source}: ${m.params.entry.text}`);
    }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      log.requests.push({ url: r.url, type: m.params.type, method: r.method, postData: r.postData || '', headers: r.headers, t: Date.now() });
      if (!r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:')) log.offsite.push(r.url);
    }
  };
  listeners.add(onMsg);
  await s('Runtime.enable');
  await s('Network.enable');
  await s('Page.enable');
  await s('Log.enable');
  await s('DOM.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (downloads) await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, browserContextId, eventsEnabled: true });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: inPage(watchPolicy) });
  if (init) await s('Page.addScriptToEvaluateOnNewDocument', { source: init });
  const ev = async (expression: string): Promise<FromBrowser> => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression: string, ms = 10000): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await ev(expression)) return true; } catch { /* the page is still loading */ }
      await sleep(50);
    }
    return false;
  };
  /** Calls a typed function in the page (see inPage) and returns what it returns, awaited. */
  const run = <A extends readonly unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<Awaited<R>> => ev(inPage(fn, ...args));
  /** Calls a typed function in the page until it returns something true, for up to ms milliseconds; false if it never did. */
  const until = <A extends readonly unknown[]>(ms: number, fn: (...args: A) => unknown, ...args: A): Promise<boolean> => waitFor(inPage(fn, ...args), ms);
  const load = async (target = url): Promise<void> => {
    await s('Page.navigate', { url: target });
    await until(20000, () => document.readyState === 'complete');
    await until(20000, () => document.documentElement.dataset.ready === 'true' || !document.getElementById('letter'));
    await sleep(150);
  };
  await load();
  const gateShown = await run(() => !!document.querySelector('.sb-gate-overlay'));
  if (gate === 'close' && gateShown) {
    await run(() => document.querySelector<HTMLElement>('.sb-gate-btn')!.click());
    if (!(await until(5000, () => !document.querySelector('.sb-gate-overlay') && !document.querySelector('main')!.inert))) throw new Error('the first-run notice did not close');
  }
  const settle = async (): Promise<void> => {
    let last = await run(() => scrollY);
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      const now = await run(() => scrollY);
      if (now === last) return;
      last = now;
    }
  };
  // Presses an element in its centre with real mouse events, after scrolling it into view and
  // checking nothing covers it there.
  const click = async (selector: string): Promise<void> => {
    await run((sel: string) => document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
    await settle();
    const r = await run((sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return { err: 'not found' };
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return { err: 'not visible' };
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      const labels = (el as HTMLInputElement).labels;
      return { x, y, ok: !!hit && (hit === el || el.contains(hit) || (labels && [...labels].some((l) => l.contains(hit)))) };
    }, selector);
    if (r.err || !r.ok) throw new Error(`cannot press ${selector}: ${r.err || 'covered'}`);
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
    await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await sleep(80);
  };
  const KEYS: Record<Key, { key: string; code: string; windowsVirtualKeyCode: number; text?: string }> = {
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  };
  const key = async (k: Key, { shift = false }: { shift?: boolean } = {}): Promise<void> => {
    const d = KEYS[k];
    const modifiers = shift ? 8 : 0;
    await s('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...d });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: d.key, code: d.code, windowsVirtualKeyCode: d.windowsVirtualKeyCode });
    await sleep(40);
  };
  // Types into a field as a person would: focus, select what is there, insert the text.
  const type = async (selector: string, text: string, { replace = true }: { replace?: boolean } = {}): Promise<void> => {
    await run((sel: string, all: boolean) => {
      const t = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!;
      t.scrollIntoView({ block: 'center', behavior: 'instant' });
      t.focus();
      if (all) { if (t.select) t.select(); } else t.selectionStart = t.selectionEnd = t.value.length;
    }, selector, replace);
    if (replace) {
      await s('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS.Backspace });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    }
    if (text) await s('Input.insertText', { text });
    await sleep(60);
  };
  // A date field: set as the browser's own picker would (focus, the value, then input and change
  // events). A person always focuses the field first; the page undoes input events that come with no
  // press, key or focus in its first seconds, because only a browser's session restore sends those.
  const setDate = async (selector: string, iso: string): Promise<void> => {
    await run((sel: string, value: string) => {
      const t = document.querySelector<HTMLInputElement>(sel)!;
      t.focus();
      t.value = value;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }, selector, iso);
    await sleep(60);
  };
  const shot = async (path: string): Promise<void> => {
    const h = await run(() => Math.min(document.documentElement.scrollHeight, 12000));
    const r = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  };
  const viewShot = async (path: string): Promise<void> => {
    const r = await s('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  };
  const close = async (): Promise<void> => {
    listeners.delete(onMsg);
    await send('Target.closeTarget', { targetId }).catch(() => {});
    await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  };
  return { s, run, until, click, key, type, setDate, shot, viewShot, close, load, log, gateShown, browserContextId, settle };
}

export type Page = Awaited<ReturnType<typeof openPage>>;
