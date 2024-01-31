const fs = require('fs');
const { execSync } = require('child_process');

const filePath = './cmd.js';
let lastContent = null;

function checkFile() {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (lastContent === null) {
      // 初次运行，记录文件内容
      lastContent = content;
    } else if (content !== lastContent) {
      // 文件内容已变化，执行命令
      lastContent = content;
      console.log(`${filePath} has been modified, executing...`);
      try {
        const result = execSync(`node ${filePath}`);
        console.log(result.toString());
      } catch (error) {
        console.error(`Error executing ${filePath}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(error);
  }

  // 模拟定时器
  setTimeout(checkFile, 3000);
}

checkFile();
