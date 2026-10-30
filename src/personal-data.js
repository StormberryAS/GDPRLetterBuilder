/*! src/personal-data.js is compiled from ts/src/personal-data.ts by tools/build-ts.sh, which leaves
    out every comment but this one: the explanations are in the source. Edit the TypeScript, never
    the .js: the build refuses to overwrite a hand edit, and its check mode fails on one. */
const W1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const W2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function controlDigit(digits, weights) {
    let sum = 0;
    for (let i = 0; i < weights.length; i++)
        sum += digits[i] * weights[i];
    const r = 11 - (sum % 11);
    if (r === 11)
        return 0;
    if (r === 10)
        return -1;
    return r;
}
export function isNorwegianId(text) {
    if (!/^\d{11}$/.test(text))
        return false;
    const d = [...text].map(Number);
    const k1 = controlDigit(d, W1);
    if (k1 < 0 || k1 !== d[9])
        return false;
    const k2 = controlDigit(d, W2);
    if (k2 < 0 || k2 !== d[10])
        return false;
    let day = d[0] * 10 + d[1];
    let month = d[2] * 10 + d[3];
    if (day > 40)
        day -= 40;
    if (month > 80)
        month -= 80;
    else if (month > 40)
        month -= 40;
    return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}
export function luhn(text) {
    if (!/^\d+$/.test(text))
        return false;
    let sum = 0;
    let double = false;
    for (let i = text.length - 1; i >= 0; i--) {
        let v = text.charCodeAt(i) - 48;
        if (double) {
            v *= 2;
            if (v > 9)
                v -= 9;
        }
        sum += v;
        double = !double;
    }
    return sum % 10 === 0;
}
const RUN_RE = /\d(?:[ .-]?\d)+/g;
export function findSensitive(text) {
    const out = [];
    const seen = new Set();
    for (const m of String(text || '').matchAll(RUN_RE)) {
        const groups = m[0].split(/[ .-]/);
        for (let i = 0; i < groups.length; i++) {
            let digits = '';
            for (let j = i; j < groups.length && digits.length <= 19; j++) {
                digits += groups[j];
                if (seen.has(digits))
                    continue;
                if (digits.length === 11 && isNorwegianId(digits)) {
                    seen.add(digits);
                    out.push({ kind: 'national-id', digits });
                }
                else if (digits.length >= 13 && digits.length <= 19 && /^[2-6]/.test(digits) && luhn(digits)) {
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
