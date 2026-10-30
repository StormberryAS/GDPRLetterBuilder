#!/usr/bin/env bash
# Compile GDPRLetterBuilder's TypeScript (ts/ and the Android bridge script) into the JavaScript the
# page and the app load.
#
# Copied on 29 October 2026 from EclipseTracker's tools/build-ts.sh (fbfb837), itself from the
# Website's of 2026-10-14. Changed for GDPRLetterBuilder: the modules are ts/src/ (compiled to
# src/), there is no data generator, the golden files take its place in the check, gate.js (written
# by build-gates.py at the root of the GitHub folder, never by this script) is the one other .js
# allowed beside app.js, and the hand-edit record lives outside git too (below).
#
#   tools/build-ts.sh           install the pinned compiler, compile every ts/**/*.ts into the .js
#                               of the same path at the repository root (ts/app.ts -> app.js,
#                               ts/src/x.ts -> src/x.js; ts/page.d.ts and ts/pure.d.ts are types
#                               only and emit nothing), compile the Android app's bridge script,
#                               android/web-overlay/android-bridge.ts, into android-bridge.js beside
#                               it (a classic script, never published), then run bump_assets.py so
#                               every import and every page carries the current ?v= stamp
#   tools/build-ts.sh --force   the same, but overwrite a compiled .js even when it holds a hand edit
#   tools/build-ts.sh --check   change nothing: fail when a compiled .js is missing, is not tracked
#                               by git (in a git checkout), or is not (stamps aside) byte for byte
#                               what its source compiles to; when the root, src/ or
#                               android/web-overlay/ holds a .js that no source compiles to (gate.js
#                               aside); when a page or an import carries a stale ?v=; or when a
#                               golden file is not what the compiled modules write
#                               (node tests/update-goldens.ts --check)
#
# Stamps. bump_assets.py stamps every relative import with the imported file's hash (?v=...), so a
# compiled .js at the root differs from what tsc writes in exactly those stamps. Every comparison
# below strips them first ("normalised"), and bump_assets.py --check then proves the stamps
# themselves are current. The TypeScript imports carry no stamp.
#
# Every mode first type-checks, and writes nothing when one fails:
#   * ts/src/ on its own with tsconfig.src.json, whose only library is ES2020 (and ts/pure.d.ts,
#     TextEncoder alone): no DOM. The modules are pure; the Node tests run them as the page does.
#   * the tests (tests/*.ts, run by Node 24 directly) with tests/tsconfig.json, strict.
#   * ts/ with tsconfig.json, strict, which also emits.
#   * the bridge script with android/web-overlay/tsconfig.json. That program is emitted into a
#     scratch folder and only android-bridge.js is taken from it. It has no ?v= stamps.
#
# The compiled .js files are committed on purpose: GitHub Pages publishes the repository's files as
# they are, with no build step of its own, and the Android build bundles them as they are and never
# runs tsc. Edit the TypeScript, never the .js. .gitattributes marks them linguist-generated.
#
# Hand edits. A build never overwrites a compiled .js silently. It writes only when the .js now on
# disk, normalised, is one some TypeScript source produced: what the committed sources (HEAD)
# compile to, what the current sources compile to, or what this script wrote last time. Anything
# else is an edit made in the .js itself: the build stops and writes nothing. Port the edit into
# the TypeScript and build again, or rerun with --force to drop it. The record of the last build
# lives in the git directory (build-ts.last) in a git checkout, so it is never committed or
# published; until the repository is under git (stage 4) it is .build-ts.last at the root, a dot
# file that neither Pages nor the APK takes, listed in .gitignore.
#
# The compiler is the exact version in package-lock.json, installed with `npm ci` (a frozen install)
# and with install scripts off. Needs Node 24 and npm, python3, and git only for the HEAD record
# and the tracked-file check (both are skipped outside a git checkout).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "$#:${1:-}" in
  0:)        MODE=build ;;
  1:--force) MODE=force ;;
  1:--check) MODE=check ;;
  *)         echo "usage: $0 [--check | --force]" >&2; exit 2 ;;
esac

