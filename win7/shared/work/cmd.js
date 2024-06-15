const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// 异步执行命令并输出标准输出内容
const executeCommand = async (command, args) => {
  await sendHttpLog(`开始执行命令：${command} ${args}`);
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args);
    let stdout = '';

    // 监听标准输出，并拼接内容
    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(data.toString());
    });

    // 监听错误输出
    childProcess.stderr.on('data', (data) => {
      console.error(data.toString());
    });

    // 监听命令执行完成事件
    childProcess.on('close', (code) => {
      console.log(`命令执行结束，退出码：${code}`);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`命令执行失败，退出码：${code}`));
      }
    });
  });
};

async function main() {
  const exeName = 'installer.exe';

  // 安装.exe文件
  await sendHttpLog('开始安装.exe文件...');
  await executeCommand('powershell', [`-Command "Start-Process -FilePath \'${exeName}\' -ArgumentList \'/S\' -Wait"`])
    .then((output) => {
      console.log('安装命令执行结果：', output);
    })
    .catch((error) => {
      console.error('安装命令执行出错：', error);
    });

  // npm install
  sendHttpLog('开始npm install...');
  await executeCommand('npm', ['install yarn -g && yarn'])
    .then((output) => {
      console.log('npm install命令执行结果：', output);
    })
    .catch((error) => {
      console.error('npm install命令执行出错：', error);
    });

  // 开始测试
  sendHttpLog('开始测试...');
  await executeCommand(`yarn`, ['wdio'])
    .then((output) => {
      console.log('测试执行结果：', output);
    })
    .catch((error) => {
      console.error('测试执行出错：', error);
    });
}

function sendHttpLog(logText) {
  return new Promise((resolve, reject) => {
      // 获取当前时间并格式化为 "HHMMSS" 格式
      const currentTime = new Date().toLocaleString();

      // 获取 Node.js 版本
      const nodeVersion = process.version;

      const text = `${currentTime}_NodeVersion_${nodeVersion}_${logText}`;
      const url = `http://ds.0728123.xyz:65080/log_channel12?text=cmd.js_${text}`;

      // 解析 URL，以便使用 http.request
      const parsedUrl = new URL(url);

      // 设置 HTTP 请求选项
      const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET'
      };

      // 创建并发送 HTTP 请求
      const req = http.request(options, (res) => {
          let data = '';

          // 收集响应数据
          res.on('data', (chunk) => {
              data += chunk;
          });

          // 响应结束时，解析结果
          res.on('end', () => {
              resolve(data);
          });
      });

      // 处理请求错误
      req.on('error', (e) => {
          reject(new Error(`Request error: ${e.message}`));
      });

      // 结束请求
      req.end();
  });
}

try {
  // 调用函数并传递日志内容
  const logText = 'cmd.js log';
  sendHttpLog(logText);

  main()
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
    sendHttpLog(err.message);
  }
}
