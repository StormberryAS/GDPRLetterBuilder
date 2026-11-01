// Static checks (spec sections 9, 10, 12 and 13): no network code, no address-bar reads, no storage
// but the generated notice's flag, no form; the page's policy first in head, no inline script or
// style; outside links that open a new tab do so safely; the published and the excluded files;
// the stamps; the law date; the manifest of files; and the TypeScript rule (guards S-1, S-2, S-3 of
// 29 October 2026): the only JavaScript is what tools/build-ts.sh compiles (gate.js too, since
// 0.0.2), the browser is driven by typed functions, and the tooling is pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAW_CHECKED } from '#src/citations.js';
import { PAGE_CSP, metaCsp } from './legal-pages.ts';
import { CASES as FOLLOWUP_CASES } from './followup-cases.ts';

const FOLLOWUP_GOLDENS = FOLLOWUP_CASES.length;

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const GITHUB = dirname(ROOT);
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const bytes = (rel: string): Buffer => readFileSync(join(ROOT, rel));
// The page's own scripts as they ship: the compiled app.js and src/*.js, comments taken out.
const code = (): Array<[string, string]> => ['app.js', ...readdirSync(join(ROOT, 'src')).map((f) => `src/${f}`)].map((f): [string, string] => [f, read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')]);

test('no network code anywhere in the page\'s own scripts', () => {
  for (const [f, src] of code()) {
    for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /importScripts/, /new\s+Worker/, /\beval\s*\(/, /new\s+Function/, /\bimport\s*\(/, /WebAssembly/, /serviceWorker/, /RTCPeerConnection/]) {
      assert.ok(!bad.test(src), `${f}: ${bad}`);
    }
  }
});

test('the address bar is never read (PRIV-2), and nothing is stored but the notice\'s flag (PRIV-1)', () => {
  for (const [f, src] of code()) {
    assert.ok(!/location\.(search|hash|href)|document\.URL|URLSearchParams|document\.referrer/.test(src), `${f} reads the address`);
    assert.ok(!/localStorage|sessionStorage|indexedDB|caches\.|document\.cookie|cookieStore/.test(src), `${f} touches storage`);
  }
  // gate.js (compiled from ts/gate.ts, which build-gates.py writes) stores its one flag and nothing else.
  const gate = read('gate.js');
  assert.equal([...gate.matchAll(/localStorage\.(\w+)/g)].map((m) => m[1]).sort().join(), 'getItem,setItem');
  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(gate));
});

test('no form element (PRIV-3); autocomplete="off" on every field the person types into, their own name, email and address included', () => {
  for (const f of ['index.html', 'privacy.html', 'disclaimer.html']) assert.ok(!/<form\b/i.test(read(f)), f);
  const html = read('index.html');
  const ac = [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => m[0]);
  // No field asks the browser to fill it in: Firefox keeps such fields in its session-restore file
  // and brings them back after a crash (code review of 12 October 2026).
  assert.deepEqual(ac.filter((t) => /autocomplete="(?!off")/.test(t)), []);
  const typed = ac.filter((x) => /type="(text|email|date)"|<textarea/.test(x));
  // 13 in stage 1; stage 2 adds step 9's four dates and its letter, and the cover note's date,
  // its event row's date and note, what is missing and the note itself (FU-11).
  assert.equal(typed.length, 23, String(typed.length));
  for (const t of typed) {
    assert.match(t, /autocomplete="off"/, t);
    if (/type="date"/.test(t)) continue;
    // No spell checking anywhere: a browser's enhanced spell check can send what is typed to an
    // online service (Chromium's sends it to Google when the person has turned it on).
    assert.match(t, /spellcheck="false"/, t);
  }
  // The deadline's two dates stop where the count still works (the extension must end by 2199).
  for (const id of ['posted', 'received', 'fu-request-date', 'fu-received-date', 'fu-answer-date']) assert.match(ac.find((t) => t.includes(`id="${id}"`)) ?? '', /min="1900-01-01" max="2199-09-30"/, id);
  assert.match(ac.find((t) => t.includes('class="tl-date"')) ?? '', /min="1900-01-01" max="2199-09-30"/);
});

