const login = require('./include/login');
const { productConfig, devConfig } = require('./config');
const openSession = require('./include/openSession');
const { saveResult, showResultTable, outputLog, screenshot } = require('./include/tools');

async function e2eTest(browser) {
  outputLog(`当前任务是E2E测试`);
  let isDev = process.env.IN_DEV === "true";
  let ipText = '';
  let sessionScreenshotUrl = '';
  let errorMsg = '';

  outputLog(`E2E测试开始`);
  try {
    let config = productConfig;
    let password = process.env.PRODUCT_WDIO_PASSWORD || "password";
    if (isDev) {
      config = devConfig;
      password = process.env.DEV_WDIO_PASSWORD || "password";
    }
    outputLog(`开始登录`);
    await login(config, password, browser);

    // 设置浏览器窗口大小
    outputLog("设置浏览器窗口大小");
    await browser.execute(() => {
      window.resizeTo(1600, 1200);
    });

    let shopName = config.shopName;
    if (process.env.IN_WIN7 === "true") {
      // win7只有109的浏览器内核，所以要使用特定的分身
      shopName = config.win7shopName;
    }

    // 进入分身列表页面
    outputLog("进入分身列表页面");
    await browser.$(`.icon-chrome_outline`).waitForExist({ timeout: 30 * 1000 })
    await browser.$(`.icon-chrome_outline`).click();

    outputLog("等待分身出现");
    await browser.$(`//a[text()="${shopName}"]`).waitForExist({ timeout: 30 * 1000 })
    title = await browser.getTitle();
    outputLog(`当前窗口标题是${title}`);

    // 进入分身详情页面
    outputLog("进入分身详情页面");
    await browser.$(`//a[text()="${shopName}"]`).click();
    // 打开浏览器
    outputLog(`打开浏览器`);
    await browser.$('//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]').waitForExist({ timeout: 30 * 1000 });
    await browser.$('//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]').click();

    // 处理有其他人在访问的情况
    outputLog(`处理有其他人在访问的情况`);
    // 最多尝试100次
    let tryCount = 0;
    while (true) {
      tryCount++;
      if (tryCount > 100) {
        throw new Error("等待打开会话超时");
      }

      try {
        await browser.$(`//span[text()="继续访问"]`).waitForExist({ timeout: 5 * 1000 })
        await browser.$(`//span[text()="继续访问"]`).click();
      } catch (e) {
        outputLog(`等待继续访问按钮出现`);
        try {
          let url = await screenshot(browser, 'app-screenshot.png');
          outputLog(`客户端截图${url}`);
        } catch (e) {

        }
      }

      try {
        await browser.$('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 5 * 1000 });
        break;
      } catch (e) {
        outputLog(`等待正在访问按钮消失`);
        try {
          let url = await screenshot(browser, 'app-screenshot.png');
          outputLog(`客户端截图${url}`);
        } catch (e) {

        }
      }
    }

    outputLog(`开始打开会话`);
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

  let msg="";
  try {
    // 点击支持按钮，展示当前版本号
    await browser.$('//span[text()="支持"][contains(@class,"menu-item-name")]').click();
  } catch (e) {
    msg+="找不到支持按钮";
  }
  outputLog(`E2E测试结束：ipText=${ipText}`);

  if (ipText) {
    msg += `打开会话测试完成！当前IP地址是：${ipText}。\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n`;
    await saveResult(isDev, process.env.E2E_PLATFORM || "--", `${ipText}|${process.env.DOWNLOAD_URL?.split('/')?.slice(-1)?.[0]?.match(/\d+\.\d+\.\d+/)?.[0]}`);
  } else {
    msg += `打开会话测试失败！\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${sessionScreenshotUrl}\n\n${errorMsg}` + `\n<at user_id=\"${process.env.FEISHU_ME}\">me</at>`;
    await saveResult(isDev, process.env.E2E_PLATFORM || "--", `Error|${process.env.DOWNLOAD_URL.split('/').slice(-1)?.[0]?.match(/\d+\.\d+\.\d+/)?.[0]}`);
  }
  let rs = await showResultTable(isDev);
  msg += `${rs}`;
  console.log(msg);

  return msg;
}

module.exports = {
  e2eTest
};
