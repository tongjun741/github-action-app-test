const fs = require('fs');

const DEFAULT_HOST_TIME_FILE = '\\\\host.lan\\Data\\host-time.txt';
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const UTC_ISO_SECONDS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function readHostTime(fileText) {
  const hostTimeText = fileText.trim();
  const hostTime = new Date(hostTimeText);
  const normalizedHostTime = Number.isNaN(hostTime.getTime())
    ? ''
    : hostTime.toISOString().replace('.000Z', 'Z');
  if (
    !UTC_ISO_SECONDS_PATTERN.test(hostTimeText) ||
    normalizedHostTime !== hostTimeText
  ) {
    throw new Error(`host-time.txt 中的时间无效：${hostTimeText}`);
  }

  return {
    hostTime,
    hostTimeText
  };
}

function formatChinaTime(hostTime) {
  const chinaTime = new Date(hostTime.getTime() + CHINA_TIME_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, '0');

  return {
    date: [
      pad(chinaTime.getUTCMonth() + 1),
      pad(chinaTime.getUTCDate()),
      chinaTime.getUTCFullYear()
    ].join('-'),
    time: [
      pad(chinaTime.getUTCHours()),
      pad(chinaTime.getUTCMinutes()),
      pad(chinaTime.getUTCSeconds())
    ].join(':')
  };
}

async function synchronizeSystemTime({
  sendHttpLog,
  executeCommand,
  hostTimeFilePath = DEFAULT_HOST_TIME_FILE,
  readFile = fs.promises.readFile,
  now = () => new Date(),
  output = console.log
}) {
  const outputCurrentTime = async (label) => {
    const message = `${label}：${now().toISOString()}`;
    output(message);
    await sendHttpLog(message);
  };

  const executeAndLog = async (command, args) => {
    const commandText = `${command} ${JSON.stringify({ args })}`;

    try {
      const result = await executeCommand(command, args);
      await sendHttpLog(
        `命令执行成功：${commandText}；执行结果：${JSON.stringify(result)}`
      );
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendHttpLog(`命令执行失败：${commandText}；失败原因：${reason}`);
      throw error;
    }
  };

  await outputCurrentTime('系统时间同步前');

  try {
    let configuredTime;
    try {
      const hostTimeText = await readFile(hostTimeFilePath, 'utf8');
      configuredTime = readHostTime(hostTimeText);
      await sendHttpLog(
        `从 host-time.txt 读取宿主机时间：${configuredTime.hostTimeText}`
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendHttpLog(`读取宿主机时间失败：${reason}`);
      throw error;
    }

    const windowsTime = formatChinaTime(configuredTime.hostTime);
    await executeAndLog('tzutil', ['/s', 'China Standard Time']);
    await executeAndLog('cmd.exe', [
      '/d',
      '/s',
      '/c',
      `date ${windowsTime.date}`
    ]);
    await executeAndLog('cmd.exe', [
      '/d',
      '/s',
      '/c',
      `time ${windowsTime.time}`
    ]);
  } finally {
    await outputCurrentTime('系统时间同步后');
  }
}

module.exports = {
  synchronizeSystemTime
};
