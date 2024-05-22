const { productConfig } = require('./config');
const login = require('./include/login');
const openSession = require('./include/openSession');

describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {

    await login(productConfig, process.env.PRODUCT_WDIO_PASSWORD);

    // 进入分身列表页面
    await $(`.icon-chrome_outline`).waitForExist({ timeout: 10 * 1000 })
    await $(`.icon-chrome_outline`).click();

    await $(`//a[text()="${config.shopName}"]`).waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);

    // 进入分身详情页面
    await $(`//a[text()="${config.shopName}"]`).click();
    // 打开浏览器
    await $('//span[text()="打开浏览器"]').waitForExist({ timeout: 10 * 1000 });
    await $('//span[text()="打开浏览器"]').click();

    await $('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 120 * 1000 });

    await openSession();

  });
});
