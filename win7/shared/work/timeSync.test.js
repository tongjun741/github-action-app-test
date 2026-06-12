const assert = require('node:assert/strict');
const test = require('node:test');

const { synchronizeSystemTime } = require('./timeSync');

test('logs the time before and after synchronizing Windows 7 system time', async () => {
  const events = [];
  const times = [
    new Date('2026-06-12T01:00:00.000Z'),
    new Date('2026-06-12T01:00:05.000Z')
  ];

  await synchronizeSystemTime({
    sendHttpLog: async (message) => {
      events.push(['log', message]);
    },
    output: (message) => {
      events.push(['output', message]);
    },
    executeCommand: async (command, args) => {
      events.push(['command', command, args]);
    },
    now: () => times.shift()
  });

  assert.deepEqual(events, [
    ['output', '系统时间同步前：2026-06-12T01:00:00.000Z'],
    ['log', '系统时间同步前：2026-06-12T01:00:00.000Z'],
    ['command', 'tzutil', ['/s', 'China Standard Time']],
    ['command', 'net', ['start', 'w32time']],
    ['command', 'w32tm', ['/resync', '/force']],
    ['output', '系统时间同步后：2026-06-12T01:00:05.000Z'],
    ['log', '系统时间同步后：2026-06-12T01:00:05.000Z']
  ]);
});

test('logs the current time after a failed synchronization attempt', async () => {
  const logs = [];
  const output = [];
  const syncError = new Error('w32tm failed');
  const times = [
    new Date('2026-06-12T01:00:00.000Z'),
    new Date('2026-06-12T01:00:05.000Z')
  ];

  await assert.rejects(
    synchronizeSystemTime({
      sendHttpLog: async (message) => {
        logs.push(message);
      },
      output: (message) => {
        output.push(message);
      },
      executeCommand: async (command, args) => {
        if (command === 'w32tm' && args[0] === '/resync') {
          throw syncError;
        }
      },
      now: () => times.shift()
    }),
    syncError
  );

  assert.deepEqual(logs, [
    '系统时间同步前：2026-06-12T01:00:00.000Z',
    '系统时间同步后：2026-06-12T01:00:05.000Z'
  ]);
  assert.deepEqual(output, logs);
});
