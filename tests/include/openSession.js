/**
 * 需要将main.js的
 * this.remoteDebugPort&&t.push
 * 替换成：
 * this.remoteDebugPort=9221;t.push
 */

const http = require('node:http');
const https = require('node:https');
const process = require('node:process');
const puppeteer = require('puppeteer-core');
const { sleep, screenshot, outputLog } = require('./tools');

const DEFAULT_DEBUGGER_URL = process.env.SESSION_DEBUGGER_URL || 'http://127.0.0.1:9221';
const DEFAULT_IP_URL = 'https://ipapi.co/';

function getJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`调试端口返回了无效JSON: ${error.message}`));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`请求超时（${timeoutMs}ms）`));
    });
    request.on('error', reject);
  });
}

function getDebuggerInfo(debuggerUrl = DEFAULT_DEBUGGER_URL) {
  return getJson(new URL('/json/version', debuggerUrl).toString());
}

async function waitForDebugger({
  debuggerUrl = DEFAULT_DEBUGGER_URL,
  maxAttempts = 40,
  intervalMs = 3000,
  probe = getDebuggerInfo,
  sleep: wait = sleep,
  outputLog: log = outputLog,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await probe(debuggerUrl);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
      log(`调试端口尚未就绪，${intervalMs / 1000}秒后重试（${attempt}/${maxAttempts}）：${error.message}`);
      await wait(intervalMs);
    }
  }

  throw new Error(`等待浏览器调试端口超时：${lastError?.message || '未知错误'}`);
}

function createOpenSession({
  connect = (options) => puppeteer.connect(options),
  waitForDebugger: waitUntilReady = waitForDebugger,
  sleep: wait = sleep,
  screenshot: takeScreenshot = screenshot,
  outputLog: log = outputLog,
  debuggerUrl = DEFAULT_DEBUGGER_URL,
  ipUrl = DEFAULT_IP_URL,
} = {}) {
  return async function openSession() {
    log(`等待浏览器调试端口就绪：${debuggerUrl}`);
    const debuggerInfo = await waitUntilReady({
      debuggerUrl,
      sleep: wait,
      outputLog: log,
    });
    log(`浏览器内核版本为${debuggerInfo.Browser || '未知'}`);

    let browser;
    try {
      browser = await connect({
        browserURL: debuggerUrl,
        defaultViewport: null,
        protocolTimeout: 60 * 1000,
      });

      const pages = await browser.pages();
      if (pages.length > 0) {
        log(`当前窗口标题是${await pages[0].title()}`);
      }
      log('分身浏览器连接成功');

      log(`开始访问${ipUrl}`);
      const page = await browser.newPage();
      await page.goto(ipUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60 * 1000,
      });
      await page.bringToFront();

      const size = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      log(`浏览器窗口宽度：${size.width}`);
      log(`浏览器窗口高度：${size.height}`);

      log(`分身标题是${await page.title()}`);
      await page.waitForSelector('#jumbo-ip', { timeout: 60 * 1000 });
      await page.waitForFunction(
        () => Boolean(document.querySelector('#jumbo-ip')?.getAttribute('data-ip')),
        { timeout: 60 * 1000 },
      );

      const ipText = await page.$eval('#jumbo-ip', (element) => element.getAttribute('data-ip'));
      log(`ipText=${ipText}`);
      await page.$eval('#ip-qv', (element) => element.click());
      await wait(3 * 1000);

      log('对分身浏览器截图');
      const screenshotTarget = {
        saveScreenshot: (filePath) => page.screenshot({ path: filePath }),
      };
      const sessionScreenshotUrl = await takeScreenshot(screenshotTarget, 'session-screenshot.png');

      return { ipText, sessionScreenshotUrl };
    } finally {
      if (browser) {
        try {
          await browser.disconnect();
        } catch (error) {
          log(`断开调试连接失败：${error.message}`);
        }
      }
    }
  };
}

const openSession = createOpenSession();

module.exports = openSession;
module.exports.createOpenSession = createOpenSession;
module.exports.getDebuggerInfo = getDebuggerInfo;
module.exports.waitForDebugger = waitForDebugger;
