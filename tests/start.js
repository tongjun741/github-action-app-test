const path = require('path');
const os = require('os');
const { e2eTest } = require('./e2eTest');
const { ipTest } = require('./ipTest');
const { feishuNotify, screenshot, uploadFile } = require('./include/tools');
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
  const browser = await remote({
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

  let startTime = new Date().getTime();
  let testResult = "";
  let errorMsg = "";

  try {
    if (process.argv[2] === "e2e") {
      testResult = await e2eTest(browser);
    } else {
      testResult = await ipTest(browser);
    }
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
  }

  let appScreenshotUrl = "客户端截图失败";
  try {
    // 对客户端截图
    appScreenshotUrl = await screenshot(browser, 'app-screenshot.png');
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
  }

  let screenshotUrl = "屏幕截图失败";
  try {
    // 屏幕截图
    let options = { filename: 'screenshot.png' };
    if (process.env.E2E_PLATFORM === "Ubuntu") {
      options.screen = 99
    }
    await desktopScreenshot(options)
      .then((imagePath) => {
        console.log('Screenshot saved at:', imagePath);
      })
      .catch((err) => {
        console.error('Error taking screenshot:', err);
      });

    screenshotUrl = await uploadFile('screenshot.png');
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
  }

  let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
  let msg = `${testResult}\n耗时${timeUse.toFixed(2)}分钟\n客户端截图：${appScreenshotUrl}\n屏幕截图：${screenshotUrl}\n\n${errorMsg}`;
  await feishuNotify(msg);
  process.exit(0);
}

main();