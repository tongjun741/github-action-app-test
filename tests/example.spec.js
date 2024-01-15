const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {

    await $('div[class*=app-version]').waitForExist({ timeout: 10 * 1000 })

    // 验证页面标题
    let title = await browser.getTitle();
    console.log("标题是", title);
    // expect(title).toBe('Your Electron App Title');

    const version = await $('div[class*=app-version]').getText();
    console.log("版本号是：", version);

    // expect(version).toBe('Clicked');
    await $('//span[text()="童1227"]').click();

    await sleep(3000);
    let windowIDs = await browser.getWindowHandles();
    console.log(windowIDs);
    browser.switchToWindow(windowIDs[0])
    await sleep(3000);
    let mainWindowID = await browser.getWindowHandle();
    console.log(mainWindowID);

    await $('//a[text()="抖音_TJ"]').waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);

    await $('//a[text()="抖音_TJ"]').click();
    await $('//span[text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 })
    await $('//span[text()="打开浏览器"]').click();

    while (true) {
      await sleep(3000);
      windowIDs = await browser.getWindowHandles();
      console.log(windowIDs);
      let newWindow = windowIDs.find(o => o !== mainWindowID)
      if (windowIDs.length>1) {
        for(let i=0;i<windowIDs.length;i++){
          browser.switchToWindow(newWindow);
          await sleep(3000);
          title = await browser.getTitle();
          console.log("标题是", title);
        }
        // break;
      }
    }
    title = await browser.getTitle();
    console.log("标题是", title);

    await $('//a[text()="定制浏览器首页"]').waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);

    await browser.newWindow('https://webdriver.io', {
      windowName: 'WebdriverIO window',
      windowFeature: 'width=420,height=230,resizable,scrollbars=yes,status=1',
    });
    
    console.log(await browser.getTitle()) // outputs: "WebdriverIO · Next-gen browser and mobile automation test framework for Node.js"


  });
});
