const path = require('path');
const os = require('os');
const fs = require('fs');
const asar = require('@electron/asar');

async function main() {
    let asarFilePath;
    if (os.platform() === 'darwin') {
        asarFilePath = "/Applications/花漾客户端.app/Contents/Resources/app.asar";
    } else if (os.platform() === 'linux') {
        asarFilePath = "/opt/花漾客户端/resources/app.asar";
    } else {
        asarFilePath = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'HuaYoung', 'resources', 'app.asar');
    }

    // 解压到的临时目录
    const tempDir = `${asarFilePath}_tmp`;

    // 检查 tempDir 是否存在，存在则同步删除
    try {
        const stats = await fs.statSync(tempDir);
        if (stats.isDirectory()) {
            await fs.rmdirSync(tempDir, { recursive: true });
            console.log(`Deleted existing temporary directory ${tempDir}`);
        }
    } catch (err) {
        // 如果目录不存在或删除失败，可以忽略错误继续操作
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }

    try {
        // 解压 .asar 文件
        asar.extractAll(asarFilePath, tempDir);
        console.log(`Extracted ${asarFilePath} to ${tempDir}`);
    } catch (err) {
        console.error(`Error Extracted asar package: ${err.message}`);
    }

    // 执行修改 main.js 的操作
    // 在 tempDir 中找到 main.js，修改它的内容
    const mainJsPath = path.join(tempDir, 'main.js');
    // 这里可以根据需要修改 main.js 的内容，比如更改代码逻辑或修复 bug
    /**
     * 需要将main.js的
     * this.remoteDebugPort&&t.push
     * 替换成：
    this.remoteDebugPort=9221;t.push

    将
    t.push(...this.browserSwitches.split("\n"));
    替换成：
    t.push(...this.browserSwitches.split("\n"));t.push("--window-size=1000,600");
    */
    let fileContent = fs.readFileSync(mainJsPath, 'utf8');
    // 进行内容替换，默认开启9221调试端口
    fileContent = fileContent.replace(/this\.remoteDebugPort\s*&&\s*t\.push/g, 'this.remoteDebugPort = 9221; t.push');
    // 进行内容替换，设置分身浏览器窗口大小
    fileContent = fileContent.replace('t.push(...this.browserSwitches.split("\\n"));', 't.push(...this.browserSwitches.split("\\n"));t.push("--window-size=1920,1080");');
    // 写入替换后的内容到main.js文件
    fs.writeFileSync(mainJsPath, fileContent, 'utf8');
    console.log('main.js替换完成');

    try {
        // 重新打包修改后的内容
        asar.createPackage(tempDir, asarFilePath);
        console.log(`Successfully replaced ${asarFilePath} with modified version.`);
    } catch (err) {
        console.error(`Error creating asar package: ${err.message}`);
    }

}

main();