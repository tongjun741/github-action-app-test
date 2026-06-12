const path = require('path');
const http = require('http');
const fs = require('fs');
const { createCommandExecutor } = require('./commandRunner');
const { formatBeijingTime, synchronizeSystemTime } = require('./timeSync');

// 读取 passwd.json 文件
const passwdJson = fs.readFileSync('passwd.json', 'utf8');
const passwdData = JSON.parse(passwdJson);

const executeCommand = createCommandExecutor({
  sendHttpLog,
  envVars: {
    ...passwdData,
    NODE_SKIP_PLATFORM_CHECK: 1,
    IN_WIN7: true,
    PATH: `c:\\node;${process.env.PATH}`
  }
});

function sendHttpLog(logText) {
  return new Promise((resolve, reject) => {
    const currentTime = formatBeijingTime(new Date());

    // 获取 Node.js 版本
    const nodeVersion = process.version;

    const text = `${currentTime}_NodeVersion_${nodeVersion}_${logText}`;
    const url = `${passwdData.LOGGER_SERVER}/log_channel12?text=cmd.js_${text}`;

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
  }).catch(e => {
    console.error(e);
  });
}

async function main() {
  try {
    await synchronizeSystemTime({
      sendHttpLog,
      executeCommand
    });

    // 调用函数并传递日志内容
    const logText = 'cmd.js log';
    sendHttpLog(logText);

    const exeName = 'installer.exe';
    // const shortcutPath = 'C:\\Users\\Docker\\Desktop\\花漾客户端.lnk';
    // 12.1开始快捷方式放在公共目录
    const shortcutPath = 'C:\\Users\\Public\\Desktop\\花漾客户端.lnk';

    // 安装.exe文件
    while (true) {
      if (fs.existsSync(shortcutPath)) {
        await sendHttpLog('桌面有花漾客户端.lnk，安装成功');
        break;
      }
      await sendHttpLog('开始安装.exe文件...');
      await executeCommand(exeName, ['/S'])
        .then((output) => {
          console.log('安装命令执行结果：', output);
          return sendHttpLog(`安装命令执行结果：${JSON.stringify(output)}`);
        })
        .catch((error) => {
          console.error('安装命令执行出错：', error);
          return sendHttpLog('安装.exe文件失败，重试');
        });

      // 等待桌面上的快捷方式出现
      let i = 0;
      let shortcutExist = false;
      // 最多等待10分钟
      while (i < 6 * 10) {
        if (fs.existsSync(shortcutPath)) {
          await sendHttpLog('桌面有花漾客户端.lnk，安装成功');
          shortcutExist = true;
          break;
        }
        await sendHttpLog('桌面没有花漾客户端.lnk，等待10秒再检查');
        // 检查C:\\Users\\Docker\\Desktop目录下的所有文件
        let desktopFiles = fs.readdirSync(`C:\\Users\\Docker\\Desktop\\`);
        await sendHttpLog(`当前用户桌面上的文件列表：${JSON.stringify(desktopFiles)}`);
        desktopFiles = fs.readdirSync(`C:\\Users\\Public\\Desktop\\`);
        await sendHttpLog(`公共桌面上的文件列表：${JSON.stringify(desktopFiles)}`);
        await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
      }
      if (shortcutExist) {
        break;
      }
    }

    // npm install
    await sendHttpLog('开始npm install...');
    await executeCommand(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      'npm install yarn -g && yarn'
    ])
      .then((output) => {
        console.log('npm install命令执行结果：', output);
      })
      .catch((error) => {
        console.error('npm install命令执行出错：', error);
      });

    // 获取当前用户的用户名，自动创建工作目录
    const username = process.env.USERNAME;
    // 构建目标路径
    const directoryPath = path.join('C:', 'Users', username, 'AppData', 'Roaming', 'HuaYoung');
    try {
      // 同步创建目录
      fs.mkdirSync(directoryPath, { recursive: true });
      console.log('目录创建成功:', directoryPath);
    } catch (err) {
      console.error('创建目录' + directoryPath + '失败:', err);
    }

    await sendHttpLog('修改main.js...');
    await executeCommand(`node`, ['modifyMain.js'])

    // 开始测试
    await sendHttpLog('开始测试...');
    await executeCommand(`node`, ['tests/start.js', 'e2e'])
      .then((output) => {
        console.log('测试执行结果：', output);
      })
      .catch((error) => {
        console.error('测试执行出错：', error);
      });
  } catch (e) {
    console.error(e);
    try {
      await sendHttpLog(`Exit on ${e.message}`);
    } catch (e) {

    }
  } finally {
    // 标记任务结束
    try {
      // 文件输出到了done.log
      const logFilePath = '\\\\host.lan\\Data\\done.log';
      const currentTime = new Date().toString() + '\n';
      fs.appendFileSync(logFilePath, currentTime);
      console.error(`Current time appended to ${logFilePath}`);
      await sendHttpLog("任务完成");
    } catch (err) {
      console.error(err);
      await sendHttpLog(err.message);
    }
  }
}

main();
