const process = require('node:process');
const login = require('./include/login');
const { productConfig, devConfig } = require('./config');
const openSession = require('./include/openSession');
const { saveResult, showResultTable, outputLog, screenshot, sleep } = require('./include/tools');

function getShopNames(config, {
  testAllShopNames = false,
  inWin7 = false,
  platform = process.platform,
} = {}) {
  const configuredShopNames = inWin7 ? config.win7shopName : config.shopName;
  const shopNames = (Array.isArray(configuredShopNames)
    ? configuredShopNames
    : [configuredShopNames]
  ).filter(Boolean);
  const supportedShopNames = platform === 'linux'
    ? shopNames.filter(shopName => {
      const shopNumber = String(shopName).match(/\d+/)?.[0];
      return shopNumber !== undefined && Number(shopNumber) <= 144;
    })
    : shopNames;

  return testAllShopNames ? supportedShopNames : supportedShopNames.slice(0, 1);
}

async function ensureBrowserWindowSize(browser, {
  width = 1600,
  height = 1200,
  retryDelayMs = 3000,
  sleep: wait = sleep,
  outputLog: log = outputLog,
} = {}) {
  const resizeWindow = () => browser.execute((targetWidth, targetHeight) => {
    window.resizeTo(targetWidth, targetHeight);
  }, width, height);
  const getWindowSize = () => browser.execute(() => ({
    width: window.outerWidth,
    height: window.outerHeight,
  }));

  log(`设置浏览器窗口大小为${width}x${height}`);
  await resizeWindow();

  let actualSize = await getWindowSize();
  if (actualSize.width === width && actualSize.height === height) {
    log(`浏览器窗口大小设置成功：${actualSize.width}x${actualSize.height}`);
    return actualSize;
  }

  log(`浏览器窗口大小未生效，当前为${actualSize.width}x${actualSize.height}，${retryDelayMs / 1000}秒后重新调整`);
  await wait(retryDelayMs);
  await resizeWindow();

  actualSize = await getWindowSize();
  log(`重新调整后的浏览器窗口大小为${actualSize.width}x${actualSize.height}`);
  return actualSize;
}

async function e2eTest(browser) {
  outputLog(`当前任务是E2E测试`);
  const isDev = process.env.IN_DEV === "true";
  const testAllShopNames = process.env.TEST_ALL_SHOP_NAMES === "true";
  const inWin7 = process.env.IN_WIN7 === "true";
  let config = productConfig;
  let password = process.env.PRODUCT_WDIO_PASSWORD || "password";
  if (isDev) {
    config = devConfig;
    password = process.env.DEV_WDIO_PASSWORD || "password";
  }
  const shopNames = getShopNames(config, { testAllShopNames, inWin7 });
  const testResults = [];

  outputLog(`E2E测试开始`);
  try {
    if (shopNames.length === 0) {
      throw new Error("没有配置可测试的shopName");
    }
    outputLog(`开始登录`);
    await login(config, password, browser);

    await ensureBrowserWindowSize(browser);

    for (const shopName of shopNames) {
      let ipText = '';
      let sessionScreenshotUrl = '';
      let errorMsg = '';

      outputLog(`开始测试分身：${shopName}`);
      try {
        // 进入分身列表页面
        outputLog("进入分身列表页面");
        await browser.$(`.icon-chrome_outline`).waitForExist({ timeout: 30 * 1000 })
        await browser.$(`.icon-chrome_outline`).click();

        outputLog("等待分身出现");
        await browser.$(`//a[text()="${shopName}"]`).waitForExist({ timeout: 30 * 1000 })
        const title = await browser.getTitle();
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
          } catch {
            outputLog(`等待继续访问按钮出现`);
            try {
              const url = await screenshot(browser, 'app-screenshot.png');
              outputLog(`客户端截图${url}`);
            } catch {
              // 截图失败不应中断会话重试。
            }
          }

          try {
            await browser.$('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 5 * 1000 });
            break;
          } catch {
            outputLog(`等待正在访问按钮消失`);
            try {
              const url = await screenshot(browser, 'app-screenshot.png');
              outputLog(`客户端截图${url}`);
            } catch {
              // 截图失败不应中断会话重试。
            }
          }
        }

        outputLog(`开始打开会话`);
        const rs = await openSession();
        ipText = rs.ipText;
        sessionScreenshotUrl = rs.sessionScreenshotUrl;
      } catch (e) {
        errorMsg += e.message + '\n';
        console.error(e);
      }
      testResults.push({ shopName, ipText, sessionScreenshotUrl, errorMsg });
      outputLog(`分身${shopName}测试结束：ipText=${ipText}`);
    }
  } catch (e) {
    console.error(e);
    for (const shopName of shopNames.length > 0 ? shopNames : ['']) {
      testResults.push({
        shopName,
        ipText: '',
        sessionScreenshotUrl: '',
        errorMsg: e.message + '\n',
      });
    }
  }

  let msg = "";
  try {
    // 点击支持按钮，展示当前版本号
    await browser.$('//span[text()="支持"][contains(@class,"menu-item-name")]').click();
  } catch {
    msg += "找不到支持按钮";
  }

  for (const result of testResults) {
    const shopLabel = testResults.length > 1 ? `【${result.shopName}】` : '';
    if (result.ipText) {
      msg += `${shopLabel}打开会话测试完成！当前IP地址是：${result.ipText}。\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${result.sessionScreenshotUrl}\n`;
    } else {
      msg += `${shopLabel}打开会话测试失败！\n客户端下载地址是：${process.env.DOWNLOAD_URL}\n会话截图：${result.sessionScreenshotUrl}\n\n${result.errorMsg}`;
    }
  }
  if (testResults.some(result => !result.ipText)) {
    msg += `\n<at user_id="${process.env.FEISHU_ME}">me</at>`;
  }

  const version = process.env.DOWNLOAD_URL?.split('/')?.slice(-1)?.[0]?.match(/\d+\.\d+\.\d+/)?.[0];
  const resultSummary = testResults.length === 1
    ? (testResults[0].ipText || 'Error')
    : testResults.map(result => `${result.shopName}=${result.ipText || 'Error'}`).join(',');
  await saveResult(isDev, process.env.E2E_PLATFORM || "--", `${resultSummary}|${version}`);

  outputLog(`E2E测试结束：${resultSummary}`);
  const rs = await showResultTable(isDev);
  msg += `${rs}`;
  console.log(msg);

  return msg;
}

module.exports = {
  e2eTest,
  ensureBrowserWindowSize,
  getShopNames,
};
