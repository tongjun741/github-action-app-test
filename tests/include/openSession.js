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
const { sleep, screenshot, outputLog } = require('./tools');

// 当前浏览器内核是128.0.6613.45，但没有这个版本的chromedriver，所以换个相近版本的
let browserVersion = '128.0.6613.137';
if (process.env.IN_DEV === "true") {
  // 如果测试环境上了新内核可以改这个地方
  browserVersion = '128.0.6613.137';
}
outputLog(`浏览器内核版本为${browserVersion}`);

async function openSession() {
  let browser = null;
  let retry = 0;
  // 等待30秒让浏览器内核解压完成
  outputLog("等待30秒让浏览器内核解压完成");
  await sleep(30 * 1000);
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
      outputLog(`当前窗口标题是${title}`);
      if (browserVersion === "109") {
        outputLog(`开始访问https://ipapi.co/`);
        await browser.url('https://ipapi.co/');
        await sleep(10 * 1000);
        outputLog(`切换到ipapi.co`);
        await browser.switchWindow('ipapi.co');
        title = await browser.getTitle();
        outputLog(`当前窗口标题是${title}`);
        if (!title) {
          throw new Error("窗口标题为空");
        }
      }
      outputLog("分身浏览器连接成功");
    } catch (e) {
      console.log(e)
      outputLog("分身浏览器连接失败，3秒后重试");
      retry++;
      if (retry > 10) {
        throw new Error('分身浏览器连接失败');
      }
      continue;
    }
    break;
  }

  await sleep(10 * 1000);
  // 验证页面标题
  let title = await browser.getTitle();
  outputLog(`当前窗口标题是${title}`);

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
  outputLog(`开始访问https://ipapi.co/`);
  await browser.newWindow('https://ipapi.co/');
  await sleep(10 * 1000);
  await browser.switchWindow('ipapi.co');
  // 执行 JavaScript 脚本以获取浏览器窗口大小并在主进程中输出
  await browser.execute(function () {
    // 使用JavaScript获取浏览器窗口的宽度和高度
    var windowWidth = window.innerWidth;
    var windowHeight = window.innerHeight;
    // 将窗口大小信息返回给WebdriverIO主进程
    return { width: windowWidth, height: windowHeight };
  }).then(function (size) {
    // 在主进程中输出窗口大小信息
    console.log("浏览器窗口宽度：" + size.width);
    console.log("浏览器窗口高度：" + size.height);
  });
  await sleep(3000);

  // 验证页面标题
  title = await browser.getTitle();
  outputLog(`分身标题是${title}`);
  await browser.$('#jumbo-ip').waitForExist({ timeout: 60 * 1000 });
  let ipText = await browser.$('#jumbo-ip').getAttribute('data-ip');
  console.log(ipText);
  outputLog(`ipText=${ipText}`);

  // 对分身浏览器截图
  outputLog(`对分身浏览器截图`);
  let sessionScreenshotUrl = await screenshot(browser, 'session-screenshot.png');

  return { ipText, sessionScreenshotUrl };
}

module.exports = openSession;
