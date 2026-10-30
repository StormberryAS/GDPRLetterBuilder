// Stage 3: the Android app's files checked against the website's (no Android tools needed). The
// Kotlin logic has its own unit tests (android/app/src/test, ./gradlew :app:testDebugUnitTest), the
// Gradle build proves the bundled web files byte for byte (verifyWebAssets) and the merged
// manifest (check<Variant>MergedManifest), and the emulator run of 16 October 2026 exercised the
// bridge; this file holds what ties the two worlds together, so a change on one side that the
// other does not follow fails here:
//   * the policy the app's asset handler sends is the page's meta policy plus frame-ancestors
//     'none' and upgrade-insecure-requests, and every response says Referrer-Policy: no-referrer;
//   * zero permissions: none asked for, INTERNET removed, allowBackup false,
//     expected-permissions.txt the package line alone;
//   * the bridge: window.GLBridge only through addWebMessageListener for the app's own origin,
//     never addJavascriptInterface; the messages it sends are the ones OutgoingRequest.kt accepts;
//   * the bridge hooks exactly what the page uses (the clipboard, navigator.share, window.print,
//     a Save link to a Blob, the two Save a reminder buttons and their status lines, the print
//     box and the three letter boxes), and the page's own files never name the bridge;
//   * the files GitHub Pages publishes are all in the APK or on the build's LEFT_OUT list;
//   * the save screen accepts exactly the page's neutral file names;
//   * the launcher icon is ICON-1 draft C, and the writing rules hold in the new texts;
//   * the stage 3 fix round (16 October 2026): Back and the side pages (E3-1), the save outcome,
//     size and email-app lines (E3-4, E3-6, E3-7, A3-5), the message size cap (A3-6), exported
//     components (A3-7) and configChanges (A3-8). What the bridge does in a browser is proved by
//     tests/app-mode-smoke.ts (A3-3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_CSP } from './legal-pages.ts';
import { letterFileName, reminderFileName } from '#src/format.js';
import { followUpFileName } from '#src/followups.js';
import { timelineFileName } from '#src/timeline.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const GITHUB = dirname(ROOT);
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const bytes = (rel: string): Buffer => readFileSync(join(ROOT, rel));
const KT = 'android/app/src/main/kotlin/no/stormberry/gdprletterbuilder';
// The bridge script the app bundles is compiled (tools/build-ts.sh) from the TypeScript beside it,
// which keeps the statements' own layout and its comments. Checks on the script's wording and
// layout read the source (BRIDGE_TS); checks on what ships, and on what reaches the network, read
// the compiled file (BRIDGE) as well; tools/build-ts.sh --check proves the two agree.
const BRIDGE = 'android/web-overlay/android-bridge.js';
const BRIDGE_TS = 'android/web-overlay/android-bridge.ts';
const GRADLE = 'android/app/build.gradle.kts';
const noComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (['build', '.gradle', '.kotlin', 'local.properties'].includes(name)) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const directives = (policy: string): Map<string, string> => new Map(policy.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
  const [name, ...values] = d.split(/\s+/);
  return [name!, values.join(' ')];
}));

function appCsp() {
  const block = read(`${KT}/ResponseHeaders.kt`).match(/CONTENT_SECURITY_POLICY =\s*([\s\S]*?)\n\n/);
  assert.ok(block, 'ResponseHeaders.kt has no CONTENT_SECURITY_POLICY');
  return block[1]!.match(/"([^"]*)"/g)!.map((s) => s.slice(1, -1)).join('');
}

/** A Kotlin `const val NAME = 12_345` as a number. */
const ktNumber = (src: string, name: string): number => Number(src.match(new RegExp(`const val ${name} = ([0-9_]+)`))![1]!.replace(/_/g, ''));

