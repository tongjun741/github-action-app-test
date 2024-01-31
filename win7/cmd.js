const path = require('path');
const fs = require('fs');

// 文件输出到了z:\\out.log
const logFilePath = path.join(__dirname, 'out.log');
const currentTime = new Date().toString() + '\n';

try {
  fs.appendFileSync(logFilePath, currentTime);
  console.log(`Current time appended to ${logFilePath}`);
} catch (err) {
  console.error(err);
}
