const assert = require('node:assert/strict');
const test = require('node:test');

const { synchronizeSystemTime } = require('./timeSync');

test('logs the time before and after synchronizing Windows 7 system time', async () => {
  const events = [];
  const times = [
    new Date('2026-06-12T01:00:00.000Z'),
    new Date('2026-06-12T01:00:05.000Z')
  ];
  const commandResults = [
    'timezone updated',
    'service started',
    'time server updated',
    'resync completed'
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
      return commandResults.shift();
    },
    now: () => times.shift()
  });

  assert.deepEqual(events, [
    ['output', '系统时间同步前：2026-06-12T01:00:00.000Z'],
    ['log', '系统时间同步前：2026-06-12T01:00:00.000Z'],
    ['command', 'tzutil', ['/s', 'China Standard Time']],
    ['log', '命令执行成功：tzutil {"args":["/s","China Standard Time"]}；执行结果："timezone updated"'],
    ['command', 'net', ['start', 'w32time']],
    ['log', '命令执行成功：net {"args":["start","w32time"]}；执行结果："service started"'],
    ['command', 'w32tm', [
      '/config',
      '/manualpeerlist:time.nist.gov,0.us.pool.ntp.org,1.us.pool.ntp.org',
      '/syncfromflags:manual',
      '/reliable:yes',
      '/update'
    ]],
    ['log', '命令执行成功：w32tm {"args":["/config","/manualpeerlist:time.nist.gov,0.us.pool.ntp.org,1.us.pool.ntp.org","/syncfromflags:manual","/reliable:yes","/update"]}；执行结果："time server updated"'],
    ['command', 'w32tm', ['/resync', '/force']],
    ['log', '命令执行成功：w32tm {"args":["/resync","/force"]}；执行结果："resync completed"'],
    ['output', '系统时间同步后：2026-06-12T01:00:05.000Z'],
    ['log', '系统时间同步后：2026-06-12T01:00:05.000Z']
  ]);
});

test('logs the failure reason and current time after a failed synchronization attempt', async () => {
  const logs = [];
  const output = [];
  const syncError = new Error('no time data was available');
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
        if (command === 'w32tm' && args[0] === '/config') {
          throw syncError;
        }
        return `${command} completed`;
      },
      now: () => times.shift()
    }),
    syncError
  );

  assert.deepEqual(logs, [
    '系统时间同步前：2026-06-12T01:00:00.000Z',
    '命令执行成功：tzutil {"args":["/s","China Standard Time"]}；执行结果："tzutil completed"',
    '命令执行成功：net {"args":["start","w32time"]}；执行结果："net completed"',
    '命令执行失败：w32tm {"args":["/config","/manualpeerlist:time.nist.gov,0.us.pool.ntp.org,1.us.pool.ntp.org","/syncfromflags:manual","/reliable:yes","/update"]}；失败原因：no time data was available',
    '系统时间同步后：2026-06-12T01:00:05.000Z'
  ]);
  assert.deepEqual(output, [
    '系统时间同步前：2026-06-12T01:00:00.000Z',
    '系统时间同步后：2026-06-12T01:00:05.000Z'
  ]);
});

test('waits five seconds and retries a failed resync until it succeeds', async () => {
  const logs = [];
  const delays = [];
  let resyncAttempts = 0;

  await synchronizeSystemTime({
    sendHttpLog: async (message) => {
      logs.push(message);
    },
    output: () => {},
    executeCommand: async (command, args) => {
      if (command === 'w32tm' && args[0] === '/resync') {
        resyncAttempts += 1;
        if (resyncAttempts < 3) {
          throw new Error(`resync failed ${resyncAttempts}`);
        }
        return 'resync completed';
      }
      return `${command} completed`;
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    }
  });

  assert.equal(resyncAttempts, 3);
  assert.deepEqual(delays, [5000, 5000]);
  assert.ok(logs.includes(
    '时间同步失败，5 秒后进行第 1/10 次重试'
  ));
  assert.ok(logs.includes(
    '时间同步失败，5 秒后进行第 2/10 次重试'
  ));
  assert.ok(logs.some((message) => (
    message.includes('命令执行失败：w32tm') &&
    message.includes('失败原因：resync failed 1')
  )));
  assert.ok(logs.some((message) => (
    message.includes('命令执行成功：w32tm') &&
    message.includes('"resync completed"')
  )));
});

test('stops after ten resync retries and throws the final error', async () => {
  const logs = [];
  const delays = [];
  let resyncAttempts = 0;

  await assert.rejects(
    synchronizeSystemTime({
      sendHttpLog: async (message) => {
        logs.push(message);
      },
      output: () => {},
      executeCommand: async (command, args) => {
        if (command === 'w32tm' && args[0] === '/resync') {
          resyncAttempts += 1;
          throw new Error(`resync failed ${resyncAttempts}`);
        }
        return `${command} completed`;
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    }),
    {
      message: 'resync failed 11'
    }
  );

  assert.equal(resyncAttempts, 11);
  assert.deepEqual(delays, Array(10).fill(5000));
  assert.ok(logs.includes('时间同步失败，已完成最多 10 次重试'));
  assert.ok(logs.some((message) => (
    message.includes('命令执行失败：w32tm') &&
    message.includes('失败原因：resync failed 11')
  )));
});
