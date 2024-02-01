describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {

    await $('div[class*=app-version]').waitForExist({ timeout: 100 * 1000 })

    // 验证页面标题
    let title = await browser.getTitle();
    console.log("标题是", title);

    const version = await $('div[class*=app-version]').getText();
    console.log("版本号是：", version);

  });
});
