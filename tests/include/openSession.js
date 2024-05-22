/**
 * 需要将main.js的
 * this.remoteDebugPort&&t.push
 * 替换成：
this.remoteDebugPort=9221;t.push
 */

const { remote } = require('webdriverio');
const { sleep } = require('./tools');

async function openSession() {
  let browser = null;
  while (true) {
    await sleep(3000);
    try {
      browser = await remote({
        capabilities: {
          browserName: 'chrome',
          browserVersion: '120',
          'goog:chromeOptions': {
            debuggerAddress: 'localhost:9221',
          }
        }
      });
    } catch (e) {
      console.log("分身浏览器连接失败，3秒后重试");
      continue;
    }
    break;
  }

  // while(true){
  await sleep(3000);
  // 验证页面标题
  let title = await browser.getTitle();
  console.log("分身标题是", title);
  // }

  // await browser.$('//a[text()="定制浏览器首页"]').waitForExist({ timeout: 10 * 1000 })

  // 验证页面标题
  title = await browser.getTitle();
  console.log("分身标题是", title);

  // 新开标签页
  await browser.newWindow('https://qq.com');

  await sleep(3000);

  // 获取所有打开的窗口句柄
  const windowHandles = await browser.getWindowHandles();

  for (let i = 0; i < windowHandles.length; i++) {
    // 切换到新打开的标签页
    await browser.switchToWindow(windowHandles[windowHandles.length - 1]);

    // 验证页面标题
    title = await browser.getTitle();
    console.log(i + "标题是", title);
    await sleep(3000);
  }


  // 进行其他操作...

  await browser.deleteSession();
}

module.exports = openSession;