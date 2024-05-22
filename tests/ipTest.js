const login = require('./include/login');

describe('Electron App Test', () => {
  it('should open Electron app and perform actions', async () => {

    await login();

    // 进入IP列表页面
    await $(`.icon-IP_24`).waitForExist({ timeout: 10 * 1000 })
    await $(`.icon-IP_24`).click();

    await $(`//div[text()="质量测试"]`).waitForExist({ timeout: 10 * 1000 })
    title = await browser.getTitle();
    console.log("标题是", title);

    while (true) {
      // 全选
      await $(`.ant-table-thead  .ant-checkbox-input`).click();
      // 开始测试
      await $(`//div[text()="质量测试"]`).click();
      // 等待测试完成，1小时超时
      await $(`//button[not(self::node()[contains(concat(" ",normalize-space(@class)," "),"ant-btn-loading")])]//div[text()="质量测试"]`).waitForExist({ timeout: 60 * 60 * 1000 })

      if (await $('.icon-angle-right_24:not(.disabled)').isExisting()) {
        // 有下一页，进入下一页
        await $('.icon-angle-right_24:not(.disabled)').click();
      }else{
        // 没有下一页，退出
        break;
      }
    }

  });
});
