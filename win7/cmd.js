const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

try {
  const exeName = 'installer.exe';

  // 安装.exe文件
  console.log('开始安装.exe文件...');
  try {
    const stdout = execSync(`powershell -Command "Start-Process -FilePath \'${exeName}\' -ArgumentList \'/S\' -Wait"`);
    console.log('.exe文件安装完成！');
    console.log('标准输出:', stdout.toString());
  } catch (error) {
    console.error('安装时发生错误:', error.stderr.toString());
  }

  // 开始测试
  console.log('开始测试');
  try {
    const stdout = execSync(`npm install yarn -g && yarn && yarn wdio`);
    console.log('测试完成！');
    console.log('标准输出:', stdout.toString());
  } catch (error) {
    console.error('测试时发生错误:', error.stderr.toString());
  }
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
