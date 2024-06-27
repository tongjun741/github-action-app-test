const { productConfig, devConfig } = require('./config');
const login = require('./include/login');
const openSession = require('./include/openSession');
const { feishuNotify, screenshot } = require('./include/tools');

global.testData = {
  startTime: 0,
  ipText: '',
  sessionScreenshotUrl: '',
  errorMsg: '',
};

describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {
    global.testData.startTime = new Date().getTime();
    console.log(`E2E测试开始，当前时间是${new Date().toLocaleString()}`);
    try {
      // 设置浏览器窗口大小
      browser.setWindowSize(1600, 1200);

      let config = productConfig;
      let password = process.env.PRODUCT_WDIO_PASSWORD || "password";
      if (process.env.IN_DEV === "true") {
        config = devConfig;
        password = process.env.DEV_WDIO_PASSWORD || "password";
      }
      console.log(`开始登录，当前时间是${new Date().toLocaleString()}`);
      await login(config, password);

      let shopName = config.shopName;
      if(process.env.IN_WIN7==="true"){
        // win7只有109的浏览器内核，所以要使用特定的分身
        shopName = config.win7shopName;
      }
      // 进入分身列表页面
      await $(`.icon-chrome_outline`).waitForExist({ timeout: 10 * 1000 })
      await $(`.icon-chrome_outline`).click();

      await $(`//a[text()="${shopName}"]`).waitForExist({ timeout: 10 * 1000 })
      title = await browser.getTitle();
      console.log("标题是", title);

      // 进入分身详情页面
      await $(`//a[text()="${shopName}"]`).click();
      // 打开浏览器
      await $('//span[text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 });
      await $('//span[text()="打开浏览器"]').click();

      // 处理有其他人在访问的情况
      while (true) {
        try {
          await $(`//span[text()="继续访问"]`).waitForExist({ timeout: 5 * 1000 })
          await $(`//span[text()="继续访问"]`).click();
        } catch (e) {
        }

        try {
          await $('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 5 * 1000 });
          break;
        } catch (e) {
        }
      }

      console.log(`开始打开会话，当前时间是${new Date().toLocaleString()}`);
      let rs = await openSession().catch(e => {
        global.testData.errorMsg += e.message + '\n';
        console.error(e);
      });
      if (rs) {
        global.testData.ipText = rs.ipText;
        global.testData.sessionScreenshotUrl = rs.sessionScreenshotUrl;
      }
    } catch (e) {
      global.testData.errorMsg += e.message + '\n';
      console.error(e);
    }
    console.log(`E2E测试结束，当前时间是${new Date().toLocaleString()}`);
  });

  it('report', async () => {
    console.log(`Report开始，当前时间是${new Date().toLocaleString()}`);
    const { startTime, ipText, sessionScreenshotUrl, errorMsg } = global.testData;
    let appScreenshotUrl;

    try {
      // 对客户端截图
      appScreenshotUrl = await screenshot(browser, 'app-screenshot.png');
    } catch (e) {
      errorMsg += e.message + '\n';
      console.error(e);
    }

    let msg;
    let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
    if (ipText) {
      msg = `打开会话测试完成！耗时${timeUse.toFixed(2)}分钟，当前IP地址是：${ipText}。\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n客户端截图：${appScreenshotUrl}`;
    } else {
      msg = `打开会话测试失败！耗时${timeUse.toFixed(2)}分钟。\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n客户端截图：${appScreenshotUrl}\n\n${errorMsg}` + `\n<at user_id=\"${process.env.FEISHU_ME}\">me</at>`;
    }
    console.log(msg);
    await feishuNotify(msg);
  });
});