die() { echo "build-ts: $*" >&2; exit 1; }
command -v node >/dev/null || die "node not found"
command -v npm >/dev/null || die "npm not found"
command -v python3 >/dev/null || die "python3 not found"
GIT=0
if command -v git >/dev/null && [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$ROOT" ]; then GIT=1; fi

npm ci --ignore-scripts --no-audit --no-fund --prefer-offline --loglevel=error >/dev/null \
  || die "npm ci failed (package.json and package-lock.json must agree; nothing was compiled)"
TSC=(node "$ROOT/node_modules/typescript/bin/tsc")
echo "build-ts: TypeScript $("${TSC[@]}" --version | sed 's/^Version //')"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A relative import with its ?v= stamp removed: from './src/x.js?v=0123abcd' to from './src/x.js'.
normalise() { sed -E "s#(['\"]\\.{1,2}/[^'\"?]+\\.js)\\?v=[0-9a-f]{8}(['\"])#\\1\\2#g" "$1"; }
nsha() { normalise "$1" | sha256sum | cut -d' ' -f1; }

"${TSC[@]}" -p "$ROOT/tsconfig.src.json" \
  || die "ts/src/ uses something only a browser has (see above): the modules stay free of the DOM; nothing was written"
"${TSC[@]}" -p "$ROOT/tests/tsconfig.json" || die "the tests (tests/*.ts) do not type-check; nothing was written"
"${TSC[@]}" -p "$ROOT/tsconfig.json" --outDir "$tmp/out" || die "ts/ does not compile; nothing was written"

mapfile -t OUTPUTS < <(cd "$tmp/out" && find . -type f -printf '%P\n' | LC_ALL=C sort)
mapfile -t EXPECTED < <(cd ts && find . -type f -name '*.ts' ! -name '*.d.ts' -printf '%P\n' | sed 's/\.ts$/.js/' | LC_ALL=C sort)
[ "${#OUTPUTS[@]}" -gt 0 ] || die "tsc emitted nothing"
[ "${OUTPUTS[*]}" = "${EXPECTED[*]}" ] \
  || die "tsc emitted [${OUTPUTS[*]}] but ts/ holds sources for [${EXPECTED[*]}]; look at tsconfig.json"

# The Android bridge script: its own program, of which only android-bridge.js is kept.
BRIDGE=android/web-overlay/android-bridge.js
"${TSC[@]}" -p "$ROOT/android/web-overlay/tsconfig.json" --noEmit false --outDir "$tmp/bridge" \
  || die "android/web-overlay/android-bridge.ts does not compile; nothing was written"
[ -f "$tmp/bridge/$BRIDGE" ] || die "tsc did not emit $BRIDGE; look at android/web-overlay/tsconfig.json"
mkdir -p "$tmp/out/$(dirname "$BRIDGE")"
cp "$tmp/bridge/$BRIDGE" "$tmp/out/$BRIDGE"
OUTPUTS+=("$BRIDGE")

# Where each compiled file comes from, for the messages.
source_of() { if [ "$1" = "$BRIDGE" ]; then echo "${BRIDGE%.js}.ts"; else echo "ts/${1%.js}.ts"; fi; }

# "./$1": a path that git reads as a path, whatever it starts with.
tracked() { [ "$GIT" = 1 ] && git ls-files --error-unmatch "./$1" >/dev/null 2>&1; }

if [ "$MODE" = check ]; then
  bad=0
  [ "$GIT" = 1 ] || echo "build-ts: not a git checkout; skipping the tracked-file check"
  for f in "${OUTPUTS[@]}"; do
    if [ ! -f "$f" ]; then
      echo "build-ts: $f is missing: run tools/build-ts.sh" >&2; bad=1
    elif [ "$(nsha "$f")" != "$(nsha "$tmp/out/$f")" ]; then
      echo "build-ts: $f is NOT what $(source_of "$f") compiles to: edit $(source_of "$f"), then run tools/build-ts.sh" >&2; bad=1
    elif [ "$GIT" = 1 ] && ! tracked "$f"; then
      echo "build-ts: $f is what $(source_of "$f") compiles to but is not tracked by git: git add it" >&2; bad=1
    else
      echo "build-ts: $f matches $(source_of "$f")"
    fi
  done
  # JavaScript with no source: the root, src/ and android/web-overlay/ hold only what the
  # TypeScript compiles to, and gate.js (generated by build-gates.py).
  mapfile -t PRESENT < <({ find . -maxdepth 1 -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -printf '%P\n'
    for d in src android/web-overlay; do [ -d "$d" ] && find "$d" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \); done; } | LC_ALL=C sort)
  for f in "${PRESENT[@]}"; do
    [ "$f" = gate.js ] && continue
    case " ${OUTPUTS[*]} " in
      *" $f "*) ;;
      *) echo "build-ts: $f is JavaScript that no TypeScript source compiles to: delete it, or restore its source" >&2; bad=1 ;;
    esac
  done
  node "$ROOT/tests/update-goldens.ts" --check || bad=1
  python3 -I "$ROOT/bump_assets.py" --check || bad=1
  [ "$bad" = 0 ] || exit 1
  echo "build-ts: check passed"
  exit 0
