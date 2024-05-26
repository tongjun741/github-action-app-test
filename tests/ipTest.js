const path = require('path');
const os = require('os');
const login = require('./include/login');
const { ipTestConfig } = require('./config');
const { sleep, feishuNotify, screenshot } = require('./include/tools');
const { remote } = require('webdriverio');

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
  let appScreenshotUrl;
  let currentPage;
  let totalCount;
  let errorMsg = "";
  let unavailable = "";

  try {
    await login(ipTestConfig, process.env.PRODUCT_IP_TEST_PASSWORD, browser);

    // 进入IP列表页面
    await browser.$(`.icon-IP_24`).waitForExist({ timeout: 10 * 1000 })
    await browser.$(`.icon-IP_24`).click();

    await browser.$(`//div[text()="质量测试"]`).waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);
    while (true) {
      // 等待全选按钮出现
      await browser.$(`.ant-table-thead  .ant-checkbox-input`).waitForExist({ timeout: 600 * 1000 });
      // 等待当前页码出现
      await browser.$(`span.current-page`).waitForExist({ timeout: 600 * 1000 });
      // 等待Loading消失
      const spin = await browser.$('.ant-spin-spinning');
      if (await spin.isExisting()) {
        await spin.waitUntil(async function () {
          return !await this.isExisting()
        }, {
          timeout: 60 * 1000,
        })
      }

      currentPage = await browser.$(`span.current-page`).getText();
      console.log(`${new Date().toLocaleString()}, 当前页码：${currentPage}`);

      // 全选
      await browser.$(`.ant-table-thead  .ant-checkbox-input`).click();
      console.log('开始测试');
      // 等待质量测试按钮可用
      await browser.$(`//button[not(self::node()[contains(concat(" ",normalize-space(@class)," "),"disabled")])]//div[text()="质量测试"]`).waitForExist({ timeout: 60 * 60 * 1000 })
      await browser.$(`//div[text()="质量测试"]`).click();
      console.log('等待测试完成，1小时超时');
      await browser.$(`//button[not(self::node()[contains(concat(" ",normalize-space(@class)," "),"ant-btn-loading")])]//div[text()="质量测试"]`).waitForExist({ timeout: 60 * 60 * 1000 });
      await sleep(5 * 1000);

      if (await browser.$('.icon-angle-right_24:not(.disabled)').isExisting()) {
        console.log('有下一页，进入下一页');
        await browser.$('.icon-angle-right_24:not(.disabled)').click();
      } else {
        console.log('没有下一页，退出');
        totalCount = await browser.$(`.pagination > div >span`).getText();
        break;
      }
    }

    try {
      if (await browser.$('div[class*=ai-chat-popup] div[class*=close]').isExisting()) {
        console.log('关闭AI弹窗');
        await browser.$('div[class*=ai-chat-popup] div[class*=close]').click();
      }

      // 失效的IP
      console.log('查看失效的IP');
      await browser.$(`//span[text()="已失效的IP"]`).click();
      await sleep(5 * 1000);
      await browser.$(`.pagination > div >span`).waitForExist({ timeout: 60 * 60 * 1000 })
      unavailable = await browser.$(`.pagination > div >span`).getText();
    } catch (e) {
      errorMsg += e.message + '\n';
      console.error(e);
    }
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
  }

  try {
    // 对客户端截图
    appScreenshotUrl = await screenshot(browser, 'app-screenshot.png');
    await browser.deleteSession();
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
  }

  let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
  let msg = `IP测试完成！耗时${timeUse.toFixed(2)}分钟\n最后一页是：${currentPage}\n总记录数：${totalCount}\n已失效的IP：${unavailable}\n客户端截图：${appScreenshotUrl}\n\n${errorMsg}`;
  await feishuNotify(msg);
}

main();