test('the policy is the spec\'s, the first element in head, the same on the privacy page; no inline script or style anywhere', () => {
  for (const f of ['index.html', 'privacy.html']) {
    const html = read(f);
    assert.equal(metaCsp(html), PAGE_CSP, f);
    assert.ok(html.indexOf('<meta http-equiv="Content-Security-Policy"') < html.indexOf('<meta charset'), `${f}: policy first`);
    // A comment is not an element: the page's verse comes first, then the policy.
    assert.match(html, /<head>\n(?: {2}<!--[\s\S]*?-->\n)? {2}<meta http-equiv="Content-Security-Policy"/, f);
    assert.match(html, /<meta name="referrer" content="no-referrer" \/>/, f);
    const bare = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/<style|\sstyle=|\son[a-z]+=|javascript:/i.test(bare), `${f}: inline style or handler`);
    for (const m of bare.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.match(m[1]!, /\bsrc="/, `${f}: an inline script`);
      assert.equal(m[2]!.trim(), '', `${f}: script with content`);
    }
  }
  assert.ok(!/<script/i.test(read('privacy.html')), 'the privacy page has no script at all');
  assert.ok(!/<script|<style|\sstyle=/i.test(read('disclaimer.html')), 'the disclaimer has no script and no style block');
  // No data: images and no workers: nothing in the policy allows them, and nothing needs them.
  assert.ok(!/data:image/.test(read('index.html') + read('style.css')));
});

test('every link that opens a new tab has rel noopener, and every link to another site noreferrer too', () => {
  for (const f of ['index.html', 'privacy.html']) {
    for (const m of read(f).matchAll(/<a\b[^>]*>/g)) {
      const a = m[0];
      if (/target="_blank"/.test(a)) assert.match(a, /rel="[^"]*noopener/, `${f}: ${a}`);
      const href = (a.match(/href="([^"]+)"/) || [])[1] || '';
      if (/^https?:/.test(href) && !/^https:\/\/([a-z]+\.)?stormberry\.as/.test(href) && !/^http:\/\/stormberry\w+\.onion/.test(href)) {
        assert.match(a, /rel="[^"]*noreferrer/, `${f}: ${a}`);
      }
    }
  }
});

test('no http: link except the onion address; no link to a tracker or a font service', () => {
  const html = read('index.html') + read('privacy.html');
  for (const m of html.matchAll(/href="(http:[^"]+)"/g)) assert.match(m[1]!, /^http:\/\/stormberry\w+\.onion$/);
  assert.ok(!/googleapis|gstatic|googletagmanager|google-analytics|doubleclick|facebook\.net|cdn\.|unpkg|jsdelivr/.test(html));
});

