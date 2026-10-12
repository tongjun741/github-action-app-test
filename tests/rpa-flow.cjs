/**
 * rpa-flow.cjs —— RPA 流程执行用例（源表 R21，脚本化 2026-10-12）
 *
 * 用户指定：流程「百度检索-教程示例」，参数 关键词=ios，结果匹配 Apple。
 *
 * 执行路径（主壳 WebdriverIO 驱动客户端 UI）：
 *   1) 登录客户端 → 主界面左侧「自动化」菜单
 *   2) 找到流程「百度检索-教程示例」→ 点执行/运行
 *   3) 弹出参数表单 → 填 关键词=ios → 确认执行
 *   4) 轮询分身浏览器 CDP 9221：新页面出现 baidu.com 且内容含 Apple（最长 matchTimeoutMs）
 *      （RPA 会打开/复用分身浏览器执行百度检索）
 *   5) 判定：pass=页面出现匹配内容；fail=超时未见
 *
 * 环境变量：CLIENT_BINARY/E2E_PLATFORM/TEAM_NAME/WDIO_USERNAME/PRODUCT_WDIO_PASSWORD/
 *           CLONE_NAME/REMOTE_DEBUG_PORT/OUT/CLOUDINARY_URL
 * 输出：results-RPA_Flow.json
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const http = require('node:http');
const { remote } = require('webdriverio');
const login = require('./include/login');
const { productConfig } = require('./config');

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const SLUG = PLATFORM.replace(/\s+/g, '_');
const CLONE = process.env.CLONE_NAME || 'UA152';
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || 'results-RPA_Flow.json';
const FLOW_NAME = process.env.RPA_FLOW_NAME || '百度检索-教程示例';
const RPA_KEYWORD = process.env.RPA_KEYWORD || 'ios';
const MATCH = process.env.RPA_MATCH || 'Apple';
const TIMEOUT_MS = Number(process.env.RPA_TIMEOUT_MS || 120000);

const log = (...a) => console.log('[rpa-flow]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadShot(browser, tag) {
  try {
    const p = path.join(process.cwd(), `rpa-${tag}-${Date.now()}.png`);
    await browser.saveScreenshot(p);
    if (!process.env.CLOUDINARY_URL) return p;
    const mod = require('cloudinary');
    const cloudinary = (mod.default && mod.default.v2) || mod.v2 || mod.default;
    cloudinary.config({ secure: true });
    const now = new Date();
    const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const r = await cloudinary.uploader.upload(p, { asset_folder: `e2eTest_${mm}`, resource_type: 'raw' });
    console.log(`::notice title=RPA截图-${tag}::${Buffer.from(r.url).toString('base64')}`);
    return r.url;
  } catch (e) { log(`截图失败(${tag}): ${e.message.slice(0, 60)}`); return ''; }
}

async function main() {
  const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [] };
  const push = (status, detail) => {
    out.results.push({ id: 'rpa_flow', name: '执行RPA流程', type: 'client_rpa_flow', platform: PLATFORM, status, detail, ts: new Date().toISOString() });
    console.log(`  [${status === 'pass' ? '✓' : '✗'}] 执行RPA流程 — ${detail.slice(0, 120)}`);
  };

  const config = {
    ...productConfig,
    teamName: process.env.TEAM_NAME || productConfig.teamName,
    username: process.env.WDIO_USERNAME || productConfig.username,
  };
  const password = process.env.PRODUCT_WDIO_PASSWORD || 'password';
  const caps = {
    browserName: 'chrome', browserVersion: '108',
    'goog:chromeOptions': { binary: process.env.CLIENT_BINARY || undefined },
    'wdio:chromedriverOptions': { binary: (function () {
      const os = require('node:os');
      const base = path.resolve(__dirname, '..', 'tools', 'chromedriver', '108.0.5359.71');
      if (os.platform() === 'darwin') return path.join(base, os.arch() === 'arm64' ? 'mac-arm64' : 'mac-x64', 'chromedriver');
      if (os.platform() === 'linux') return path.join(base, 'linux64', 'chromedriver');
      return path.join(base, 'win32', 'chromedriver.exe');
    })() },
  };
  if (process.env.CHROMEDRIVER_BIN) caps['wdio:chromedriverOptions'].binary = process.env.CHROMEDRIVER_BIN;

  const browser = await remote({ capabilities: caps, logLevel: 'warn' });
  log('客户端已启动');
  try {
    await login(config, password, browser);
    log('登录完成');

    // 1) 左侧「自动化」菜单
    await browser.$('.icon-shouye_24').waitForExist({ timeout: 60000 });
    await browser.$('.icon-shouye_24').click();
    // 自动化菜单（图标 class 参考「支持」按钮旁的菜单结构；兜底 XPath 文本）
    let menuOk = false;
    for (const sel of ['=.自动化', '//span[text()="自动化"]', '//li[contains(.,"自动化")]']) {
      try {
        const el = browser.$(sel);
        await el.waitForExist({ timeout: 4000 });
        await el.click();
        menuOk = true; break;
      } catch (_) {}
    }
    if (!menuOk) throw new Error('未找到「自动化」菜单入口');
    await sleep(3000);
    log('已进入自动化页面');

    // 2) 找流程卡片/行「百度检索-教程示例」并点「执行/运行」
    let execOk = false;
    for (const sel of [
      `//div[contains(.,"${FLOW_NAME}")][1]//span[text()="执行"]`,
      `//div[contains(.,"${FLOW_NAME}")][1]//button[contains(.,"执行")]`,
      `//tr[contains(.,"${FLOW_NAME}")]//span[text()="执行"]`,
      `//div[contains(.,"${FLOW_NAME}")][1]//span[contains(text(),"运行")]`,
    ]) {
      try {
        const el = browser.$(sel);
        await el.waitForExist({ timeout: 4000 });
        await el.click();
        execOk = true; log(`已点击执行（${sel.slice(0, 50)}…）`); break;
      } catch (_) {}
    }
    if (!execOk) throw new Error(`自动化页面未找到流程「${FLOW_NAME}」的执行入口`);

    // 3) 参数表单：关键词=ios
    await sleep(3000);
    let paramOk = false;
    for (const sel of ['//input[@placeholder="关键词"]', '//label[contains(.,"关键词")]//following-sibling::div//input', '//input[contains(@placeholder,"关键词")]']) {
      try {
        const inp = browser.$(sel);
        await inp.waitForExist({ timeout: 4000 });
        await inp.setValue(RPA_KEYWORD);
        paramOk = true; log(`已填参数 关键词=${RPA_KEYWORD}`); break;
      } catch (_) {}
    }
    if (paramOk) {
      for (const sel of ['.ant-modal-confirm .ant-btn-primary', '//button[text()="确定"]', '//span[text()="确定"]/ancestor::button']) {
        try { const b = browser.$(sel); await b.waitForExist({ timeout: 3000 }); await b.click(); log('已确认执行'); break; } catch (_) {}
      }
    } else {
      log('未找到参数表单（流程可能无参数直接执行或结构不同）——截图取证');
      await uploadShot(browser, 'param-miss');
    }

    // 4) 轮询分身浏览器 CDP：出现 baidu.com 页面且内容含 Apple
    log(`轮询 CDP ${CDP} 等待 RPA 结果（最长 ${TIMEOUT_MS / 1000}s）`);
    const puppeteer = require('puppeteer-core');
    const deadline = Date.now() + TIMEOUT_MS;
    let matched = null;
    while (Date.now() < deadline) {
      let b = null;
      try {
        b = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 15000 });
        const pages = await b.pages();
        for (const p of pages) {
          try {
            const url = p.url();
            if (!/baidu\.com|bing\.com|google/i.test(url)) continue;
            const text = await p.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 8000)).catch(() => '');
            if (text.includes(MATCH)) { matched = url; break; }
          } catch (_) {}
        }
        await b.disconnect();
      } catch (_) { if (b) try { await b.disconnect(); } catch (_) {} }
      if (matched) break;
      await sleep(5000);
    }

    await uploadShot(browser, 'final');
    if (matched) {
      push('pass', `RPA「${FLOW_NAME}」(关键词=${RPA_KEYWORD}) 执行完成，页面命中「${MATCH}」（${matched.slice(0, 60)}）`);
    } else {
      push('fail', `RPA 执行后 ${TIMEOUT_MS / 1000}s 内未见含「${MATCH}」的检索结果页`);
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    log(`已写出 ${OUT}`);
    process.exit(0);
  } finally {
    try { await browser.deleteSession(); } catch (_) {}
  }
}

main().catch((e) => {
  console.error('[rpa-flow] 失败:', e && (e.stack || e.message));
  const out = { platform: PLATFORM, ts: new Date().toISOString(), error: String(e && e.message), results: [
    { id: 'rpa_flow', name: '执行RPA流程', type: 'client_rpa_flow', platform: PLATFORM, status: 'error', detail: String(e && e.message), ts: new Date().toISOString() },
  ] };
  try { fs.writeFileSync(process.env.OUT || 'results-RPA_Flow.json', JSON.stringify(out, null, 2)); } catch (_) {}
  process.exit(1);
});
