async function synchronizeSystemTime({
  sendHttpLog,
  executeCommand,
  now = () => new Date(),
  output = console.log,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  const maxResyncRetries = 10;
  const resyncRetryDelayMs = 5000;

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

  const resyncWithRetry = async () => {
    for (let retryCount = 0; retryCount <= maxResyncRetries; retryCount += 1) {
      try {
        return await executeAndLog('w32tm', ['/resync', '/force']);
      } catch (error) {
        if (retryCount === maxResyncRetries) {
          await sendHttpLog(
            `时间同步失败，已完成最多 ${maxResyncRetries} 次重试`
          );
          throw error;
        }

        const nextRetry = retryCount + 1;
        await sendHttpLog(
          `时间同步失败，5 秒后进行第 ${nextRetry}/${maxResyncRetries} 次重试`
        );
        await sleep(resyncRetryDelayMs);
      }
    }
  };

  await outputCurrentTime('系统时间同步前');

  try {
    await executeAndLog('tzutil', ['/s', 'China Standard Time']);
    await executeAndLog('net', ['start', 'w32time']);
    await executeAndLog('w32tm', [
      '/config',
      '/manualpeerlist:time.nist.gov,0.us.pool.ntp.org,1.us.pool.ntp.org',
      '/syncfromflags:manual',
      '/reliable:yes',
      '/update'
    ]);
    await resyncWithRetry();
  } finally {
    await outputCurrentTime('系统时间同步后');
  }
}

module.exports = {
  synchronizeSystemTime
};
