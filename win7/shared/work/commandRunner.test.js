const assert = require('node:assert/strict');
const test = require('node:test');

const { createCommandExecutor } = require('./commandRunner');

test('preserves a command argument containing spaces', async () => {
  const executeCommand = createCommandExecutor({
    sendHttpLog: async () => {},
    output: () => {},
    errorOutput: () => {}
  });

  const output = await executeCommand(process.execPath, [
    '-e',
    'process.stdout.write(process.argv[1])',
    'China Standard Time'
  ]);

  assert.equal(output, 'China Standard Time');
});
