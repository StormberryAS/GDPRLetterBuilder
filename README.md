# GDPRLetterBuilder

**Information, not legal advice.** GDPRLetterBuilder fills in a letter asking a company to show you the personal data it holds about you (an access request, GDPR Article 15) or to erase it (an erasure request, GDPR Article 17), in English or in Norwegian (Bokmål). It counts the company's deadline, gives you a reminder file for your own calendar, and explains what you can do if they do not answer, or not fully, including how to complain to the Norwegian Data Protection Authority (Datatilsynet).

It sends nothing. You read the letter, change what you need and send it yourself.

A functioning prototype from [Stormberry Labs](https://stormberry.as/labs.html). Data about you comes with rights, and they are yours.

## Status

**0.0.1, the first release, 30 October 2026.** The web app is at [gdpr.stormberry.as](https://gdpr.stormberry.as); the Android app comes from this repository's releases page and from Zapstore (below).

## What it does

1. **What do you want?** See what they hold (access) or have it deleted (erasure).
2. **Who are you writing to?** The company, how you will send it, where it is based, its privacy email and postal address.
3. **About you.** Your name, your email or postal address, where the reply should go, and any details that help them find your data. A warning shows if you type something that looks like a Norwegian national identity number or a payment card number. It warns and never blocks.
4. **What to ask for.** Everything, or only something you name. For access, the look-ups of your data (off by default) and the format of the copy. For erasure, the grounds (all optional) and the extras.
5. **Your letter.** A live letter in English or Bokmål. You can edit it; once you do, the form no longer changes it, until you rebuild it.
6. **Send it yourself.** Copy, open your email app (a draft, never sent), print or save as PDF, save as a text file, or share.
7. **Remember the deadline.** One month from receipt, counted the way the European Data Protection Board describes, with weekends and Norwegian public holidays rolled over. For post, the date of receipt is estimated. The extension is shown as the later of the two ways of counting it. A reminder file (.ics) holds the deadline and, unless you leave it out, the company's name; never your details.
8. **If they do not answer, or not fully.** What the law says in each situation, and what you can do.
9. **Write a follow-up letter.** A reminder when no answer came; the items an answer left out, ticked off against what the first letter asked for; an extension without reasons or told too late; a refusal without its reasons, its § 16 reference or the complaint information; a request for identity information beyond what is needed. In English or Bokmål, with a hint when a reminder may be early. No threat and no time limit of its own.
10. **Complaining to Datatilsynet.** The steps and what to attach, and a cover note: a dated timeline of what happened, with the attachments numbered, in Bokmål or English. Facts only.
11. **Sources and date.** Every source the letters rely on, and the date they were checked.

## What it never does

- Send anything: no email, no web form submission, no server.
- Look anything up: no company search, no address lookup.
- Keep your details, your letters or a history. Reloading the page empties every field. The only thing stored is the first-run notice's flag (`sb-gate:gdprletterbuilder:v2`).
- Tell you whether a company has broken the law, or advise on your case.
- Write anything with AI while you use it. The letters are fixed texts, checked against the sources listed on the page on 12 October 2026.

## Privacy and security

The page's own Content Security Policy is the first element in `<head>`:

    default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'

No inline scripts or styles, no WebAssembly, no worker, no form element, no URL parameters read, no cookies, no analytics, no third-party code. The browser enforces this policy together with the zone's header, so no host-specific Cloudflare rule is needed (as for MetadataScrubber). The end-to-end test proves that the page makes no request after it has loaded, and that nothing typed reaches a request or any storage the page itself can reach (localStorage, sessionStorage, IndexedDB, Cache Storage, cookies). Every field carries `autocomplete="off"`, and the LibreWolf suite checks that a crash and restart brings nothing back. See `privacy.html`.

## Android app

The Android app (package `no.stormberry.gdprletterbuilder`, Android 7.0 or later) runs the same files as the website, bundled inside it, offline, in Android's web view. It adds what the page cannot do well inside an app: **Add to calendar app** hands the reminder to your calendar app, **Print or save as PDF** opens Android's print screen, and the save buttons open Android's save screen. Each `android-v*` tag runs the release workflow, which publishes `gdprletterbuilder-v<version>.apk` on this repository's releases page with a `.sha256` file and a build provenance attestation. The release is then listed on Zapstore. Nothing has been released yet.

### Install

From [Zapstore](https://zapstore.dev/apps/no.stormberry.gdprletterbuilder), or download the APK and its `.sha256` file from this repository's releases page and check them as below before you install.

### Permissions: none

```bash
aapt dump permissions gdprletterbuilder-v0.0.1.apk
```

prints one line, `package: no.stormberry.gdprletterbuilder`, and nothing else. There is no internet permission (the manifest removes it), so the app cannot send anything anywhere; links to other sites open in your own browser. There is no storage permission: files go out through Android's save screen. There is no calendar permission: Add to calendar app hands the event to your calendar app, which opens it for you to save or not. The clipboard is marked sensitive, the keyboard is asked not to learn from what you type, the fields are kept out of Android's autofill, and the app's data is left out of every backup. `android/expected-permissions.txt` holds that one line: every build fails if the merged manifest asks for any permission, and the release workflow fails if the APK's permissions are anything else. The app sends the page's Content Security Policy and `Referrer-Policy: no-referrer` with every file it serves to its web view. See `privacy.html`, "The Android app".

### Verify a release

```bash
sha256sum -c gdprletterbuilder-v0.0.1.apk.sha256
apksigner verify --print-certs gdprletterbuilder-v0.0.1.apk
gh attestation verify gdprletterbuilder-v0.0.1.apk -R StormberryAS/GDPRLetterBuilder
```

**Signing certificate SHA-256:** `8287710abd10fc1d37615299bd11c3e79306545ecc3e1b968010da54a80424e2` (RSA 4096). GDPRLetterBuilder has its own key (one key per app), and this certificate never changes.

### Reproducible build

The build is reproducible: the same commit gives the same APK, byte for byte (the unsigned release was built twice and compared on 16 and 29 October 2026). To check a release against its tag, build it unsigned, sign it with a key of your own the way the workflow signs, and compare the two with their signatures taken out (`android/tools/apk-without-signature.ts`, run by Node 24):

```bash
git clone https://github.com/StormberryAS/GDPRLetterBuilder.git
cd GDPRLetterBuilder && git checkout android-v0.0.1
cd android && ./gradlew --no-daemon -PunsignedRelease=true :app:assembleRelease
BT="$ANDROID_HOME/build-tools/36.0.0"
"$BT/zipalign" -f 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
keytool -genkeypair -keystore mine.p12 -storetype PKCS12 -alias mine -keyalg RSA -keysize 4096 -validity 1 -dname CN=mine
"$BT/apksigner" sign --ks mine.p12 --ks-key-alias mine \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --out mine.apk aligned.apk
cd .. && node android/tools/apk-without-signature.ts android/mine.apk /path/to/gdprletterbuilder-v0.0.1.apk
```

The two lines must show the same SHA-256. Use JDK 21, as the workflow does (Temurin 21), and a 4096-bit key as above, the size of the release key, so the signing block takes the same room.

### The release workflow

`.github/workflows/android-release.yml` starts on `android-v*` tags only; there is no manual run. It has two jobs. **build** holds no secret and no token that can write: it refuses to go on while a store text, the README or the privacy page still carries a draft marker, then runs `tools/build-ts.sh --check`, the Node suite, the Kotlin unit tests, `verifyWebAssets` and `verifyWebAssetsCommitted` (every bundled web file byte for byte the published and the committed one) and lint, and builds the release APK unsigned (`-PunsignedRelease=true`). **release** runs no Gradle and no Node. It checks the unsigned APK before any key is decoded: no permission, not debuggable, the version the tag names, every web file byte for byte the tagged commit's, and the licence texts. Then it aligns and signs it with Google's zipalign and apksigner, refuses it unless there is exactly one signer with the pinned certificate and signing changed no file, attests it and publishes the APK with its `.sha256`.

The key is used only through the `release` environment, which allows `android-v*` tags only and waits for an approval on GitHub before each release. Its secrets, set from the keystore and the keyring and never shown: `KEYSTORE_BASE64` (the `.p12` file, base64), `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`. None of them is a repository secret. A tag ruleset restricts who may create, move or delete `android-v*` tags. Until the release certificate is pinned in the workflow, the release job stops before it decodes any key.

### Build from source

Requirements: JDK 21 and the Android SDK with platform 37.1 and build-tools 36.0.0. From `android/`:

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug   # the Kotlin tests and a debug APK
./gradlew :app:verifyWebAssets                         # prove the bundled web files match
./gradlew -PunsignedRelease=true :app:assembleRelease  # the release APK, unsigned
```

The app bundles an explicit list of web files (`WebAssets.INCLUDES` in `android/app/build.gradle.kts`): the page, its modules, the style sheets, the privacy page, the disclaimer, the first-run notice, the fonts with their licence and the carousel icons. Every build checks that each bundled file is byte for byte the one GitHub Pages publishes (apart from one line in `index.html` that loads `android/web-overlay/android-bridge.js`), that every file the page refers to is bundled, and that nothing else is; a release build also checks them against the commit `HEAD` points at. `fastlane/`, `zapstore.yaml` and this README are never bundled.

The store files are `fastlane/metadata/android/en-US/` (the title, the descriptions, the release note of each versionCode, the icon, the feature graphic and the phone screenshots) and `zapstore.yaml`; `tests/store.test.ts` checks them, and the release workflow against them. `android/tools/build-store-icon.py` renders the icon and the feature graphic from the launcher icon (Chromium and Pillow). A signed release needs the release key, which never enters this repository: the release workflow signs with apksigner from the `release` environment's secrets.

## Try it locally

    python3 tests/serve.py --port 8899

Then open `http://127.0.0.1:8899/`. The server sends the same security headers as the live zone and serves only what GitHub Pages would publish (`_config.yml`).

## Tests

Node 24, Python 3, Chromium and, for one suite, LibreWolf. The tests are TypeScript, run by Node 24 directly (it strips the types); `npm ci --ignore-scripts` installs the pinned compiler and Node's types, which the build and the type check use.

    npm test                              # the engines (the deadline also against an independent count), the letters, the citations, the copy, the static and release checks
    node tests/ui-smoke.ts --out DIR      # Chromium: widths, 200% text, dark, light and forced colours, keyboard, print, the notice
    node tests/e2e.ts --out DIR           # Chromium over HTTPS as gdpr.stormberry.as: no requests (non-Latin typing included), the canary audit, the saved files
    node tests/librewolf-smoke.ts         # LibreWolf with fingerprinting protection: the notice, the files, mailto, session restore, a crash and restart
    node tests/app-mode-smoke.ts --out DIR  # the page as the Android app loads it, with the bridge script
    tools/build-ts.sh --check             # the compiled files current, the type check, the goldens, the stamps

`npm test` runs `node --test tests/*.test.ts`; the browser suites do not end in `.test.ts`, so it skips them. `tests/goldens/` holds every letter variant; after a deliberate change to the wording, run `node tests/update-goldens.ts` and read the diff (`node tests/update-goldens.ts --check` writes nothing and fails on any difference). When the spec is beside this repository, `tests/spec-wording.test.ts` checks the four letters against the spec's own templates, character for character. The code that the browser suites run inside the page is TypeScript too: typed functions, sent with `inPage()` from `tests/cdp.ts`, never JavaScript written in a string.

## TypeScript

The app is written in TypeScript (since 29 October 2026). The page's code is `ts/app.ts` and the pure modules `ts/src/*.ts`; the Android bridge script is `android/web-overlay/android-bridge.ts`. `tools/build-ts.sh` compiles them into the JavaScript the page and the app load, `app.js`, `src/*.js` and `android/web-overlay/android-bridge.js`, and then runs `bump_assets.py`:

    npm ci --ignore-scripts
    tools/build-ts.sh                     # compile, then stamp
    tools/build-ts.sh --check             # change nothing; fail on any drift

The compiled files are committed, because GitHub Pages publishes the repository as it is, with no build step, and the Android build bundles them as they are. Edit the TypeScript, never the `.js`: the build refuses to overwrite a hand edit, and its check mode fails on one. `.gitattributes` marks the compiled files as generated. The check also type-checks `ts/src/` with no DOM at all (`tsconfig.src.json`: the modules stay pure), the bridge script (`android/web-overlay/tsconfig.json`) and the tests (`tests/tsconfig.json`), all strict. Some tests read only the TypeScript source (the layout of the page and of the bridge); they speak for what ships only because the check proves that the compiled files are what the source compiles to, so a CI run needs `tools/build-ts.sh --check` as well as `npm test`. The compiled files keep only their header comment: every explanation, the privacy notes at the top of `ts/app.ts` included, is in the source.

TypeScript 6.0.3 and `@types/node` 24.19.2 are the development dependencies, pinned with their integrity hashes (`package.json`, `package-lock.json`, `.npmrc`); the page itself has none. `ts/page.d.ts` types the page's elements by id, and `tests/static.test.ts` checks it against `index.html`. The TypeScript imports carry no stamp; `bump_assets.py` writes the `?v=` stamps into the compiled files. None of the TypeScript, tooling or compiler files is published (`_config.yml`) or bundled into the Android app, and `node_modules/` is ignored.

The only other JavaScript in the repository is `gate.js`, the first-run notice: it is generated for every Labs app by `build-gates.py` at the root of the GitHub folder and is exempt, so it stays as that generator writes it (marked generated too). `tests/static.test.ts` fails on any other `.js`, `.mjs` or `.cjs`.

## Files

- `index.html`, `app.js`, `style.css`: the page. `app.js` only renders; it is compiled from `ts/app.ts`.
- `src/`: pure modules, tested in Node, compiled from `ts/src/`. `letters.js` (the templates as data), `citations.js` (the verified list of citations and sources), `deadline.js` and `holidays-no.js`, `ics.js`, `mailto.js`, `personal-data.js`, `format.js`, `followups.js`, `timeline.js`.
- `gate.js`, `gate.css`, `disclaimer.html`, `disclaimer.css`: generated by `build-gates.py` and `build-disclaimers.py` at the root of the GitHub folder. Do not edit them here.
- `DISCLAIMER.md`: the source of `disclaimer.html`; the section "Specific to GDPRLetterBuilder" is this app's own.
- `privacy.html`: the privacy page, no scripts.
- `fonts/inter/`, `licences/Inter-OFL-1.1.txt`: the Inter typeface and its licence (see `NOTICE`).
- `favicon.svg`, `apple-touch-icon.png`, `og-image.png`: the icon (ICON-1, draft C, the same drawing as the Android launcher icon), the Home Screen icon for iPhone and iPad (180 x 180, from the store icon) and the picture for link previews.
- `switcher-icons/`: the Stormberry Labs carousel icons; `gdpr.svg` is a byte copy of `favicon.svg`.
- `bump_assets.py`: stamps `?v=` hashes on assets and module imports. Run it after every edit to a stylesheet or script.
- `ts/`, `tsconfig.json`, `tsconfig.src.json`, `tools/build-ts.sh`, `package.json`, `package-lock.json`, `.npmrc`, `.gitattributes`: the TypeScript and its build (see TypeScript). Never published.

## Disclaimer

GDPRLetterBuilder gives information, not legal advice, and using it does not make Stormberry AS your lawyer or adviser. See `DISCLAIMER.md`, shown in the app as the Disclaimer page.

## Licence

MIT, see `LICENSE`. Third-party notices in `NOTICE`. Copyright (c) 2026 Stormberry AS, Askøy, Norway.
