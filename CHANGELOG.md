# Changelog

Every released version of GDPRLetterBuilder, newest first. Each release is tagged `android-vX.Y.Z`,
and its APK, the APK's `.sha256` file and its build provenance attestation are on the
[releases page](https://github.com/StormberryAS/GDPRLetterBuilder/releases). The short note shown in
the app store for a release is `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`; this
file is the full log it points to. The website, [gdpr.stormberry.as](https://gdpr.stormberry.as),
runs the same files as the app. Every release on the releases page and Zapstore is signed with
the same key, certificate SHA-256 `8287710abd10fc1d37615299bd11c3e79306545ecc3e1b968010da54a80424e2`.

## 0.0.2 (versionCode 2), 1 November 2026

A maintenance release. Nothing you see or use changes: the page, the letters, the deadline, the
reminder, the first-run notice's words and the permissions (none) are the same as in 0.0.1.

- The first-run notice is now TypeScript, like the rest of the page. Its source is `ts/gate.ts`,
  which the shared generator `build-gates.py` writes for every Stormberry Labs app, and
  `tools/build-ts.sh` compiles it to `gate.js`. Before, `gate.js` was the one JavaScript file in
  the repository that was not compiled from TypeScript.
- The notice keeps the same flag under the same key (`sb-gate:gdprletterbuilder:v2`), so a notice
  you closed in 0.0.1 stays closed.
- The compiled `gate.js` keeps only its header comment, as `app.js` does; the explanations are in
  the source.
- Zapstore's listing now links to gdpr.stormberry.as.
- The Google Play edition of this version has versionName 0.0.2 and versionCode 1002.

## 0.0.1 (versionCode 1), 30 October 2026

The first release, on the website and as an Android app.

- Writes a GDPR access or erasure letter in English or Bokmål, ready to copy, save, print or share.
- Counts the company's one-month deadline, with weekends and Norwegian public holidays rolled
  over, and saves a reminder file for your calendar, or hands it to your calendar app on Android.
- Follow-up letters for an answer that is missing, late or incomplete, and a cover note with a
  dated timeline for a complaint to Datatilsynet.
- On Android: Save as PDF through Android's print screen, and Send using email app with the whole
  letter in the draft.
- Information, not legal advice. No permissions, no internet access; it sends nothing.
