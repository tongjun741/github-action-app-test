const path = require('path');
const os = require('os');
const { e2eTest } = require('./e2eTest');
const { ipTest } = require('./ipTest');
const { feishuNotify, screenshot, uploadFile, outputLog } = require('./include/tools');
const { remote } = require('webdriverio');
const desktopScreenshot = require('screenshot-desktop');

let extCapabilities = {};
if (os.platform() === 'darwin') {
  exePath = "/Applications/花漾客户端.app/Contents/MacOS/花漾客户端";
  extCapabilities = {
    'wdio:chromedriverOptions': {
      cacheDir: '/tmp'
    }
  }
} else if (os.platform() === 'linux') {
  exePath = "/opt/花漾客户端/huayoung";
} else {
  exePath = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'HuaYoung', '花漾客户端.exe');
}

async function main() {
  let taskType = (process.argv.length > 1 && process.argv[2] === "e2e") ? "e2e" : "ipTest";
  outputLog(`环境变量：${JSON.stringify(process.env)}`);
  outputLog(`输入参数：${JSON.stringify(process.argv)}`);
  let screenshotUrl;
  let appScreenshotUrl = "客户端截图失败";
  let startTime = new Date().getTime();
  let errorMsg = "";
  let testResult = "";
  let browser;
  try {
    browser = await remote({
      capabilities: {
        browserName: 'chrome',
        browserVersion: '108',
        'goog:chromeOptions': {
          // C:\Users\tongjun\AppData\Local\Temp\electron-fiddle-63636-4fM8uPJnP5Qg\out\nutritious-cactus-suspect-ocuz1-win32-x64
          // binary: path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp', 'electron-fiddle-63636-4fM8uPJnP5Qg', 'out', 'nutritious-cactus-suspect-ocuz1-win32-x64', 'nutritious-cactus-suspect-ocuz1.exe')
          binary: exePath
        },
        ...extCapabilities
      },
      logLevel: 'warn'
    });

  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
    testResult = "启动客户端失败";
  }
  if (!errorMsg) {
    try {
      if (taskType === "e2e") {
        outputLog("开始进行E2E测试");
        testResult = await e2eTest(browser);
        outputLog("E2E测试完成");
      } else {
        outputLog("开始进行IP测试");
        testResult = await ipTest(browser);
        outputLog("开始进行E2E测试");
        outputLog("IP测试完成");
      }
    } catch (e) {
      errorMsg += e.message + '\n';
      console.error(e);
    }

    try {
      // 对客户端截图
      outputLog("对客户端截图");
      appScreenshotUrl = await screenshot(browser, 'app-screenshot.png');
    } catch (e) {
      errorMsg += e.message + '\n';
      console.error(e);
    }

    if (taskType != "e2e") {
      // macOS下无法截屏
      try {
        // 屏幕截图
        outputLog("对屏幕截图");
        let options = { filename: 'screenshot.png' };
        if (process.env.E2E_PLATFORM === "Ubuntu") {
          options.screen = 99
        }
        if (process.env.E2E_PLATFORM?.indexOf('macOS') > -1) {
          screenshotUrl = await screenshot(browser, 'screenshot.png');
        } else {
          await desktopScreenshot(options)
            .then(async (imagePath) => {
              console.log('Screenshot saved at:', imagePath);
              screenshotUrl = await uploadFile('screenshot.png');
            })
            .catch((err) => {
              screenshotUrl = "屏幕截图失败";
              console.error('Error taking screenshot:', err);
            });
        }
      } catch (e) {
        screenshotUrl = "屏幕截图失败";
        errorMsg += e.message + '\n';
        console.error(e);
      }
    }

  }

  outputLog("整理汇总信息");
  let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
  let msg = `${testResult}\n耗时${timeUse.toFixed(2)}分钟\n客户端截图：${appScreenshotUrl}`;
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