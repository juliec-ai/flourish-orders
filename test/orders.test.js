const test = require('node:test');
const assert = require('node:assert');
const O = require('../server/orders');
const A = require('../server/auth');

test('totals tax only taxable lines and skip tax for exempt customers', () => {
  const lines = [{ qty: 2, price: 45, taxable: true }, { qty: 1, price: 10, taxable: false }];
  assert.deepStrictEqual(O.computeTotals({ lines, deliveryFee: 12.5, taxRate: 0.0725 }), { subtotal: 100, deliveryFee: 12.5, tax: 6.53, total: 119.03 });
  assert.strictEqual(O.computeTotals({ lines, taxRate: 0.0725, taxExempt: true }).tax, 0);
});

test('order numbers count up within the day', () => {
  assert.strictEqual(O.nextOrderNumber([], '261028'), '261028-01');
  assert.strictEqual(O.nextOrderNumber(['261028-01', '261028-09', '261027-14', null], '261028'), '261028-10');
});

test('date prefix uses the shop time zone', () => {
  // 03:00 UTC on Oct 29 is still Oct 28 in Utah.
  assert.strictEqual(O.datePrefix(new Date('2026-10-29T03:00:00Z'), 'America/Denver'), '261028');
});

test('validation explains what is missing', () => {
  assert.throws(() => O.validateOrder({ lines: [] }), /customer.*item.*due date/s);
  assert.throws(
    () => O.validateOrder({ customer: { name: 'A' }, lines: [{ name: 'Roses', qty: 1, price: 5 }], fulfillment: 'Delivery', dueDate: '2026-10-28', recipient: {} }),
    /recipient address/,
  );
  const lines = O.validateOrder({ customer: { id: 'x' }, lines: [{ name: 'Roses', qty: '2', price: '5' }, { name: '' }], fulfillment: 'Pickup', dueDate: '2026-10-28' });
  assert.deepStrictEqual(lines, [{ productId: null, name: 'Roses', qty: 2, price: 5, taxable: true }]);
});

test('PIN hashes check and sessions are tamper-proof', () => {
  const h = A.hashPin('1234');
  assert.ok(A.checkPin('1234', h));
  assert.ok(!A.checkPin('4321', h));
  const tok = A.sign({ email: 'a@b.c', exp: Date.now() + 1000 }, 's');
  assert.strictEqual(A.verify(tok, 's').email, 'a@b.c');
  assert.strictEqual(A.verify(tok, 'other'), null);
  assert.strictEqual(A.verify(A.sign({ email: 'a', exp: Date.now() - 1 }, 's'), 's'), null);
});
