// Recording stand-ins for what the page hands to the outside world: the clipboard, the share sheet,
// mailto: links and the print dialog. Injected before the page's own scripts by the browser tests,
// so nothing leaves the machine and every hand-over can be read back exactly. Downloads (Save as
// text file, Save a reminder) are left real: the browser tests save them into the run folder and
// compare the files. Not a test file itself.
//
//   share: true defines navigator.share (Chromium on Linux has none), so the Share button shows;
//   clipboard: 'deny' makes writeText refuse, as a browser that does not allow copying would.
//
// TypeScript since 29 October 2026: the stand-ins and the page-state reader are typed functions
// that run in the page (sent with inPage, tests/cdp.ts), no longer JavaScript written in strings.

import { inPage } from './cdp.ts';

/** What the stand-ins recorded, on window.__rec. */
export interface Recorded {
  clipboard: string[];
  share: ShareData[];
  links: string[];
  prints: number;
  downloads: Array<string | null>;
}

declare global {
  interface Window {
    /** What the share stand-ins recorded (tests/share-stub.ts). */
    __rec?: Recorded;
  }
}

export interface StubOptions {
  share?: boolean;
  clipboard?: 'allow' | 'deny';
}

/** Installs the stand-ins. Runs in the page, before its own scripts. */
function installStub(share: boolean, clipboard: 'allow' | 'deny'): void {
  const rec: Recorded = { clipboard: [], share: [], links: [], prints: 0, downloads: [] };
  Object.defineProperty(window, '__rec', { value: rec });
  const cb = navigator.clipboard;
  if (cb) {
    Object.defineProperty(cb, 'writeText', { configurable: true, value: (t: unknown) => {
      if (clipboard === 'deny') return Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
      rec.clipboard.push(String(t)); return Promise.resolve();
    } });
  }
  if (share) {
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d: ShareData) => { rec.share.push(d); return Promise.resolve(); } });
  } else {
    try { delete (Navigator.prototype as { share?: unknown }).share; } catch (e) { /* not deletable */ }
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const href = this.getAttribute('href') || '';
    if (href.startsWith('mailto:')) { rec.links.push(href); return undefined; }
    if (this.hasAttribute('download')) rec.downloads.push(this.getAttribute('download'));
    return click.call(this);
  };
  window.print = () => { rec.prints += 1; };
}

/** The init script (PageOptions.init) that installs the stand-ins with these options. */
export function shareStub({ share = true, clipboard = 'allow' }: StubOptions = {}): string {
  return inPage(installStub, share, clipboard);
}

/** The page's state, read in the page: what a test needs about the form, the letter and the outputs. */
export function pageState() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const radio = (n: string): string | null => { const r = document.querySelector<HTMLInputElement>('input[name="' + n + '"]:checked'); return r ? r.value : null; };
  const vis = (el: Element | null): boolean => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  return {
    ready: document.documentElement.dataset.ready === 'true',
    kind: radio('kind'), lang: radio('lang'), channel: radio('channel'), based: radio('based'), reply: radio('reply'), scope: radio('scope'), copy: radio('copy'),
    letter: $<HTMLTextAreaElement>('letter').value, letterLang: $('letter').getAttribute('lang'),
    edited: !$('letter-edited').hidden,
    missing: $('missing').hidden ? '' : $('missing').textContent,
    emailLabel: $('open-email').textContent,
    status: $('out-status').textContent, icsStatus: $('ics-status').textContent, extStatus: $('ext-status').textContent,
    deadline: $('deadline-result').innerText,
    received: $<HTMLInputElement>('received').value, posted: $<HTMLInputElement>('posted').value, postedShown: vis($('posted')),
    shareShown: vis($('share')),
    accessShown: vis(document.querySelector('[data-kind="access"]')), erasureShown: vis(document.querySelector('div[data-kind="erasure"]')),
    rows: document.querySelectorAll('.id-row').length,
    warnings: [...document.querySelectorAll<HTMLElement>('.warn')].filter((w) => !w.hidden).map((w) => ({ id: w.id, text: w.textContent })),
    printText: $('print-letter').textContent, printLang: $('print-letter').getAttribute('lang'),
    // Every page the suites read this way has the stand-ins (shareStub); without them rec is null.
    rec: (window.__rec ? JSON.parse(JSON.stringify(window.__rec)) : null) as Recorded,
    sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
  };
}
export type PageState = ReturnType<typeof pageState>;
