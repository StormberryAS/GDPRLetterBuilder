// Rewrites tests/goldens/*.txt and tests/goldens/followup/*.txt from the letter templates, as the
// compiled modules (src/*.js) write them. Run it only after a deliberate change to the wording,
// read the diff, and commit the goldens with the change:
//
//   node tests/update-goldens.ts           write the goldens
//   node tests/update-goldens.ts --check   write nothing; exit 1 when a golden differs or is missing
//                                          (tools/build-ts.sh --check runs this)
//
// The file name does not end in .test.ts, so `npm test` does not run it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { render } from '#src/letters.js';
import { render as renderFollowUp } from '#src/followups.js';
import { render as renderTimeline } from '#src/timeline.js';
import { CASES } from './golden-cases.ts';
import { CASES as STAGE2 } from './followup-cases.ts';

const check = process.argv.slice(2).includes('--check');
const dir = new URL('./goldens/', import.meta.url);
const sub = new URL('./goldens/followup/', import.meta.url);
const files: Array<[URL, string]> = [
  ...CASES.map((c): [URL, string] => [new URL(`${c.id}.txt`, dir), `${render(c.input).text}\n`]),
  ...STAGE2.map((c): [URL, string] => [new URL(`${c.id}.txt`, sub), `${c.kind === 'timeline' ? renderTimeline(c.input) : renderFollowUp(c.input).text}\n`]),
];
if (check) {
  const bad = files.filter(([url, text]) => !existsSync(url) || readFileSync(url, 'utf8') !== text).map(([url]) => url.pathname.replace(/^.*\/tests\//, 'tests/'));
  for (const f of bad) console.error(`update-goldens: ${f} is not what the modules write (run node tests/update-goldens.ts and read the diff)`);
  if (bad.length) process.exit(1);
  console.log(`update-goldens: ${CASES.length} goldens and ${STAGE2.length} stage 2 goldens match`);
} else {
  mkdirSync(sub, { recursive: true });
  for (const [url, text] of files) writeFileSync(url, text);
  console.log(`${CASES.length} goldens and ${STAGE2.length} stage 2 goldens written`);
}
