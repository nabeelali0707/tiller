const assert = require('node:assert/strict');
const { add } = require('./add.cjs');
assert.equal(add(2, 3), 5, 'positive operands');
assert.equal(add(-2, 3), 1, 'mixed signs');
assert.equal(add(0, 0), 0, 'zero');
console.log('All 3 addition checks passed');
