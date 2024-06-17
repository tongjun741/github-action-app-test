/**
 * 需要将main.js的
 * this.remoteDebugPort&&t.push
 * 替换成：
this.remoteDebugPort=9221;t.push

TODO
关闭窗口后会话不结束
 */

const os = require('os');
const { remote } = require('webdriverio');
const { sleep, screenshot } = require('./tools');

let browserVersion = '120';
if (process.env.IN_DEV === "true") {
  // 测试环境的浏览器内核是125.0.6422.150，但没有这个版本的chromedriver，所以换个相近版本的
  browserVersion = '125.0.6422.60';
}
console.log(`浏览器内核版本为${browserVersion}`);

async function openSession() {
  let browser = null;
  while (true) {
    await sleep(10 * 1000);
    try {
      let chromeOptions = {};
      if (os.platform() === 'win32' && os.release().startsWith('6.1')) {
        // 下载地址：https://chromedriver.storage.googleapis.com/109.0.5414.74/chromedriver_win32.zip
        chromeOptions.binary = 'C:\\Users\\Docker\\AppData\\Local\\Temp\\chromedriver\\win64-109\\chromedriver-win64\\chromedriver.exe';
        browserVersion = '109';
        console.log(`当前操作系统是 Windows 7，浏览器内核版本为109，需要手工指定browserVersion为${browserVersion}，chromedriver的路径：${chromeOptions.binary}`);
      }

      browser = await remote({
        capabilities: {
          browserName: 'chrome',
          browserVersion, // 值是字符串，不能是数字
          'goog:chromeOptions': {
            debuggerAddress: 'localhost:9221',
            ...chromeOptions,
            // args: ['--window-size=1440,1280']
          }
        },
        logLevel: 'warn'
      });
      await sleep(3 * 1000);
      let title = await browser.getTitle();
      console.log("当前窗口标题是", title);
      console.log("分身浏览器连接成功");
    } catch (e) {
      console.log(e)
      console.log("分身浏览器连接失败，3秒后重试");
      continue;
    }
    break;
  }

  await sleep(10 * 1000);
  // 验证页面标题
  let title = await browser.getTitle();
  console.log("当前窗口标题是", title);

  // const windowSize = await browser.getWindowSize();
  // console.log("当前窗口大小是", windowSize);

  // // 设置浏览器窗口大小
  // await browser.setWindowSize(1600, 1200);

  // const windowSize2 = await browser.getWindowSize();
  // console.log("当前窗口大小2是", windowSize2);

  // 浏览器检测页面
  // await browser.switchWindow('szdamai.local');
  // let t = await browser.$('.ant-pro-card-title').getText();
  // console.log(t);
  // await browser.$('//a[text()="定制浏览器首页"]').waitForExist({ timeout: 10 * 1000 });

  // 新开标签页，109中只能用url不能用newWindow
  await browser.url('https://ip.sb');
  await sleep(10 * 1000);
  await browser.switchWindow('ip.sb');
  // 执行 JavaScript 脚本以获取浏览器窗口大小并在主进程中输出
  await browser.execute(function() {
      // 使用JavaScript获取浏览器窗口的宽度和高度
      var windowWidth = window.innerWidth;
      var windowHeight = window.innerHeight;
      // 将窗口大小信息返回给WebdriverIO主进程
      return { width: windowWidth, height: windowHeight };
  }).then(function(size) {
      // 在主进程中输出窗口大小信息
      console.log("浏览器窗口宽度：" + size.width);
      console.log("浏览器窗口高度：" + size.height);
  });
  await sleep(3000);

  // 验证页面标题
  title = await browser.getTitle();
  console.log("分身标题是", title);
  await browser.$('.proto_address a').waitForExist({ timeout: 60 * 1000 });
  let ipText = await browser.$('.proto_address a').getText();
  console.log(ipText);

  // 对分身浏览器截图
  let sessionScreenshotUrl = await screenshot(browser, 'session-screenshot.png');

  return { ipText, sessionScreenshotUrl };
}

module.exports = openSession;