test('the app sends the page\'s own policy plus the two directives only a header can carry, and no-referrer', () => {
  const meta = read('index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]!;
  assert.equal(meta, PAGE_CSP);
  const page = directives(meta);
  const app = directives(appCsp());
  assert.deepEqual([...app.keys()].filter((k) => !page.has(k)).sort(), ['frame-ancestors', 'upgrade-insecure-requests']);
  for (const [k, v] of page) assert.equal(app.get(k), v, `${k} differs between the page and the app`);
  assert.equal(app.get('frame-ancestors'), "'none'");
  assert.equal(appCsp(), `${PAGE_CSP}; frame-ancestors 'none'; upgrade-insecure-requests`);
  const headers = read(`${KT}/ResponseHeaders.kt`);
  assert.match(headers, /"Referrer-Policy" to "no-referrer"/);
  assert.ok(!/"Permissions-Policy"/.test(noComments(headers)));
  // Every answer, success, 403 and 404 alike, carries the same headers.
  const handler = noComments(read(`${KT}/WebAssetHandler.kt`));
  assert.equal([...handler.matchAll(/ResponseHeaders\.ALL/g)].length, 2);
  assert.match(read(`${KT}/MainActivity.kt`), /if \(!NavigationPolicy\.isAssetRequest\(url\)\) return WebAssetHandler\.forbidden\(\)/);
});

test('zero permissions: none asked for, INTERNET removed, no backup, and expected-permissions.txt is the package line alone', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
  const uses = [...manifest.matchAll(/<uses-permission(?:-sdk-23)?\s+android:name="([^"]+)"\s*(tools:node="remove")?\s*\/>/g)];
  assert.deepEqual(uses.filter((m) => !m[2]).map((m) => m[1]), [], 'a permission is asked for');
  assert.ok(uses.some((m) => m[1] === 'android.permission.INTERNET' && m[2]), 'INTERNET is not removed');
  assert.ok(!/<uses-feature/.test(manifest));
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /EnableSafeBrowsing"\s+android:value="false"/);
  assert.match(manifest, /MetricsOptOut"\s+android:value="true"/);
  assert.ok(!/<provider|<service|<receiver(?![^>]*tools:node="remove")/.test(manifest), 'no provider, service or live receiver');
  // The launcher is the only way in: no share target, no deep link.
  assert.deepEqual([...manifest.matchAll(/<action android:name="([^"]+)"/g)].map((m) => m[1]), ['android.intent.action.MAIN']);
  assert.equal(read('android/expected-permissions.txt'), 'package: no.stormberry.gdprletterbuilder\n');
  // The build checks the merged manifest (the libraries' parts included) on every variant, before
  // the APK is written: no permission, and no exported component but MainActivity (A3-7).
  const gradle = read(GRADLE);
  assert.match(gradle, /SingleArtifact\.MERGED_MANIFEST/);
  assert.match(gradle, /uses-permission\(\?:-sdk-23\|-sdk-m\)\?\|permission\|permission-group\|permission-tree/);
  assert.match(gradle, /it\.name == "package\$cap" \|\| it\.name == "assemble\$cap" \|\| it\.name == "check"/);
  assert.match(gradle, /<\(activity\|activity-alias\|service\|receiver\|provider\)/);
  assert.match(gradle, /name == "no\.stormberry\.gdprletterbuilder\.MainActivity"/);
  // Only the launcher activity is exported in the app's own manifest.
  const exported = [...manifest.matchAll(/<(activity|activity-alias|service|receiver|provider)\b[^>]*android:exported="true"[^>]*>/g)];
  assert.equal(exported.length, 1);
  assert.match(exported[0]![0], /android:name="\.MainActivity"/);
});

test('configChanges keeps the letter through every change Android can make while the app runs (A3-8)', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
  const changes = manifest.match(/android:configChanges="([^"]+)"/)![1]!.split('|');
  for (const c of ['mcc', 'mnc', 'orientation', 'screenSize', 'smallestScreenSize', 'screenLayout', 'keyboard', 'keyboardHidden', 'navigation', 'uiMode', 'density', 'fontScale', 'locale', 'layoutDirection', 'fontWeightAdjustment', 'grammaticalGender', 'colorMode', 'touchscreen']) {
    assert.ok(changes.includes(c), c);
  }
  // A text size change reaches the WebViews (E3-3).
  const main = read(`${KT}/MainActivity.kt`);
  assert.match(main, /override fun onConfigurationChanged\(newConfig: Configuration\)/);
  assert.match(main, /settings\.textZoom = \(resources\.configuration\.fontScale \* 100\)\.roundToInt\(\)/);
});

