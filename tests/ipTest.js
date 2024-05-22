const path = require('path');
const os = require('os');
const login = require('./include/login');
const { remote, $ } = require('webdriverio');

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
    }
  });

  await login(browser);

  // 进入IP列表页面
  await browser.$(`.icon-IP_24`).waitForExist({ timeout: 10 * 1000 })
  await browser.$(`.icon-IP_24`).click();

  await browser.$(`//div[text()="质量测试"]`).waitForExist({ timeout: 10 * 1000 })
  title = await browser.getTitle();
  console.log("标题是", title);

  while (true) {
    // 全选
    await browser.$(`.ant-table-thead  .ant-checkbox-input`).click();
    console.log('开始测试');
    await browser.$(`//div[text()="质量测试"]`).click();
    console.log('等待测试完成，1小时超时');
    await browser.$(`//button[not(self::node()[contains(concat(" ",normalize-space(@class)," "),"ant-btn-loading")])]//div[text()="质量测试"]`).waitForExist({ timeout: 60 * 60 * 1000 })

    if (await browser.$('.icon-angle-right_24:not(.disabled)').isExisting()) {
      console.log('有下一页，进入下一页');
      await browser.$('.icon-angle-right_24:not(.disabled)').click();
    } else {
      console.log('没有下一页，退出');
      break;
    }
  }

  await browser.deleteSession()
}

main();