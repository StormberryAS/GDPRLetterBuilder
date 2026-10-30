// The live warnings (spec section 4, ID-2): made-up national identity numbers and D-numbers, valid
// and invalid, payment card numbers by Luhn, and no warning on ordinary order or customer numbers.
// The valid numbers were made with an independent Python count of the two control digits; none
// belongs to a person (the dates and individual numbers are invented, and most such numbers are
// never issued).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSensitive, isNorwegianId, luhn, WARNINGS } from '#src/personal-data.js';

const VALID_IDS = ['01019012480', '01019012561', '15057532189', '31129987688', '29022845681'];
const VALID_D = ['41019012393', '41019012474'];
const VALID_SYNTHETIC = ['01819012365', '01819012527'];

test('national identity numbers and D-numbers: both control digits, and a date that can exist', () => {
  for (const n of [...VALID_IDS, ...VALID_D, ...VALID_SYNTHETIC]) assert.ok(isNorwegianId(n), n);
  // One digit off in each place: refused.
  for (const n of VALID_IDS) {
    for (let i = 0; i < 11; i++) {
      const d = (Number(n[i]) + 1) % 10;
      const changed = n.slice(0, i) + d + n.slice(i + 1);
      assert.ok(!isNorwegianId(changed), `${changed} (from ${n}, digit ${i + 1})`);
    }
  }
  // 010190123 has no valid first control digit at all (remainder 1).
  for (let k = 0; k < 100; k++) assert.ok(!isNorwegianId(`010190123${String(k).padStart(2, '0')}`));
  // Not 11 digits, or a date that cannot exist.
  for (const n of ['0101901248', '010190124800', '00000000000', '32019012345', 'abcdefghijk']) assert.ok(!isNorwegianId(n), n);
});

test('payment cards: Luhn over 13 to 19 digits, starting 2 to 6', () => {
  for (const c of ['4111111111111111', '5555555555554444', '378282246310005', '4012888888881881']) assert.ok(luhn(c), c);
  assert.ok(!luhn('4111111111111112'));
  assert.deepEqual(findSensitive('card 4111 1111 1111 1111 please'), [{ kind: 'payment-card', digits: '4111111111111111' }]);
  assert.deepEqual(findSensitive('5555-5555-5555-4444'), [{ kind: 'payment-card', digits: '5555555555554444' }]);
  // Passes Luhn but starts with 1: an order number, not a card.
  assert.ok(luhn('1234567812345670'));
  assert.deepEqual(findSensitive('Order 1234567812345670'), []);
});

test('findSensitive: spaces, dots and hyphens inside a number, each number once, letters break a number', () => {
  assert.deepEqual(findSensitive('010190 12480'), [{ kind: 'national-id', digits: '01019012480' }]);
  assert.deepEqual(findSensitive('01.01.90 124 80'), [{ kind: 'national-id', digits: '01019012480' }]);
  assert.deepEqual(findSensitive('41019012393 and again 41019012393'), [{ kind: 'national-id', digits: '41019012393' }]);
  assert.deepEqual(findSensitive('0101901248O'), []);
  assert.deepEqual(findSensitive(''), []);
  assert.deepEqual(findSensitive(undefined), []);
});

test('findSensitive: a number next to another in the same run is still found (code review of 12 October 2026)', () => {
  assert.deepEqual(findSensitive('01019012480 2026'), [{ kind: 'national-id', digits: '01019012480' }]);
  assert.deepEqual(findSensitive('order 12345 01019012480'), [{ kind: 'national-id', digits: '01019012480' }]);
  assert.deepEqual(findSensitive('01019012480 4111111111111111'), [{ kind: 'national-id', digits: '01019012480' }, { kind: 'payment-card', digits: '4111111111111111' }]);
  assert.deepEqual(findSensitive('4111 1111 1111 1111 12'), [{ kind: 'payment-card', digits: '4111111111111111' }]);
  // A run with no separators is one number, tested whole: no warning for a slice of it.
  assert.deepEqual(findSensitive('order 123456789012345'), []);
  assert.deepEqual(findSensitive('0101901248012345'), []);
});

test('no warning on ordinary order, customer and membership numbers', () => {
  for (const s of ['K-40213', 'Order 100245', 'Kundenummer 12345678', '2026-10-12', '+47 22 39 69 00', 'Medlem 7001 2345 9988',
    '12345678901', '98765432109', 'NO 937 751 249', 'Postboks 458 Sentrum, 0105 Oslo', '1000000000000']) {
    assert.deepEqual(findSensitive(s), [], s);
  }
});

test('the warnings say what the spec says, and never block', () => {
  assert.equal(WARNINGS['national-id'], 'This looks like a Norwegian national identity number (fødselsnummer). Include it only if the company already uses it to identify you, and think twice before sending it by ordinary email.');
  assert.equal(WARNINGS['payment-card'], 'This looks like a payment card number. A data request never needs it.');
});
