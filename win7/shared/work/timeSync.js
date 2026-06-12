async function synchronizeSystemTime({
  sendHttpLog,
  executeCommand,
  now = () => new Date(),
  output = console.log
}) {
  const outputCurrentTime = async (label) => {
    const message = `${label}：${now().toISOString()}`;
    output(message);
    await sendHttpLog(message);
  };

  await outputCurrentTime('系统时间同步前');

  try {
    await executeCommand('tzutil', ['/s', 'China Standard Time']);
    await executeCommand('net', ['start', 'w32time']);
    await executeCommand('w32tm', ['/resync', '/force']);
  } finally {
    await outputCurrentTime('系统时间同步后');
  }
}

module.exports = {
  synchronizeSystemTime
};
