/*! src/personal-data.js is compiled from ts/src/personal-data.ts by tools/build-ts.sh, which leaves
    out every comment but this one: the explanations are in the source. Edit the TypeScript, never
    the .js: the build refuses to overwrite a hand edit, and its check mode fails on one. */

// Live warnings for details a letter rarely needs (spec section 4, ID-2). They warn and never
// block, and they run on the device: nothing typed is sent anywhere.
//
//   * An 11-digit number that passes the Norwegian control-digit check: a national identity number
//     (fødselsnummer) or a D-number. No more information than needed [EDPB para 68]; national
//     identity numbers can be subject to national rules [EDPB para 78].
//   * A 13 to 19 digit number that passes the Luhn check and starts like a payment card (2 to 6,
//     our narrowing, so that most order and customer numbers do not trigger it): a payment card
//     number. A data request never needs it (our judgement).

const W1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const W2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

function controlDigit(digits: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += digits[i]! * weights[i]!;
  const r = 11 - (sum % 11);
  if (r === 11) return 0;
  if (r === 10) return -1; // no valid control digit: the number cannot be issued
  return r;
}

/**
 * Whether 11 digits form a valid Norwegian national identity number or D-number: both control
 * digits right, and a date part that can exist (day 01 to 31, or 41 to 71 for a D-number; month 01
 * to 12, or 41 to 52 for an H-number, or 81 to 92 for the synthetic test numbers of the National
 * Population Register).
 */
export function isNorwegianId(text: string): boolean {
  if (!/^\d{11}$/.test(text)) return false;
  const d = [...text].map(Number);
  const k1 = controlDigit(d, W1);
  if (k1 < 0 || k1 !== d[9]) return false;
  const k2 = controlDigit(d, W2);
  if (k2 < 0 || k2 !== d[10]) return false;
  let day = d[0]! * 10 + d[1]!;
  let month = d[2]! * 10 + d[3]!;
  if (day > 40) day -= 40;
  if (month > 80) month -= 80;
  else if (month > 40) month -= 40;
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

/**
 * The Luhn check, over digits only.
 */
export function luhn(text: string): boolean {
  if (!/^\d+$/.test(text)) return false;
  let sum = 0;
  let double = false;
  for (let i = text.length - 1; i >= 0; i--) {
    let v = text.charCodeAt(i) - 48;
    if (double) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    double = !double;
  }
  return sum % 10 === 0;
}

// Runs of digits, allowing single spaces, dots or hyphens between groups ("010190 12345",
// "4111 1111 1111 1111"), but not across letters.
const RUN_RE = /\d(?:[ .-]?\d)+/g;

/**
 * What the warnings should say about a piece of text. Returns a list of { kind, digits } with kind
 * 'national-id' or 'payment-card', each number once.
 *
 * A run can hold more than one number ("01019012480 2026", "order 12345 01019012480"), so every
 * stretch of whole groups in it is tested, not only the run as a whole. A run with no separators is
 * one group and is still only tested whole, so a long order number gives no warning for a slice of
 * itself.
 */
export function findSensitive(text: string | null | undefined): Array<{ kind: keyof typeof WARNINGS; digits: string; }> {
  const out: Array<{ kind: keyof typeof WARNINGS; digits: string; }> = [];
  const seen = new Set<string>();
  for (const m of String(text || '').matchAll(RUN_RE)) {
    const groups = m[0].split(/[ .-]/);
    for (let i = 0; i < groups.length; i++) {
      let digits = '';
      for (let j = i; j < groups.length && digits.length <= 19; j++) {
        digits += groups[j];
        if (seen.has(digits)) continue;
        if (digits.length === 11 && isNorwegianId(digits)) {
          seen.add(digits);
          out.push({ kind: 'national-id', digits });
        } else if (digits.length >= 13 && digits.length <= 19 && /^[2-6]/.test(digits) && luhn(digits)) {
          seen.add(digits);
          out.push({ kind: 'payment-card', digits });
        }
      }
    }
  }
  return out;
}

export const WARNINGS = {
  'national-id': 'This looks like a Norwegian national identity number (fødselsnummer). Include it only if the company already uses it to identify you, and think twice before sending it by ordinary email.',
  'payment-card': 'This looks like a payment card number. A data request never needs it.',
};
