/*! src/mailto.js is compiled from ts/src/mailto.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */

// "Send using email app" (spec section 6, OUT-1): a mailto: link that opens a draft in the person's
// own email app, with the company's privacy email in To, the person's own email address in Cc when
// they gave one, the subject and the whole letter as the body. It never sends anything; the person
// presses Send there.
//
// The body is always in the link, however long the letter is (Marcos, 30 October 2026: "with the
// text body already filled in with the letter and also sending to the person itself as Cc"). The
// cap of 1,800 characters and the copy-first button it needed are gone. The Android app reads the
// same link and hands each part to the email app separately (NavigationPolicy.mailDraft), so a
// long letter does not depend on how much of a link an email app reads.
//
// Built with encodeURIComponent only. Line breaks become CRLF before encoding, as RFC 6068 asks.
// Each address passes looksLikeEmail() or is left out, so no address can carry a second address,
// a line break or a field of its own (?, & and = are encoded or refused), and the subject and body
// are encoded whole, so neither can add a field either.

// A format check only (spec section 4): one address, no spaces or separators in the local part,
// and a domain of letters, digits and hyphens in dot-separated labels, ending in a label with a
// letter (so no IP literal). Unicode letters are allowed, so an address on a Norwegian domain
// (bøker.no) passes as typed and in the punycode form a browser's email field gives it. Nothing
// such as ?, &, #, / or % gets through in the domain, where it would only make the draft bounce.
// The local part may hold ? & = %, which encodeAddress() encodes, so they stay part of the address.
const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?=[\p{L}\p{N}-]*\p{L})[\p{L}\p{N}-]{2,63}$/u;

export function looksLikeEmail(text: string | null | undefined): boolean {
  const t = String(text || '').trim();
  return t.length <= 254 && EMAIL_RE.test(t);
}

/**
 * The recipient part: encoded, with the @ kept readable (RFC 6068 allows it unencoded).
 */
function encodeAddress(address: string): string {
  return encodeURIComponent(address.trim()).replace(/%40/g, '@');
}

const crlf = (text: string) => String(text).replace(/\r\n|\r|\n/g, '\r\n');

/**
 * The draft's mailto: link: To the company's address, Cc the person's own address, the subject and
 * the body. An address that fails the format check is left out (no To, or no Cc), never sent half.
 */
export function buildMailto({ to, cc, subject, body }: { to?: string; cc?: string; subject?: string; body?: string; }): string {
  // looksLikeEmail() is false for a missing address, so encodeAddress() always has one.
  const addr = looksLikeEmail(to) ? encodeAddress(to as string) : '';
  const copy = looksLikeEmail(cc) ? `cc=${encodeAddress(cc as string)}&` : '';
  return `mailto:${addr}?${copy}subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(crlf(body || ''))}`;
}
