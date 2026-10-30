// What 0.0.1 adds around the app, checked statically (CheckLink's stage5-release.test.mjs, adapted):
//   * the first-run notice (gate.js and gate.css from build-gates.py, dismissible tier) and its
//     wiring;
//   * DISCLAIMER.md, with disclaimer.html and disclaimer.css from build-disclaimers.py;
//   * the generators' GDPRLetterBuilder output, pinned by hash, and regenerated and compared byte
//     for byte when the generators are beside this repository (the GitHub folder);
//   * privacy.html (the page's own policy, no scripts), the footer and the carousel;
//   * og-image.png.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE, PAGE_CSP, copyProblems, htmlText, metaCsp } from './legal-pages.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const GITHUB = dirname(ROOT);
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const bytes = (rel: string): Buffer => readFileSync(join(ROOT, rel));
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const python = spawnSync('python3', ['--version']).status === 0;
const GATES_PY = join(GITHUB, 'build-gates.py');
const DISCLAIMERS_PY = join(GITHUB, 'build-disclaimers.py');
const generators = python && existsSync(GATES_PY) && existsSync(DISCLAIMERS_PY);

function py(script: string, ...args: string[]): string {
  const r = spawnSync('python3', ['-B', '-c', script, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const IMPORT = (path: string, name: string): string => `import importlib.util, sys\nspec = importlib.util.spec_from_file_location(${JSON.stringify(name)}, ${JSON.stringify(path)})\nm = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\n`;

// The notice's words as gate.js carries them, markup taken out.
function gateWords() {
  const js = read('gate.js');
  const unq = (s: string): string => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const strip = (s: string): string => unq(s).replace(/<[^>]+>/g, '');
  return {
    title: strip(js.match(/<h2 class="sb-gate-title" id="' \+ TITLE_ID \+ '">(.*?)<\/h2>/)![1]!),
    paragraphs: [...js.matchAll(/^ {4}'<p>(.*)<\/p>',$/gm)].map((m) => strip(m[1]!)),
    ack: strip(js.match(/<p class="sb-gate-ack">(.*?)<\/p>/)![1]!),
    button: strip(js.match(/<button type="button" class="sb-gate-btn">(.*?)<\/button>/)![1]!),
    link: strip(js.match(/<a class="sb-gate-link" href="disclaimer\.html">(.*?)<\/a>/)![1]!),
    linkHref: 'disclaimer.html',
  };
}

// The first-run notice

test('the first-run notice: GDPRLetterBuilder\'s, dismissible, version 2, its words pinned word for word', () => {
  const js = read('gate.js');
  assert.match(js, /^\/\* =+\n {3}STORMBERRY FIRST-RUN GATE \(behaviour\)\n {3}GDPRLetterBuilder, dismissible tier\.\n\n {3}GENERATED FILE\./);
  assert.match(js, /var APP_ID = 'gdprletterbuilder';\n  var VERSION = '2';\n  var MANDATORY = false;/);
  assert.equal(GATE.key, 'sb-gate:gdprletterbuilder:v2');
  const w = gateWords();
  assert.deepEqual(w.paragraphs, GATE.paragraphs);
  assert.equal(w.title, GATE.title);
  assert.equal(w.ack, GATE.ack);
  assert.equal(w.button, GATE.button);
  assert.equal(w.link, GATE.link);
  assert.match(js, /window\.localStorage\.setItem\(STORE_KEY, new Date\(\)\.toISOString\(\)\);/);
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|document\.cookie|eval\(|new Function|\.style\./.test(js));
  assert.deepEqual(copyProblems([GATE.title, ...GATE.paragraphs, GATE.ack].join('\n')), []);
  // Its own acknowledgement, not the shared one about figures.
  assert.ok(!GATE.ack.includes('figures'));
});

test('the first-run notice: gate.css takes the app\'s own tokens, and every token it uses exists in style.css', () => {
  const css = read('gate.css');
  assert.match(css, /--sb-gate-accent: {4}var\(--accent-primary\);\n {2}--sb-gate-accent-bg: var\(--grad-primary\);\n {2}--sb-gate-anim: {6}var\(--t-slow\);\n {2}--sb-gate-btn-fg: {4}var\(--on-accent\);/);
  const style = read('style.css');
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!).filter((t) => !t.startsWith('--sb-gate')));
  for (const t of used) assert.ok(new RegExp(`\\n\\s+${t}:`).test(style), `${t} is not defined in style.css`);
  // CheckLink's addition, copied: the notice scrolls when it is taller than the screen (200% text).
  assert.match(style, /html \.sb-gate-overlay \{\n {2}overflow-y: auto;\n {2}align-items: safe center;\n\}/);
});

test('the first-run notice is wired into index.html after the style sheet, stamped, deferred, before the app', () => {
  const html = read('index.html');
  const css = html.match(/<link rel="stylesheet" href="gate\.css\?v=([0-9a-f]{8})" \/>/);
  const js = html.match(/<script src="gate\.js\?v=([0-9a-f]{8})" defer><\/script>/);
  assert.ok(css && js, 'gate.css and gate.js are linked with their stamps');
  assert.equal(css[1], sha256(bytes('gate.css')).slice(0, 8));
  assert.equal(js[1], sha256(bytes('gate.js')).slice(0, 8));
  assert.ok(html.indexOf('href="style.css?v=') < html.indexOf('href="gate.css?v=') && html.indexOf('src="gate.js?v=') < html.indexOf('<script type="module" src="app.js'));
  assert.equal(html.indexOf('<script'), html.indexOf('<script src="gate.js'));
});

// The disclaimer

test('DISCLAIMER.md: the shared framing, and GDPRLetterBuilder\'s own section (spec section 10, LEGAL-2)', () => {
  const md = read('DISCLAIMER.md');
  assert.match(md, /^# Disclaimer and terms of use\n\n\*\*Applies to this application and to every application published by Stormberry AS\.\*\*\n\n## What this is\n\nThis is a \*\*functioning prototype\*\*/);
  const own = md.slice(md.indexOf('## Specific to GDPRLetterBuilder'), md.indexOf('## No warranty'));
  const paras = own.split('\n\n').slice(1).map((p) => p.trim()).filter(Boolean);
  assert.equal(paras.length, 6);
  assert.ok(paras[0]!.startsWith('GDPRLetterBuilder gives **information, not legal advice**.'));
  assert.ok(paras[5]!.startsWith('The app is meant for your own requests, one letter at a time.'));
  // Prose only: the generator renders no lists or tables.
  assert.ok(!/^\s*([-*] |\d+\. |\|)/m.test(own));
  // The spec's draft, word for word, when the spec is beside this repository.
  const spec = join(dirname(GITHUB), 'LabsIdeas', 'GDPR Letter Builder - spec 2026-10-12.md');
  if (existsSync(spec)) {
    const s = readFileSync(spec, 'utf8');
    const draft = s.slice(s.indexOf('> GDPRLetterBuilder gives'), s.indexOf('\n\nThe last paragraph squares'));
    const fromSpec = draft.split('\n>\n').map((p) => p.replace(/^> /, '').trim());
    assert.deepEqual(paras, fromSpec);
  }
  // The shared sections are the template's, word for word.
  for (const sib of ['MetadataScrubber', 'CheckLink']) {
    const template = join(GITHUB, sib, 'DISCLAIMER.md');
    if (!existsSync(template)) continue;
    const strip = (t: string): string => t.replace(/## Specific to [\s\S]*?(?=## No warranty)/, '');
    assert.equal(strip(md), strip(readFileSync(template, 'utf8')), sib);
  }
});

// Pinned output of the shared generators for GDPRLetterBuilder, so a change to them shows up here
// even where the generators are not at hand (a clone of the public repository).
const PINNED = {
  'gate.js': 'c2604ccb6e5ac524327af705cb49fce43131b2e2505fb50c33cd823e78655d78',
  'gate.css': '512ef19b8551096f1821f0edef5e241fb9c6dca3f85eead5994cbefe17f105df',
  'disclaimer.css': '14d0ec8be6482608350697244ba5e86255478a1d93170897015685f06697d159',
  'disclaimer.html': 'fa1845551e9fcf15dcc2caa9c40c6817d4bc28b9b5172c513b17ee4d10a3a17f',
};

test('the generators\' GDPRLetterBuilder output is pinned by hash', () => {
  for (const [f, h] of Object.entries(PINNED)) assert.equal(sha256(bytes(f)), h, `${f} changed: run the generators, check the change, and pin the new hash`);
  // disclaimer.css is CheckLink's, byte for byte: the generator writes the same style block for both.
  const cl = join(GITHUB, 'CheckLink', 'disclaimer.css');
  if (existsSync(cl)) assert.ok(bytes('disclaimer.css').equals(readFileSync(cl)));
});

test('disclaimer.html: rendered from DISCLAIMER.md, with its style sheet beside it instead of a style block', () => {
  const html = read('disclaimer.html');
  assert.ok(!/<style|style=|<script/i.test(html));
  const link = html.match(/<link rel="stylesheet" href="disclaimer\.css\?v=([0-9a-f]{8})" \/>/);
  assert.ok(link);
  assert.equal(link[1], sha256(bytes('disclaimer.css')).slice(0, 8));
  assert.match(html, /<a class="back" href="\.\/">&larr; Back to GDPRLetterBuilder<\/a>/);
  assert.match(html, /<a href="privacy\.html">Privacy<\/a><\/footer>/);
  assert.match(html, /<title>Disclaimer and terms of use &middot; GDPRLetterBuilder &middot; Stormberry AS<\/title>/);
  assert.match(html, /<h2>Specific to GDPRLetterBuilder<\/h2>\n<p>GDPRLetterBuilder gives <strong>information, not legal advice<\/strong>\./);
});

test('the generators, run here, write exactly the GDPRLetterBuilder files in this repository', { skip: !generators && 'build-gates.py and build-disclaimers.py are not beside this repository' }, () => {
  const out = py(`${IMPORT(GATES_PY, 'gates')}app = [a for a in m.APPS if a["dir"] == "GDPRLetterBuilder"][0]\nsys.stdout.write(m.render_js(app) + "\\x00" + m.render_css(app))`);
  const [js, css] = out.split('\0');
  assert.equal(js, read('gate.js'));
  assert.equal(css, read('gate.css'));
  const page = py(`${IMPORT(DISCLAIMERS_PY, 'disclaimers')}import os
md = open(sys.argv[1], encoding="utf-8").read()
assert m.NEW_WHAT in md
assert "GDPRLetterBuilder" in m.APPS and "GDPRLetterBuilder" in m.EXTERNAL_STYLE
page = m.PAGE.replace("@@BODY@@", m.to_html(md)).replace("@@APP@@", "GDPRLetterBuilder")
page = page.replace('<a href="https://stormberry.as/privacy.html">Privacy</a></footer>', '<a href="privacy.html">Privacy</a></footer>', 1)
assert os.path.exists(os.path.join(os.path.dirname(sys.argv[1]), "apple-touch-icon.png"))
page = page.replace(m.TITLE_END, m.TITLE_END + m.TOUCH_ICON, 1)
page, css = m.split_style(page)
sys.stdout.write(page + "\\x00" + css)`, join(ROOT, 'DISCLAIMER.md'));
  const [html, dcss] = page.split('\0');
  assert.equal(html, read('disclaimer.html'));
  assert.equal(dcss, read('disclaimer.css'));
  // The generators list the app where the spec says: APPS alphabetically after EcoCompass.
  const order = py(`${IMPORT(DISCLAIMERS_PY, 'disclaimers')}sys.stdout.write(",".join(m.APPS))`).split(',');
  assert.equal(order[order.indexOf('EcoCompass') + 1], 'GDPRLetterBuilder');
  assert.deepEqual([...order].sort((a, b) => a.localeCompare(b, 'en')), order);
});

// The privacy page

test('privacy.html: the page\'s own policy word for word, no scripts, no inline styles, the site\'s style sheets', () => {
  const html = read('privacy.html');
  assert.equal(metaCsp(html), PAGE_CSP);
  assert.equal(metaCsp(html), metaCsp(read('index.html')));
  assert.ok(!/<script|<style|\sstyle=|\son[a-z]+=/i.test(html.replace(/<!--[\s\S]*?-->/g, '')));
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)\?v=([0-9a-f]{8})" \/>/g)].map((m): [string, string] => [m[1]!, m[2]!]);
  assert.deepEqual(sheets.map((s) => s[0]), ['fonts/inter/inter.css', 'style.css']);
  for (const [f, v] of sheets) assert.equal(v, sha256(bytes(f)).slice(0, 8), `${f} stamp`);
});

test('privacy.html covers spec section 9: on the device, the outputs, the reminder, the one flag, links, hosting, rights, a date', () => {
  const text = htmlText(read('privacy.html'));
  for (const part of [
    'Stormberry AS', 'organisation number NO 937 751 249', 'info@stormberry.as',
    'Nothing you type is sent anywhere, to us or to anyone else', 'there is no company search and no address lookup',
    'blocks every connection its code could open and every form submission', 'disconnect from the internet and use it',
    'Copy letter', 'clipboard history', 'Send using email app', 'nothing is sent until you press Send there', 'with that address as Cc', 'Save as PDF',
    'Save as text file', 'never after the company', 'Share',
    'Save a reminder', 'It never holds your name, your contact details, the details that help the company find you, or your letter',
    'keeps nothing you type, and no history', 'Reloading or closing the page empties every field',
    'when you close the first-run notice, your browser stores the date and time in its local storage',
    'Every field on the page is marked so that browsers do not save or fill in what you type',
    'Firefox, with its standard settings, keeps the options you tick or choose on the page in its own session-restore file',
    'the page puts the options back to their defaults when a browser restores them as the page opens', 'Other browsers may behave differently',
    'EUR-Lex, Lovdata', 'open in a new tab only when you press them', 'GitHub (GitHub Pages) and delivered through Cloudflare',
    'They never see what you type', 'Norwegian Data Protection Authority (Datatilsynet', 'Norwegian Personal Data Act (personopplysningsloven)',
    'a follow-up letter and the cover note', '"follow-up" or "timeline"', 'no history of letters, follow-ups, events or companies',
    'Last updated: 30 October 2026',
  ]) assert.ok(text.includes(part), `privacy.html does not say: ${part}`);
  assert.deepEqual(copyProblems(text), []);
});

test('privacy.html: Back to GDPRLetterBuilder, the same footer as the page, Privacy marked as the current page', () => {
  const html = read('privacy.html');
  assert.match(html, /<a class="pp-back" href="\.\/">&larr; Back to GDPRLetterBuilder<\/a>/);
  assert.match(html, /<a href="privacy\.html" aria-current="page">Privacy<\/a> &middot; <a href="disclaimer\.html">Disclaimer<\/a><\/p>/);
  const footer = (t: string): string => t.slice(t.indexOf('<footer class="site-footer">'), t.indexOf('</footer>'));
  assert.equal(footer(html).replace(' aria-current="page"', ''), footer(read('index.html')));
});

test('the footer of index.html: the canonical lines, this app\'s own powered-by and offline lines, the law date, Privacy and Disclaimer once each', () => {
  const html = read('index.html');
  assert.match(html, /· Askøy, Norway · <a href="privacy\.html">Privacy<\/a> &middot; <a href="disclaimer\.html">Disclaimer<\/a><\/p>/);
  assert.equal([...html.matchAll(/href="privacy\.html"/g)].length, 1);
  assert.equal([...html.matchAll(/href="disclaimer\.html"/g)].length, 1);
  const footer = html.slice(html.indexOf('<footer class="site-footer">'), html.indexOf('</footer>'));
  const cl = join(GITHUB, 'CheckLink', 'index.html');
  if (existsSync(cl)) {
    // CheckLink's footer, with only this app's lines changed.
    const c = readFileSync(cl, 'utf8');
    const cf = c.slice(c.indexOf('<footer class="site-footer">'), c.indexOf('</footer>'));
    const norm = (f: string): string => f.replace(/<!--[\s\S]*?-->\n\s*/g, '').replace(/<p>Runs entirely[\s\S]*?<\/p>/, '').replace(/<p class="footer-offline">[^<]*<\/p>/, '')
      .replace(/\n\s*<p class="footer-(rules|law)"[^\n]*<\/p>/g, '');
    assert.equal(norm(footer), norm(cf));
  }
  assert.match(footer, /<p class="footer-law" id="law-date">Law and guidance checked on 12 October 2026\.<\/p>\n {6}<p class="footer-ai">Proudly powered by sovereign AI agents\.<\/p>/);
});

test('the carousel: 21 cards in ten sets in the 2026-10-15 order (Labs, MetadataScrubber, CheckLink, UsernameGenerator, SunApp, MoonApp, ServiceScheduler, the rest), this app last and current, the copies out of reach', () => {
  const html = read('index.html');
  const cards = [...html.matchAll(/<a href="([^"]+)" class="switcher-card"([^>]*)><img src="\/switcher-icons\/(\w+)\.svg" alt="" width="32" height="32"> <span>([^<]+)<\/span><\/a>/g)];
  assert.equal(cards.length, 210);
  const first = cards.slice(0, 21).map((m) => m[3]);
  assert.deepEqual(first, ['labs', 'metadata', 'check', 'username', 'sun', 'moon', 'eclipse', 'scheduler', 'photo', 'garden', 'planet', 'star', 'tide', 'astro', 'beer', 'flare', 'meteor', 'nightmode', 'weather', 'eco', 'gdpr']);
  cards.forEach((m, i) => {
    assert.equal(m[3], first[i % 21]);
    assert.equal(/aria-current="page"/.test(m[2]!), m[3] === 'gdpr', `card ${i}`);
    assert.equal(/aria-hidden="true" tabindex="-1"/.test(m[2]!), i >= 21, `card ${i}`);
  });
  assert.ok(cards.find((m) => m[3] === 'gdpr')?.[1] === 'https://gdpr.stormberry.as' && cards.find((m) => m[3] === 'gdpr')?.[4] === 'GDPRLetterBuilder');
  assert.match(html, /<h2 class="switcher-title" id="switcher-title">Explore the Stormberry Ecosystem<\/h2>\n {4}<input type="checkbox" id="switcher-pause" class="switcher-pause"><label for="switcher-pause" class="switcher-pause-label">Pause the animation<\/label>/);
  assert.match(read('style.css'), /100% \{ transform: translateX\(-10%\); \}/);
});

test('og-image.png is 1200 by 630, and the page names it for link previews', () => {
  const png = bytes('og-image.png');
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 400000, `${png.length} bytes`);
  assert.match(read('index.html'), /<meta property="og:image" content="https:\/\/gdpr\.stormberry\.as\/og-image\.png" \/>/);
});

test('README.md: information, not legal advice; the 0.0.1 status and the pinned certificate', () => {
  const md = read('README.md');
  assert.ok(md.startsWith('# GDPRLetterBuilder\n\n**Information, not legal advice.**'));
  assert.match(md, /\*\*0\.0\.1, the first release, 30 October 2026\.\*\* The web app is at \[gdpr\.stormberry\.as\]\(https:\/\/gdpr\.stormberry\.as\)/);
  assert.match(md, /\*\*Signing certificate SHA-256:\*\* `8287710abd10fc1d37615299bd11c3e79306545ecc3e1b968010da54a80424e2`/);
  assert.ok(!/not created yet/i.test(md));
  // The Google Play edition (30 October 2026): named as a separate package, built from the same source.
  assert.match(md, /\n### Google Play edition\n\nThe same source also builds a Google Play edition, a separate package, `no\.stormberry\.gdprletterbuilder\.play`, with the same features/);
  assert.ok(read('CNAME') === 'gdpr.stormberry.as\n');
});
