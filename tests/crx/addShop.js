const { feishuNotify, sleep, outputLog, dateFormat } = require('../include/tools');

async function addShop(targetBrowser, teamName) {
    if (targetBrowser) {
        browser = targetBrowser;
    }

    let isDev = process.env.IN_DEV === "true";
    let domain = isDev ? "dev.thinkoncloud.cn" : "tkshop.szdamai.com";
    let apiDomain = isDev ? "dev.thinkoncloud.cn" : "api.szdamai.com";
    let adminDomain = isDev ? "admin.thinkoncloud.cn" : "admin.szdamai.com";
    

    // TODO 设置IP和cookie
    // https://ipinfo.io/ip
    
    // 按url切换窗口
    outputLog("按url切换窗口到插件页面");
    await browser.switchWindow('src/side-panel/index.html');
    await browser.$(`.ant-select-selection-item`).waitForExist();
    await sleep(1000);
    await browser.$(`//div[text()="${teamName}"]`).click();
    await sleep(1000);
    await browser.$(`//span[text()="立即添加"]`).click();

    
    await browser.$(`//div[text()="自动化流程"]`).waitForExist({ timeout: 30 * 1000 });
    await browser.$(`//div[text()="自动化流程"]`).click();
    await sleep(1000);
    // 执行店铺信息同步
    await browser.$(`//div[contains(@class, 'full-row')]//span[text()='立即执行']`).click();
    await sleep(5000);
    // 切换到最新的tab
    const handles = await browser.getWindowHandles();
    await browser.switchToWindow(handles[handles.length - 1]);
    await browser.$(`//div[contains(@class, 'ant-modal-title')]//div[text()='店铺信息同步']`).waitForExist({ timeout: 30 * 1000 });
    await browser.$(`//div[contains(@class, 'ant-modal-footer')]//span[text()='确 定']`).click();
    await sleep(3000);
    await browser.$(`//div[contains(@class, 'ant-modal-confirm-btns')]//span[text()='确 定']`).click();
};

module.exports = addShop;
