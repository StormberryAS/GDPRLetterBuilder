// The release kit around the Android app (29 October 2026), checked statically:
//   * the store files Zapstore reads (fastlane/metadata/android/en-US and zapstore.yaml): their
//     lengths, the copy rules, that the store texts say only what the manifest makes true, that
//     zapstore.yaml carries the same texts, and the images' sizes and format;
//   * the approval: Marcos approved every text written on 29 October 2026 on 30 October 2026, so
//     no text carries a DRAFT line any more, and the release workflow still refuses to build with one;
//   * the release workflow (.github/workflows/android-release.yml): its trigger, its two jobs,
//     the checks it runs, its pinned actions, its secrets by name, its web file list against the
//     Gradle build's, and its asset name against zapstore.yaml's pattern;
//   * android/tools/apk-without-signature.ts, the README's tool for comparing a release with your
//     own build (EclipseTracker's test, adapted).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyProblems } from './legal-pages.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const FL = 'fastlane/metadata/android/en-US';
const WORKFLOW = '.github/workflows/android-release.yml';
const GRADLE = 'android/app/build.gradle.kts';
const DRAFT = 'DRAFT, not approved';
const RELEASE_CERT = '8287710abd10fc1d37615299bd11c3e79306545ecc3e1b968010da54a80424e2';
// The Google Play upload key (30 October 2026): it signs the Play bundle only, never an APK of this workflow.
const UPLOAD_CERT = '54ffe8dbc5f4361b75e4800261b9d33844bed272f55648c75959a202b12535d0';

/** A store text, as Zapstore reads it (approved 30 October 2026, so there is no DRAFT line to take off). */
const text = (rel: string): string => read(rel);
const versionCode = (): number => Number(read(GRADLE).match(/^\s*versionCode = (\d+)$/m)![1]);
const versionName = (): string => read(GRADLE).match(/^\s*versionName = "([^"]+)"$/m)![1]!;

/** Every file under a folder of the repository, as paths relative to the root. */
const walkFiles = (rel: string): string[] => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walkFiles(`${rel}/${e.name}`) : [`${rel}/${e.name}`]);

/** The value of a top-level `key: value` line of zapstore.yaml, quotes removed. */
const yamlValue = (yaml: string, key: string): string => {
  const m = yaml.match(new RegExp(`^${key}: (.*)$`, 'm'));
  assert.ok(m, `zapstore.yaml has no ${key}`);
  return m[1]!.replace(/^"(.*)"$/, '$1');
};
/** zapstore.yaml's description block, as text with its two-space indent removed. */
const yamlDescription = (yaml: string): string => {
  const lines = yaml.split('\n');
  const at = lines.indexOf('description: |');
  assert.ok(at >= 0);
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l !== '' && !l.startsWith('  ')) break;
    body.push(l.slice(2));
  }
  return body.join('\n').trim();
};
/** Paragraphs with their line breaks joined, so a re-wrapped text compares equal. */
const paragraphs = (t: string): string[] => t.trim().split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).join(' ').replace(/ - /g, '\n- '));

