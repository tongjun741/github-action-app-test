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
    [
      'command',
      'reg.exe',
      [
        'add',
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\TimeProviders\\NtpClient',
        '/v',
        'Enabled',
        '/t',
        'REG_DWORD',
        '/d',
        '1',
        '/f'
      ]
    ],
    [
      'command',
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "$service = Get-Service -Name w32time; if ($service.Status -ne 'Running') { Start-Service -Name w32time }"
      ]
    ],
    [
      'command',
      'w32tm.exe',
      [
        '/config',
        '/manualpeerlist:time.windows.com,0x8',
        '/syncfromflags:manual',
        '/update'
      ]
    ],
    ['command', 'w32tm.exe', ['/resync', '/rediscover']],
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
        if (command === 'w32tm.exe' && args[0] === '/resync') {
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
