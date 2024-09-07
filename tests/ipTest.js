const login = require('./include/login');
const { ipTestConfig } = require('./config');
const { sleep } = require('./include/tools');

async function ipTest(browser) {
  let errorMsg = "";
  console.log(`当前任务是IP测试`);
  await login(ipTestConfig, process.env.PRODUCT_IP_TEST_PASSWORD, browser);
    
  // 设置浏览器窗口大小
  await browser.execute(() => {
    window.resizeTo(1280, 800);
  });

  // 进入IP列表页面
  await browser.$(`.icon-IP_24`).waitForExist({ timeout: 10 * 1000 })
  await browser.$(`.icon-IP_24`).click();

  await browser.$(`//span[text()="批量续费"]`).waitForExist({ timeout: 10 * 1000 })
  title = await browser.getTitle();
  console.log("标题是", title);
  while (true) {
    // 等待全选按钮出现
    await browser.$(`.ant-table-thead  .ant-checkbox-input`).waitForExist({ timeout: 600 * 1000 });
    // 等待当前页码出现
    await browser.$(`span.current-page`).waitForExist({ timeout: 600 * 1000 });
    // 等待Loading消失
    const spin = await browser.$('.ant-spin-spinning');
    if (await spin.isExisting()) {
      await spin.waitUntil(async function () {
        return !await this.isExisting()
      }, {
        timeout: 60 * 1000,
      })
    }

    currentPage = await browser.$(`span.current-page`).getText();
    console.log(`${new Date().toLocaleString()}, 当前页码：${currentPage}`);

    // 全选
    await browser.$(`.ant-table-thead  .ant-checkbox-input`).click();
    console.log('开始测试');

    // 展开菜单
    await browser.$(`.dm-table-footer div.icon-gengduo_24`).waitForExist({ timeout: 10 * 1000 })
    await browser.$(`.dm-table-footer div.icon-gengduo_24`).click();
    await sleep(5 * 1000);

    // 等待质量测试按钮可用
    await browser.$(`//*[contains(concat(" ",normalize-space(@class)," ")," ant-dropdown-placement-topCenter ")]//span[text()="质量测试"]`).waitForExist({ timeout: 60 * 60 * 1000 });
    totalCount = await browser.$(`.pagination > div >span`).getText();
    console.log(`总共有${totalCount}个IP`);
    await browser.$(`//*[contains(concat(" ",normalize-space(@class)," ")," ant-dropdown-placement-topCenter ")]//span[text()="质量测试"]`).click();
    console.log('等待测试完成，1小时超时');
    await browser.$(`.dm-table-footer div.icon-gengduo_24`).moveTo();
    await browser.$(`.dm-table-footer div.icon-gengduo_24`).waitUntil(async function () {
      return !(await browser.$(`.ant-dropdown-placement-topCenter .ant-btn-loading-icon`).isExisting())
    }, {
      timeout: 60 * 60 * 1000,
      timeoutMsg: '质量测试1小时都没有结束'
    });
    console.log('本页质量测试完成');
    await sleep(5 * 1000);

    if (await browser.$('.icon-angle-right_24:not(.disabled)').isExisting()) {
      console.log('有下一页，进入下一页');
      await browser.$('.icon-angle-right_24:not(.disabled)').click();
    } else {
      console.log('没有下一页，退出');
      break;
    }
  }

  try {
    if (await browser.$('div[class*=ai-chat-popup] div[class*=close]').isExisting()) {
      console.log('关闭AI弹窗');
      await browser.$('div[class*=ai-chat-popup] div[class*=close]').click();
      await sleep(5 * 1000);
    }

    // 失效的IP
    console.log('查看失效的IP');
    await browser.$(`//span[text()="已失效的IP"]`).click();
    while (true) {
      await sleep(5 * 1000);
      if (await browser.$('.pagination > div >span').isExisting()) {
        unavailable = await browser.$(`.pagination > div >span`).getText();
        break;
      }
      if (await browser.$('//div[text()="暂无数据"]').isExisting()) {
        unavailable = "暂无数据";
        break;
      }
    }
  } catch (e) {
    errorMsg += e.message + '\n';
    console.error(e);
  }

  let msg = `IP测试完成！\n最后一页是：${currentPage}\n总记录数：${totalCount}\n已失效的IP：${unavailable}\n\n${errorMsg}`;

  return msg;
}

module.exports = {
  ipTest
};