/** Width, height and PNG colour type of a PNG file (IHDR). */
function png(rel: string): { width: number; height: number; colourType: number; bytes: number } {
  const b = readFileSync(join(ROOT, rel));
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${rel} is not a PNG`);
  assert.equal(b.subarray(12, 16).toString('latin1'), 'IHDR');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25]!, bytes: b.length };
}

// The store texts

test('the store texts: Zapstore\'s and Fastlane\'s lengths, the copy rules, and a note for this version', () => {
  assert.equal(read(`${FL}/title.txt`), 'GDPRLetterBuilder');
  const short = text(`${FL}/short_description.txt`);
  assert.ok(short.length <= 80 && !short.includes('\n'), `short_description ${short.length}`);
  const full = text(`${FL}/full_description.txt`);
  assert.ok(full.length <= 4000, `full_description ${full.length}`);
  // One new note per release (Marcos, 23 October 2026): for this versionCode, main updates only,
  // under 500 characters with the link to the full log at its end.
  const note = text(`${FL}/changelogs/${versionCode()}.txt`).trim();
  assert.ok(note.length < 500, `changelog ${note.length}`);
  assert.match(note, /Full log: https:\/\/github\.com\/StormberryAS\/GDPRLetterBuilder\/releases$/);
  assert.match(note, new RegExp(`\\b${versionName().replace(/\./g, '\\.')}\\b`));
  assert.deepEqual(readdirSync(join(ROOT, FL, 'changelogs')), [`${versionCode()}.txt`]);
  for (const [name, t] of [['short', short], ['full', full], ['note', note]] as const) {
    assert.deepEqual(copyProblems(t), [], name);
    assert.ok(!/\bvibe/i.test(t), name);
  }
  // The framing every Labs app carries, and the app's own.
  assert.match(full, /This is a functioning prototype from Stormberry AS, MIT licensed/);
  assert.match(full, /Information, not legal advice\./);
  assert.match(note, /Information, not legal advice\./);
});

test('the texts are approved (30 October 2026): no DRAFT line anywhere, and the release workflow still refuses to build with one', () => {
  const fastlane = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? fastlane(`${dir}/${e.name}`) : e.name.endsWith('.txt') ? [`${dir}/${e.name}`] : []);
  const texts = [...fastlane('fastlane'), 'zapstore.yaml', 'privacy.html', 'README.md'];
  assert.ok(texts.includes(`${FL}/changelogs/${versionCode()}.txt`) && texts.includes(`${FL}/full_description.txt`));
  for (const rel of texts) assert.doesNotMatch(read(rel), /\bDRAFT\b/, rel);
  const wf = read(WORKFLOW);
  assert.ok(wf.includes(`grep -rln '${DRAFT}' fastlane zapstore.yaml privacy.html README.md`));
  assert.ok(wf.indexOf('marked DRAFT') < wf.indexOf('tools/build-ts.sh --check'), 'the DRAFT check comes first');
});

test('the store texts claim no permission only while the APK asks for none', () => {
  const full = text(`${FL}/full_description.txt`);
  const claims = /asks for no Android permission at all/.test(full) && /The only line you should see is the package name\./.test(full);
  assert.ok(claims);
  assert.equal(read('android/expected-permissions.txt').trim(), 'package: no.stormberry.gdprletterbuilder');
  const manifest = read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(manifest, /<uses-permission(?![^>]*tools:node="remove")/);
  assert.match(manifest, /android\.permission\.INTERNET"\s+tools:node="remove"/);
});

test('zapstore.yaml carries the store texts, the release note of this version, the images and the asset pattern', () => {
  const yaml = read('zapstore.yaml');
  assert.equal(yamlValue(yaml, 'name'), 'GDPRLetterBuilder');
  assert.equal(yamlValue(yaml, 'repository'), 'https://github.com/StormberryAS/GDPRLetterBuilder');
  assert.equal(yamlValue(yaml, 'pubkey'), 'npub1zz9w77p2jkn95t0st9tcuea8zdn2vknf0ctrwyd4g46w3kswdccqesr0pa');
  assert.equal(yamlValue(yaml, 'license'), 'MIT');
  assert.equal(yamlValue(yaml, 'summary'), text(`${FL}/short_description.txt`));
  assert.deepEqual(paragraphs(yamlDescription(yaml)), paragraphs(text(`${FL}/full_description.txt`)));
  assert.equal(yamlValue(yaml, 'release_notes'), `./${FL}/changelogs/${versionCode()}.txt`);
  assert.equal(yamlValue(yaml, 'icon'), `./${FL}/images/icon.png`);
  const images = [...yaml.matchAll(/^ {2}- (\.\/fastlane\/\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(images, readdirSync(join(ROOT, FL, 'images', 'phoneScreenshots')).sort().map((f) => `./${FL}/images/phoneScreenshots/${f}`));
  // The workflow publishes gdprletterbuilder-v<version>.apk and its .sha256; the pattern takes the APK only.
  const match = new RegExp(yamlValue(yaml, 'match').replace(/\\\\/g, '\\'));
  assert.ok(match.test(`gdprletterbuilder-v${versionName()}.apk`));
  assert.ok(!match.test(`gdprletterbuilder-v${versionName()}.apk.sha256`));
  assert.ok(read(WORKFLOW).includes('cp "$RUNNER_TEMP/gdprletterbuilder-release.apk" "gdprletterbuilder-${VERSION}.apk"'));
  assert.ok(read(WORKFLOW).includes('sha256sum "gdprletterbuilder-${VERSION}.apk" > "gdprletterbuilder-${VERSION}.apk.sha256"'));
});

test('the store images: the 512 icon, the 1024x500 feature graphic, four 1080x1920 palette screenshots under 250 KB', () => {
  const icon = png(`${FL}/images/icon.png`);
  assert.deepEqual([icon.width, icon.height], [512, 512]);
  const feature = png(`${FL}/images/featureGraphic.png`);
  assert.deepEqual([feature.width, feature.height], [1024, 500]);
  const shots = readdirSync(join(ROOT, FL, 'images', 'phoneScreenshots')).sort();
  assert.deepEqual(shots, ['01-start.png', '02-your-letter.png', '03-deadline.png', '04-follow-up.png']);
  for (const s of shots) {
    const p = png(`${FL}/images/phoneScreenshots/${s}`);
    assert.deepEqual([p.width, p.height], [1080, 1920], s);
    // Zapstore's Blossom server refuses an image of about 700 KB; the estate rule is a 256-colour
    // palette PNG under 250 KB.
    assert.equal(p.colourType, 3, `${s} is not a palette PNG`);
    assert.ok(p.bytes < 250_000, `${s} is ${p.bytes} bytes`);
  }
  assert.deepEqual(readdirSync(join(ROOT, FL, 'images')).sort(), ['featureGraphic.png', 'icon.png', 'phoneScreenshots']);
  // The icon is drawn from the launcher's vectors (ICON-1, draft C), never from the web favicon (the same drawing).
  const tool = read('android/tools/build-store-icon.py');
  assert.match(tool, /SVG = os\.path\.join\(HERE, "launcher-icon\.svg"\)/);
  assert.match(tool, /ic_launcher_foreground\.xml/);
  assert.doesNotMatch(tool.replace(/"""[\s\S]*?"""/, ''), /favicon\.svg/);
});

test('privacy.html says what the Android app does, and only what its manifest allows', () => {
  const html = read('privacy.html');
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  for (const part of ['<h2>The Android app</h2>', '<h2>Where you got the app</h2>']) assert.ok(html.includes(part), part);
  for (const part of ['asks for no Android permission at all and has no internet access', 'not to send usage statistics to Google',
    'not to look up addresses in Google\'s lists of harmful sites', 'Android 13 and later hide it in the clipboard preview', 'Add to calendar app',
    'the app never reads or writes your calendar itself', 'keeps the fields out of Android\'s autofill', 'Android\'s backups leave it out',
    'A separate Google Play edition is built from the same source, with the same features and the same lack of permissions',
    'The app itself has no internet access and sends nothing, to Google or to us']) {
    assert.ok(text.includes(part), part);
  }
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.webkit\.WebView\.MetricsOptOut"\s+android:value="true"/);
  assert.match(manifest, /android\.webkit\.WebView\.EnableSafeBrowsing"\s+android:value="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
  const kt = read('android/app/src/main/kotlin/no/stormberry/gdprletterbuilder/MainActivity.kt');
  assert.match(kt, /putBoolean\(EXTRA_IS_SENSITIVE, true\)/);
  assert.match(kt, /IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS/);
  assert.match(kt, /IME_FLAG_NO_PERSONALIZED_LEARNING/);
  assert.doesNotMatch(kt, /READ_CALENDAR|WRITE_CALENDAR/);
});

// The release workflow

test('the release workflow: android-v* tags only, two jobs, the key in the release environment only', () => {
  const wf = read(WORKFLOW);
  assert.match(wf, /^on:\n {2}push:\n {4}tags: \["android-v\*"\]\n\n/m);
  assert.doesNotMatch(wf, /workflow_dispatch|pull_request|branches:/);
  assert.match(wf, /^permissions: \{\}$/m);
  assert.match(wf, /^ {2}build:\n {4}runs-on: ubuntu-latest\n {4}permissions:\n {6}contents: read\n/m);
  assert.match(wf, /^ {2}release:\n {4}needs: build\n {4}if: startsWith\(github\.ref, 'refs\/tags\/android-v'\)\n {4}runs-on: ubuntu-latest\n(?: {4}#.*\n)* {4}environment: release\n/m);
  // The secrets, by name only, and only in the release job.
  const secrets = [...new Set([...wf.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map((m) => m[1]!))].sort();
  assert.deepEqual(secrets, ['KEYSTORE_BASE64', 'KEYSTORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']);
  assert.ok(wf.indexOf('${{ secrets.') > wf.indexOf('\n  release:\n'));
  // Every action pinned to a full commit.
  const uses = [...wf.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
  assert.ok(uses.length >= 9);
  for (const u of uses) assert.match(u, /^[\w-]+\/[\w-]+(?:\/[\w-]+)?@[0-9a-f]{40}$/, u);
});

test('the release workflow runs every check the README names, before it builds the unsigned APK', () => {
  const wf = read(WORKFLOW);
  const order = ['tools/build-ts.sh --check', 'node --test tests/*.test.ts',
    './gradlew --no-daemon :app:testDebugUnitTest :app:verifyWebAssets :app:verifyWebAssetsCommitted :app:lintRelease',
    './gradlew --no-daemon -PunsignedRelease=true :app:assembleRelease', 'apksigner" verify "$APK"',
    'dump permissions', 'application-debuggable', 'GDPRLetterBuilder-MIT.txt', 'EXPECTED_WEB=', 'Read the pinned certificate', 'base64 -d',
    'apksigner" sign', 'shred -u', "grep -qx 'Number of signers: 1'", 'actions/attest-build-provenance', 'gh release create'];
  let at = -1;
  for (const step of order) {
    const i = wf.indexOf(step, at + 1);
    assert.ok(i > at, `${step} is missing or out of order`);
    at = i;
  }
  // The release key exists (30 October 2026): the pin is its certificate's SHA-256, read before the key is decoded.
  const pin = wf.match(/^ {10}EXPECTED_CERT=(.*)$/m)![1]!;
  assert.equal(pin, RELEASE_CERT);
  assert.ok(wf.indexOf('Read the pinned certificate') < wf.indexOf('name: Decode keystore'));
});

// The Google Play edition (StopScroll's switch, approved for GDPRLetterBuilder on 30 October 2026)

test('the Play switch: -PplayBuild=true builds no.stormberry.gdprletterbuilder.play, versionCode 1000 plus the sovereign one', () => {
  const gradle = read(GRADLE);
  assert.ok(versionCode() < 1000, 'the sovereign versionCode stays below the Play offset');
  assert.match(gradle, /^val PLAY_VERSION_CODE_OFFSET = 1000$/m);
  assert.match(gradle, /applicationId = if \(playBuild\) "no\.stormberry\.gdprletterbuilder\.play" else "no\.stormberry\.gdprletterbuilder"/);
  assert.match(gradle, /versionCode = 1\n {8}versionName = "0\.0\.1"\n {8}if \(playBuild\) \{\n {12}versionCode = PLAY_VERSION_CODE_OFFSET \+ versionCode!!\n {8}\}/);
  // Strict parsing: a bare -PplayBuild means Play, anything unknown stops the build.
  assert.match(gradle, /"", "true", "1", "yes" -> true\n\s*"false", "0", "no" -> false\n\s*else -> error\(/);
  assert.match(gradle, /if \(playBuild\) \{\n {4}base \{ archivesName = "gdprletterbuilder-play" \}\n\}/);
  assert.match(read('README.md'), /\| `android-v0\.0\.1` \| 1 \| 0\.0\.1 \| 1001 \|/);
  // The Play edition has the same features: nothing in the app's code or manifest depends on the switch.
  for (const f of walkFiles('android/app/src/main')) assert.ok(!/playBuild|\.play\b/.test(read(f)), `${f} depends on the Play switch`);
});

test('the Play guards: no release bundle without -PplayBuild=true, no release APK with it, the upload key never the release key', () => {
  const gradle = read(GRADLE);
  assert.match(gradle, /tasks\.matching \{ it\.name in releaseApkTasks \|\| it\.name == "signReleaseBundle" \}/);
  // Every task that writes a release APK is guarded as one, the APKs AGP makes from the bundle included.
  const apkTasks = gradle.match(/^val releaseApkTasks = setOf\(\n([\s\S]*?)\n\)$/m)![1]!.match(/"(\w+)"/g)!.map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(apkTasks, ['extractApksForRelease', 'makeApkFromBundleForRelease', 'packageRelease', 'packageReleaseUniversalApk']);
  assert.match(gradle, /if \(isBundle && !play\) \{\n\s*error\(\n\s*"Refusing to build a release bundle without -PplayBuild=true/);
  assert.match(gradle, /if \(!isBundle && play\) \{\n\s*error\(\n\s*"Refusing to build a release APK with -PplayBuild=true/);
  assert.match(gradle, /if \(!haveUploadKey\) \{\n\s*error\(\n\s*"playBuild=true but the Play upload keystore is not fully configured/);
  assert.match(gradle, /rel\.canonicalFile == upl\.canonicalFile \|\| rel\.readBytes\(\)\.contentEquals\(upl\.readBytes\(\)\)/);
  assert.match(gradle, /if \(configurationCacheRequested && \(uploadStorePassword != null \|\| uploadKeyPassword != null\)\)/);
  // The upload key is read from Gradle properties or the environment (PLAY_UPLOAD_*), never from the release key's names.
  for (const k of ['PLAY_UPLOAD_STORE_FILE', 'PLAY_UPLOAD_STORE_PASSWORD', 'PLAY_UPLOAD_KEY_ALIAS', 'PLAY_UPLOAD_KEY_PASSWORD']) assert.match(gradle, new RegExp(`signingValue\\("\\w+", "${k}"\\)`));
  assert.match(gradle, /if \(playBuild\) \{\n\s*if \(canSignPlayUpload\) signingConfig = signingConfigs\.getByName\("playUpload"\)\n\s*\} else if \(canSignRelease && !unsignedRelease\) \{\n\s*signingConfig = signingConfigs\.getByName\("release"\)/);
  assert.notEqual(UPLOAD_CERT, RELEASE_CERT);
  assert.match(read('README.md'), new RegExp(`upload key \\(certificate SHA-256 \`${UPLOAD_CERT}\`\\)`));
});

