const { feishuNotify, screenshot, uploadFile, outputLog } = require('./include/tools');
const desktopScreenshot = require('screenshot-desktop');

let EXTENSION_NAME = "花漾TK";

async function main() {
  outputLog(`环境变量：${JSON.stringify(process.env)}`);
  outputLog(`输入参数：${JSON.stringify(process.argv)}`);
  let screenshotUrl;
  let appScreenshotUrl = "截图失败";
  let startTime = new Date().getTime();
  let errorMsg = "";
  let testResult = "";
  let browser;
  try {
    // 等待浏览器完全启动
    await browser.waitUntil(async () => {
      return await browser.getUrl() !== '';
    }, {
      timeout: 5000,
      timeoutMsg: '浏览器启动超时'
    });

    // 测试1：验证扩展是否成功加载
    await browser.url('chrome://extensions/');

    // 调用自定义命令打开弹出窗口（确保该命令已在 wdio.conf.js 中注册）
    await browser.openExtensionPopup(EXTENSION_NAME, "src/side-panel/index.html");

    // 验证弹出窗口中的核心元素（替换为你扩展的实际选择器）
    const popupButton = await browser.$('.ant-row-center button'); // 示例选择器
    await popupButton.waitForExist({ timeout: 2000 });

    // 可选：点击按钮并验证结果
    await popupButton.click();
    // 这里可以添加更多验证逻辑
    testResult = "启动插件成功";
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
    testResult = "启动插件失败";
  }
  if (!errorMsg) {
    try {
      // 对浏览器截图
      outputLog("对浏览器截图");
      appScreenshotUrl = await screenshot(browser, 'browser-screenshot.png');
    } catch (e) {
      errorMsg += e.message + '\n';
      console.error(e);
    }

    try {
      // 屏幕截图
      outputLog("对屏幕截图");
      let options = { filename: 'screenshot.png' };
      await desktopScreenshot(options)
        .then(async (imagePath) => {
          console.log('Screenshot saved at:', imagePath);
          screenshotUrl = await uploadFile('screenshot.png');
        })
        .catch((err) => {
          screenshotUrl = "屏幕截图失败";
          console.error('Error taking screenshot:', err);
        });
    } catch (e) {
      screenshotUrl = "屏幕截图失败";
      errorMsg += e.message + '\n';
      console.error(e);
    }
  }

  outputLog("整理汇总信息");
  let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
  let msg = `${testResult}\n耗时${timeUse.toFixed(2)}分钟\n浏览器截图：${appScreenshotUrl}`;
  if (screenshotUrl) {
    msg += `\n屏幕截图：${screenshotUrl}`;
  }
  msg += `\n\n${errorMsg}`;
  outputLog("发送飞书消息");
  await feishuNotify(msg);
  outputLog("发送飞书消息完成，退出流程");
  process.exit(0);
}

main();