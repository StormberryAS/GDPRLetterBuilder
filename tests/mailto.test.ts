// "Open email app" (spec section 6, OUT-1): the 1,800 character cap, the body dropped above it,
// the encoding of æ, ø, å and line breaks, and the format check on the address.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMailto, looksLikeEmail, MAILTO_MAX } from '#src/mailto.js';
import { render } from '#src/letters.js';
import { PERSON } from './golden-cases.ts';

test('the cap is CheckLink\'s REPORT_MAX, 1,800 characters for the whole link', () => {
  assert.equal(MAILTO_MAX, 1800);
});

test('a short body goes in, encoded: CRLF line breaks, æ, ø and å, and nothing unescaped', () => {
  const r = buildMailto({ to: 'personvern@eksempel.example', subject: 'Innsyn (artikkel 15)', body: 'Hei\nblåbær & ørret?' });
  assert.equal(r.withBody, true);
  assert.equal(r.href, 'mailto:personvern@eksempel.example?subject=Innsyn%20(artikkel%2015)&body=Hei%0D%0Abl%C3%A5b%C3%A6r%20%26%20%C3%B8rret%3F');
  // Decodes back to exactly what went in (with CRLF).
  const u = new URL(r.href);
  assert.equal(decodeURIComponent(u.search.split('&body=')[1]!), 'Hei\r\nblåbær & ørret?');
});

test('a whole letter is over the cap: the body is dropped, the recipient and subject stay', () => {
  const letter = render({ ...PERSON });
  const r = buildMailto({ to: PERSON.companyEmail, subject: letter.subject, body: letter.text });
  assert.equal(r.withBody, false);
  assert.equal(r.href, `mailto:personvern@eksempel-handel.example?subject=${encodeURIComponent(letter.subject)}`);
  assert.ok(r.href.length <= MAILTO_MAX);
});

test('right at the cap: 1,800 characters keeps the body, 1,801 drops it', () => {
  const head = 'mailto:a@b.example?subject=x&body=';
  const fit = 'y'.repeat(MAILTO_MAX - head.length);
  assert.equal(buildMailto({ to: 'a@b.example', subject: 'x', body: fit }).href.length, 1800);
  assert.equal(buildMailto({ to: 'a@b.example', subject: 'x', body: fit }).withBody, true);
  assert.equal(buildMailto({ to: 'a@b.example', subject: 'x', body: `${fit}y` }).withBody, false);
  // Encoding counts: ø is six characters once encoded.
  assert.equal(buildMailto({ to: 'a@b.example', subject: 'x', body: 'ø'.repeat(Math.floor((MAILTO_MAX - head.length) / 6) + 1) }).withBody, false);
});

test('the address: a format check only; anything else leaves the recipient empty rather than inventing one', () => {
  for (const ok of ['a@b.no', 'personvern@eksempel-handel.example', 'first.last+gdpr@sub.domain.co.uk']) assert.ok(looksLikeEmail(ok), ok);
  for (const bad of ['', 'a@b', 'a b@c.no', 'a@b.no,c@d.no', 'a@b.no;c@d.no', '<a@b.no>', 'a@@b.no', 'mailto:a@b.no', 'a@b.n']) assert.ok(!looksLikeEmail(bad), bad);
  // The domain takes letters, digits and hyphens only: these would make a draft that bounces
  // (code review of 12 October 2026). An IP literal is refused too.
  for (const bad of ['privacy@co.example&body=Injected', 'privacy@co.example?bcc=x%40y.example', 'privacy@co.example#frag', 'privacy@co.example/../x', 'x@127.0.0.1', 'a@-b.no', 'a@b-.no', 'a@b..no']) {
    assert.ok(!looksLikeEmail(bad), bad);
    assert.equal(buildMailto({ to: bad, subject: 's', body: 'b' }).href, 'mailto:?subject=s&body=b', bad);
  }
  // Unicode domains as typed, and in the punycode form Chromium's email field gives; plus addressing.
  for (const ok of ['post@bøker.no', `post@xn${'-'.repeat(2)}bker-gra.no`, 'kari+gdpr@example.no', 'dpo@sub.firma.no']) assert.ok(looksLikeEmail(ok), ok);
  assert.equal(buildMailto({ to: 'a@b.no?cc=x@y.no', subject: 's', body: 'b' }).href, 'mailto:?subject=s&body=b');
  assert.equal(buildMailto({ to: 'x@y.no&bcc=z@w.no', subject: 's', body: 'b' }).href, 'mailto:?subject=s&body=b');
  // Never a cc or bcc smuggled in through the subject or the body.
  const r = buildMailto({ to: 'a@b.no', subject: 'x&cc=evil@example.com', body: 'y&bcc=evil@example.com' });
  assert.equal(new URL(r.href).searchParams.get('cc'), null);
  assert.equal(new URL(r.href).searchParams.get('bcc'), null);
});