test('the release workflow never builds the Play edition and refuses any package but the sovereign one', () => {
  const wf = read(WORKFLOW);
  assert.doesNotMatch(wf, /playBuild|bundleRelease|PLAY_UPLOAD|\.aab\b/);
  assert.doesNotMatch(wf, new RegExp(UPLOAD_CERT));
  const gradlew = [...wf.matchAll(/^\s*run: (\.\/gradlew .*)$/gm)].map((m) => m[1]!);
  assert.deepEqual(gradlew, [
    './gradlew --no-daemon :app:testDebugUnitTest :app:verifyWebAssets :app:verifyWebAssetsCommitted :app:lintRelease',
    './gradlew --no-daemon -PunsignedRelease=true :app:assembleRelease',
  ]);
  assert.ok(wf.includes('[ "$PACKAGE" = no.stormberry.gdprletterbuilder ] || { echo "::error::the APK is $PACKAGE, not no.stormberry.gdprletterbuilder"; exit 1; }'));
  assert.ok(wf.includes('[ "$VERSION_CODE" -lt 1000 ] ||'));
  assert.ok(wf.indexOf('[ "$PACKAGE" = no.stormberry.gdprletterbuilder ]') < wf.indexOf('name: Decode keystore'));
});

test('the release workflow expects exactly the web files the Gradle build bundles', () => {
  const gradle = read(GRADLE);
  const includes = gradle.match(/val INCLUDES = listOf\(([\s\S]*?)\n {4}\)/)![1]!.match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1)).sort();
  const leftOut = [...gradle.match(/val LEFT_OUT = mapOf\(([\s\S]*?)\n {4}\)/)![1]!.matchAll(/"([^"]+)" to "/g)].map((m) => m[1]!);
  const block = read(WORKFLOW).match(/EXPECTED_WEB=\$\(cd \.\. && for f in ([\s\S]*?); do\n/)![1]!;
  const listed = block.replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean).sort();
  assert.deepEqual(listed, includes);
  const skipped = read(WORKFLOW).match(/case "\$f" in ([^)]+)\) continue ;; esac/)![1]!.split('|').sort();
  // Only LEFT_OUT entries an include pattern would otherwise take need skipping.
  assert.deepEqual(skipped, leftOut.filter((f) => f.startsWith('src/')).sort());
});

