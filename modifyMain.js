const path = require('path');
const os = require('os');
const fs = require('fs');
const asar = require('@electron/asar');

async function main() {
    let asarFilePath, tempDir, mainJsPath;
    if (os.platform() === 'darwin') {
        asarFilePath = "/Applications/花漾客户端.app/Contents/Resources/app.asar";
        mainJsPath = "/Applications/花漾客户端.app/Contents/Resources/app/main.js";
    } else if (os.platform() === 'linux') {
        asarFilePath = "/opt/花漾客户端/resources/app.asar";
        mainJsPath = "/opt/花漾客户端/resources/app/main.js";
    } else {
        asarFilePath = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'HuaYoung', 'resources', 'app.asar');
        mainJsPath = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'HuaYoung', 'resources', 'app', 'main.js');
    }

    if (fs.existsSync(asarFilePath)) {
        console.log("当前客户端用了asar压缩包格式");
        // 如果是asar压缩包格式需要先解压到的临时目录
        tempDir = `${asarFilePath}_tmp`;

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

        // 在 tempDir 中找到 main.js，修改它的内容
        mainJsPath = path.join(tempDir, 'main.js');
    }

    // 执行修改 main.js 的操作
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

    if (fs.existsSync(asarFilePath)) {
        // 如果是asar压缩包格式需要重新打包修改后的内容
        try {
            // 重新打包修改后的内容
            asar.createPackage(tempDir, asarFilePath);
            console.log(`Successfully replaced ${asarFilePath} with modified version.`);
        } catch (err) {
            console.error(`Error creating asar package: ${err.message}`);
        }
    }

}

main();