const login = require('./include/login');
const { productConfig, devConfig } = require('./config');
const openSession = require('./include/openSession');
const { saveResult, showResultTable } = require('./include/tools');

async function e2eTest(browser) {
  console.log(`当前任务是E2E测试`);
  let isDev = process.env.IN_DEV === "true";
  let ipText = '';
  let sessionScreenshotUrl = '';
  let errorMsg = '';

  console.log(`E2E测试开始，当前时间是${new Date().toLocaleString()}`);
  try {
    let config = productConfig;
    let password = process.env.PRODUCT_WDIO_PASSWORD || "password";
    if (isDev) {
      config = devConfig;
      password = process.env.DEV_WDIO_PASSWORD || "password";
    }
    console.log(`开始登录，当前时间是${new Date().toLocaleString()}`);
    await login(config, password, browser);

    // 设置浏览器窗口大小
    await browser.execute(() => {
      window.resizeTo(1600, 1200);
    });

    let shopName = config.shopName;
    if (process.env.IN_WIN7 === "true") {
      // win7只有109的浏览器内核，所以要使用特定的分身
      shopName = config.win7shopName;
    }

    // 进入分身列表页面
    await browser.$(`.icon-chrome_outline`).waitForExist({ timeout: 10 * 1000 })
    await browser.$(`.icon-chrome_outline`).click();

    await browser.$(`//a[text()="${shopName}"]`).waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);

    // 进入分身详情页面
    await browser.$(`//a[text()="${shopName}"]`).click();
    // 打开浏览器
    await browser.$('//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 });
    await browser.$('//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]').click();

    // 处理有其他人在访问的情况
    while (true) {
      try {
        await browser.$(`//span[text()="继续访问"]`).waitForExist({ timeout: 5 * 1000 })
        await browser.$(`//span[text()="继续访问"]`).click();
      } catch (e) {
      }

      try {
        await browser.$('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 5 * 1000 });
        break;
      } catch (e) {
      }
    }

    console.log(`开始打开会话，当前时间是${new Date().toLocaleString()}`);
    let rs = await openSession().catch(e => {
      errorMsg += e.message + '\n';
      console.error(e);
    });
    if (rs) {
      ipText = rs.ipText;
      sessionScreenshotUrl = rs.sessionScreenshotUrl;
    }
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
  }

  console.log(`E2E测试结束，当前时间是${new Date().toLocaleString()}`);

  let msg;
  if (ipText) {
    msg = `打开会话测试完成！当前IP地址是：${ipText}。\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n`;
    await saveResult(isDev, process.env.E2E_PLATFORM || "--", ipText);
  } else {
    msg = `打开会话测试失败！\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n\n${errorMsg}` + `\n<at user_id=\"${process.env.FEISHU_ME}\">me</at>`;
    await saveResult(isDev, process.env.E2E_PLATFORM || "--", "Error");
  }
  let rs = await showResultTable(isDev);
  msg += `${rs}`;
  console.log(msg);

  return msg;
}

module.exports = {
  e2eTest
};
