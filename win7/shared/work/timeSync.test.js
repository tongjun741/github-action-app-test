const assert = require('node:assert/strict');
const test = require('node:test');

const { synchronizeSystemTime } = require('./timeSync');

test('sets Windows date and time from the shared host-time file', async () => {
  const events = [];
  const times = [
    new Date('2026-06-12T15:25:00.000Z'),
    new Date('2026-06-12T15:25:01.000Z')
  ];
  const commandResults = [
    'timezone updated',
    'date updated',
    'time updated'
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
    readFile: async (filePath, encoding) => {
      events.push(['read', filePath, encoding]);
      return '2026-06-12T15:24:09Z\n';
    },
    now: () => times.shift()
  });

  assert.deepEqual(events, [
    ['output', '系统时间同步前：2026-06-12T15:25:00.000Z'],
    ['log', '系统时间同步前：2026-06-12T15:25:00.000Z'],
    ['read', '\\\\host.lan\\Data\\host-time.txt', 'utf8'],
    ['log', '从 host-time.txt 读取宿主机时间：2026-06-12T15:24:09Z'],
    ['command', 'tzutil', ['/s', 'China Standard Time']],
    ['log', '命令执行成功：tzutil {"args":["/s","China Standard Time"]}；执行结果："timezone updated"'],
    ['command', 'cmd.exe', ['/d', '/s', '/c', 'date 06-12-2026']],
    ['log', '命令执行成功：cmd.exe {"args":["/d","/s","/c","date 06-12-2026"]}；执行结果："date updated"'],
    ['command', 'cmd.exe', ['/d', '/s', '/c', 'time 23:24:09']],
    ['log', '命令执行成功：cmd.exe {"args":["/d","/s","/c","time 23:24:09"]}；执行结果："time updated"'],
    ['output', '系统时间同步后：2026-06-12T15:25:01.000Z'],
    ['log', '系统时间同步后：2026-06-12T15:25:01.000Z']
  ]);
});

test('rejects a host-time file value that is not UTC ISO format', async () => {
  const logs = [];
  const commands = [];

  await assert.rejects(
    synchronizeSystemTime({
      sendHttpLog: async (message) => {
        logs.push(message);
      },
      output: () => {},
      executeCommand: async (command, args) => {
        commands.push([command, args]);
      },
      readFile: async () => '2026-06-12 15:24:09\n'
    }),
    {
      message: 'host-time.txt 中的时间无效：2026-06-12 15:24:09'
    }
  );

  assert.deepEqual(commands, []);
  assert.ok(logs.includes(
    '读取宿主机时间失败：host-time.txt 中的时间无效：2026-06-12 15:24:09'
  ));
  assert.ok(logs.some((message) => message.startsWith('系统时间同步后：')));
});

test('logs the command failure reason and rethrows it', async () => {
  const logs = [];
  const dateError = new Error('Access is denied');

  await assert.rejects(
    synchronizeSystemTime({
      sendHttpLog: async (message) => {
        logs.push(message);
      },
      output: () => {},
      executeCommand: async (command, args) => {
        if (command === 'cmd.exe' && args[3].startsWith('date ')) {
          throw dateError;
        }
        return 'completed';
      },
      readFile: async () => '2026-06-12T15:24:09Z\n'
    }),
    dateError
  );

  assert.ok(logs.includes(
    '命令执行失败：cmd.exe {"args":["/d","/s","/c","date 06-12-2026"]}；失败原因：Access is denied'
  ));
  assert.ok(logs.some((message) => message.startsWith('系统时间同步后：')));
});
