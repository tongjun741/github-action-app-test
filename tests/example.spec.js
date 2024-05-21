/**
 * 需要将main.js的
 * this.remoteDebugPort&&t.push
 * 替换成：
this.remoteDebugPort=9221;t.push
 */

const { remote } = require('webdriverio');
const config = require('./config');

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function sessionTest() {
  await sleep(3000);
  const browser = await remote({
    capabilities: {
      browserName: 'chrome',
      browserVersion: '120',
      'goog:chromeOptions': {
        debuggerAddress: 'localhost:9221',
      }
    }
  });

  // while(true){
  await sleep(3000);
  // 验证页面标题
  let title = await browser.getTitle();
  console.log("分身标题是", title);
  // }

  // await browser.$('//a[text()="定制浏览器首页"]').waitForExist({ timeout: 10 * 1000 })

  // 验证页面标题
  title = await browser.getTitle();
  console.log("分身标题是", title);

  // 新开标签页
  await browser.newWindow('https://qq.com');

  await sleep(3000);

  // 获取所有打开的窗口句柄
  const windowHandles = await browser.getWindowHandles();

  for (let i =0;i <windowHandles.length;i++){
    // 切换到新打开的标签页
    await browser.switchToWindow(windowHandles[windowHandles.length - 1]);
    
    // 验证页面标题
    title = await browser.getTitle();
    console.log(i+"标题是", title);
    await sleep(3000);
  }


  // 进行其他操作...

  await browser.deleteSession();
}

describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {

    await $('div[class*=app-version]').waitForExist({ timeout: 100 * 1000 })

    // 验证页面标题
    let title = await browser.getTitle();
    console.log("标题是", title);
    // expect(title).toBe('Your Electron App Title');

    const version = await $('div[class*=app-version]').getText();
    console.log("版本号是：", version);

    await browser.waitUntil(async () => {
      return await $('//div[text()="邮箱登录"]').isExisting() ||
        await $(`//span[text()="${config.teamName}"]`).isExisting();
    }, {
      timeout: 5000, // 最长等待时间，单位：毫秒
      interval: 500   // 检查间隔时间，单位：毫秒
    });

    if (await $('//div[text()="邮箱登录"]').isExisting()) {
      await $(`//div[text()="邮箱登录"]`).click();
      await $('#account').setValue(config.username);
      await $('#password').setValue(config.password);

      await $('.ant-btn-primary').click();

      await $(`//span[text()="${config.teamName}"]`).waitForExist({ timeout: 100 * 1000 })
    }
    await $(`//span[text()="${config.teamName}"]`).click();

    await sleep(3000);
    let windowIDs = await browser.getWindowHandles();
    console.log(windowIDs);
    browser.switchToWindow(windowIDs[0])
    await sleep(3000);
    let mainWindowID = await browser.getWindowHandle();
    console.log(mainWindowID);

    await $(`.icon-chrome_outline`).waitForExist({ timeout: 10 * 1000 })
    await $(`.icon-chrome_outline`).click();

    await $(`//a[text()="${config.shopName}"]`).waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);

    await $(`//a[text()="${config.shopName}"]`).click();
    await $('//span[text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 });
    await $('//span[text()="打开浏览器"]').click();

    await $('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 120 * 1000 });

    await sessionTest();

  });
});
