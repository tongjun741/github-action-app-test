const { sleep } = require('./tools');

async function login(config, password, targetBrowser) {
  if (targetBrowser) {
    browser = targetBrowser;
  }

  await browser.$('div[class*=app-version]').waitForExist({ timeout: 100 * 1000 })

  // 验证页面标题
  let title = await browser.getTitle();
  console.log("标题是", title);
  // expect(title).toBe('Your Electron App Title');

  const version = await browser.$('div[class*=app-version]').getText();
  console.log("版本号是：", version);

  await browser.waitUntil(async () => {
    return await browser.$('//div[text()="邮箱登录"]').isExisting() ||
      await browser.$(`//span[text()="${config.teamName}"]`).isExisting();
  }, {
    timeout: 5000, // 最长等待时间，单位：毫秒
    interval: 500   // 检查间隔时间，单位：毫秒
  });

  if (await browser.$('//div[text()="邮箱登录"]').isExisting()) {
    await browser.$(`//div[text()="邮箱登录"]`).click();
    await browser.$('#account').setValue(config.username);
    await browser.$('#password').setValue(password);

    await browser.$('.ant-btn-primary').click();

    await browser.$(`//span[text()="${config.teamName}"]`).waitForExist({ timeout: 100 * 1000 })
  }
  await browser.$(`//span[text()="${config.teamName}"]`).click();

  await sleep(3000);
  let windowIDs = await browser.getWindowHandles();
  console.log(windowIDs);
  browser.switchToWindow(windowIDs[0])
  await sleep(3000);
  let mainWindowID = await browser.getWindowHandle();
  console.log(mainWindowID);

  title = await browser.getTitle();
  console.log("标题是", title);

};

module.exports = login;
