describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async  () => {

      await $('div[class*=app-version]').waitForExist({ timeout: 10*1000 })

      
      // 验证页面标题
      const title = await browser.getTitle();
      console.log("标题是", title);
      // expect(title).toBe('Your Electron App Title');

      const version = await $('div[class*=app-version]').getText();
      console.log("版本号是：", version);

      // expect(version).toBe('Clicked');
  });
});
