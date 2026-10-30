#!/usr/bin/env node
// Browser smoke test of the GDPRLetterBuilder interface in headless Chromium, driven over the
// DevTools protocol with nothing but Node 24 built-ins (tests/cdp.ts).
//
//   node tests/ui-smoke.ts [--chromium /usr/bin/chromium] [--out DIR]
//
// It serves the repository with tests/serve.py (the zone's headers, only what GitHub Pages would
// publish), opens the page as a first-time visitor in a fresh browser context each time, and
// checks (spec sections 11 and 13):
//   * the first-run notice at 1280, 390 and 320 pixels and at 200% text, word for word, closed by
//     Escape, the backdrop and its button, its one flag, and not shown again after a reload;
//   * one column with no sideways scrolling at 1280, 390 and 320 pixels and at 200% text;
//   * at 320, 360 and 393 pixels, every inline choice label on one line and no radio or checkbox
//     label broken inside a word;
//   * contrast of the main text in dark, light and forced colours;
//   * the keyboard path through every step, with a visible focus ring everywhere;
//   * the letter: built from what is typed, equal to src/letters.js run in Node, lang="nb" on the
//     Bokmål letter, the edit and rebuild flow (an edited letter keeps its subject, language and
//     file name), Clear;
//   * the warnings, tied to their fields;
//   * the outputs, through the recording stand-ins of tests/share-stub.ts: Copy, Send using email
//     app (To, Cc, subject and the whole letter, no copy), Save as PDF (and print emulation shows
//     only the letter, with no page margin and its own padding), Share shown only where the browser
//     has it, Copy refused;
//   * the deadline, the postal estimate (a receipt date typed by hand wins) and the other-country note;
//   * the privacy page and the disclaimer under the page's policy, in dark and light, at 1280 and 320.
// Screenshots go to DIR. Exits 1 on any failure. The file name does not end in .test.ts, so
// `npm test` does not run it.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, openPage, sleep } from './cdp.ts';
import type { Page, PageOptions } from './cdp.ts';
import { pageState, shareStub } from './share-stub.ts';
import type { StubOptions } from './share-stub.ts';
import { FLAG_VALUE, GATE, gateState, legalState, PAGE_CSP } from './legal-pages.ts';
import { render } from '#src/letters.js';
import { render as renderFollowUp } from '#src/followups.js';
import { render as renderTimeline } from '#src/timeline.js';
import { computeDeadline, explainDeadline } from '#src/deadline.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const CHROMIUM = opt('--chromium', process.env.CHROMIUM || '/usr/bin/chromium');
const OUT = resolve(opt('--out', join(tmpdir(), 'gdpr-ui')));
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

const server = spawn('python3', [join(ROOT, 'tests', 'serve.py'), '--quiet'], { stdio: ['ignore', 'pipe', 'inherit'] });
const BASE = await new Promise<string>((res, rej) => {
  const t = setTimeout(() => rej(new Error('serve.py did not start')), 20000);
  server.stdout.on('data', (d) => {
    const m = /READY (\S+)/.exec(String(d));
    if (m) { clearTimeout(t); res(m[1]!); }
  });
});
const browser = await launchChromium({ chromium: CHROMIUM, out: OUT, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--lang=en-GB'] });
const pages: Page[] = [];
const open = async (opts: PageOptions & { stub?: StubOptions } = {}, path = ''): Promise<Page> => {
  const p = await openPage(browser, BASE + path, { init: shareStub(opts.stub || {}), ...opts });
  pages.push(p);
  return p;
};

// The answers a test types, and the same answers for src/letters.js in Node.
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
async function fill(p: Page, a: { company?: string; companyEmail?: string; name?: string; email?: string; address?: string }): Promise<void> {
  if (a.company !== undefined) await p.type('#company', a.company);
  if (a.companyEmail !== undefined) await p.type('#company-email', a.companyEmail);
  if (a.name !== undefined) await p.type('#name', a.name);
  if (a.email !== undefined) await p.type('#email', a.email);
  if (a.address !== undefined) await p.type('#address', a.address);
}

// Contrast of an element's text against what is behind it: translucent backgrounds composited
// up the tree over the page colour, the element's own opacity applied to its text.
function contrast(sels: string[]) {
  type Rgba = { r: number; g: number; b: number; a: number };
  const parse = (c: string): Rgba | null => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1]!.split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0]!, g: p[1]!, b: p[2]!, a: p.length > 3 ? p[3]! : 1 }; };
  const over = (top: Rgba, bot: Rgba): Rgba => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = (c: Rgba): number => { const f = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a: Rgba, b: Rgba): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el: Element): Rgba => {
    const chain: Array<Rgba | null> = [];
    for (let e: Element | null = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor));
    let bg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (!bg || bg.a === 0) bg = parse(getComputedStyle(document.body).backgroundColor);
    bg = { ...bg!, a: 1 };
    for (const c of chain.reverse()) if (c && c.a > 0) bg = over(c, bg);
    return bg;
  };
  return sels.map((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length && !e.closest('[hidden]'));
    if (!el) return { sel, missing: true };
    const cs = getComputedStyle(el);
    const fg = parse(cs.color)!;
    const bg = bgOf(el);
    let op = 1; for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const text = over({ ...fg, a: fg.a * op }, bg);
    // A gradient background (the primary button): the text against its lowest-contrast stop.
    const stops = [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => over(parse(m[0])!, bg));
    const r = stops.length ? Math.min(...stops.map((st) => ratio(over({ ...fg, a: fg.a * op }, st), st))) : ratio(text, bg);
    return { sel, ratio: Math.round(r * 100) / 100, color: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')', size: cs.fontSize };
  });
}
const CONTRAST_SELECTORS = ['.hero-lede', '.hero-note', '.step-title', '.hint', '.field > label', 'legend', '.choice-sub', '.choice span', '.btn-primary', '.btn-secondary', 'textarea.letter',
  'details > summary', '.sources', '.missing', '.deadline p', '.deadline-head', '.footer-bottom p', '.footer-offline', '.footer-privacy', '.footer-law', '.footer-ai', '.footer-tagline', '.switcher-title', '.tips li', 'input#company'];

