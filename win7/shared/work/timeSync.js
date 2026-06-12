const NTP_CLIENT_REGISTRY_KEY =
  'HKLM\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\TimeProviders\\NtpClient';

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
    await executeCommand('reg.exe', [
      'add',
      NTP_CLIENT_REGISTRY_KEY,
      '/v',
      'Enabled',
      '/t',
      'REG_DWORD',
      '/d',
      '1',
      '/f'
    ]);

    await executeCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "$service = Get-Service -Name w32time; if ($service.Status -ne 'Running') { Start-Service -Name w32time }"
    ]);

    await executeCommand('w32tm.exe', [
      '/config',
      '/manualpeerlist:time.windows.com,0x8',
      '/syncfromflags:manual',
      '/update'
    ]);
    await executeCommand('w32tm.exe', ['/resync', '/rediscover']);
  } finally {
    await outputCurrentTime('系统时间同步后');
  }
}

module.exports = {
  synchronizeSystemTime
};
