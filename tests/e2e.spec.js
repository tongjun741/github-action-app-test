const { productConfig, devConfig } = require('./config');
const login = require('./include/login');
const openSession = require('./include/openSession');
const { feishuNotify } = require('./include/tools');

describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {
    let startTime = new Date().getTime();
    let ipText;
    let appScreenshotUrl;
    let sessionScreenshotUrl;
    let errorMsg = "";

    try {
      let config = productConfig;
      let password = process.env.PRODUCT_WDIO_PASSWORD || "password";
      if (process.env.IN_DEV === "true") {
        config = devConfig;
        password = process.env.DEV_WDIO_PASSWORD || "password";
      }
      await login(config, password);

      // 进入分身列表页面
      await $(`.icon-chrome_outline`).waitForExist({ timeout: 10 * 1000 })
      await $(`.icon-chrome_outline`).click();

      await $(`//a[text()="${productConfig.shopName}"]`).waitForExist({ timeout: 10 * 1000 })
      title = await browser.getTitle();
      console.log("标题是", title);

      // 进入分身详情页面
      await $(`//a[text()="${productConfig.shopName}"]`).click();
      // 打开浏览器
      await $('//span[text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 });
      await $('//span[text()="打开浏览器"]').click();

      try {
        // 处理有其他人在访问的情况
        await $(`//span[text()="继续访问"]`).waitForExist({ timeout: 10 * 1000 })
        await $(`//span[text()="继续访问"]`).click();
      } catch (e) {
      }

      await $('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 120 * 1000 });

      let rs = await openSession().catch(e => {
        errorMsg += e.message + '\n';
        console.error(e);
      });
      ipText = rs.ipText;
      sessionScreenshotUrl = rs.sessionScreenshotUrl;

      // 对客户端截图
      appScreenshotUrl = await screenshot(browser, 'app-screenshot.png');
    } catch (e) {
      errorMsg += e.message + '\n';
      console.error(e);
    }

    let msg;
    let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
    if (ipText) {
      msg = `打开会话测试完成！耗时${timeUse.toFixed(2)}分钟，当前IP地址是：${ipText}。\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n客户端截图：${sessionScreenshotUrl}`;
    } else {
      msg = `打开会话测试失败！耗时${timeUse.toFixed(2)}分钟。\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n客户端截图：${sessionScreenshotUrl}\n\n${errorMsg}`;
    }
    console.log(msg);
    await feishuNotify(msg);
  });
});
