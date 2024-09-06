const { sleep } = require('./tools');

async function login(config, password, targetBrowser) {
  if (targetBrowser) {
    browser = targetBrowser;
  }
  
  while (true) {
    try {
      // 按标题切换到主窗口
      // 兼容有首页和默认只有分身页的情况
      await browser.switchWindow(' - 花漾灵动');
      break;
    } catch (e) {
    }
    await sleep(2 * 1000);
  }

  await browser.$('div[class*=app-version]').waitForExist({ timeout: 100 * 1000 })

  // 验证页面标题
  let title = await browser.getTitle();
  console.log("标题是", title);
  // expect(title).toBe('Your Electron App Title');

  const version = await browser.$('div[class*=app-version]').getText();
  console.log("版本号是：", version);

  // 检查当前是登录页面还是团队选择界面
  await browser.waitUntil(async () => {
    return await browser.$('//div[text()="邮箱登录"]').isExisting() ||
      await browser.$(`//span[text()="${config.teamName}"]`).isExisting();
  }, {
    timeout: 5000, // 最长等待时间，单位：毫秒
    interval: 500   // 检查间隔时间，单位：毫秒
  });

  // 等待10s确认服务器是否可用
  await sleep(10 * 1000);
  // 服务器不可用，等待服务器恢复
  while (await browser.$('//div[contains(concat(" ", normalize-space(@class), " "), " marquee-container ")]//span[contains(., "请检查您的网络是否通畅")]').isExisting()) {
    console.log("服务器不可用，等待服务器恢复")
    await sleep(60 * 1000);
  }

  // 当前是登录页面，开始登录
  if (await browser.$('//div[text()="邮箱登录"]').isExisting()) {
    await browser.$(`//div[text()="邮箱登录"]`).click();
    await browser.$('#account').setValue(config.username);
    await browser.$('#password').setValue(password);

    await browser.$('.ant-btn-primary').click();

    await browser.$(`//span[text()="${config.teamName}"]`).waitForExist({ timeout: 100 * 1000 })
  }
  await browser.$(`//span[text()="${config.teamName}"]`).click();

  while (true) {
    await sleep(5 * 1000);

    try {
      // 按标题切换到主窗口
      // 兼容有首页和默认只有分身页的情况
      await browser.switchWindow(' - 花漾灵动');
      break;
    } catch (e) {
    }
  }
  title = await browser.getTitle();
  console.log("标题是", title);
};

module.exports = login;
