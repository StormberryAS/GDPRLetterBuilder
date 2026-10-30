/*! src/mailto.js is compiled from ts/src/mailto.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the TypeScript, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */

// "Open email app" (spec section 6, OUT-1): a mailto: link that opens a draft in the person's own
// email app. It never sends anything; the person presses Send there.
//
// The link carries the recipient and the subject, and the body only when the whole link stays
// within MAILTO_MAX characters (CheckLink's REPORT_MAX): longer links are cut or refused by some
// email apps and operating systems. Over the cap the page copies the letter and opens a draft
// without the body, and says "Paste the letter into the message."
//
// Built with encodeURIComponent only. Line breaks become CRLF before encoding, as RFC 6068 asks.

export const MAILTO_MAX = 1800;

// A format check only (spec section 4): one address, no spaces or separators in the local part,
// and a domain of letters, digits and hyphens in dot-separated labels, ending in a label with a
// letter (so no IP literal). Unicode letters are allowed, so an address on a Norwegian domain
// (bøker.no) passes as typed and in the punycode form a browser's email field gives it. Nothing
// such as ?, &, #, / or % gets through in the domain, where it would only make the draft bounce.
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
 * Returns { href, withBody }. withBody is false when the body would take the link over the cap;
 * the href then has no body. An address that fails the format check gives no recipient.
 */
export function buildMailto({ to, subject, body }: { to?: string; subject?: string; body?: string; }): { href: string; withBody: boolean; } {
  // looksLikeEmail() is false for a missing address, so encodeAddress() always has one.
  const addr = looksLikeEmail(to) ? encodeAddress(to as string) : '';
  const head = `mailto:${addr}?subject=${encodeURIComponent(subject || '')}`;
  const full = `${head}&body=${encodeURIComponent(crlf(body || ''))}`;
  if (full.length <= MAILTO_MAX) return { href: full, withBody: true };
  return { href: head, withBody: false };
}