test('large text: both WebViews keep textZoom, and the default font size stays the browser\'s (17 October 2026)', () => {
  // EclipseTracker's fix C (S-2) moved to a larger default font size. Measured here on the emulator
  // at 1.0 to 2.0, 320 and 393 dp, it cut the dates and the selects in the rows and put Remove
  // outside its card, because this page's spacing is in rem; textZoom did not. See the comment on
  // applyTextZoom in MainActivity.kt and the large-text checks in tests/app-mode-smoke.ts.
  const main = read(`${KT}/MainActivity.kt`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(main, /defaultFontSize|defaultFixedFontSize|minimumFontSize|minimumLogicalFontSize|textAutosizing|TEXT_AUTOSIZING/);
  // Every WebView the app makes goes through privateView, which applies the text zoom, and a font
  // size change while the app is open reaches both.
  assert.deepEqual(main.match(/= *\w*WebView\(/g), ['= PrivateWebView(']);
  assert.match(main, /private fun privateView\(script: Boolean\): WebView \{[\s\S]*?applyTextZoom\(view\)[\s\S]*?return view\n    \}/);
  assert.match(main, /override fun onConfigurationChanged\(newConfig: Configuration\) \{[\s\S]*?webView\?\.let \{ applyTextZoom\(it\) \}\s*sidePage\?\.let \{ applyTextZoom\(it\) \}/);
  assert.match(main, /\.coerceIn\(50, 300\)/);
});

test('names, versions and the activity: GDPRLetterBuilder everywhere, as CheckLink\'s template', () => {
  const gradle = read(GRADLE);
  assert.match(gradle, /namespace = "no\.stormberry\.gdprletterbuilder"/);
  assert.match(gradle, /applicationId = "no\.stormberry\.gdprletterbuilder"/);
  assert.match(gradle, /versionCode = 1\s+versionName = "0\.0\.1"/);
  assert.match(gradle, /minSdk = 24\s+targetSdk = 36/);
  assert.match(gradle, /applicationIdSuffix = "\.debug"/);
  assert.match(read('android/gradle/libs.versions.toml'), /agp = "9\.3\.1"/);
  assert.match(read('android/gradle/wrapper/gradle-wrapper.properties'), /gradle-9\.5\.0-bin\.zip/);
  assert.match(read('android/app/src/main/res/values/strings.xml'), /<string name="app_name">GDPRLetterBuilder<\/string>/);
  assert.match(read('android/app/src/main/res/values/themes.xml'), /name="Theme\.GDPRLetterBuilder"/);
  const files = walk('android').filter((f) => /\.(kt|kts|xml|js|ts|json|properties|pro|toml|txt|py)$/.test(f) && !f.endsWith('gradle-wrapper.properties'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const text = read(f);
    assert.ok(!/no\.stormberry\.checklink|CLBridge|CLAndroid|Theme\.CheckLink|qr-worker|zxing|CameraPermission|PngCheck/.test(text), `${f} still names the template`);
  }
  // CheckLink's SEC-8 pair, and nothing else that moves the activity between tasks.
  const manifest = read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
  const activity = manifest.match(/<activity\b[^>]*>/)![0]!;
  assert.match(activity, /android:launchMode="singleTask"/);
  assert.match(activity, /android:taskAffinity=""/);
  assert.match(activity, /android:autoRemoveFromRecents="true"/);
  assert.ok(!/allowTaskReparenting|excludeFromRecents|documentLaunchMode/.test(manifest));
  // No signing material in the project, and keystore.properties (if it ever appears) holds no password.
  for (const f of walk('android')) assert.ok(!/\.(jks|p12|keystore)$/.test(f), `${f}: a key file in the project`);
  if (existsSync(join(ROOT, 'android/keystore.properties'))) assert.ok(!/^[^#\n]*password[^=\n]*=/im.test(read('android/keystore.properties')));
});

test('the bridge is a web message listener for the app\'s own origin only, never addJavascriptInterface', () => {
  const kotlin = walk(`${KT}`).map(read).join('\n');
  assert.ok(!kotlin.includes('addJavascriptInterface'));
  assert.ok(!kotlin.includes('@JavascriptInterface'));
  assert.match(kotlin, /BRIDGE_NAME = "GLBridge"/);
  assert.match(kotlin, /addWebMessageListener\(\s*view,\s*BRIDGE_NAME,\s*setOf\(NavigationPolicy\.ASSET_ORIGIN\),/);
  assert.match(kotlin, /if \(!isMainFrame \|\| !NavigationPolicy\.isAssetOrigin\(origin\.toString\(\)\)\) return/);
  assert.match(kotlin, /ASSET_ORIGIN = "https:\/\/\$ASSET_HOST"/);
  for (const f of [BRIDGE, BRIDGE_TS]) assert.match(read(f), /var bridge = window\.GLBridge;/, f);
});

test('the messages the bridge sends are the ones the app accepts, with the same limits', () => {
  const bridge = noComments(read(BRIDGE_TS));
  // The requests, and the answers about Back (answerBack), which carry the app's Back query number.
  const sent = new Set([...bridge.matchAll(/\bt: '([a-z-]+)'/g), ...bridge.matchAll(/answerBack\('([a-z-]+)', q\)/g)].map((m) => m[1]));
  assert.deepEqual([...sent].sort(), ['ask', 'calendar', 'close', 'copy', 'hello', 'print', 'save', 'share', 'stay']);
  const req = read(`${KT}/OutgoingRequest.kt`);
  for (const t of sent) assert.ok(req.includes(`"${t}" ->`), `the app does not handle "${t}"`);
  // What the app sends the page, and what the bridge listens for: the same four types.
  const main = read(`${KT}/MainActivity.kt`);
  const toPage = new Set([...main.matchAll(/put\("t", "([a-z-]+)"\)/g)].map((m) => m[1]));
  assert.deepEqual([...toPage].sort(), ['ask-ok', 'back', 'no-email-app', 'reply']);
  for (const t of toPage) assert.match(bridge, new RegExp(`msg\\.t (===|!==) '${t}'`), t);
  assert.equal(Number(bridge.match(/var MAX_TEXT = (\d+);/)![1]!), ktNumber(req, 'MAX_TEXT_CHARS'));
  assert.equal(Number(bridge.match(/var MAX_FILE = (\d+);/)![1]!), 3 * ktNumber(req, 'MAX_TEXT_CHARS'));
  assert.match(req, /const val MAX_FILE_BYTES = 3 \* MAX_TEXT_CHARS/);
  assert.equal(Number(bridge.match(/var MAX_ICS = (\d+);/)![1]!), 64 * 1024);
  assert.match(req, /const val MAX_ICS_BYTES = 64 \* 1024/);
  // A3-6: the app drops any message over this length before parsing it, and the bridge never posts one.
  assert.equal(Number(bridge.match(/var MAX_MESSAGE = (\d+);/)![1]!), ktNumber(req, 'MAX_MESSAGE_CHARS'));
  assert.match(bridge, /if \(text\.length > MAX_MESSAGE\) throw new \(?TooLong\b[^;]*\(\);/);
  assert.match(main, /if \(!OutgoingRequest\.messageFits\(data\)\) return\s+val msg = try \{\s+JSONObject\(data!!\)/);
  // The print kinds the bridge names are the app's.
  const kinds = new Set([...bridge.matchAll(/return '(letter|follow-up|timeline)'/g)].map((m) => m[1]));
  assert.deepEqual([...kinds].sort(), ['follow-up', 'letter', 'timeline']);
  for (const k of kinds) assert.ok(req.includes(`("${k}")`), k);
  // Copy is always marked sensitive (AND-1): the page cannot turn it off.
  assert.match(main, /clip\.description\.extras = PersistableBundle\(\)\.apply \{ putBoolean\(EXTRA_IS_SENSITIVE, true\) \}/);
  assert.ok(!/sensitive/.test(noComments(bridge)));
});

test('the bridge cannot reach the network and adds no global of its own', () => {
  for (const f of [BRIDGE, BRIDGE_TS]) {
  const code = noComments(read(f));
  for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'eval(', 'new Function', 'innerHTML', 'outerHTML', 'document.write', 'insertAdjacentHTML', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.ok(!code.includes(word), word);
  }
  assert.ok(!/window\.[A-Z]\w*\s*=/.test(code), 'the bridge sets a global');
  // It only hides the website-only parts; nothing else of the page is removed or rewritten.
  assert.match(code, /function hideWebOnly\(root(?:: Node)?\)/);
  assert.ok(!/\.remove\(\)|removeChild|replaceChildren/.test(code));
  }
});

test('the bridge hooks exactly what the page uses, and the page never names the bridge', () => {
  // The page's code as written (ts/app.ts; app.js is its compiled form).
  const app = read('ts/app.ts');
  const html = read('index.html');
  // The page's ways out, which the bridge gives the app's way under the same names.
  assert.match(app, /await navigator\.clipboard\.writeText\(text\);/);
  assert.match(app, /await navigator\.share\(\{ text: \$\('letter'\)\.value \}\);/);
  assert.match(app, /await navigator\.share\(\{ text: \$\(id\)\.value \}\);/);
  assert.equal([...app.matchAll(/window\.print\(\);/g)].length, 2);
  assert.match(app, /const url = URL\.createObjectURL\(new Blob\(\[text\], \{ type \}\)\);/);
  assert.match(app, /a\.download = name;/);
  assert.match(app, /window\.addEventListener\('beforeprint', fillPrint\);/);
  assert.match(app, /window\.addEventListener\('afterprint', \(\) => \{ printSource = 'letter'; \}\);/);
  assert.match(app, /\$\('save-ics'\)\.disabled = !d;/);
  assert.match(app, /\$\('save-ics-ext'\)\.disabled = !d;/);
  const bridge = read(BRIDGE_TS);
  assert.match(bridge, /Object\.defineProperty\(clip, 'writeText'/);
  assert.match(bridge, /Object\.defineProperty\(navigator, 'share'/);
  assert.match(bridge, /Object\.defineProperty\(window, 'print'/);
  assert.match(bridge, /target\.closest(?:<\w+>)?\('a\[download\]'\)/);
  assert.match(bridge, /addCalendarButton\('save-ics', 'ics-status'\);/);
  assert.match(bridge, /addCalendarButton\('save-ics-ext', 'ext-status'\);/);
  for (const id of ['save-ics', 'save-ics-ext', 'ics-status', 'ext-status', 'print-letter', 'letter', 'fu-letter', 'tl-text', 'android-app',
    'announcer', 'confirm-dialog', 'confirm-text', 'confirm-ok', 'confirm-cancel', 'letter-edited', 'fu-edited', 'tl-edited']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // Each output button the bridge watches for size hands over the box it names, and its status
  // line is the .status paragraph straight after its row of buttons.
  const sources = Object.fromEntries([...read(BRIDGE_TS).match(/var SOURCES(?:: Record<string, string>)? = \{([\s\S]*?)\};/)![1]!.matchAll(/'([a-z-]+)': '([a-z-]+)'/g)].map((m) => [m[1], m[2]]));
  assert.equal(Object.keys(sources).length, 14);
  for (const [button, box] of Object.entries(sources)) {
    assert.match(html, new RegExp(`<button type="button" class="btn[^"]*" id="${button}"`), button);
    assert.ok(app.includes(`$('${button}').addEventListener('click'`), button);
    // Step 9's buttons hand over the follow-up, step 10's the cover note, step 6's the first letter.
    assert.equal(box, button.startsWith('fu-') ? 'fu-letter' : button.startsWith('tl-') ? 'tl-text' : 'letter', button);
  }
  for (const id of ['out-status', 'ics-status', 'ext-status', 'fu-status', 'tl-status']) {
    assert.match(html, new RegExp(`</div>\\s*<p class="status" id="${id}"></p>`), id);
  }
  // The website-only section stays hidden on the website until the app is on Zapstore (stage 5),
  // and the bridge hides it in the app whatever happens to that attribute.
  assert.match(html, /<section class="android-app" id="android-app" aria-labelledby="android-app-title" data-web-only hidden>/);
  assert.match(html, /href="https:\/\/zapstore\.dev\/apps\/no\.stormberry\.gdprletterbuilder"/);
  assert.match(html, /No permissions and no internet access\./);
  // The build injects the bridge before the first script; the page itself must not name it.
  for (const f of ['index.html', 'app.js', 'privacy.html', 'disclaimer.html']) assert.ok(!read(f).includes('android-bridge.js'), f);
  assert.ok(html.indexOf('<script') < html.indexOf('type="module"'), 'the first script is not the module');
  assert.match(read(GRADLE), /const val INJECTED_TAG = "<script src=\\"android-bridge\.js\\"><\/script>"/);
});

test('the APK carries every file GitHub Pages publishes, or leaves it out on purpose', () => {
  const gradle = read(GRADLE);
  const includes = gradle.match(/val INCLUDES = listOf\(([\s\S]*?)\n {4}\)/)![1]!.match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1));
  const leftOut = [...gradle.match(/val LEFT_OUT = mapOf\(([\s\S]*?)\n {4}\)/)![1]!.matchAll(/"([^"]+)" to "/g)].map((m) => m[1]!);
  assert.deepEqual(leftOut.sort(), ['CNAME', 'og-image.png', 'robots.txt', 'src/citations.js']);
  // What Pages publishes: the folder less _config.yml's exclusions and Jekyll's own.
  const excluded = [...read('_config.yml').matchAll(/^ {2}- (.+)$/gm)].map((m) => m[1]);
  const all: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(join(ROOT, dir || '.'))) {
      const rel = dir ? `${dir}/${name}` : name;
      if (/^[._#]/.test(name) || name.endsWith('~') || name === '__pycache__' || name.endsWith('.pyc')) continue;
      if (excluded.includes(rel) || excluded.includes(`${rel}/`)) continue;
      if (statSync(join(ROOT, rel)).isDirectory()) visit(rel);
      else all.push(rel);
    }
  };
  visit('');
  const glob = (p: string): RegExp => new RegExp(`^${p.replace(/\./g, '\\.').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*')}$`);
  const bundled = all.filter((f) => includes.some((p) => glob(p).test(f)) && !leftOut.includes(f));
  assert.deepEqual(all.filter((f) => !bundled.includes(f) && !leftOut.includes(f)), [], 'published but neither bundled nor left out');
  assert.equal(bundled.length, 80);
  for (const f of leftOut) assert.ok(all.includes(f), `${f} is on LEFT_OUT but not published`);
  // Nothing on the page loads the files left out.
  for (const f of ['index.html', 'app.js', ...readdirSync(join(ROOT, 'src')).map((n) => `src/${n}`)]) {
    assert.ok(!/citations\.js/.test(noComments(read(f)).replace(/<!--[\s\S]*?-->/g, '')), `${f} loads citations.js`);
  }
});

test('when the APK has been built here, its web copy is byte for byte the website, but for the one injected line', { skip: !existsSync(join(ROOT, 'android/app/build/generated/webAssets/web/index.html')) && 'no Android build output beside the repository' }, () => {
  const web = 'android/app/build/generated/webAssets/web';
  const copied = walk(web).map((f) => f.slice(web.length + 1));
  assert.equal(copied.length, 81);
  for (const f of copied) {
    if (f === 'android-bridge.js') { assert.ok(bytes(`${web}/${f}`).equals(bytes(BRIDGE))); continue; }
    if (f === 'index.html') {
      const lines = read(`${web}/${f}`).split('\n');
      const at = lines.findIndex((l) => l.trim() === '<script src="android-bridge.js"></script>');
      assert.ok(at > 0);
      lines.splice(at, 1);
      assert.equal(lines.join('\n'), read('index.html'));
      continue;
    }
    assert.ok(bytes(`${web}/${f}`).equals(bytes(f)), f);
  }
});

test('the save screen takes exactly the page\'s neutral file names', () => {
  const src = read(`${KT}/SaveName.kt`);
  const date = src.match(/private const val DATE = "([^"]+)"/)![1]!;
  const textRe = new RegExp(src.match(/TEXT_NAME = Regex\("(.+)"\)/)![1]!.replace('$DATE', date).replace(/\\\\/g, '\\'));
  const calRe = new RegExp(src.match(/CALENDAR_NAME = Regex\("(.+)"\)/)![1]!.replace('$DATE', date).replace(/\\\\/g, '\\'));
  for (const iso of ['2026-10-16', '2028-02-29', '2026-12-31', '2026-01-01']) {
    for (const name of [letterFileName('access', iso), letterFileName('erasure', iso), followUpFileName(iso), timelineFileName(iso)]) {
      assert.match(name, textRe, name);
      assert.doesNotMatch(name, calRe, name);
    }
    assert.match(reminderFileName(iso), calRe);
    assert.doesNotMatch(reminderFileName(iso), textRe);
  }
  for (const bad of ['Eksempel AS.txt', 'access-request-2026-10-16.ics', '../timeline-2026-10-16.txt']) {
    assert.doesNotMatch(bad, textRe, bad);
    assert.doesNotMatch(bad, calRe, bad);
  }
  // The type the page gives each Blob is the one the app checks.
  assert.equal([...read('app.js').matchAll(/'text\/plain;charset=utf-8'/g)].length, 3);
  assert.match(read('app.js'), /'text\/calendar;charset=utf-8'/);
  assert.match(read(`${KT}/OutgoingRequest.kt`), /if \(mime != "\$type;charset=utf-8"\) return null/);
});

test('the Kotlin tests read the web app\'s own golden reminder', () => {
  assert.ok(bytes('android/app/src/test/resources/reminder-2026-03-05.ics').equals(bytes('tests/goldens/reminder-2026-03-05.ics')));
});

test('the launcher icon is ICON-1 draft C, copied byte for byte', () => {
  const svg = bytes('android/tools/launcher-icon.svg');
  assert.match(svg.toString(), /closed\s+envelope with a small person on it/);
  const draft = join(GITHUB, '..', 'LabsIdeas', 'GDPRLetterBuilder icon drafts 2026-10-12', 'C-envelope-with-person.svg');
  if (existsSync(draft)) assert.ok(svg.equals(readFileSync(draft)), 'android/tools/launcher-icon.svg differs from draft C');
  const fg = read('android/app/src/main/res/drawable/ic_launcher_foreground.xml');
  assert.match(fg, /ICON-1, draft C/);
  assert.match(fg, /android:fillColor="#FF103033"/);
  assert.match(fg, /android:fillColor="#FFECFDFA"/);
  assert.match(read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'), /<monochrome android:drawable="@drawable\/ic_launcher_monochrome" \/>/);
  // The web favicon is the same drawing since 29 October 2026 (tests/static.test.ts compares the shapes).
  assert.match(read('favicon.svg'), /ICON-1 draft C/);
});

test('app toasts fit the two lines Android shows: 66 characters at most', () => {
  const strings = read('android/app/src/main/res/values/strings.xml');
  const all = [...strings.matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g)];
  assert.ok(all.length >= 12);
  for (const [, name, text] of all) assert.ok(text!.replace(/\\'/g, "'").length <= 66, `${name} is too long for a toast`);
});

test('the new Android texts follow the writing rules: no em or en dashes, no double hyphen as a dash, no exclamation mark, British spelling', () => {
  const files = [...walk('android').filter((f) => /\.(kt|kts|xml|js|ts|json|properties|pro|py|toml|txt)$/.test(f) && !/licences\/Apache|gradlew/.test(f)), 'tests/android-app.test.ts'];
  for (const f of files) {
    const text = read(f);
    assert.ok(!/[\u2013\u2014]/.test(text), `${f} has an em or en dash`);
    assert.ok(!/(^|[\s(])--(?=[\s).,]|$)/m.test(text), `${f} uses a double hyphen as a dash`);
  }
  // User-facing words: the toasts and the bridge's own lines (every upper-case string constant).
  const bridgeWords = [...read(BRIDGE_TS).matchAll(/var [A-Z][A-Z_]+\s*=\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(bridgeWords.length, 9);
  const words = [...read('android/app/src/main/res/values/strings.xml').matchAll(/>([^<]+)<\/string>/g)].map((m) => m[1]).join(' ') + ' ' + bridgeWords.join(' ');
  assert.ok(!/!/.test(words), 'an exclamation mark');
  for (const us of [/\bcolor\b/i, /\borganiz/i, /\bcenter\b/i, /\bfavorite/i, /\bdialog\b/i, /\bcanceled\b/i]) assert.doesNotMatch(words, us);
  assert.match(words, /Add to calendar app/);
});

test('the app-only texts of the stage 3 fix round are exactly the approved ones, and reuse the approved texts', () => {
  const bridge = read(BRIDGE_TS);
  const strings = read('android/app/src/main/res/values/strings.xml');
  const str = (name: string): string => strings.match(new RegExp(`<string name="${name}">([^<]*)</string>`))![1]!;
  const js = (name: string): string => bridge.match(new RegExp(`var ${name} = '([^']+)';`))![1]!;
  // E3-1: Back on the letter with something typed.
  assert.equal(js('CLOSE_QUESTION'), 'Close the app? What you have typed will be lost.');
  assert.equal(js('CLOSE_LABEL'), 'Close');
  assert.equal(str('close_question'), js('CLOSE_QUESTION'));
  assert.equal(str('close_close'), 'Close');
  assert.equal(str('close_cancel'), 'Cancel');
  assert.match(read('index.html'), /<button type="button" class="btn btn-secondary" id="confirm-cancel">Cancel<\/button>/);
  // A3-5, E3-6: the size refusal, as a status line.
  assert.equal(js('TOO_LONG'), 'This is too long for the app to hand over. Shorten it and try again.');
  // E3-4 and E3-7 reuse approved texts: the save toast and the page's own "Copied.".
  assert.equal(js('SAVE_FAILED'), str('file_save_failed'));
  assert.equal(js('COPIED'), 'Copied.');
  assert.match(read('ts/app.ts'), /status\('Copied\.'\)/);
});

test('Back and the side pages: the privacy page and the disclaimer open over the letter, and Back asks first (E3-1)', () => {
  const nav = read(`${KT}/NavigationPolicy.kt`);
  const side = [...nav.match(/SIDE_PAGES = setOf\(([^)]*)\)/)![1]!.matchAll(/"\/([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(side, ['disclaimer.html', 'privacy.html']);
  for (const f of side) assert.ok(existsSync(join(ROOT, f)), f);
  // The links that reach them: the footer and the first-run notice.
  assert.match(read('index.html'), /<a href="privacy\.html">Privacy<\/a> &middot; <a href="disclaimer\.html">Disclaimer<\/a>/);
  assert.match(read('gate.js'), /href="disclaimer\.html"/);
  // Neither side page runs a script, so the second WebView runs none and has no bridge.
  for (const f of side) assert.ok(!/<script/i.test(read(f)), f);
  const main = read(`${KT}/MainActivity.kt`);
  assert.match(main, /val view = sidePage \?: privateView\(script = false\)/);
  assert.equal([...main.matchAll(/addWebMessageListener\(/g)].length, 1);
  assert.match(main, /if \(side\.canGoBack\(\)\) side\.goBack\(\) else closeSidePage\(\)/);
  assert.ok(!/view\.canGoBack\(\)\) view\.goBack\(\) else finish\(\)/.test(main), 'Back still ends the app without asking');
  // The bridge asks in the page's own dialog, and only Close closes the app.
  const bridge = noComments(read(BRIDGE_TS));
  assert.match(bridge, /if \(msg\.t === 'back'\)/);
  assert.match(bridge, /dialog\.showModal\(\);\s+cancel\.focus\(\);/);
  assert.match(bridge, /if \(close\) answerBack\('close', q\);/);
  // The Back timing race (stage 3 verification): the page's dialog opens only on the app's ask-ok
  // for the Back it asked about, and the app agrees only while it has not asked itself.
  assert.match(bridge, /askingFor = q;\s+answerBack\('ask', q\);/);
  assert.match(bridge, /function onAskOk\(q(?:: number)?\)(?:: void)? \{\s+if \(q !== askingFor\) return;/);
  assert.match(main, /if \(backQuery\.timedOut\(q\)\) askBeforeClosing\(\)/);
  assert.match(main, /BackQuery\.Outcome\.LET_PAGE_ASK -> \{\s+stopBackWatchdog\(\)\s+post\(proxy, JSONObject\(\)\.put\("t", "ask-ok"\)\.put\("q", q\)\)/);
});

test('a save the app answers late: the bridge waits for the outcome, and the app keeps one save at a time (E3-4, A3-2, A3-4)', () => {
  const bridge = noComments(read(BRIDGE_TS));
  assert.match(bridge, /ask\(\{ t: 'save', name: name, mime: blob!?\.type \|\| '', data: data \}, 0\)/);
  assert.match(bridge, /if \(answer\.cancelled === true\) \{\s+if \(status\) status\.textContent = '';/);
  const main = read(`${KT}/MainActivity.kt`);
  assert.match(main, /if \(pendingSave != null\) \{\s+reply\(proxy, request\.id, false, busy = true\)/);
  assert.match(main, /waiting\?\.let \{ reply\(it\.proxy, it\.id, false, cancelled = true\) \}/);
  // A renderer that stops does not drop the waiting file (A3-2).
  const gone = main.slice(main.indexOf('override fun onRenderProcessGone'), main.indexOf('private inner class SideClient'));
  assert.ok(!/pendingSave = null/.test(gone));
  // After Android ended the app, the person hears that it stopped, once (E3-5, A3-10).
  assert.match(main, /if \(savedInstanceState != null\) \{\s+crashNoticeShown = true\s+toast\(R\.string\.page_crashed\)/);
  assert.match(main, /if \(!crashNoticeShown\) toast\(R\.string\.page_crashed\)/);
});
