const { productConfig } = require('./config');
const login = require('./include/login');
const openSession = require('./include/openSession');
const { feishuNotify } = require('./include/tools');

describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {
    let startTime = new Date().getTime();

    await login(productConfig, process.env.PRODUCT_WDIO_PASSWORD);

    // 进入分身列表页面
    await $(`.icon-chrome_outline`).waitForExist({ timeout: 10 * 1000 })
    await $(`.icon-chrome_outline`).click();

    await $(`//a[text()="${productConfig.shopName}"]`).waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);

    // 进入分身详情页面
    await $(`//a[text()="${productConfig.shopName}"]`).click();
    // 打开浏览器
    await $('//span[text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 });
    await $('//span[text()="打开浏览器"]').click();

    await $('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 120 * 1000 });

    let ipText = await openSession();
    let msg;
    let timeUse = (new Date().getTime() - startTime) / (60 * 1000);
    if (ipText) {
      msg = `打开会话测试完成！耗时${timeUse.toFixed(2)}分钟，当前IP地址是：${ipText}`;
    } else {
      msg = `打开会话测试失败！耗时${timeUse.toFixed(2)}分钟`;
    }
    console.log(msg);
    await feishuNotify(msg);
  });
});
