const axios = require('axios');
const { sleep, outputLog, screenshot } = require('./tools');

async function login(config, password, targetBrowser, isClient = true) {
  outputLog(`===== 开始登录流程 =====`);
  outputLog(`配置信息: teamName=${config.teamName}, username=${config.username}`);
  outputLog(`isClient: ${isClient}`);

  if (targetBrowser) {
    browser = targetBrowser;
  }

  let retryTimes = 0;
  outputLog("尝试切换到主窗口...");
  while (retryTimes < 100) {
    try {
      // 按标题切换到主窗口
      // 兼容有首页和默认只有分身页的情况
      outputLog(`第 ${retryTimes + 1} 次尝试按标题切换到主窗口，兼容有首页和默认只有分身页的情况`);
      let titleReg = isClient ? / - HuaYoung| - 花漾灵动/ : /花漾TK/;
      outputLog(`标题正则表达式: ${titleReg}`);
      await browser.switchWindow(titleReg);
      outputLog("✓ 成功切换到主窗口");
      break;
    } catch (e) {
      outputLog(`切换窗口失败: ${e.message}`);
    }
    await sleep(2 * 1000);
    retryTimes++;
  }

  if (retryTimes >= 100) {
    throw new Error("切换到主窗口超时");
  }

  outputLog("按标题切换到主窗口完成");

  if (isClient) {
    outputLog("等待应用版本元素出现...");
    await browser.$('div[class*=app-version]').waitForExist({ timeout: 100 * 1000 });
    outputLog("✓ 应用版本元素已出现");
  }

  // 验证页面标题
  outputLog("验证页面标题");
  let title = await browser.getTitle();
  outputLog(`当前窗口标题是${title}`);
  // expect(title).toBe('Your Electron App Title');

  if (isClient) {
    const version = await browser.$('div[class*=app-version]').getText();
    outputLog(`版本号是：${version}`);
  }

  // 检查当前是登录页面还是团队选择界面
  outputLog("检查当前是登录页面还是团队选择界面");
  try {
    await browser.waitUntil(async () => {
      const hasLoginButton = await browser.$('//div[text()="邮箱登录"]').isExisting();
      const hasTeamName = await browser.$(`//span[text()="${config.teamName}"]`).isExisting();
      outputLog(`邮箱登录按钮: ${hasLoginButton}, 团队名称: ${hasTeamName}`);
      return hasLoginButton || hasTeamName;
    }, {
      timeout: 5000, // 最长等待时间，单位：毫秒
      interval: 500   // 检查间隔时间，单位：毫秒
    });
  } catch (e) {
    outputLog(`✗ 等待登录页面或团队选择界面超时: ${e.message}`);
    const url = await screenshot(browser, 'login-error-screenshot.png');
    outputLog(`错误截图: ${url}`);
    throw e;
  }

  // 当前是登录页面，开始登录
  if (await browser.$('//div[text()="邮箱登录"]').isExisting()) {
    outputLog("当前是登录页面，开始登录")
    await browser.$(`//div[text()="邮箱登录"]`).click();
    await sleep(3 * 1000);

    outputLog("填写用户名和密码");
    await browser.$('#email').setValue(config.username);
    await browser.$('#email_password').setValue(password);
    outputLog("✓ 用户名和密码已填写");

    // 发送请求测试服务器是否可用
    let url = 'https://api.szdamai.com/api/msg-center/broadcasts';
    if (process.env.IN_DEV === "true") {
      url = "https://dev.thinkoncloud.cn/api/msg-center/broadcasts";
    }
    outputLog(`检查服务器状态: ${url}`);
    // 最多等待20分钟
    let startTime = Date.now();
    while (true) {
      try {
        let response = await axios.get(url, { timeout: 10000 });
        outputLog(`✓ 服务器状态正常：${response.status}`);
        break;
      } catch (e) {
        console.error(e.message);
        outputLog(`服务器不可用，等待服务器恢复：${url}`)
        if (Date.now() - startTime > 20 * 60 * 1000) {
          throw new Error("等待服务器恢复超时");
        }
        await sleep(60 * 1000);
      }
    }

    // 服务器不可用，等待服务器恢复
    while (await browser.$('//div[contains(concat(" ", normalize-space(@class), " "), " marquee-container ")]//span[contains(., "请检查您的网络是否通畅")]').isExisting()) {
      outputLog("服务器不可用，等待服务器恢复")
      await sleep(60 * 1000);
    }

    outputLog("点击登录按钮");
    await browser.$('.ant-btn-primary').click();

    if (isClient) {
      outputLog(`等待团队名称出现: ${config.teamName}`);
      await browser.$(`//span[text()="${config.teamName}"]`).waitForExist({ timeout: 100 * 1000 });
      outputLog("✓ 团队选择界面已出现");
    } else {
      await browser.$(`//div[text()="花漾TK登录成功"]`).waitForExist({ timeout: 30 * 1000 });
    }
  } else {
    outputLog("当前已在团队选择界面，跳过登录");
  }

  if (isClient) {
    outputLog(`点击团队: ${config.teamName}`);
    await browser.$(`//span[text()="${config.teamName}"]`).click();

    outputLog("等待进入主界面");
    while (true) {
      await sleep(5 * 1000);

      try {
        // 按标题切换到主窗口
        outputLog("按标题切换到主窗口")
        // 兼容有首页和默认只有分身页的情况
        await browser.switchWindow(' - 花漾灵动');
        outputLog("✓ 成功进入主界面");
        break;
      } catch (e) {
        outputLog(`按标题切换到主窗口失败：${e.message}`);
        let url = await screenshot(browser, 'app-screenshot.png');
        outputLog(`客户端截图${url}`);
      }
    }

    // 如果有弹出消息就点掉
    try {
      await browser.$('.ant-modal-confirm .ant-btn-primary').waitForExist({ timeout: 5 * 1000 });
      outputLog(`点掉弹出消息`);
      await browser.$(`.ant-modal-confirm .ant-btn-primary`).click();
    } catch (e) {
      outputLog("没有弹出消息需要关闭");
    }
  } else {
    // 按url切换窗口
    outputLog("按url切换窗口到插件页面")
    await browser.switchWindow('src/side-panel/index.html');
  }

  title = await browser.getTitle();
  outputLog(`===== 登录完成，当前窗口标题是${title} =====`);
};

module.exports = login;
