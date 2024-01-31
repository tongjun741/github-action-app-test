const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

try {
  // 定义要下载和安装的 EXE 文件 URL 和文件名
  const exeUrl = 'https://dev.thinkoncloud.cn/downloads/win7_app_zh/HuaYoungApp_Win7_dev_zh_setup.exe';
  const exeName = 'example.exe';

  // 定义要下载和安装文件的保存目录
  const downloadPath = 'C:\\downloads';

  // 下载和安装 EXE 文件
  exec(`powershell -Command "(New-Object System.Net.WebClient).DownloadFile('${exeUrl}', '${downloadPath}\\${exeName}'); Start-Process -FilePath '${downloadPath}\\${exeName}' -ArgumentList '/S' -Wait"`, (err, stdout, stderr) => {
    if (err) {
      console.error('安装失败：', err);
      return;
    }
    console.log('安装成功');
  });

} catch (e) {
  console.error(e);
} finally {
  // 标记任务结束
  try {
    // 文件输出到了z:\\out.log
    const logFilePath = path.join(__dirname, 'done.log');
    const currentTime = new Date().toString() + '\n';
    fs.appendFileSync(logFilePath, currentTime);
    console.error(`Current time appended to ${logFilePath}`);
  } catch (err) {
    console.error(err);
  }
}
