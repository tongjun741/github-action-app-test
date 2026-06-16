const path = require('path');
const os = require('os');
const fs = require('fs');
const asar = require('@electron/asar');

async function main() {
    console.log("===== 开始修改 main.js =====");
    console.log("操作系统平台:", os.platform());

    let asarFilePath, tempDir, mainJsPath;
    if (os.platform() === 'darwin') {
        asarFilePath = "/Applications/花漾客户端.app/Contents/Resources/app.asar";
        mainJsPath = "/Applications/花漾客户端.app/Contents/Resources/app/main.js";
    } else if (os.platform() === 'linux') {
        asarFilePath = "/opt/花漾客户端/resources/app.asar";
        mainJsPath = "/opt/花漾客户端/resources/app/main.js";
    } else {
        asarFilePath = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'HuaYoung', 'resources', 'app.asar');
        mainJsPath = 'C:\\Program Files\\HuaYoung\\resources\\app\\main.js';
        // mainJsPath = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'HuaYoung', 'resources', 'app', 'main.js');
    }

    console.log("预期的 asar 文件路径:", asarFilePath);
    console.log("预期的 main.js 路径:", mainJsPath);

    if (fs.existsSync(asarFilePath)) {
        console.log("✓ 找到 asar 压缩包文件");
        console.log("当前客户端用了asar压缩包格式");
        // 如果是asar压缩包格式需要先解压到的临时目录
        tempDir = `${asarFilePath}_tmp`;
        console.log("临时解压目录:", tempDir);

        // 检查 tempDir 是否存在，存在则同步删除
        try {
            const stats = await fs.statSync(tempDir);
            if (stats.isDirectory()) {
                console.log("删除已存在的临时目录:", tempDir);
                await fs.rmdirSync(tempDir, { recursive: true });
                console.log(`✓ 已删除临时目录 ${tempDir}`);
            }
        } catch (err) {
            // 如果目录不存在或删除失败，可以忽略错误继续操作
            if (err.code !== 'ENOENT') {
                console.error("删除临时目录时出错:", err.message);
                throw err;
            }
        }

        try {
            console.log("开始解压 asar 文件...");
            // 解压 .asar 文件
            asar.extractAll(asarFilePath, tempDir);
            console.log(`✓ 成功解压 ${asarFilePath} 到 ${tempDir}`);

            // 检查解压后的文件
            console.log("解压后的目录内容:");
            const files = fs.readdirSync(tempDir);
            console.log(files.join(', '));
        } catch (err) {
            console.error(`✗ 解压 asar 包失败: ${err.message}`);
            throw err;
        }

        // 在 tempDir 中找到 main.js，修改它的内容
        mainJsPath = path.join(tempDir, 'main.js');
        console.log("main.js 路径（解压后）:", mainJsPath);
    } else {
        console.log("✗ 未找到 asar 文件，尝试直接修改 main.js");
    }

    // 检查 main.js 是否存在
    if (!fs.existsSync(mainJsPath)) {
        console.error(`✗ 错误：找不到 main.js 文件: ${mainJsPath}`);
        throw new Error(`main.js 文件不存在: ${mainJsPath}`);
    }
    console.log("✓ 找到 main.js 文件:", mainJsPath);

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
    console.log("读取 main.js 内容...");
    let fileContent = fs.readFileSync(mainJsPath, 'utf8');
    console.log("main.js 文件大小:", fileContent.length, "字节");

    // 检查要替换的内容是否存在
    const remoteDebugPortPattern = /this.remoteDebugPort=e.remoteDebugPort/g;
    const windowSizePattern = /this.windowSize=e.windowSize/g;

    const remoteDebugPortMatches = fileContent.match(remoteDebugPortPattern);
    const windowSizeMatches = fileContent.match(windowSizePattern);

    console.log("remoteDebugPort 匹配次数:", remoteDebugPortMatches ? remoteDebugPortMatches.length : 0);
    console.log("windowSize 匹配次数:", windowSizeMatches ? windowSizeMatches.length : 0);

    if (!remoteDebugPortMatches && !windowSizeMatches) {
        console.warn("⚠ 警告：未找到任何需要替换的内容，可能 main.js 已被修改或格式不同");
    }

    // 进行内容替换，默认开启9221调试端口
    fileContent = fileContent.replace(remoteDebugPortPattern, 'this.remoteDebugPort=9221');
    // 进行内容替换，设置分身浏览器窗口大小
    fileContent = fileContent.replace(windowSizePattern, 'this.windowSize="1920,1080"');

    // 写入替换后的内容到main.js文件
    console.log("写入修改后的内容到 main.js...");
    fs.writeFileSync(mainJsPath, fileContent, 'utf8');
    console.log('✓ main.js 替换完成');

    if (fs.existsSync(asarFilePath)) {
        // 如果是asar压缩包格式需要重新打包修改后的内容
        try {
            console.log("重新打包 asar 文件...");
            // 重新打包修改后的内容
            asar.createPackage(tempDir, asarFilePath);
            console.log(`✓ 成功将修改后的内容打包回 ${asarFilePath}`);
        } catch (err) {
            console.error(`✗ 创建 asar 包失败: ${err.message}`);
            throw err;
        }
    }

    console.log("===== main.js 修改流程完成 =====");
}

main();