const assert = require('node:assert/strict');
const test = require('node:test');

const { formatBeijingTime } = require('../include/tools');

test('formatBeijingTime formats dates in Asia/Shanghai time', () => {
  const result = formatBeijingTime(new Date('2026-06-12T10:20:30.000Z'));

  assert.equal(result, '2026-06-12 18:20:30');
});
