const { remote } = require('webdriverio');

async function runTest() {
    const browser = await remote({
        capabilities: {
            browserName: 'chrome',
            browserVersion: '120.0.6099.109',
            'goog:chromeOptions': {
                debuggerAddress: 'localhost:9222',
            }
        }
    });

    // 新开标签页
    await browser.newWindow('https://baidu.com');

    // 获取所有打开的窗口句柄
    const windowHandles = await browser.getWindowHandles();

    // 切换到新打开的标签页
    await browser.switchToWindow(windowHandles[windowHandles.length - 1]);


    // 验证页面标题
    let title = await browser.getTitle();
    console.log("标题是", title);

    // 进行其他操作...

    await browser.deleteSession();
}

runTest().catch((err) => {
    console.error('测试失败:', err);
});
