const assert = require('node:assert/strict');
const { discount } = require('./discount.cjs');
assert.equal(discount(200, 25), 150);
assert.equal(discount(80, 0), 80);
assert.equal(discount(20, 100), 0);
for (const args of [[-1, 10], [10, -1], [10, 101], [Infinity, 10], [10, NaN], ['10', 20]]) {
  assert.throws(() => discount(...args), RangeError);
}
console.log('Percentage arithmetic and invalid-input checks passed');