fi

if [ "$GIT" = 1 ]; then STATE="$(git rev-parse --absolute-git-dir)/build-ts.last"; else STATE="$ROOT/.build-ts.last"; fi

if [ "$MODE" = build ]; then
  if [ "$GIT" = 1 ] && git cat-file -e HEAD:tsconfig.json 2>/dev/null && git cat-file -e HEAD:ts 2>/dev/null; then
    mkdir -p "$tmp/head"
    git archive HEAD tsconfig.json ts | tar -x -C "$tmp/head"
    "${TSC[@]}" -p "$tmp/head/tsconfig.json" --outDir "$tmp/head-out" >/dev/null 2>&1 || true
    # The bridge as the committed android-bridge.ts compiles.
    if git cat-file -e "HEAD:${BRIDGE%.js}.ts" 2>/dev/null && git cat-file -e HEAD:android/web-overlay/tsconfig.json 2>/dev/null; then
      git archive HEAD "${BRIDGE%.js}.ts" android/web-overlay/tsconfig.json | tar -x -C "$tmp/head"
      if "${TSC[@]}" -p "$tmp/head/android/web-overlay/tsconfig.json" --noEmit false --outDir "$tmp/head-bridge" >/dev/null 2>&1; then
        mkdir -p "$tmp/head-out/$(dirname "$BRIDGE")"
        cp "$tmp/head-bridge/$BRIDGE" "$tmp/head-out/$BRIDGE"
      fi
    fi
  fi
  hand=()
  for f in "${OUTPUTS[@]}"; do
    [ -f "$f" ] || continue
    cur="$(nsha "$f")"
    [ "$cur" = "$(nsha "$tmp/out/$f")" ] && continue
    [ -f "$tmp/head-out/$f" ] && [ "$cur" = "$(nsha "$tmp/head-out/$f")" ] && continue
    [ -f "$STATE" ] && grep -qxF "$cur  $f" "$STATE" && continue
    hand+=("$f")
  done
  if [ "${#hand[@]}" -gt 0 ]; then
    for f in "${hand[@]}"; do
      echo "build-ts: $f holds changes that no TypeScript source produced (edited by hand?)" >&2
    done
    die "nothing was written. Port the change into its TypeScript source, then build again; or run tools/build-ts.sh --force to overwrite it."
  fi
fi

wrote=0
for f in "${OUTPUTS[@]}"; do
  if [ -f "$f" ] && [ "$(nsha "$f")" = "$(nsha "$tmp/out/$f")" ]; then continue; fi
  mkdir -p "$(dirname "$f")"
  cp "$tmp/out/$f" "$f"
  echo "build-ts: wrote $f"
  wrote=1
  if [ "$GIT" = 1 ] && ! tracked "$f"; then
    echo "build-ts: $f is new: git add it" >&2
  fi
done
[ "$wrote" = 1 ] || echo "build-ts: compiled output unchanged"
for f in "${OUTPUTS[@]}"; do printf '%s  %s\n' "$(nsha "$f")" "$f"; done > "$STATE"

# Always: bump_assets.py changes nothing when every stamp is current, and repairs a stale one even
# when the compiled output did not change.
python3 -I "$ROOT/bump_assets.py"