test('_config.yml: the repository-only files are excluded, src/ and the legal pages are published', () => {
  const cfg = read('_config.yml');
  const ex = [...cfg.matchAll(/^ {2}- (.+)$/gm)].map((m) => m[1]!);
  // The TypeScript sources and the compiler's files are excluded (29 October 2026); the compiled
  // app.js, src/*.js and gate.js are published. CHANGELOG.md is a repository file (0.0.2).
  assert.deepEqual(ex, ['LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'DISCLAIMER.md', 'bump_assets.py', 'tools/', 'tests/', 'package.json', 'package-lock.json', '.npmrc', 'node_modules/', 'tsconfig.json', 'tsconfig.src.json', 'ts/', 'android/', 'fastlane/', 'zapstore.yaml']);
  for (const gone of ['jsconfig.json', 'types/']) assert.ok(!ex.includes(gone), `${gone} no longer exists`);
  for (const kept of ['src', 'privacy.html', 'disclaimer.html', 'disclaimer.css', 'gate.js', 'gate.css', 'og-image.png', 'licences', 'fonts', 'switcher-icons', 'favicon.svg']) {
    assert.ok(!ex.some((e) => e.replace(/\/$/, '') === kept), kept);
    // The safe test of 2026-09-05: a name the site's JavaScript or pages use must never be excluded.
  }
  const site = read('index.html') + read('app.js');
  for (const e of ex) assert.ok(!site.includes(`"${e}`) && !site.includes(`'./${e}`), `${e} is used by the site`);
});

test('bump_assets.py --check: every stamp is current', () => {
  const r = spawnSync('python3', ['-B', join(ROOT, 'bump_assets.py'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Every local script and style sheet the pages load is stamped.
  for (const f of ['index.html', 'privacy.html']) {
    for (const m of read(f).matchAll(/(?:src|href)="([^"/:][^":]*\.(?:js|css))(\?v=[0-9a-f]{8})?"/g)) assert.ok(m[2], `${f}: ${m[1]} is not stamped`);
  }
  // Every import in the compiled modules carries its stamp: app.js and src/*.js alike (the
  // TypeScript imports carry none; bump_assets.py writes them into the compiled files).
  for (const f of ['app.js', ...readdirSync(join(ROOT, 'src')).map((n) => `src/${n}`)]) {
    for (const m of read(f).matchAll(/from '(\.{1,2}\/[^']+)'/g)) assert.match(m[1]!, /\?v=[0-9a-f]{8}$/, `${f}: ${m[1]}`);
  }
  for (const f of ['ts/app.ts', ...readdirSync(join(ROOT, 'ts', 'src')).map((n) => `ts/src/${n}`)]) assert.ok(!/\?v=/.test(read(f)), `${f} carries no stamp`);
});

test('the law date: on the page, in the code and in the disclaimer, and not older than 180 days (LEGAL-3)', () => {
  assert.equal(LAW_CHECKED, '2026-10-12');
  assert.ok(read('index.html').includes('Law and guidance checked on 12 October 2026.'));
  assert.ok(read('DISCLAIMER.md').includes('checked against the sources listed in the app on 12 October 2026'));
  const age = (Date.now() - Date.parse(`${LAW_CHECKED}T00:00:00Z`)) / 86400000;
  assert.ok(age <= 180, `the law was checked ${Math.floor(age)} days ago: check the letters and the guides against current law and guidance, then move LAW_CHECKED and the page's date`);
});

test('LICENSE is the MIT licence, Stormberry AS, nothing appended; NOTICE names Inter; the typeface\'s licence is shipped', () => {
  const lic = read('LICENSE');
  assert.match(lic, /^MIT License\n\nCopyright \(c\) 2026 Stormberry AS\n\nPermission is hereby granted/);
  assert.ok(lic.trimEnd().endsWith('OTHER DEALINGS IN THE\nSOFTWARE.'));
  assert.match(read('NOTICE'), /GDPRLetterBuilder ships no third-party code/);
  assert.match(read('NOTICE'), /Inter \(fonts\/inter\/\)\n {2}Licence: {3}SIL Open Font License 1\.1/);
  assert.match(read('licences/Inter-OFL-1.1.txt'), /SIL OPEN FONT LICENSE Version 1\.1/);
  const sibling = join(GITHUB, 'CheckLink', 'LICENSE');
  if (existsSync(sibling)) assert.ok(bytes('LICENSE').equals(readFileSync(sibling)));
});

test('the shared files are byte copies of the siblings\' (fonts, carousel icons, robots.txt)', { skip: !existsSync(join(GITHUB, 'MetadataScrubber')) && 'the siblings are not beside this repository' }, () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  for (const f of walk(join(ROOT, 'fonts'))) {
    const rel = relative(ROOT, f);
    assert.ok(readFileSync(f).equals(readFileSync(join(GITHUB, 'MetadataScrubber', rel))), rel);
  }
  for (const f of readdirSync(join(ROOT, 'switcher-icons'))) {
    if (f === 'gdpr.svg') continue;
    assert.ok(bytes(`switcher-icons/${f}`).equals(readFileSync(join(GITHUB, 'CheckLink', 'switcher-icons', f))), f);
  }
  assert.ok(bytes('switcher-icons/gdpr.svg').equals(bytes('favicon.svg')), 'the carousel card is the favicon');
  assert.ok(bytes('robots.txt').equals(readFileSync(join(GITHUB, 'CheckLink', 'robots.txt'))));
  assert.ok(bytes('licences/Inter-OFL-1.1.txt').equals(readFileSync(join(GITHUB, 'CheckLink', 'licences', 'Inter-OFL-1.1.txt'))));
});

test('the favicon is ICON-1 draft C, the launcher\'s drawing, with no tick, scales or emblem', () => {
  const svg = read('favicon.svg');
  assert.match(svg, /ICON-1 draft C, "Data about you", chosen by Marcos on\s+16 October 2026/);
  assert.ok(!/<script|href=|xlink/.test(svg));
  // The same shapes as android/tools/launcher-icon.svg, only the comment differs (29 October 2026).
  const shapes = (s: string): string => s.replace(/<!--[\s\S]*?-->\n?/g, '');
  assert.equal(shapes(svg), shapes(read('android/tools/launcher-icon.svg')));
  assert.match(read('index.html'), /og-image\.png \(1200x630\) shows the icon, ICON-1 draft C; its layout is PROVISIONAL\./);
  // The Home Screen icon for iPhone and iPad, linked relatively from every page (the estate's rule of 21 October 2026).
  const png = bytes('apple-touch-icon.png');
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
  for (const f of ['index.html', 'privacy.html', 'disclaimer.html']) assert.equal(read(f).split('<link rel="apple-touch-icon" href="apple-touch-icon.png" />').length, 2, f);
});

// The manifest: exactly these files make up the repository (the browser suites' outputs go to
// --out folders outside it, the Android build's to the folders android/.gitignore names). A new
// file must be added here on purpose.
const MANIFEST = [
  '.gitignore', 'CHANGELOG.md', 'CNAME', 'DISCLAIMER.md', 'LICENSE', 'NOTICE', 'README.md', '_config.yml', 'app.js', 'bump_assets.py',
  'apple-touch-icon.png', 'disclaimer.css', 'disclaimer.html', 'favicon.svg', 'gate.css', 'gate.js', 'index.html', 'licences/Inter-OFL-1.1.txt',
  'og-image.png', 'privacy.html', 'robots.txt', 'style.css',
  'src/citations.js', 'src/deadline.js', 'src/followups.js', 'src/format.js', 'src/holidays-no.js', 'src/ics.js', 'src/letters.js', 'src/mailto.js', 'src/personal-data.js', 'src/timeline.js',
  'tests/cdp.ts', 'tests/citations.test.ts', 'tests/copy.test.ts', 'tests/deadline-oracle.test.ts', 'tests/deadline.test.ts', 'tests/e2e.ts', 'tests/followup-cases.ts', 'tests/followups.test.ts', 'tests/golden-cases.ts', 'tests/ics.test.ts',
  'tests/helpers.ts', 'tests/legal-pages.ts', 'tests/letters.test.ts', 'tests/librewolf-smoke.ts', 'tests/mailto.test.ts', 'tests/personal-data.test.ts',
  'tests/release.test.ts', 'tests/serve.py', 'tests/share-stub.ts', 'tests/spec-wording.test.ts', 'tests/static.test.ts', 'tests/timeline.test.ts', 'tests/ui-smoke.ts',
  'tests/update-goldens.ts', 'tests/goldens/reminder-2026-03-05.ics', 'tests/android-app.test.ts', 'tests/app-mode-smoke.ts', 'tests/tsconfig.json',
  // TypeScript (29 October 2026): the sources in ts/ (compiled to app.js, src/*.js and, since 0.0.2,
  // gate.js above, and the bridge below), the compiler's settings, the pinned tooling and the build
  // script. None of them is published (_config.yml) or bundled (android/app/build.gradle.kts).
  'ts/app.ts', 'ts/gate.ts', 'ts/page.d.ts', 'ts/pure.d.ts', 'ts/src/citations.ts', 'ts/src/deadline.ts', 'ts/src/followups.ts', 'ts/src/format.ts', 'ts/src/holidays-no.ts', 'ts/src/ics.ts',
  'ts/src/letters.ts', 'ts/src/mailto.ts', 'ts/src/personal-data.ts', 'ts/src/timeline.ts',
  'tsconfig.json', 'tsconfig.src.json', 'tools/build-ts.sh', 'package.json', 'package-lock.json', '.npmrc', '.gitattributes',
  // Stage 3: the Android app (spec section 14). android/ is excluded from the website (_config.yml);
  // its build output and machine-local files (android/.gitignore) are not part of the repository.
  'android/app/build.gradle.kts', 'android/app/proguard-rules.pro', 'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/AssetPaths.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/BackQuery.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/CalendarEvent.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/LetterPrintAdapter.kt',
  'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/MainActivity.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/NavigationPolicy.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/OutgoingRequest.kt',
  'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/PrintPages.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/ResponseHeaders.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/SaveName.kt',
  'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/SaveTarget.kt', 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/WebAssetHandler.kt', 'android/app/src/main/res/drawable/ic_launcher_foreground.xml',
  'android/app/src/main/res/drawable/ic_launcher_monochrome.xml', 'android/app/src/main/res/mipmap-anydpi/ic_launcher_round.xml', 'android/app/src/main/res/mipmap-anydpi/ic_launcher.xml',
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', 'android/app/src/main/res/values/colors.xml',
  'android/app/src/main/res/values/strings.xml', 'android/app/src/main/res/values/themes.xml', 'android/app/src/main/res/xml/backup_rules.xml',
  'android/app/src/main/res/xml/data_extraction_rules.xml', 'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/AssetPathsTest.kt', 'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/BackQueryTest.kt', 'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/CalendarEventTest.kt',
  'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/NavigationPolicyTest.kt', 'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/OutgoingRequestTest.kt', 'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/PrintPagesTest.kt',
  'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/ResponseHeadersTest.kt', 'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/SaveNameTest.kt', 'android/app/src/test/kotlin/no/stormberry/gdprletterbuilder/SaveTargetTest.kt',
  'android/app/src/test/resources/reminder-2026-03-05.ics', 'android/build.gradle.kts', 'android/expected-permissions.txt',
  'android/.gitignore', 'android/gradle/libs.versions.toml', 'android/gradle.properties',
  'android/gradlew', 'android/gradlew.bat', 'android/gradle/wrapper/gradle-wrapper.jar',
  'android/gradle/wrapper/gradle-wrapper.properties', 'android/licences/Apache-2.0.txt', 'android/settings.gradle.kts',
  'android/tools/launcher-icon.svg', 'android/tools/make_icons.py', 'android/web-overlay/android-bridge.js', 'android/web-overlay/android-bridge.ts', 'android/web-overlay/tsconfig.json',
  // The release kit (29 October 2026): the release workflow, the README's tool for comparing a
  // release with your own build, the store images' generator and the store files Zapstore reads
  // (approved by Marcos on 30 October 2026), all checked by tests/store.test.ts. None of them is
  // published (_config.yml; Jekyll never publishes .github/) or bundled.
  '.github/workflows/android-release.yml', 'android/tools/apk-without-signature.ts', 'android/tools/build-store-icon.py', 'tests/store.test.ts',
  'zapstore.yaml', 'fastlane/metadata/android/en-US/title.txt', 'fastlane/metadata/android/en-US/short_description.txt',
  'fastlane/metadata/android/en-US/full_description.txt', 'fastlane/metadata/android/en-US/changelogs/1.txt',
  'fastlane/metadata/android/en-US/changelogs/2.txt',
  'fastlane/metadata/android/en-US/images/icon.png', 'fastlane/metadata/android/en-US/images/featureGraphic.png',
  'fastlane/metadata/android/en-US/images/phoneScreenshots/01-start.png', 'fastlane/metadata/android/en-US/images/phoneScreenshots/02-your-letter.png',
  'fastlane/metadata/android/en-US/images/phoneScreenshots/03-deadline.png', 'fastlane/metadata/android/en-US/images/phoneScreenshots/04-follow-up.png',
];

test('one live region: the announcer; the deadline and the status lines are plain text (stage 3 review E3-2)', () => {
  const html = read('index.html');
  const live = [...html.matchAll(/<[^>]*\b(?:aria-live|role="(?:status|alert|log)")[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(live, ['<div class="visually-hidden" id="announcer" role="status" aria-live="polite">']);
  assert.match(html, /<div class="deadline" id="deadline-result"><\/div>/);
  for (const id of ['out-status', 'ics-status', 'ext-status', 'fu-status', 'tl-status']) assert.match(html, new RegExp(`<p class="status" id="${id}"></p>`), id);
  // Every status line is written through say(), which announces it; nothing else writes them but Clear.
  // Read in the TypeScript, whose layout the compiler does not keep (the compiled app.js has the
  // same statements, as tools/build-ts.sh --check proves).
  const app = read('ts/app.ts');
  assert.match(app, /function say\(id: [^,)]+, text: string\) \{\s+\$\(id\)\.textContent = text;\s+announce\(text\);\s+\}/);
  assert.match(app, /const status = \(text: string\) => say\('out-status', text\);/);
  const writes = [...app.matchAll(/\$\('(out|ics|ext|fu|tl)-status'\)\.textContent =/g)];
  assert.equal(writes.length, 0, 'a status line written without an announcement');
  // The announcer is emptied a few seconds after each message, unless something newer is there.
  assert.match(app, /const ANNOUNCE_CLEAR_MS = 4000;/);
  assert.match(app, /if \(el\.textContent === text\) el\.textContent = '';/);
});

test('touch targets and the title at large text (stage 3 review E3-8, E3-9)', () => {
  const css = read('style.css');
  // 44 px rows, with the box level with the label's first line (stage 3 verification): one flex
  // line centred in the row, items at its top, the label capped beside the box.
  assert.match(css, /\.choice,\n\.check \{\n {2}display: flex;\n {2}flex-wrap: wrap;\n {2}align-content: center;\n {2}align-items: flex-start;\n {2}min-height: 44px;/);
  assert.match(css, /\.choice input,\n\.check input \{[^}]*margin: 0\.125rem 0 0;\n {2}margin: calc\(\(1lh - 1\.2rem\) \/ 2\) 0 0;/);
  assert.match(css, /\.choice > span,\n\.check > span \{ min-width: 0; max-width: calc\(100% - 1\.85rem - 1px\);/);
  // In an inline row the label is only as wide as its own text, so that cap broke "English"
  // inside the word at every width (finish round, 2026-10-29). The inline rows lift the cap and
  // let the label take the rest of the line, so it wraps at a space and stays beside its box.
  assert.match(css, /\.choices\.inline \.choice > span \{ flex: 1 1 0; max-width: none; \}/);
  // The title breaks between its three words, never inside one while they fit.
  assert.match(read('index.html'), /<h1 class="hero-title" id="app-title"><span aria-hidden="true">GDPR<wbr>Letter<wbr>Builder<\/span><span class="visually-hidden">GDPR Letter Builder<\/span><\/h1>/);
});

test('the manifest of files: the repository holds exactly the expected files', () => {
  // android/.gitignore: the Gradle and Kotlin caches, the build output and this machine's SDK path.
  const ANDROID_LOCAL = new Set(['android/.gradle', 'android/build', 'android/app/build', 'android/.kotlin', 'android/local.properties']);
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (ANDROID_LOCAL.has(relative(ROOT, p))) return [];
    // npm ci's TypeScript (.gitignore), the build script's record of its last build outside git
    // (.gitignore), and git's own folder (the repository is under git since 30 October 2026, in the
    // vault and in every CI checkout): none is a file of the repository.
    if (['node_modules', '.build-ts.last', '.git'].includes(relative(ROOT, p))) return [];
    return statSync(p).isDirectory() ? walk(p) : [relative(ROOT, p)];
  });
  const all = walk(ROOT).filter((f) => !/^(fonts|switcher-icons)\//.test(f) && !/^tests\/goldens\/.*\.txt$/.test(f) && !/__pycache__|\.pyc$/.test(f)).sort();
  assert.deepEqual(all, [...MANIFEST].sort());
  assert.equal(readdirSync(join(ROOT, 'tests', 'goldens')).filter((f) => f.endsWith('.txt')).length, 40);
  assert.equal(readdirSync(join(ROOT, 'tests', 'goldens', 'followup')).filter((f) => f.endsWith('.txt')).length, FOLLOWUP_GOLDENS);
  assert.equal(readdirSync(join(ROOT, 'switcher-icons')).length, 21);
  assert.equal(readdirSync(join(ROOT, 'fonts', 'inter')).length, 39);
});

test('the texts are approved (Marcos, 30 October 2026): no file of the repository carries a DRAFT line', () => {
  // The release workflow keeps its DRAFT gate, and the two tests name the marker to look for it.
  const names = new Set(['.github/workflows/android-release.yml', 'tests/store.test.ts', 'tests/static.test.ts']);
  const textual = MANIFEST.filter((f) => !names.has(f) && !/\.(?:png|jar|woff2?|ttf|ico)$/.test(f));
  assert.ok(textual.includes('privacy.html') && textual.includes('README.md') && textual.includes('zapstore.yaml'));
  for (const f of textual) assert.ok(!read(f).includes('DRAFT, not approved'), f);
});

test('the type check\'s page types match index.html: every id app.ts looks up, and every part of the row templates', () => {
  const html = read('index.html');
  const dts = read('ts/page.d.ts');
  const TAGS: Record<string, string> = {
    input: 'HTMLInputElement', textarea: 'HTMLTextAreaElement', select: 'HTMLSelectElement', button: 'HTMLButtonElement',
    p: 'HTMLParagraphElement', div: 'HTMLDivElement', span: 'HTMLSpanElement', label: 'HTMLLabelElement',
    dialog: 'HTMLDialogElement', template: 'HTMLTemplateElement', main: 'HTMLElement',
  };
  const block = (name: string): string => dts.match(new RegExp(`interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
  const entries = (name: string): Array<[string, string]> => [...block(name).matchAll(/^ {2}'([^']+)': (\w+);$/gm)].map((m): [string, string] => [m[1]!, m[2]!]);
  const ids = entries('PageElements');
  assert.ok(ids.length >= 100, String(ids.length));
  for (const [id, type] of ids) {
    const tags = [...html.matchAll(new RegExp(`<(\\w+)\\b[^>]*\\sid="${id}"[^>]*>`, 'g'))];
    assert.equal(tags.length, 1, `#${id}: ${tags.length} elements with this id`);
    assert.equal(TAGS[tags[0]![1]!], type, `#${id} is a <${tags[0]![1]}>`);
  }
  // Every literal id app.js looks up is declared (a typo is then a type error too).
  const declared = new Set(ids.map(([id]) => id));
  for (const m of read('ts/app.ts').matchAll(/\$\('([^']+)'\)/g)) assert.ok(declared.has(m[1]!), `#${m[1]} is not in ts/page.d.ts`);
  const templates = [...html.matchAll(/<template id="[^"]+">([\s\S]*?)<\/template>/g)].map((m) => m[1]).join('\n');
  for (const [sel, type] of entries('RowParts')) {
    const cls = sel.slice(1);
    const tags = [...templates.matchAll(new RegExp(`<(\\w+)\\b[^>]*\\sclass="(?:[^"]* )?${cls}(?: [^"]*)?"[^>]*>`, 'g'))];
    assert.equal(tags.length, 1, `${sel}: ${tags.length} elements in the row templates`);
    assert.equal(TAGS[tags[0]![1]!], type, `${sel} is a <${tags[0]![1]}>`);
  }
});

// S-3 (29 October 2026, as EclipseTracker's and UsernameGenerator's): the TypeScript tooling is
// pinned and strict, development only, and nothing of it is published or loaded by the site.
test('the TypeScript set-up: TypeScript 6.0.3 and @types/node 24.19.2 pinned, strict, development tooling only', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.engines, { node: '>=24' });
  assert.deepEqual(pkg.devDependencies, { '@types/node': '24.19.2', typescript: '6.0.3' });
  assert.equal(pkg.dependencies, undefined, 'no runtime dependency');
  assert.equal(pkg.scripts.build, 'tools/build-ts.sh');
  assert.equal(pkg.scripts.check, 'tools/build-ts.sh --check');
  assert.equal(pkg.scripts.typecheck, 'tools/build-ts.sh --check', 'the old command still checks (D-8)');
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.ts');
  // The tests run the compiled modules the site serves, type-checked against their sources.
  assert.deepEqual(pkg.imports, { '#src/*.js': { types: './ts/src/*.ts', default: './src/*.js' } });
  const lock = JSON.parse(read('package-lock.json'));
  assert.deepEqual(Object.keys(lock.packages).sort(), ['', 'node_modules/@types/node', 'node_modules/typescript', 'node_modules/undici-types']);
  assert.equal(lock.packages['node_modules/typescript'].version, '6.0.3');
  assert.equal(lock.packages['node_modules/@types/node'].version, '24.19.2');
  for (const [k, v] of Object.entries(lock.packages as Record<string, { integrity?: string; hasInstallScript?: boolean }>)) {
    if (k === '') continue;
    assert.match(v.integrity ?? '', /^sha512-/, `${k} is pinned by its integrity hash`);
    assert.notEqual(v.hasInstallScript, true, `${k} has no install script`);
  }
  assert.match(read('.npmrc'), /^ignore-scripts=true$/m);
  assert.match(read('.npmrc'), /^save-exact=true$/m);
  assert.match(read('.gitignore'), /^node_modules\/$/m);
  assert.match(read('.gitignore'), /^\.build-ts\.last$/m);
  const tsc = JSON.parse(read('tsconfig.json'));
  for (const k of ['strict', 'noUnusedLocals', 'noUnusedParameters', 'noImplicitReturns', 'noFallthroughCasesInSwitch', 'noUncheckedIndexedAccess', 'verbatimModuleSyntax', 'removeComments', 'noEmitOnError']) {
    assert.equal(tsc.compilerOptions[k], true, `tsconfig.json ${k}`);
  }
  assert.equal(tsc.compilerOptions.target, 'ES2020');
  assert.equal(tsc.compilerOptions.module, 'ES2020');
  assert.equal(tsc.compilerOptions.rootDir, 'ts');
  assert.equal(tsc.compilerOptions.outDir, '.');
  assert.deepEqual(tsc.include, ['ts/**/*.ts']);
  assert.deepEqual(tsc.exclude, [], 'an explicit empty exclude: with outDir ".", tsc would otherwise exclude everything');
  // The pure modules are checked a second time with no DOM at all.
  const src = JSON.parse(read('tsconfig.src.json'));
  assert.equal(src.extends, './tsconfig.json');
  assert.deepEqual(src.compilerOptions.lib, ['ES2020']);
  assert.deepEqual(src.include, ['ts/src/**/*.ts', 'ts/pure.d.ts']);
  // The bridge script has its own program, a classic script (no import or export).
  const bridge = JSON.parse(read('android/web-overlay/tsconfig.json'));
  assert.equal(bridge.extends, '../../tsconfig.json');
  assert.deepEqual(bridge.include, ['android-bridge.ts']);
  assert.doesNotMatch(read('android/web-overlay/android-bridge.ts'), /^\s*(import|export)\b/m);
  // The tests are TypeScript, run by Node 24 directly and type-checked strictly with the DOM library
  // for the functions that run in the browser.
  const tests = JSON.parse(read('tests/tsconfig.json'));
  for (const k of ['strict', 'noUncheckedIndexedAccess', 'erasableSyntaxOnly', 'verbatimModuleSyntax', 'noEmit']) assert.equal(tests.compilerOptions[k], true, `tests/tsconfig.json ${k}`);
  assert.deepEqual(tests.compilerOptions.types, ['node']);
  assert.deepEqual(tests.compilerOptions.lib, ['ES2023', 'DOM', 'DOM.Iterable']);
  const build = read('tools/build-ts.sh');
  for (const p of ['tsconfig.src.json', 'tests/tsconfig.json', 'android/web-overlay/tsconfig.json', 'tests/update-goldens.ts" --check', 'bump_assets.py" --check']) assert.ok(build.includes(p), `tools/build-ts.sh runs ${p}`);
  // Gone with the move.
  for (const f of ['jsconfig.json', 'types', 'tests/index.js']) assert.ok(!existsSync(join(ROOT, f)), `${f} is gone`);
  // Nothing on the site loads the tooling.
  for (const f of ['index.html', 'app.js']) assert.ok(!/jsconfig|(?<![\w-])types\/|(?<![\w-])ts\/|tsconfig|node_modules/.test(read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), f);
});

// S-1 (29 October 2026; no exception since 0.0.2): the only JavaScript in the repository is what
// tools/build-ts.sh compiles from TypeScript (app.js, src/*.js, gate.js from ts/gate.ts, which the
// shared build-gates.py writes, and android/web-overlay/android-bridge.js); each of them is marked
// linguist-generated in .gitattributes, so GitHub's language bar counts none of it. A hand-written script anywhere else,
// tests and tools included, fails here. Until the repository is under git (stage 4) the files are
// found by walking the folder (less node_modules/ and the Android build's own folders); in a git
// checkout, by git, tracked or about to be, as UsernameGenerator does.
test('the only JavaScript is what the TypeScript compiles to, gate.js included; all of it marked generated (S-1)', () => {
  const walkTs = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => (statSync(join(ROOT, dir, n)).isDirectory() ? walkTs(`${dir}/${n}`) : [`${dir}/${n}`]));
  const compiled = walkTs('ts').filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).map((f) => f.replace(/^ts\//, '').replace(/\.ts$/, '.js'));
  assert.deepEqual(compiled.sort(), ['app.js', 'gate.js', 'src/citations.js', 'src/deadline.js', 'src/followups.js', 'src/format.js', 'src/holidays-no.js', 'src/ics.js', 'src/letters.js', 'src/mailto.js', 'src/personal-data.js', 'src/timeline.js']);
  const allowed = [...compiled, 'android/web-overlay/android-bridge.js'].sort();
  let js: string[];
  const inGit = existsSync(join(ROOT, '.git'));
  if (inGit) {
    const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.js', '*.mjs', '*.cjs'], { encoding: 'utf8' });
    js = [...new Set(r.stdout.split('\0').filter(Boolean))];
  } else {
    const SKIP = new Set(['node_modules', 'android/.gradle', 'android/build', 'android/app/build', 'android/.kotlin']);
    const walk = (d: string): string[] => readdirSync(join(ROOT, d)).flatMap((n) => {
      const rel = d ? `${d}/${n}` : n;
      if (SKIP.has(rel)) return [];
      return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
    });
    js = walk('').filter((f) => /\.(m?js|cjs)$/.test(f));
  }
  assert.deepEqual(js.sort(), allowed, 'JavaScript in the repository other than the compiled files');
  // Each one is marked linguist-generated: by git check-attr in a git checkout, else by reading
  // .gitattributes (its patterns here are exact paths and one folder-level *.js).
  const attrs = read('.gitattributes').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
  const marked = (f: string): boolean => attrs.some(([pat, ...a]) => a.includes('linguist-generated=true') && new RegExp(`^${(pat ?? '').replace(/^\//, '').replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`).test(f));
  for (const f of allowed) assert.ok(marked(f), `${f} is linguist-generated in .gitattributes`);
  if (inGit) {
    const out = spawnSync('git', ['-C', ROOT, 'check-attr', '-z', 'linguist-generated', '--', ...allowed], { encoding: 'utf8' }).stdout.split('\0');
    for (let i = 0; i + 2 < out.length; i += 3) assert.equal(out[i + 2], 'true', `${out[i]} is linguist-generated (git)`);
  }
  // The README says where gate.js comes from: ts/gate.ts, which build-gates.py writes.
  assert.match(read('README.md'), /gate\.js[^\n]*ts\/gate\.ts[^\n]*build-gates\.py/);
  // ts/gate.ts is the generator's output, so it is marked generated too, and the build has no
  // exception for gate.js any more.
  assert.ok(marked('ts/gate.ts'), 'ts/gate.ts is linguist-generated in .gitattributes');
  assert.ok(!/gate\.js \] && continue/.test(read('tools/build-ts.sh')), 'tools/build-ts.sh still exempts gate.js');
});

// S-2 (29 October 2026, UsernameGenerator's round 2 rule): code that runs in a browser is a typed
// TypeScript function sent with inPage() / page.run() / page.until() (tests/cdp.ts), so the strict
// check reads it. A string literal or template handed to ev(), waitFor(), a Runtime.evaluate
// expression, a Page.addScriptToEvaluateOnNewDocument source, an init option or a WebDriver BiDi
// script.evaluate / callFunction is hand-written JavaScript.
test('no page code is written inside a string: the browsers are driven by typed functions (inPage) (S-2)', () => {
  const files = readdirSync(new URL('./', import.meta.url)).filter((n) => n.endsWith('.ts')).map((n) => `tests/${n}`);
  const bad: string[] = [];
  const quoted = /(?:\.ev|\.waitFor|\bev|\bwaitFor|\bevaluate)\(\s*(?:`|'|")|\b(?:expression|source|init|functionDeclaration)\s*:\s*(?:`|'|")/g;
  for (const f of files) {
    if (f === 'tests/static.test.ts') continue;
    read(f).split('\n').forEach((line, i) => {
      if (!/^\s*(\/\/|\*)/.test(line) && quoted.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
      quoted.lastIndex = 0;
    });
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(readdirSync(new URL('./', import.meta.url)).filter((n) => /\.(m?js|cjs)$/.test(n)), [], 'no JavaScript left in tests/');
});
