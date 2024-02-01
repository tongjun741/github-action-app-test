const { remote } = require('webdriverio');

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function sessionTest() {
  await sleep(3000);
  const browser = await remote({
    capabilities: {
      browserName: 'chrome',
      browserVersion: '120.0.6099.109',
      'goog:chromeOptions': {
        debuggerAddress: 'localhost:9221',
      }
    }
  });

  await sleep(3000);
  // 验证页面标题
  let title = await browser.getTitle();
  console.log("标题是", title);

  await browser.$('//a[text()="定制浏览器首页"]').waitForExist({ timeout: 10 * 1000 })

  // 验证页面标题
  title = await browser.getTitle();
  console.log("标题是", title);

  // 新开标签页
  await browser.newWindow('https://qq.com');

  await sleep(3000);

  // 获取所有打开的窗口句柄
  const windowHandles = await browser.getWindowHandles();

  // 切换到新打开的标签页
  await browser.switchToWindow(windowHandles[windowHandles.length - 1]);

  // 验证页面标题
  title = await browser.getTitle();
  console.log("标题是", title);

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

    // expect(version).toBe('Clicked');
    // await $('//span[text()="童1227"]').click();

    // await sleep(3000);
    // let windowIDs = await browser.getWindowHandles();
    // console.log(windowIDs);
    // browser.switchToWindow(windowIDs[0])
    // await sleep(3000);
    // let mainWindowID = await browser.getWindowHandle();
    // console.log(mainWindowID);

    // await $('//a[text()="抖音_TJ"]').waitForExist({ timeout: 10 * 1000 })
    // title = await browser.getTitle();
    // console.log("标题是", title);

    // await $('//a[text()="抖音_TJ"]').click();
    // await $('//span[text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 });
    // await $('//span[text()="打开浏览器"]').click();

    // //
    // await $('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 120 * 1000 });

    // await sessionTest();

  });
});