try {
  // The first-run notice
  for (const [w, h, big] of [[1280, 900, false], [390, 844, false], [320, 640, false], [320, 640, true]] as Array<[number, number, boolean]>) {
    const p = await open({ width: w, height: h, gate: 'keep' });
    const tag = `${w}${big ? ' at 200% text' : ''}`;
    if (big) await p.run(() => document.documentElement.style.fontSize = '200%');
    await sleep(300);
    let g = await p.run(gateState);
    check(`notice ${tag}: shown on a first visit, dismissible, word for word, the page inert behind it`,
      g.open && g.tier === 'dismissible' && g.role === 'dialog' && g.modal === 'true' && g.kicker === GATE.kicker && g.title === GATE.title
      && J(g.paragraphs) === J(GATE.paragraphs) && g.ack === GATE.ack && g.button === GATE.button && g.link === GATE.link && g.linkHref === GATE.linkHref
      && g.focusInside && g.othersInert && g.mainInert && g.stored === null, g);
    check(`notice ${tag}: no sideways scrolling, and Got it can be reached`, g.sw <= g.vw + 1 && g.buttonBox && g.buttonBox.width > 40, { sw: g.sw, vw: g.vw, btn: g.buttonBox });
    if (big) {
      await p.run(() => document.querySelector('.sb-gate-btn')!.scrollIntoView({ block: 'center' }));
      const b = await p.run(() => { const r = document.querySelector('.sb-gate-btn')!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
      check(`notice ${tag}: Got it scrolls into view inside the notice`, b.top >= 0 && b.bottom <= b.vh, b);
      await p.viewShot(join(SHOTS, 'notice-320-200pct.png'));
    }
    if (w === 1280) {
      await p.viewShot(join(SHOTS, 'notice-1280.png'));
      // A press that starts and ends on the backdrop closes it.
      await p.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: 8, button: 'left', clickCount: 1 });
      await p.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 8, y: 8, button: 'left', clickCount: 1 });
    } else if (w === 390) {
      await p.key('Escape');
    } else {
      await p.click('.sb-gate-btn');
    }
    await p.until(3000, () => !document.querySelector('.sb-gate-overlay'));
    g = await p.run(gateState);
    check(`notice ${tag}: closed by ${w === 1280 ? 'the backdrop' : w === 390 ? 'Escape' : 'Got it'}, storing its one flag, the time it was closed`,
      !g.open && !g.mainInert && FLAG_VALUE.test(g.stored || '') && J(g.keys) === J([GATE.key]), { open: g.open, stored: g.stored, keys: g.keys });
    if (w === 390) {
      await p.load();
      g = await p.run(gateState);
      check('notice: not shown again after a reload', !g.open, g.open);
    }
  }

  // Layout at every width
  for (const [w, h] of [[1280, 900], [390, 844], [320, 640]]) {
    const p = await open({ width: w, height: h });
    await fill(p, { company: 'Eksempel Handel AS', name: 'Kari Nordmann', email: 'kari.nordmann@example.no' });
    for (const big of [false, true]) {
      if (big) await p.run(() => document.documentElement.style.fontSize = '200%');
      for (const kind of ['access', 'erasure']) {
        await p.click(`#kind-${kind}`);
        await sleep(100);
        const st = await p.run(() => { const wide = [...document.querySelectorAll('main *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map((e) => e.tagName + '#' + e.id + '.' + e.className).slice(0, 5); return { sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, wide }; });
        check(`layout ${w}${big ? ' at 200% text' : ''}, ${kind}: one column, nothing wider than the screen`, st.sw <= st.vw + 1 && st.wide.length === 0, st);
      }
      // Stage 3 review E3-8: every radio and checkbox row shown is a target at least 44 px high.
      const rows = await p.run(() => [...document.querySelectorAll('main .choice, main .check')].filter((e) => e.getClientRects().length).map((e) => ({ id: (e.querySelector('input') || {}).id, h: Math.round(e.getBoundingClientRect().height * 10) / 10 })));
      const low = rows.filter((r) => r.h < 44);
      check(`layout ${w}${big ? ' at 200% text' : ''}: every radio and checkbox row is at least 44 px high (${rows.length} rows)`, rows.length > 20 && low.length === 0, low.slice(0, 5));
      // Stage 3 verification: the box sits level with the first line of its label, on a two-line
      // choice too (step 1's options, with their article line), as in stage 2; on a one-line row it
      // is in the middle of the text; and the label never wraps under the box.
      const boxes = await p.run(() => [...document.querySelectorAll('main .choice, main .check')].filter((e) => e.getClientRects().length).map((e) => {
        const box = e.querySelector('input')!.getBoundingClientRect();
        const span = e.querySelector(':scope > span');
        // The text's own line boxes (its glyphs), not the boxes of the elements inside the label.
        const walker = document.createTreeWalker(span!, NodeFilter.SHOW_TEXT);
        const rects = [];
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const r = document.createRange(); r.selectNodeContents(t);
          rects.push(...[...r.getClientRects()].filter((x) => x.height > 0 && x.width > 0));
        }
        const first = rects[0];
        const lines = new Set(rects.map((x) => Math.round(x.top))).size;
        const s = span!.getBoundingClientRect();
        return { id: e.querySelector('input')!.id, lines, boxTop: Math.round((box.top - first!.top) * 10) / 10,
          mid: Math.round(((box.top + box.bottom) / 2 - (first!.top + first!.bottom) / 2) * 10) / 10, beside: s.left >= box.right - 0.5 && s.top < box.bottom };
      }));
      const two = boxes.filter((b) => b.lines >= 2);
      const off = boxes.filter((b) => Math.abs(b.mid) > 3 || !b.beside);
      check(`layout ${w}${big ? ' at 200% text' : ''}: each box sits level with the first line of its label, beside it (${two.length} rows of two lines or more)`,
        two.some((b) => b.id === 'kind-access') && off.length === 0 && two.every((b) => Math.abs(b.boxTop) <= 4), { off: off.slice(0, 5), two: two.slice(0, 3) });
      // Stage 3 review E3-9: the title breaks only between "GDPR", "Letter" and "Builder", never inside one.
      const title = await p.run(() => { const span = document.querySelector('#app-title span[aria-hidden]'); const parts = [...span!.childNodes].filter((n) => n.nodeType === 3);
        return parts.map((n) => { const r = document.createRange(); r.selectNodeContents(n); const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top))); return { text: (n as Text).data, lines: tops.size }; }); });
      check(`layout ${w}${big ? ' at 200% text' : ''}: the title "GDPR Letter Builder" never breaks inside a word`, title.length === 3 && title.map((t) => t.text).join('') === 'GDPRLetterBuilder' && title.every((t) => t.lines === 1), title);
      await p.shot(join(SHOTS, `page-${w}${big ? '-200pct' : ''}.png`));
    }
  }

  // Phone widths (2026-10-29): every inline choice label (the three language rows and "All of it" /
  // "Part of it") stays on one line, and no radio or checkbox label breaks inside a word, in each
  // situation of step 9 so that every label is shown once. A label that wraps does so at a space
  // or after a hyphen or slash only.
  for (const w of [320, 360, 393]) {
    const p = await open({ width: w, height: 800 });
    await fill(p, { company: 'Eksempel Handel AS', name: 'Kari Nordmann', email: 'kari.nordmann@example.no' });
    const inline = new Map<string, number>();
    const broken: Array<{ text: string; at: string }> = [];
    let labels = 0;
    for (const situation of ['reminder', 'partial', 'extension', 'refusal', 'identity']) {
      await p.click(`#fu-${situation}`);
      await sleep(100);
      const r = await p.run(() => {
        const visible = (e: Element): boolean => e.getClientRects().length > 0;
        const rows = [...document.querySelectorAll('main .choices.inline .choice > span')].filter(visible).map((sp) => {
          const range = document.createRange(); range.selectNodeContents(sp);
          const id = sp.parentElement!.querySelector('input')!.id;
          return { id, lines: new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size };
        });
        const breaks: Array<{ text: string; at: string }> = [];
        const spans = [...document.querySelectorAll('main .choice > span, main .check > span')].filter(visible);
        for (const sp of spans) {
          const walker = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT);
          let prev: { ch: string; bottom: number } | null = null;
          let prevParent: Element | null = null;
          for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
            // A new block (the article line under a choice) starts a new word.
            if (t.parentElement !== prevParent && (getComputedStyle(t.parentElement!).display !== 'inline' || (prevParent && getComputedStyle(prevParent).display !== 'inline'))) prev = null;
            prevParent = t.parentElement;
            for (let i = 0; i < t.data.length; i++) {
              const ch = t.data[i]!;
              if (/\s/.test(ch)) { prev = null; continue; }
              const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + 1);
              const b = [...range.getClientRects()].find((x) => x.width > 0);
              if (!b) continue;
              if (prev && b.top >= prev.bottom - 1 && !/[-‐/]/.test(prev.ch)) breaks.push({ text: (sp.textContent || '').trim().slice(0, 60), at: prev.ch + ch });
              prev = { ch, bottom: b.bottom };
            }
          }
        }
        return { rows, breaks, labels: spans.length };
      });
      for (const row of r.rows) inline.set(row.id, Math.max(inline.get(row.id) ?? 0, row.lines));
      broken.push(...r.breaks);
      labels += r.labels;
    }
    const tall = [...inline].filter(([, lines]) => lines !== 1);
    check(`phone ${w}: every inline choice label stays on one line (${inline.size} labels)`, inline.size === 8 && tall.length === 0, { tall, ids: [...inline.keys()] });
    check(`phone ${w}: no radio or checkbox label breaks inside a word (${labels} labels over the five step 9 situations)`, labels > 100 && broken.length === 0, broken.slice(0, 5));
    await p.run(() => document.getElementById('lang-en')!.scrollIntoView({ block: 'center' }));
    await p.viewShot(join(SHOTS, `inline-choices-${w}.png`));
  }

  // Contrast in dark, light and forced colours
  {
    const p = await open({ width: 1280, height: 900 });
    await fill(p, { company: 'Eksempel Handel AS' });
    await p.setDate('#received', '2026-03-05');
    for (const [name, features] of [['dark', [{ name: 'prefers-color-scheme', value: 'dark' }]], ['light', [{ name: 'prefers-color-scheme', value: 'light' }]], ['forced colours', [{ name: 'forced-colors', value: 'active' }]]] as Array<[string, Array<{ name: string; value: string }>]>) {
      await p.s('Emulation.setEmulatedMedia', { features });
      await sleep(200);
      const res = await p.run(contrast, CONTRAST_SELECTORS);
      const low = res.filter((r) => r.missing || r.ratio! < 4.5);
      check(`contrast, ${name}: every checked text at least 4.5:1 (${res.length} kinds of text)`, low.length === 0, low);
      if (name !== 'dark') await p.shot(join(SHOTS, `page-1280-${name.replace(' ', '-')}.png`));
      if (name === 'forced colours') {
        const borders = await p.run(() => ['#company', '#letter', '.btn-secondary', '.card'].map((s) => { const cs = getComputedStyle(document.querySelector(s)!); return s + ' ' + cs.borderTopStyle + ' ' + cs.borderTopWidth; }));
        check('forced colours: fields, the letter, buttons and cards keep a visible border', borders.every((b) => / solid [1-9]/.test(b)), borders);
      }
    }
    await p.s('Emulation.setEmulatedMedia', { features: [] });
  }

  // The keyboard path
  {
    const p = await open({ width: 1280, height: 900 });
    await p.run(() => { document.activeElement && (document.activeElement as HTMLElement).blur(); window.scrollTo(0, 0); });
    const seen: string[] = [];
    let unfocused = [];
    for (let i = 0; i < 320; i++) {
      await p.key('Tab');
      const f = await p.run(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none'; return { id: e.id || e.tagName + '.' + e.className, ring, inMain: !!e.closest('main'), footer: !!e.closest('footer, .app-switcher-container') }; });
      if (!f) continue;
      if (f.footer) break;
      seen.push(f.id);
      if (!f.ring) unfocused.push(f.id);
    }
    const want = ['kind-access', 'company', 'channel-email', 'company-email', 'dpo', 'company-address', 'based-no', 'name', 'email', 'address', 'reply-email', 'id-add',
      'scope-all', 'consultations', 'copy-electronic', 'lang-en', 'letter-date', 'letter', 'copy-letter', 'open-email', 'print', 'save-txt', 'share', 'clear', 'received', 'ics-leave-out', 'save-ics',
      'fu-reminder', 'tl-lang-nb', 'tl-date', 'tl-add', 'tl-missing', 'tl-text', 'tl-copy', 'tl-print', 'tl-save'];
    const order = want.map((id) => seen.indexOf(id));
    check('keyboard: Tab reaches every step\'s controls, in the order of the page', order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1]!)), { missing: want.filter((id) => !seen.includes(id)), seen });
    check('keyboard: every stop shows a focus ring', unfocused.length === 0, unfocused);
    check('keyboard: the "why" lines and the guide cards are reachable summaries', seen.filter((s) => s.startsWith('SUMMARY')).length >= 15, seen.filter((s) => s.startsWith('SUMMARY')).length);
    // Arrow keys move through a radio group; Space ticks a box; Enter opens a card.
    await p.run(() => document.getElementById('kind-access')!.focus());
    await p.key('ArrowDown');
    let st = await p.run(pageState);
    check('keyboard: the arrow key chooses erasure, and the erasure options show', st.kind === 'erasure' && st.erasureShown && !st.accessShown, { kind: st.kind });
    await p.run(() => document.getElementById('ground-a')!.focus());
    await p.key('Space');
    st = await p.run(pageState);
    check('keyboard: Space ticks a ground, and the letter names it', st.letter.includes('(Article 17(1)(a)).'), st.letter.slice(0, 600));
    await p.run(() => (document.querySelector('details.guide summary')! as HTMLElement).focus());
    await p.key('Enter');
    check('keyboard: Enter opens a guide card', await p.run(() => (document.querySelector('details.guide')! as HTMLDetailsElement).open));
  }

  // The letter, the warnings and the outputs
  {
    const p = await open({ width: 1280, height: 900 });
    await sleep(300);
    check('nothing is announced as the page starts: the deadline shown at the start is not news (E3-2)', (await p.run(() => document.getElementById('announcer')!.textContent)) === '');
    const A = { company: 'Eksempel Handel AS', companyEmail: 'personvern@eksempel-handel.example', name: 'Kari Nordmann', email: 'kari.nordmann@example.no', address: 'Storgata 1\n5300 Kleppestø' };
    await fill(p, A);
    let st = await p.run(pageState);
    const date = await p.run(() => (document.getElementById('letter-date')! as HTMLInputElement).value);
    check('the letter date is today by default', date === TODAY, date);
    check('access, English: the letter is exactly what src/letters.js writes', st.letter === render({ ...A, letterDate: date }).text && st.letterLang === 'en-GB' && st.missing === '', { lang: st.letterLang, missing: st.missing });
    await p.click('#lang-nb');
    st = await p.run(pageState);
    check('Bokmål: the letter is the Bokmål text and carries lang="nb"', st.letter === render({ ...A, letterDate: date, lang: 'nb' }).text && st.letterLang === 'nb', st.letterLang);
    check('a change of option is announced once: "Letter updated."', await p.until(2000, () => document.getElementById('announcer')!.textContent === 'Letter updated.'));
    await p.click('#kind-erasure');
    await p.click('#ground-c');
    await p.click('#copy-first');
    st = await p.run(pageState);
    check('erasure, Bokmål, a ground and an extra: the letter is exactly what src/letters.js writes',
      st.letter === render({ ...A, letterDate: date, lang: 'nb', kind: 'erasure', grounds: { c: true }, copyFirst: true }).text, st.letter.slice(0, 300));
    await p.shot(join(SHOTS, 'erasure-nb-1280.png'));
    await p.click('#lang-en');
    await p.click('#kind-access');

    // Details that help them find you, and the warnings.
    await p.click('#id-add');
    check('Add a detail adds a row and moves focus to it', (await p.run(() => document.activeElement!.className)) === 'id-label' && (await p.run(pageState)).rows === 1);
    await p.type('.id-row .id-value', '010190 12480');
    st = await p.run(pageState);
    const wid = await p.run(() => document.querySelector('.id-row .id-value')!.getAttribute('aria-describedby'));
    check('a national identity number shows a warning, worded as the spec says, tied to its field', st.warnings.length === 1 && st.warnings[0]!.text.startsWith('Warning: This looks like a Norwegian national identity number (fødselsnummer).')
      && wid!.split(' ').includes(st.warnings[0]!.id), { warnings: st.warnings, wid });
    check('the warning does not block: the detail is in the letter', st.letter.includes('Email address I use with you: 010190 12480'));
    await p.type('.id-row .id-value', '4111 1111 1111 1111');
    st = await p.run(pageState);
    check('a payment card number shows its warning', st.warnings.length === 1 && st.warnings[0]!.text.includes('This looks like a payment card number. A data request never needs it.'), st.warnings);
    await p.type('.id-row .id-value', 'K-40213');
    await p.run(() => { (document.querySelector('.id-row .id-label')! as HTMLInputElement).value = 'customer'; document.querySelector('.id-row .id-label')!.dispatchEvent(new Event('change', { bubbles: true })); });
    st = await p.run(pageState);
    check('an ordinary customer number: no warning, its label in the letter', st.warnings.length === 0 && st.letter.includes('These details may help you find my data:\nCustomer number: K-40213'), st.warnings);
    await p.click('.id-remove');
    st = await p.run(pageState);
    check('Remove takes the row and its line away, and focus goes to Add a detail', st.rows === 0 && !st.letter.includes('K-40213') && (await p.run(() => document.activeElement!.id)) === 'id-add');
    await p.type('#company-email', 'not an address');
    st = await p.run(pageState);
    check('a privacy email that is not an address is flagged', st.warnings.some((w) => w.id === 'company-email-warn'), st.warnings);
    await p.type('#company-email', A.companyEmail);

    // Copy.
    await p.click('#copy-letter');
    await sleep(100);
    st = await p.run(pageState);
    check('Copy letter puts the letter, as it stands, on the clipboard and says "Copied."', st.rec.clipboard.length === 1 && st.rec.clipboard[0] === st.letter && st.status === 'Copied.', st.status);
    // Send using email app: one label, whatever the length; a draft with To, Cc, the subject and the whole letter, and nothing copied.
    check('the email button says "Send using email app" for a whole letter', st.emailLabel === 'Send using email app', st.emailLabel);
    await p.click('#open-email');
    await sleep(100);
    st = await p.run(pageState);
    const link = st.rec.links.at(-1) || '';
    const SUBJECT = encodeURIComponent('Request for access to my personal data (GDPR Article 15)');
    check('Send using email app: a draft to the privacy email, Cc the person\'s own address, the subject and the whole letter, nothing copied',
      st.rec.clipboard.length === 1 && link === `mailto:personvern@eksempel-handel.example?cc=kari.nordmann@example.no&subject=${SUBJECT}&body=${encodeURIComponent(st.letter.replace(/\n/g, '\r\n'))}`
      && link.length > 1800 && st.status === 'Your email app should open a draft. Check that the whole letter is in it before you press Send.', { link: link.slice(0, 200), status: st.status, clip: st.rec.clipboard.length });
    check('the hint under the buttons says the draft has the letter and the Cc, and that nothing is sent',
      (await p.run(() => document.getElementById('email-note')!.textContent)) === 'Your email app opens a draft with the letter, and your own email address as Cc if you gave one. Nothing is sent until you press Send there.');
    // No valid address of the person's own: no Cc.
    await p.type('#email', 'not an address');
    await p.click('#open-email');
    await sleep(100);
    st = await p.run(pageState);
    check('an email address of the person\'s own that is not an address gives no Cc', (st.rec.links.at(-1) || '').startsWith(`mailto:personvern@eksempel-handel.example?subject=${SUBJECT}&body=`), (st.rec.links.at(-1) || '').slice(0, 120));
    check('and step 3 warns that it is left out of Cc, tied to its field', st.warnings.some((w) => w.id === 'email-warn' && w.text === 'Warning: This does not look like an email address, so Send using email app will leave it out of Cc.')
      && (await p.run(() => document.getElementById('email')!.getAttribute('aria-describedby')))!.split(' ').includes('email-warn'), st.warnings);
    await p.type('#email', A.email);
    st = await p.run(pageState);
    check('a valid own address: the warning goes', !st.warnings.some((w) => w.id === 'email-warn'), st.warnings);
    // An edited, short letter: the label stays, the body is the edited letter.
    await p.type('#letter', 'Short test letter, æøå.');
    st = await p.run(pageState);
    check('editing the letter: the notice shows, and the label stays', st.edited && st.emailLabel === 'Send using email app', { edited: st.edited, label: st.emailLabel });
    await p.click('#open-email');
    await sleep(100);
    st = await p.run(pageState);
    check('Send using email app with an edited letter: the body is the letter as it stands, encoded', (st.rec.links.at(-1) || '').endsWith(`&body=${encodeURIComponent('Short test letter, æøå.')}`), st.rec.links.at(-1));
    // Edited: the form no longer changes it; Rebuild asks first.
    await p.type('#company', 'Another Company AS');
    st = await p.run(pageState);
    check('after an edit, changes above no longer update the letter', st.letter === 'Short test letter, æøå.');
    // The edited letter keeps its own subject, language tag and file name when the form changes
    // (code review of 12 October 2026). Saving is refused by the browser here: only the name the page
    // gives the file is read, from the stand-in.
    await browser.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: p.browserContextId });
    await p.click('#lang-nb');
    await p.click('#kind-erasure');
    await p.click('#open-email');
    await p.click('#save-txt');
    await sleep(100);
    st = await p.run(pageState);
    check('after an edit, a change of language and kind leaves the letter\'s subject, language tag and file name alone',
      st.letter === 'Short test letter, æøå.' && st.letterLang === 'en-GB'
      && (st.rec.links.at(-1) || '').startsWith(`mailto:personvern@eksempel-handel.example?cc=kari.nordmann@example.no&subject=${encodeURIComponent('Request for access to my personal data (GDPR Article 15)')}&body=`)
      && st.rec.downloads.at(-1) === `access-request-${date}.txt`, { lang: st.letterLang, link: st.rec.links.at(-1), file: st.rec.downloads.at(-1) });
    await p.click('#lang-en');
    await p.click('#kind-access');
    await p.click('#rebuild');
    check('Rebuild from the form asks first', await p.run(() => (document.getElementById('confirm-dialog')! as HTMLDialogElement).open && document.getElementById('confirm-text')!.textContent.startsWith('Rebuild the letter from the form?')));
    await p.key('Escape');
    await sleep(100);
    st = await p.run(pageState);
    check('Escape keeps the edited letter', !(await p.run(() => (document.getElementById('confirm-dialog')! as HTMLDialogElement).open)) && st.letter === 'Short test letter, æøå.' && st.edited);
    await p.click('#rebuild');
    await p.click('#confirm-ok');
    await sleep(100);
    st = await p.run(pageState);
    check('Rebuild: the letter comes back from the form, with the new company name', !st.edited && st.letter === render({ ...A, company: 'Another Company AS', letterDate: date }).text, st.letter.slice(0, 80));

    // Print: the stand-in records the press; print emulation shows the letter alone.
    await p.click('#print');
    await sleep(50);
    st = await p.run(pageState);
    check('Save as PDF: the print view gets the letter as it stands, in its language, and the line says to choose Save as PDF', st.rec.prints === 1 && st.printText === st.letter && st.printLang === 'en-GB' && st.status === 'In the print window, choose to save as PDF instead of a printer.', { prints: st.rec.prints, status: st.status });
    check('the three PDF buttons say "Save as PDF"', J(await p.run(() => ['print', 'fu-print', 'tl-print'].map((id) => document.getElementById(id)!.textContent))) === J(['Save as PDF', 'Save as PDF', 'Save as PDF']));
    await p.s('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(200);
    const pr = await p.run(() => {
      const box = getComputedStyle(document.getElementById('print-letter')!);
      return { shown: [...document.body.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.tagName), bg: getComputedStyle(document.body).backgroundColor, color: box.color, ws: box.whiteSpace,
        pad: [box.paddingTop, box.paddingRight, box.paddingBottom, box.paddingLeft].map((x) => Math.round(parseFloat(x) * 25.4 / 96)), clone: box.getPropertyValue('box-decoration-break') || box.getPropertyValue('-webkit-box-decoration-break') };
    });
    check('print: only the letter is printed, black on white, line breaks kept, 20 mm sides and top and 22 mm bottom as padding repeated on every page',
      J(pr.shown) === J(['print-letter']) && pr.bg === 'rgb(255, 255, 255)' && pr.color === 'rgb(0, 0, 0)' && pr.ws === 'pre-wrap' && J(pr.pad) === J([20, 20, 22, 20]) && pr.clone === 'clone', pr);
    // The WebKit fallback (Safari and iOS clone padding only on inline boxes): a @supports branch that
    // puts the 20 and 22 mm back on the page and takes the padding away. It is parsed, and it does
    // not apply in Chromium.
    const fb = await p.run(() => {
      const sheet = [...document.styleSheets].find((x) => (x.href || '').includes('style.css'))!;
      const media = [...sheet.cssRules].filter((r) => r instanceof CSSMediaRule && r.conditionText === 'print') as CSSMediaRule[];
      const sup = media.flatMap((m) => [...m.cssRules]).find((r) => r instanceof CSSSupportsRule) as CSSSupportsRule | undefined;
      const inner = sup ? [...sup.cssRules] : [];
      const page = inner.find((r) => r instanceof CSSPageRule) as CSSPageRule | undefined;
      const pad = inner.find((r) => r instanceof CSSStyleRule && r.selectorText === '.print-letter') as CSSStyleRule | undefined;
      return { cond: sup?.conditionText, applies: sup ? CSS.supports(sup.conditionText) : null, margin: page?.style.getPropertyValue('margin'), padding: pad?.style.getPropertyValue('padding') };
    });
    check('print: the WebKit fallback branch is there (page margin 20 mm 20 mm 22 mm, no padding) and does not apply in Chromium',
      fb.cond === '(not (box-decoration-break: clone)) or (font: -apple-system-body)' && fb.applies === false && fb.margin === '20mm 20mm 22mm' && fb.padding === '0px', fb);
    await p.viewShot(join(SHOTS, 'print-emulation.png'));
    await p.s('Emulation.setEmulatedMedia', { media: '' });

    // Share, where the browser has it (the stand-in gives Chromium one).
    check('Share shows where the browser can share', st.shareShown);
    await p.click('#share');
    await sleep(50);
    st = await p.run(pageState);
    check('Share hands over the letter as text', st.rec.share.length === 1 && st.rec.share[0]!.text === st.letter);

    // The deadline.
    await p.setDate('#received', '2026-03-05');
    st = await p.run(pageState);
    const e = explainDeadline(computeDeadline('2026-03-05', 'NO'));
    check('the deadline for a letter received on 5 March 2026: Tuesday 7 April, Easter explained, the later extension reading',
      st.deadline.includes(`${e.headline}, ${e.counted}`) && e.lines.every((l) => st.deadline.includes(l)) && st.deadline.includes(e.extension), st.deadline);
    // Stage 3 review E3-2: the deadline is plain text; its change is said through the announcer.
    check('a new deadline is announced through the announcer, in full', await p.until(2000, (v0) => document.getElementById('announcer')!.textContent === v0, [`${e.headline}, ${e.counted}`, ...e.lines, e.extension].join(' ')),
      await p.run(() => document.getElementById('announcer')!.textContent));
    await p.click('#channel-post');
    await p.setDate('#posted', '2026-04-01');
    st = await p.run(pageState);
    check('post: the posting date shows, the date of receipt is estimated (3 working days over Easter), and the count says so',
      st.postedShown && st.received === '2026-04-09' && st.deadline.includes('counted from an estimated delivery date.'), { received: st.received, deadline: st.deadline.slice(0, 160) });
    await p.click('#based-eea');
    st = await p.run(pageState);
    check('abroad: 10 working days, and the note that the company\'s holidays are not taken into account',
      st.received === '2026-04-20' && st.deadline.includes('Public holidays in the company\'s country are not taken into account here; check them yourself.'), { received: st.received });
    await p.click('#channel-email');
    st = await p.run(pageState);
    check('back to email: the estimate no longer stands in the box', st.received === TODAY && !st.postedShown, st.received);
    // A receipt date typed by hand wins over the estimate until a new posting date is given
    // (code review of 12 October 2026).
    await p.click('#channel-post');
    await p.setDate('#received', '2026-04-14');
    await p.click('#based-no');
    st = await p.run(pageState);
    check('post: a receipt date typed by hand stays when the country changes, and the count does not call it an estimate',
      st.received === '2026-04-14' && st.deadline.includes('counted from the date you gave for when they received it.'), { received: st.received, deadline: st.deadline.slice(0, 120) });
    await p.setDate('#posted', '2026-04-02');
    st = await p.run(pageState);
    check('post: a new posting date brings the estimate back (3 working days over Easter)', st.received === '2026-04-09' && st.deadline.includes('counted from an estimated delivery date.'), { received: st.received });
    await p.click('#channel-email');
    await p.click('#based-outside');
    check('outside the EEA: the two hints show', await p.run(() => !document.getElementById('outside-note')!.hidden && document.getElementById('outside-note')!.textContent.includes('representative')));

    // Clear.
    await p.click('#clear');
    await p.click('#confirm-ok');
    await sleep(100);
    st = await p.run(pageState);
    // The three generated boxes (the letter, the follow-up, the cover note) are left out: they hold
    // what the page writes, not what was typed.
    const empty = await p.run(() => [...document.querySelectorAll('main input[type=text], main input[type=email], main textarea:not(#letter):not(#fu-letter):not(#tl-text)')].every((e) => (e as HTMLInputElement).value === ''));
    check('Clear everything, after asking: every field empty, every choice back to its default', empty && st.kind === 'access' && st.channel === 'email' && st.based === 'NO' && st.rows === 0
      && st.letter.startsWith('[Company name]') && st.status === 'Cleared.', { kind: st.kind, status: st.status, letter: st.letter.slice(0, 40) });
    check('no errors, no policy violations and no requests to other sites on the main page', p.log.errors.length === 0 && p.log.csp.length === 0 && p.log.offsite.length === 0 && (await p.run(() => window.__csp.length)) === 0,
      { errors: p.log.errors, csp: p.log.csp, offsite: p.log.offsite });
  }

  // Stage 2: the follow-up letter (step 9) and the cover note (step 10)
  {
    const p = await open({ width: 1280, height: 900 });
    const A = { company: 'Eksempel Handel AS', companyEmail: 'personvern@eksempel-handel.example', name: 'Kari Nordmann', email: 'kari.nordmann@example.no' };
    await fill(p, A);
    const fuState = () => { const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T; const shown = (id: string): boolean => !$(id).hidden && !$(id).closest('[hidden]'); return {
      body: shown('fu-body'), wrap: shown('fu-letter-wrap'), letter: $<HTMLTextAreaElement>('fu-letter').value, lang: $('fu-letter').getAttribute('lang'),
      missing: shown('fu-missing') ? $('fu-missing').textContent : '', check: shown('fu-check') ? $('fu-check').textContent : '',
      attach: shown('fu-attach'), nothing: shown('fu-nothing'), edited: shown('fu-edited'), status: $('fu-status').textContent,
      items: [...document.querySelectorAll('.fu-item')].map((l) => [l.querySelector('input')!.value, l.textContent!.trim(), l.querySelector('input')!.checked] as [string, string, boolean]),
      answer: shown('fu-answer-field'), received: shown('fu-received-field'), s16: shown('fu-ref-16-row'), emailLabel: $('fu-email').textContent,
      tl: $<HTMLTextAreaElement>('tl-text').value, tlLang: $('tl-text').getAttribute('lang'), tlMissing: shown('tl-missing-parts') ? $('tl-missing-parts').textContent : '',
      undated: shown('tl-undated'), tlEdited: shown('tl-edited'), tlStatus: $('tl-status').textContent, tlRows: document.querySelectorAll('.tl-row').length,
      tlWarn: [...document.querySelectorAll<HTMLElement>('.tl-warn, #tl-missing-warn')].filter((w) => !w.hidden).map((w) => w.textContent),
    }; };
    const base = { ...A, letterDate: TODAY, lang: 'en' };
    let f = await p.run(fuState);
    check('step 9: no situation chosen at first, so no fields and no letter', !f.body && f.letter === '');

    // The reminder.
    await p.click('#fu-reminder');
    // Dates well before any day this suite runs, so the deadline has passed.
    await p.setDate('#fu-request-date', '2026-01-05');
    await p.setDate('#fu-received-date', '2026-01-05');
    f = await p.run(fuState);
    const rem = { ...base, situation: 'reminder', requestDate: '2026-01-05', receivedDate: '2026-01-05' };
    check('reminder: exactly what src/followups.js writes; the attachment tip; no answer date; nothing missing',
      f.letter === renderFollowUp(rem).text && f.attach && !f.answer && f.received && f.missing === '' && f.lang === 'en-GB', { missing: f.missing, start: f.letter.slice(0, 120) });
    check('reminder: a date it reached them long ago: the time limit ended, with the pause caveat and no early warning',
      f.check === 'Counted from the date it reached them, the time limit ended on 5 February 2026. If they asked about your identity, or asked you to narrow your request, the time may have paused, so it may not have ended yet.', f.check);
    await p.setDate('#fu-received-date', TODAY);
    f = await p.run(fuState);
    check('reminder: a date it reached them that leaves the deadline open says the reminder may be early, and the warning is announced (FU-5, K2-3)',
      f.check.startsWith('Counted from the date it reached them, the time limit ends on ') && f.check.includes('A reminder before then may be early.')
      && (await p.until(2000, () => document.getElementById('announcer')!.textContent.includes('A reminder before then may be early.'))), f.check);
    await p.click('#fu-email');
    await sleep(100);
    let st = await p.run(pageState);
    f = await p.run(fuState);
    check('reminder by email: "Send using email app", a draft to the privacy email, Cc the person, the reminder subject and the whole reminder, and the reminder to attach the first letter',
      f.emailLabel === 'Send using email app'
      && (st.rec.links.at(-1) || '') === `mailto:personvern@eksempel-handel.example?cc=kari.nordmann@example.no&subject=${encodeURIComponent('Reminder: request for access to my personal data (GDPR Article 15)')}&body=${encodeURIComponent(f.letter.replace(/\n/g, '\r\n'))}`
      && f.status === 'Your email app should open a draft. Check that the whole letter is in it before you press Send. Remember to attach your first letter.', { link: (st.rec.links.at(-1) || '').slice(0, 200), status: f.status });

    // Not fully: the reply checker.
    await p.click('#fu-partial');
    await p.setDate('#fu-answer-date', '2026-02-02');
    f = await p.run(fuState);
    check('not fully: the checker lists the nine access items with their labels, none ticked, and the letter asks for all nine',
      f.items.length === 9 && f.items[3]![1] === 'The recipients, named' && f.items.every((i) => !i[2]) && f.answer && !f.received && !f.attach
      && f.letter === renderFollowUp({ ...base, situation: 'partial', requestDate: '2026-01-05', answerDate: '2026-02-02', receivedDate: TODAY }).text, f.items);
    await p.click('#fu-item-copy');
    await p.click('#fu-item-purposes');
    f = await p.run(fuState);
    check('ticking items takes them out of the letter', f.letter === renderFollowUp({ ...base, situation: 'partial', requestDate: '2026-01-05', answerDate: '2026-02-02', received: { copy: true, purposes: true } }).text
      && !f.letter.includes('a copy of all the personal data'));
    await p.click('#consultations');
    f = await p.run(fuState);
    check('asking about look-ups in step 4 adds a tenth item, and the ticks stay', f.items.length === 10 && f.items[9]![0] === 'consultations' && f.items[0]![2] && f.items[1]![2], f.items.map((i) => i[0] + (i[2] ? '+' : '')));
    for (const id of ['categories', 'recipients', 'storage', 'source', 'automated', 'transfers', 'rights', 'consultations']) await p.click(`#fu-item-${id}`);
    f = await p.run(fuState);
    check('every item ticked: no letter, and the page says and announces that nothing is missing (K2-3)', f.nothing && !f.wrap && f.letter === ''
      && (await p.until(2000, () => document.getElementById('announcer')!.textContent === 'Nothing is missing, so there is no follow-up to write.')));
    await p.click('#consultations');
    await p.click('#kind-erasure');
    f = await p.run(fuState);
    check('erasure: the checker lists the recipients, what they keep and what they erased, with the already-erased hint', J(f.items.map((i) => i[1])) === J(['Who the recipients are, and whether they were told', 'What they keep, and why', 'What they have erased'])
      && (await p.run(() => !document.getElementById('fu-erased-hint')!.hidden && document.getElementById('fu-item-kept')!.getAttribute('aria-describedby') === 'fu-items-hint fu-erased-hint')), f.items);
    await p.click('#fu-item-kept');
    await p.click('#kind-access');
    f = await p.run(fuState);
    check('back to access: the access ticks are still there, and the erased hint goes', f.items.length === 9 && f.items.every((i) => i[2]) && (await p.run(() => document.getElementById('fu-erased-hint')!.hidden)));
    await p.click('#kind-erasure');
    check('and to erasure again: its own tick is still there', (await p.run(() => (document.getElementById('fu-item-kept')! as HTMLInputElement).checked && !(document.getElementById('fu-item-erased')! as HTMLInputElement).checked)));
    await p.click('#kind-access');

    // A refusal, and the § 16 line.
    await p.click('#fu-refusal');
    f = await p.run(fuState);
    check('refusal: the § 16 tick shows for access to a company in Norway, and nothing ticked is still to fill in', f.s16 && f.missing.includes('what their answer left out'), f.missing);
    await p.click('#fu-ref-16');
    f = await p.run(fuState);
    check('refusal: the § 16 tick adds the § 16 paragraph', f.letter.includes('Under section 16 of the Norwegian Personal Data Act (personopplysningsloven)') && f.missing === '', f.missing);
    await p.click('#based-eea');
    f = await p.run(fuState);
    check('refusal to a company elsewhere in the EEA: no § 16 tick, no § 16 paragraph', !f.s16 && !f.letter.includes('section 16'));
    await p.click('#based-no');

    // An extension told too late.
    await p.click('#fu-extension');
    await p.setDate('#fu-received-date', '2026-10-12');
    await p.setDate('#fu-answer-date', '2026-11-20');
    f = await p.run(fuState);
    check('extension: the page counts the first month from the date it reached them, as a hint, with the pause caveat', f.check === 'Counted from the date it reached them, the first month ended on 12 November 2026, before their message. If they asked about your identity, or asked you to narrow your request, the time may have paused, and their message may still have been in time.', f.check);
    await p.click('#based-eea');
    f = await p.run(fuState);
    check('extension to a company elsewhere: the hint adds that its holidays are not counted', f.check.endsWith('Public holidays in the company\'s country are not taken into account here; check them yourself.'), f.check);
    await p.click('#based-no');
    await p.click('#fu-ext-late');
    f = await p.run(fuState);
    check('extension, told too late: the letter says so with the date it reached them', f.letter.includes('My request reached you on 12 October 2026, and the one-month period had ended before you told me of the extension.'));
    // Switching situation with the dates filled in: the early-reminder warning is read out with the
    // update, not replaced by it (verification of 16 October 2026, N-1).
    await p.setDate('#fu-received-date', TODAY);
    await p.click('#fu-reminder');
    check('a switch to the reminder announces the update and the early warning together', await p.until(2000, () => document.getElementById('announcer')!.textContent.startsWith('Follow-up letter updated. Counted from the date it reached them') && document.getElementById('announcer')!.textContent.includes('A reminder before then may be early.')),
      await p.run(() => document.getElementById('announcer')!.textContent));
    await p.click('#fu-extension');
    await p.setDate('#fu-received-date', '2026-10-12');

    // Bokmål, print, save, share.
    await p.click('#fu-lang-nb');
    f = await p.run(fuState);
    check('Bokmål: the follow-up is the Bokmål text and carries lang="nb"', f.lang === 'nb' && f.letter.startsWith('Eksempel Handel AS') && f.letter.includes('Oppfølging: innsyn i personopplysninger om meg'));
    await browser.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: p.browserContextId });
    await p.click('#fu-print');
    await sleep(50);
    st = await p.run(pageState);
    check('Print the follow-up: the print view gets the follow-up, in its language', st.rec.prints === 1 && st.printText === f.letter && st.printLang === 'nb');
    // A browser that fires beforeprint only after print() has returned still prints the follow-up;
    // after printing, the browser's own print command prints the first letter again (K2-1).
    await p.run(() => window.dispatchEvent(new Event('beforeprint')));
    st = await p.run(pageState);
    check('a late beforeprint still prints the follow-up', st.printText === f.letter);
    await p.run(() => { window.dispatchEvent(new Event('afterprint')); window.dispatchEvent(new Event('beforeprint')); });
    st = await p.run(pageState);
    check('after printing, Ctrl+P prints the first letter', st.printText === st.letter);
    await p.click('#fu-save');
    await p.click('#fu-share');
    await sleep(100);
    st = await p.run(pageState);
    check('Save and Share the follow-up: a neutral file name with the letter\'s date, the letter as text', st.rec.downloads.at(-1) === `follow-up-${TODAY}.txt` && st.rec.share.at(-1)!.text === f.letter, { file: st.rec.downloads.at(-1) });
    await p.click('#fu-copy');
    await sleep(100);
    st = await p.run(pageState);
    check('Copy the follow-up: the letter on the clipboard', st.rec.clipboard.at(-1) === f.letter);

    // Edited, then rebuilt.
    check('an unedited follow-up is described by its hint only (K2-5)', (await p.run(() => document.getElementById('fu-letter')!.getAttribute('aria-describedby'))) === 'fu-letter-hint');
    await p.type('#fu-letter', 'Edited follow-up.');
    await p.type('#company', 'Another Company AS');
    f = await p.run(fuState);
    check('an edited follow-up stays as edited when the form changes, and its description now names the notice', f.edited && f.letter === 'Edited follow-up.'
      && (await p.run(() => document.getElementById('fu-letter')!.getAttribute('aria-describedby'))) === 'fu-letter-hint fu-edited');
    await p.click('#fu-reminder');
    await p.click('#fu-email');
    await sleep(100);
    st = await p.run(pageState);
    f = await p.run(fuState);
    check('an edited extension letter keeps its own subject when the situation changes, and no attachment tip (K2-11)',
      (st.rec.links.at(-1) || '').includes(`subject=${encodeURIComponent('Oppfølging: innsyn i personopplysninger om meg (personvernforordningen artikkel 15)')}`) && !f.attach && !f.status.includes('attach'), { link: st.rec.links.at(-1), attach: f.attach });
    await p.click('#fu-extension');
    await p.click('#fu-rebuild');
    check('Rebuild the follow-up asks first', await p.run(() => document.getElementById('confirm-text')!.textContent.startsWith('Rebuild the letter from the form?')));
    await p.click('#confirm-ok');
    await sleep(100);
    f = await p.run(fuState);
    check('Rebuild: the follow-up comes back from the form, with the new company name', !f.edited && f.letter.startsWith('Another Company AS'));
    await p.type('#company', A.company);

    // The cover note.
    f = await p.run(fuState);
    check('the cover note starts in Bokmål, with the company and the name, and asks for a dated event', f.tlLang === 'nb' && f.tl.startsWith('Tidslinje: anmodning om innsyn i personopplysninger om meg, Eksempel Handel AS') && f.tlMissing.includes('at least one dated event'), f.tlMissing);
    await p.click('#tl-add');
    check('Add an event adds a row and moves focus to its date', (await p.run(() => document.activeElement!.className)) === 'tl-date' && (await p.run(fuState)).tlRows === 1);
    await p.setDate('.tl-row:nth-child(1) .tl-date', '2026-10-12');
    await p.click('.tl-row:nth-child(1) .tl-attach');
    await p.click('#tl-add');
    await p.setDate('.tl-row:nth-child(2) .tl-date', '2026-11-10');
    await p.run(() => { const s = document.querySelector('.tl-row:nth-child(2) .tl-type'); (s! as HTMLInputElement).value = 'partial'; s!.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.type('.tl-row:nth-child(2) .tl-note', 'Ingen mottakere ble navngitt');
    await p.click('.tl-row:nth-child(2) .tl-attach');
    await p.click('#tl-add');
    f = await p.run(fuState);
    const tlIn = { lang: 'nb', noteDate: TODAY, kind: 'access', company: A.company, name: A.name, missingText: '', events: [
      { date: '2026-10-12', type: 'sent', note: '', attach: true }, { date: '2026-11-10', type: 'partial', note: 'Ingen mottakere ble navngitt', attach: true }, { date: '', type: 'sent', note: '', attach: false }] };
    check('the cover note: exactly what src/timeline.js writes, attachments numbered, the undated row left out and the page says so',
      f.tl === renderTimeline(tlIn) && f.tl.includes('(vedlegg 2)') && f.undated && f.tlMissing === '', f.tl);
    await p.type('.tl-row:nth-child(2) .tl-note', '010190 12480');
    f = await p.run(fuState);
    check('a national identity number in an event note shows the warning', f.tlWarn.length === 1 && f.tlWarn[0]!.startsWith('Warning: This looks like a Norwegian national identity number'), f.tlWarn);
    await p.setDate('.tl-row:nth-child(3) .tl-date', '2026-11-20');
    await p.run(() => { const s = document.querySelector('.tl-row:nth-child(3) .tl-type'); (s! as HTMLInputElement).value = 'other'; s!.dispatchEvent(new Event('change', { bubbles: true })); });
    check('a dated "Other" event without a note: left out, and the page says why (K2-2)', (await p.run(() => !document.getElementById('tl-other-empty')!.hidden && document.getElementById('tl-undated')!.hidden)));
    await p.click('.tl-row:nth-child(3) .tl-remove');
    f = await p.run(fuState);
    check('Remove takes the event away', f.tlRows === 2 && !f.undated && (await p.run(() => document.getElementById('tl-other-empty')!.hidden)));
    await p.click('#tl-lang-en');
    f = await p.run(fuState);
    check('the cover note in English carries lang="en-GB"', f.tlLang === 'en-GB' && f.tl.startsWith('Timeline: request for access to my personal data, Eksempel Handel AS'));
    await p.click('#tl-save');
    await p.click('#tl-print');
    await sleep(100);
    st = await p.run(pageState);
    check('Save and Save as PDF of the cover note: a neutral file name, the note in the print view, the line says to choose Save as PDF', st.rec.downloads.at(-1) === `timeline-${TODAY}.txt` && st.printText === f.tl
      && (await p.run(() => document.getElementById('tl-status')!.textContent)) === 'In the print window, choose to save as PDF instead of a printer.', { file: st.rec.downloads.at(-1), status: f.tlStatus });
    await p.shot(join(SHOTS, 'followup-and-timeline-1280.png'));

    // Rebuild when nothing is missing: focus goes to the note that says so (K2-4).
    await p.click('#fu-partial');
    // Earlier checks left every item ticked: untick one so there is a letter to edit.
    if (await p.run(() => (document.getElementById('fu-item-copy')! as HTMLInputElement).checked)) await p.click('#fu-item-copy');
    await p.type('#fu-letter', 'Edited.');
    for (const id of ['copy', 'purposes', 'categories', 'recipients', 'storage', 'source', 'automated', 'transfers', 'rights']) {
      if (!(await p.run((id) => (document.getElementById('fu-item-' + id)! as HTMLInputElement).checked, id))) await p.click(`#fu-item-${id}`);
    }
    await p.click('#fu-rebuild');
    await p.click('#confirm-ok');
    await sleep(150);
    check('Rebuild with nothing missing: focus on the note that says so, and it is announced', (await p.run(() => document.activeElement!.id)) === 'fu-nothing'
      && (await p.until(2000, () => document.getElementById('announcer')!.textContent === 'Nothing is missing, so there is no follow-up to write.')));

    // Clear empties step 9 and the cover note too.
    await p.click('#clear');
    await p.click('#confirm-ok');
    await sleep(100);
    f = await p.run(fuState);
    const dates = await p.run(() => ['fu-request-date', 'fu-received-date', 'fu-answer-date'].map((id) => (document.getElementById(id)! as HTMLInputElement).value));
    const defaults = await p.run(() => { const r = (n: string) => ((document.querySelector('input[name=' + n + ']:checked') || {}) as HTMLInputElement).value || null; return {
      situation: r('fu-situation'), refused: r('fu-refused'), asked: r('fu-asked'), lang: r('fu-lang'), tlLang: r('tl-lang'),
      fuDate: (document.getElementById('fu-date')! as HTMLInputElement).value, tlDate: (document.getElementById('tl-date')! as HTMLInputElement).value, tlMissing: (document.getElementById('tl-missing')! as HTMLInputElement).value,
      ticks: [...document.querySelectorAll('#followup input[type=checkbox], .tl-attach')].filter((c) => (c as HTMLInputElement).checked).map((c) => c.id), items: document.querySelectorAll('.fu-item').length }; });
    check('Clear: no situation, no follow-up, every step 9 and cover-note choice and date back to its default, no events', !f.body && f.letter === '' && dates.every((d) => d === '') && f.tlRows === 0
      && J(defaults) === J({ situation: null, refused: 'all', asked: 'document', lang: 'en', tlLang: 'nb', fuDate: TODAY, tlDate: TODAY, tlMissing: '', ticks: [], items: 9 }), { dates, defaults });
    check('stage 2: no errors, no policy violations and no requests to other sites', p.log.errors.length === 0 && p.log.csp.length === 0 && p.log.offsite.length === 0 && (await p.run(() => window.__csp.length)) === 0,
      { errors: p.log.errors, csp: p.log.csp, offsite: p.log.offsite });
  }

  // Share hidden, Copy refused
  {
    const p = await open({ width: 390, height: 844, stub: { share: false, clipboard: 'deny' } });
    let st = await p.run(pageState);
    check('without navigator.share the Share button stays hidden', !st.shareShown);
    await p.click('#copy-letter');
    await sleep(100);
    st = await p.run(pageState);
    const sel = await p.run(() => { const t = document.getElementById('letter'); return document.activeElement === t && (t! as HTMLInputElement).selectionStart === 0 && (t! as HTMLInputElement).selectionEnd === (t! as HTMLInputElement).value.length; });
    check('a browser that refuses copying: the letter is selected and the status says what to press', sel && st.status.startsWith('Your browser did not allow copying. The letter is selected'), st.status);
    await p.shot(join(SHOTS, 'page-390-access.png'));
  }

  // The privacy page and the disclaimer
  for (const path of ['privacy.html', 'disclaimer.html']) {
    for (const [w, h] of [[1280, 900], [320, 640]]) {
      for (const scheme of ['dark', 'light']) {
        const p = await open({ width: w, height: h, gate: 'keep' }, path);
        await p.s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await sleep(150);
        const l = await p.run(legalState);
        const ok = l.scripts === 0 && l.styleElements === 0 && l.styleAttrs === 0 && l.sheetsLoaded >= 2 && l.sw <= l.vw + 1 && !l.gate && l.back === './'
          && /Inter/.test(l.bodyFont!) && (path === 'disclaimer.html' || (l.csp === PAGE_CSP && l.updated === 'Last updated: 30 October 2026'));
        // The generated disclaimer page names no icon, so the browser asks for /favicon.ico, which
        // the site does not have (a 404, as on every Labs app's disclaimer page). Nothing else may fail.
        const errors = p.log.errors.filter((e) => !(/status of 404/.test(e) && path === 'disclaimer.html' && p.log.requests.some((r) => r.url.endsWith('/favicon.ico'))));
        check(`${path} at ${w}, ${scheme}: its own style sheets, no script, no inline style, no notice, no sideways scrolling`, ok && p.log.csp.length === 0 && errors.length === 0,
          { ...l, text: undefined, csp: l.csp, logcsp: p.log.csp, errors });
        if (scheme === 'light' && path === 'disclaimer.html') check(`${path} at ${w}: follows the light scheme`, l.bodyBg === 'rgb(251, 250, 247)', l.bodyBg);
        if (w === 320) await p.shot(join(SHOTS, `${path.replace('.html', '')}-320-${scheme}.png`));
      }
    }
  }
} catch (err) {
  const e = err as { stack?: string } | null;
  check('the run finished', false, String(e && e.stack || err));
} finally {
  for (const p of pages) await p.close().catch(() => {});
  await browser.close();
  server.kill();
}

console.log(`\n${passes} passed, ${failures} failed. Screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
