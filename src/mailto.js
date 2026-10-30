/*! src/mailto.js is compiled from ts/src/mailto.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */
const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?=[\p{L}\p{N}-]*\p{L})[\p{L}\p{N}-]{2,63}$/u;
export function looksLikeEmail(text) {
    const t = String(text || '').trim();
    return t.length <= 254 && EMAIL_RE.test(t);
}
function encodeAddress(address) {
    return encodeURIComponent(address.trim()).replace(/%40/g, '@');
}
const crlf = (text) => String(text).replace(/\r\n|\r|\n/g, '\r\n');
export function buildMailto({ to, cc, subject, body }) {
    const addr = looksLikeEmail(to) ? encodeAddress(to) : '';
    const copy = looksLikeEmail(cc) ? `cc=${encodeAddress(cc)}&` : '';
    return `mailto:${addr}?${copy}subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(crlf(body || ''))}`;
}
