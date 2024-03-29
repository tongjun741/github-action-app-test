const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 异步执行命令并输出标准输出内容
const executeCommand = (command, args) => {
  console.log(new Date().toLocaleString(), `开始执行命令：${command} ${args}`);
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
 
  console.log('开始检查nodeJS版本...');
  await executeCommand('node', ['-v'])
    .then((output) => {
      console.log('命令执行结果：', output);
    })
    .catch((error) => {
      console.error('命令执行出错：', error);
    });

    
  console.log('开始测试powershell...');
  await executeCommand('powershell', ['-Command "pwd"'])
    .then((output) => {
      console.log('命令执行结果：', output);
    })
    .catch((error) => {
      console.error('命令执行出错：', error);
    });
}

try {
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
  }
}