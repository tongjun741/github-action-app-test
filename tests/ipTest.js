const path = require('path');
const os = require('os');
const login = require('./include/login');
const { ipTestConfig } = require('./config');
const { sleep } = require('./include/tools');
const { remote } = require('webdriverio');
const axios = require('axios');

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

  await login(ipTestConfig, process.env.PRODUCT_IP_TEST_PASSWORD, browser);

  // 进入IP列表页面
  await browser.$(`.icon-IP_24`).waitForExist({ timeout: 10 * 1000 })
  await browser.$(`.icon-IP_24`).click();

  await browser.$(`//div[text()="质量测试"]`).waitForExist({ timeout: 10 * 1000 })
  title = await browser.getTitle();
  console.log("标题是", title);

  let startTime = new Date().getTime();
  let currentPage;
  while (true) {
    // 全选
    await sleep(5 * 1000);
    currentPage = await browser.$(`span.current-page`).getText();
    console.log(`${new Date().toLocaleString()}, 当前页码：${currentPage}`);
    await browser.$(`.ant-table-thead  .ant-checkbox-input`).click();
    console.log('开始测试');
    await sleep(10 * 1000);
    await browser.$(`//div[text()="质量测试"]`).click();
    console.log('等待测试完成，1小时超时');
    await browser.$(`//button[not(self::node()[contains(concat(" ",normalize-space(@class)," "),"ant-btn-loading")])]//div[text()="质量测试"]`).waitForExist({ timeout: 60 * 60 * 1000 })
    await sleep(5 * 1000);

    if (await browser.$('.icon-angle-right_24:not(.disabled)').isExisting()) {
      console.log('有下一页，进入下一页');
      await browser.$('.icon-angle-right_24:not(.disabled)').click();
    } else {
      console.log('没有下一页，退出');
      break;
    }
  }

  await browser.deleteSession()


  // 飞书机器人Webhook URL
  const webhookUrl = `https://open.feishu.cn/open-apis/bot/v2/hook/${process.env.FEISHU_TOKEN}`;

  let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
  // 要发送的消息内容
  const message = {
    msg_type: 'text',
    content: {
      text: `【花漾】IP测试完成！耗时${timeUse.toFixed(2)}分钟，最后一页是：${currentPage}`
    }
  };

  // 发送POST请求
  await axios.post(webhookUrl, message)
    .then(response => {
      console.log('通知发送成功:', response.data);
    })
    .catch(error => {
      console.error('发送通知时出错:', error);
    });

}

main();