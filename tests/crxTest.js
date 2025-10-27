const desktopScreenshot = require('screenshot-desktop');
const { remote } = require('webdriverio');
const { join } = require('path');
const { feishuNotify, screenshot, uploadFile, outputLog } = require('./include/tools');
const { productCrxTestConfig, devCrxTestConfig } = require('./config');
const login = require('./include/login');

const EXTENSION_NAME = "花漾TK";
const EXTENSION_PATH = join(__dirname, '..', 'tkshop-crx');

async function main() {
  let isDev = process.env.IN_DEV === "true";

  let config = productCrxTestConfig;
  let password = process.env.PRODUCT_WDIO_PASSWORD || "password";
  if (isDev) {
    config = devCrxTestConfig;
    password = process.env.DEV_WDIO_PASSWORD || "password";
  }

  let screenshotUrl;
  let appScreenshotUrl = "截图失败";
  let startTime = new Date().getTime();
  let errorMsg = "";
  let testResult = "";
  let browser;
  try {
    // 配置 Chrome 浏览器选项
    const chromeOptions = {
      capabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          // 加载扩展
          args: [`--load-extension=${EXTENSION_PATH}`, '--disable-features=DisableLoadExtensionCommandLineSwitch'],
          // 可选：禁用自动化控制提示
          excludeSwitches: ['enable-automation']
        }
      },
      services: ['chromedriver'] // 使用 chromedriver 服务
    };

    // 初始化浏览器实例
    browser = await remote(chromeOptions);

    // 等待浏览器完全启动
    await browser.waitUntil(async () => {
      return await browser.getUrl() !== '';
    }, {
      timeout: 5000,
      timeoutMsg: '浏览器启动超时'
    });

    // 测试1：验证扩展是否成功加载
    await browser.url('chrome://extensions/');

    // 调用自定义命令打开弹出窗口（确保该命令已在 wdio.conf.js 中注册）
    await openExtensionPopup(browser, EXTENSION_NAME, "src/side-panel/index.html");

    // 验证弹出窗口中的核心元素（替换为你扩展的实际选择器）
    const popupButton = await browser.$('.ant-row-center button'); // 示例选择器
    await popupButton.waitForExist({ timeout: 2000 });

    // 可选：点击按钮并验证结果
    await popupButton.click();

    // 等待2秒打开新标签页
    await browser.pause(2000);

    // 切换到新打开的标签页（如果有）
    const handles = await browser.getWindowHandles();
    if (handles.length > 1) {
      await browser.switchToWindow(handles[1]);

      outputLog(`开始登录`);
      await login(config, password, browser, false);
    }

    // 这里可以添加更多验证逻辑
    testResult = "启动插件成功";
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
    testResult = "启动插件失败";
  }
  if (!errorMsg) {
    try {
      // 对浏览器截图
      outputLog("对浏览器截图");
      appScreenshotUrl = await screenshot(browser, 'browser-screenshot.png');
    } catch (e) {
      errorMsg += e.message + '\n';
      console.error(e);
    }

    try {
      // 屏幕截图
      outputLog("对屏幕截图");
      let options = { filename: 'screenshot.png' };
      await desktopScreenshot(options)
        .then(async (imagePath) => {
          console.log('Screenshot saved at:', imagePath);
          screenshotUrl = await uploadFile('screenshot.png');
        })
        .catch((err) => {
          screenshotUrl = "屏幕截图失败";
          console.error('Error taking screenshot:', err);
        });
    } catch (e) {
      screenshotUrl = "屏幕截图失败";
      errorMsg += e.message + '\n';
      console.error(e);
    }
  }

  outputLog("整理汇总信息");
  let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
  let msg = `${testResult}\n耗时${timeUse.toFixed(2)}分钟\n浏览器截图：${appScreenshotUrl}`;
  if (screenshotUrl) {
    msg += `\n屏幕截图：${screenshotUrl}`;
  }
  msg += `\n\n${errorMsg}`;
  outputLog("发送飞书消息");
  await feishuNotify(msg);
  outputLog("发送飞书消息完成，退出流程");
  process.exit(0);
}

async function openExtensionPopup(browser, extensionName, popupUrl = 'index.html') {
  if (browser.capabilities.browserName !== 'chrome') {
    throw new Error('此命令仅支持 Chrome 浏览器');
  }

  await browser.url('chrome://extensions/');

  await browser.pause(1000); // 等待页面加载

  // 2. 定位包含 Shadow DOM 的根元素（通常是扩展列表容器）
  // 注意：不同 Chrome 版本的容器元素可能不同，需按实际情况调整选择器
  const containerSelector = 'extensions-manager';
  const extensionsContainer = await browser.$(containerSelector);

  // 3. 通过原生 JS 获取 Shadow Root 并查询扩展列表（核心兼容代码）
  const extensionNames = await browser.execute((containerSelector) => {
    // 3.1 获取容器元素
    const container = document.querySelector(containerSelector);
    if (!container) return [];

    // 3.2 获取容器的 Shadow Root（原生 DOM API）
    const shadowRoot = container.shadowRoot;
    if (!shadowRoot) return [];

    // 3.3 在 Shadow Root 中查找所有扩展项（如 extensions-item）
    const extensionItems = shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelectorAll('extensions-item');
    if (!extensionItems.length) return [];

    // 3.4 遍历扩展项，获取名称（处理可能的嵌套 Shadow DOM）
    const names = [];
    extensionItems.forEach(item => {
      // 若扩展项本身也有 Shadow DOM，继续获取
      const itemShadowRoot = item.shadowRoot;
      if (itemShadowRoot) {
        const nameEl = itemShadowRoot.querySelector('#name');
        if (nameEl) names.push({
          name: nameEl.textContent.trim(),
          id: item.getAttribute('id')
        });
      }
    });
    return names;
  }, containerSelector); // 传递容器选择器给 execute 函数

  // 6. 验证目标扩展是否存在（替换为你的扩展名称）

  console.log('Shadow DOM 中的扩展列表:', JSON.stringify(extensionNames, null, 2));

  let targetExtension = null;
  for (const ext of extensionNames) {
    if (ext.name === extensionName) {
      targetExtension = ext;
      break;
    }
  }

  if (!targetExtension) {
    throw new Error(`未找到扩展 "${extensionName}"`);
  }

  console.log(`弹出扩展 "${extensionName}" 的弹出窗口，url: chrome-extension://${targetExtension.id}/popup/${popupUrl}`);
  await browser.url(`chrome-extension://${targetExtension.id}/${popupUrl}`);
}

main();