// The README's tool for a reproducible-build comparison

test('apk-without-signature: removes the APK Signing Block and moves the central directory offset back', async () => {
  const { withoutSignature, strippedSha256 } = await import('../android/tools/apk-without-signature.ts');
  const entries = new TextEncoder().encode('ENTRIES.');
  const cd = new TextEncoder().encode('CENTRALDIR');
  const eocd = (cdOffset: number): Uint8Array => {
    const e = new Uint8Array(22); const v = new DataView(e.buffer);
    v.setUint32(0, 0x06054b50, true); v.setUint32(12, cd.length, true); v.setUint32(16, cdOffset, true);
    return e;
  };
  const cat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const unsigned = cat(entries, cd, eocd(entries.length));
  const pair = new Uint8Array(12); new DataView(pair.buffer).setBigUint64(0, 4n, true); new DataView(pair.buffer).setUint32(8, 0x7109871a, true);
  const size = BigInt(pair.length + 8 + 16);
  const head = new Uint8Array(8); new DataView(head.buffer).setBigUint64(0, size, true);
  const block = cat(head, pair, head, new TextEncoder().encode('APK Sig Block 42'));
  const signed = cat(entries, block, cd, eocd(entries.length + block.length));
  assert.deepEqual(withoutSignature(signed), unsigned);
  assert.deepEqual(withoutSignature(unsigned), unsigned);
  assert.equal(strippedSha256(signed), strippedSha256(unsigned));
  const broken = signed.slice(); new DataView(broken.buffer).setBigUint64(entries.length, 99n, true);
  assert.throws(() => withoutSignature(broken), /disagree/);
  assert.throws(() => withoutSignature(new Uint8Array(40)), /not a zip/);
});

