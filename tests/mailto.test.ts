// "Send using email app" (spec section 6, OUT-1, changed 30 October 2026): To, Cc, the subject and
// the whole letter, however long; the encoding of æ, ø, å and line breaks; the format check on each
// address; and no field smuggled in through an address, the subject or the body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mailto from '#src/mailto.js';
import { render } from '#src/letters.js';
import { PERSON } from './golden-cases.ts';

const { buildMailto, looksLikeEmail } = mailto;

/** The link's fields after the "?", decoded, in order. */
const fields = (href: string): Array<[string, string]> => href.slice(href.indexOf('?') + 1).split('&').map((f) => {
  const eq = f.indexOf('=');
  return [f.slice(0, eq), decodeURIComponent(f.slice(eq + 1))];
});

test('there is no length cap any more: MAILTO_MAX is gone', () => {
  assert.ok(!('MAILTO_MAX' in mailto));
});

test('the body goes in, encoded: CRLF line breaks, æ, ø and å, and nothing unescaped', () => {
  const href = buildMailto({ to: 'personvern@eksempel.example', subject: 'Innsyn (artikkel 15)', body: 'Hei\nblåbær & ørret?' });
  assert.equal(href, 'mailto:personvern@eksempel.example?subject=Innsyn%20(artikkel%2015)&body=Hei%0D%0Abl%C3%A5b%C3%A6r%20%26%20%C3%B8rret%3F');
  assert.deepEqual(fields(href), [['subject', 'Innsyn (artikkel 15)'], ['body', 'Hei\r\nblåbær & ørret?']]);
});

test('Cc: the person\'s own address when it is a valid one, before the subject; none otherwise', () => {
  const href = buildMailto({ to: 'personvern@eksempel.example', cc: 'kari.nordmann@example.no', subject: 's', body: 'b' });
  assert.equal(href, 'mailto:personvern@eksempel.example?cc=kari.nordmann@example.no&subject=s&body=b');
  for (const cc of [undefined, '', '   ', 'kari', 'kari@example', 'a@b.no,evil@example.com', 'a@b.no\r\nBcc: evil@example.com', '<a@b.no>', 'a@b.no?bcc=evil@example.com', 'a@b.no&bcc=evil@example.com']) {
    assert.equal(buildMailto({ to: 'p@e.example', cc, subject: 's', body: 'b' }), 'mailto:p@e.example?subject=s&body=b', String(cc));
  }
  // Trimmed, and an encoded local part keeps its characters inside the address.
  assert.equal(buildMailto({ to: 'p@e.example', cc: '  kari+gdpr@example.no ', subject: 's', body: 'b' }), 'mailto:p@e.example?cc=kari%2Bgdpr@example.no&subject=s&body=b');
  assert.deepEqual(fields(buildMailto({ to: 'p@e.example', cc: 'k?a&r=i@example.no', subject: 's', body: 'b' })), [['cc', 'k?a&r=i@example.no'], ['subject', 's'], ['body', 'b']]);
  // No company address: a draft with the Cc alone.
  assert.equal(buildMailto({ to: '', cc: 'kari@example.no', subject: 's', body: 'b' }), 'mailto:?cc=kari@example.no&subject=s&body=b');
});

test('a whole letter, and a letter far longer than any cap, goes in whole', () => {
  const letter = render({ ...PERSON });
  const href = buildMailto({ to: PERSON.companyEmail, cc: PERSON.email, subject: letter.subject, body: letter.text });
  assert.ok(href.length > 1800);
  assert.deepEqual(fields(href), [['cc', PERSON.email], ['subject', letter.subject], ['body', letter.text.replace(/\r\n|\r|\n/g, '\r\n')]]);
  assert.ok(href.startsWith('mailto:personvern@eksempel-handel.example?cc='));
  const long = 'Æøå line\n'.repeat(20000);
  assert.equal(fields(buildMailto({ to: 'a@b.example', subject: 'x', body: long }))[1]![1], long.replace(/\n/g, '\r\n'));
});

test('the address: a format check only; anything else leaves the recipient empty rather than inventing one', () => {
  for (const ok of ['a@b.no', 'personvern@eksempel-handel.example', 'first.last+gdpr@sub.domain.co.uk']) assert.ok(looksLikeEmail(ok), ok);
  for (const bad of ['', 'a@b', 'a b@c.no', 'a@b.no,c@d.no', 'a@b.no;c@d.no', '<a@b.no>', 'a@@b.no', 'mailto:a@b.no', 'a@b.n']) assert.ok(!looksLikeEmail(bad), bad);
  // The domain takes letters, digits and hyphens only: these would make a draft that bounces
  // (code review of 12 October 2026). An IP literal is refused too.
  for (const bad of ['privacy@co.example&body=Injected', 'privacy@co.example?bcc=x%40y.example', 'privacy@co.example#frag', 'privacy@co.example/../x', 'x@127.0.0.1', 'a@-b.no', 'a@b-.no', 'a@b..no']) {
    assert.ok(!looksLikeEmail(bad), bad);
    assert.equal(buildMailto({ to: bad, subject: 's', body: 'b' }), 'mailto:?subject=s&body=b', bad);
  }
  // Unicode domains as typed, and in the punycode form Chromium's email field gives; plus addressing.
  for (const ok of ['post@bøker.no', `post@xn${'-'.repeat(2)}bker-gra.no`, 'kari+gdpr@example.no', 'dpo@sub.firma.no']) assert.ok(looksLikeEmail(ok), ok);
  assert.equal(buildMailto({ to: 'a@b.no?cc=x@y.no', subject: 's', body: 'b' }), 'mailto:?subject=s&body=b');
  assert.equal(buildMailto({ to: 'x@y.no&bcc=z@w.no', subject: 's', body: 'b' }), 'mailto:?subject=s&body=b');
  assert.equal(buildMailto({ to: 'a@b.no\r\nBcc: z@w.no', subject: 's', body: 'b' }), 'mailto:?subject=s&body=b');
  // Never a cc or bcc smuggled in through the subject or the body: one field each, encoded whole.
  const href = buildMailto({ to: 'a@b.no', cc: 'me@c.no', subject: 'x&cc=evil@example.com\r\nBcc: evil@example.com', body: 'y&bcc=evil@example.com' });
  assert.deepEqual(fields(href).map((f) => f[0]), ['cc', 'subject', 'body']);
  assert.equal(new URL(href).searchParams.getAll('cc').join(), 'me@c.no');
  assert.equal(new URL(href).searchParams.get('bcc'), null);
  assert.ok(!/[\r\n]/.test(href));
});
