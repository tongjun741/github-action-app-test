const fs = require('fs');
const { execSync } = require('child_process');

const filePath = './cmd.js';
let lastContent = null;

function checkFile() {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content !== lastContent) {
      // 文件内容已变化，执行命令
      lastContent = content;
      console.log(new Date().toLocaleString(), `${filePath} has been modified, executing...`);
      try {
        const result = execSync(`node ${filePath}`);
        console.log(new Date().toLocaleString(), result.toString());
      } catch (error) {
        console.error(new Date().toLocaleString(), `Error executing ${filePath}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(new Date().toLocaleString(), error);
  }

  // 模拟定时器
  setTimeout(checkFile, 3000);
}

checkFile();
