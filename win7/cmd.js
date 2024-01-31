const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

try {
  // 定义要下载和安装的 EXE 文件 URL 和文件名
  const exeUrl = 'https://dev.thinkoncloud.cn/downloads/win7_app_zh/HuaYoungApp_Win7_dev_zh_setup.exe';
  const exeName = 'installer.exe';

  // 定义要下载和安装文件的保存目录
  const downloadPath = 'C:\\downloads';

  // 下载.exe文件
  console.log('开始下载.exe文件...');
  execSync(`powershell -Command "(New-Object Net.WebClient).DownloadFile(\'${exeUrl}\', \'${exeName}\')"`);
  console.log('.exe文件下载完成！');

  // 安装.exe文件
  console.log('开始安装.exe文件...');
  execSync(`powershell -Command "Start-Process -FilePath \'${exeName}\' -ArgumentList \'/S\' -Wait"`);
  console.log('.exe文件安装完成！');
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
