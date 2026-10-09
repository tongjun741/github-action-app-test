/**
 * e2e-verify.cjs —— 真·验证「分身内核浏览器」的 UA / 指纹（不是客户端主壳）
 *
 * 背景（为什么不能直接连 9221）：
 *   命令行给客户端加 `--remote-debugging-port=9221` 会让「客户端主壳（Electron/108）」抢占 9221，
 *   于是连上的是主壳（UA 带 HuaYoung/... Electron/22），既没有 152 内核、也不支持 newPage。
 *   正确姿势（origin macOS.yml / Windows10.yml / Windows7-docker.yml 一致）：
 *     1) node modifyMain.js —— 把主壳 main.js 里的 `this.remoteDebugPort` 置为 9221，
 *        该值会在**打开分身**时作为 `--remote-debugging-port=9221` 传给「分身内核浏览器」；
 *     2) 用 WDIO(chromedriver 108) 启动主壳做 UI 驱动：登录 → 分身列表 → 打开浏览器 → 等「正在访问」；
 *     3) 分身内核浏览器此时监听 127.0.0.1:9221（origin 实测内核 = Chrome/150.x），
 *        再用 puppeteer-core 连 9221 跑 14 项验证（此时 newPage 可用）。
 *
 * 本脚本把 (2)(3) 串成一步，跑完即产出 results-<platform>.json。
 *
 * 环境变量：
 *   CLIENT_BINARY         客户端可执行文件（缺省按平台推断）
 *   E2E_PLATFORM          平台名（须与 matrix.json 一致，如 "Windows 10" / "macOS arm64" / "Ubuntu 22" / "Windows 7"）
 *   CLONE_NAME            目标分身名（默认 UA152）
 *   TEAM_NAME            登录后要选的团队显示名（默认取 tests/config.js productConfig.teamName）
 *   WDIO_USERNAME         登录账号邮箱（默认取 tests/config.js productConfig.username）
 *   PRODUCT_WDIO_PASSWORD 登录密码（secret）
 *   REMOTE_DEBUG_PORT     分身浏览器 CDP 端口（默认 9221）
 *   OUT                   结果文件路径（默认 results-<platform>.json）
 *   OPEN_CLONE_ONLY=1     只打开分身、不跑验证（调试用）
 */
const os = require('node:os');
const fs = require('node:fs');
const process = require('node:process');
const { spawnSync } = require('node:child_process');
const { remote } = require('webdriverio');

const login = require('./include/login');
const { productConfig } = require('./config');

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const CLONE = process.env.CLONE_NAME || 'UA152';
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || `results-${PLATFORM.replace(/\s+/g, '_')}.json`;
const OPEN_ONLY = process.env.OPEN_CLONE_ONLY === '1';

const LIST_LOAD_TIMEOUT = 120 * 1000;
const DETAIL_LOAD_TIMEOUT = 120 * 1000;

const log = (...a) => console.log('[e2e-verify]', ...a);

function resolveBinary() {
  if (process.env.CLIENT_BINARY) return process.env.CLIENT_BINARY;
  if (os.platform() === 'darwin') return '/Applications/花漾客户端.app/Contents/MacOS/花漾客户端';
  if (os.platform() === 'linux') return '/opt/花漾客户端/huayoung';
  return 'C:\\Program Files\\HuaYoung\\花漾客户端.exe';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writePlaceholder(reason) {
  try {
    fs.writeFileSync(OUT, JSON.stringify({
      meta: {
        kernel: '152',
        generatedAt: new Date().toISOString(),
        teamId: process.env.TEAM_ID || '',
        cloneName: CLONE,
        cloneCdpPort: CDP_PORT,
      },
      platform: PLATFORM,
      results: [],
      fatal: String(reason || ''),
    }, null, 2));
  } catch (_) { /* ignore */ }
}

/** 进入分身列表并打开目标分身（复用 origin e2eTest 的 UI 路径与选择器） */
async function openClone(browser) {
  log('进入首页');
  await browser.$('.icon-shouye_24').waitForExist({ timeout: 60 * 1000 });
  await browser.$('.icon-shouye_24').click();

  log('进入分身列表');
  await browser.$('.icon-chrome_outline').waitForExist({ timeout: 60 * 1000 });
  await browser.$('.icon-chrome_outline').click();

  // 诊断：列出可见分身链接，便于选择器失效时定位
  try {
    const texts = await browser.execute(() =>
      Array.from(document.querySelectorAll('a')).map((a) => (a.textContent || '').trim()).filter(Boolean));
    log(`[diag] 分身列表 <a> 文本(${texts.length}): ${JSON.stringify(texts.slice(0, 60))}`);
  } catch (e) {
    log(`[diag] 分身列表诊断失败(不影响主流程): ${e.message}`);
  }

  log(`等待分身出现: ${CLONE}`);
  await browser.$(`//a[contains(.,"${CLONE}")]`).waitForExist({ timeout: LIST_LOAD_TIMEOUT });
  await browser.$(`//a[contains(.,"${CLONE}")]`).click();

  log('进入分身详情页，等待「打开浏览器」');
  const openBtn = '//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]';
  await browser.$(openBtn).waitForExist({ timeout: DETAIL_LOAD_TIMEOUT });
  await browser.$(openBtn).click();

  log('处理「继续访问」并等待「正在访问」');
  let n = 0;
  for (;;) {
    if (++n > 100) throw new Error('等待打开会话超时（未出现「正在访问」）');

    try {
      await browser.$('//span[text()="继续访问"]').waitForExist({ timeout: 5 * 1000 });
      await browser.$('//span[text()="继续访问"]').click();
      // 「继续访问」可能弹 Ant Design 确认框，不点会阻塞
      try {
        const confirm = browser.$('.ant-modal-confirm .ant-btn-primary');
        await confirm.waitForExist({ timeout: 3 * 1000 });
        await confirm.click();
        log('已点掉「继续访问」确认框');
      } catch (_) { /* 无确认框 */ }
    } catch (_) {
      // 无「继续访问」按钮，继续轮询
    }

    try {
      await browser.$('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 5 * 1000 });
      log('分身已打开（正在访问）');
      return;
    } catch (_) { /* 还没打开，继续 */ }

    await sleep(1000);
  }
}

async function main() {
  const binary = resolveBinary();
  if (!fs.existsSync(binary)) {
    throw new Error(`客户端可执行文件不存在: ${binary}`);
  }

  const config = {
    ...productConfig,
    teamName: process.env.TEAM_NAME || productConfig.teamName,
    username: process.env.WDIO_USERNAME || productConfig.username,
  };
  const password = process.env.PRODUCT_WDIO_PASSWORD || process.env.WDIO_PASSWORD || 'password';

  log(`平台=${PLATFORM} 目标分身=${CLONE} 团队=${config.teamName} 账号=${config.username} CDP=${CDP}`);
  log(`客户端=${binary}`);

  const caps = {
    browserName: 'chrome',
    browserVersion: '108',
    'goog:chromeOptions': { binary },
  };
  if (os.platform() === 'darwin') {
    caps['wdio:chromedriverOptions'] = { cacheDir: '/tmp' };
  }

  let browser;
  browser = await remote({ capabilities: caps, logLevel: 'warn' });
  log('客户端已启动（chromedriver 已附着主壳）');

  try {
    try {
      await login(config, password, browser);
    } catch (e) {
      // 登录失败时把页面可见文本 dump 出来，便于判断账号/团队名/密码是否正确
      try {
        const txt = await browser.execute(() => (document.body ? document.body.innerText : '').slice(0, 800));
        const spans = await browser.execute(() =>
          Array.from(document.querySelectorAll('span')).map((s) => (s.textContent || '').trim()).filter(Boolean).slice(0, 80));
        log('[diag] 登录失败，页面文本:', JSON.stringify(txt));
        log('[diag] 可见 span 文本:', JSON.stringify(spans));
      } catch (_) { /* ignore */ }
      throw e;
    }
    log('登录完成');

    await openClone(browser);

    if (OPEN_ONLY) {
      log('OPEN_CLONE_ONLY=1 → 仅打开分身，跳过验证');
      return 0;
    }

    log(`开始 14 项验证（连分身内核 CDP: ${CDP}）`);
    const runnerArgs = [
      'tests/runner.mjs',
      '--engine', 'puppeteer',
      '--platforms', PLATFORM,
      '--cdp', CDP,
      '--out', OUT,
    ];
    if (process.env.PROXY) runnerArgs.push('--proxy', process.env.PROXY);
    if (process.env.PROXY_IP) runnerArgs.push('--proxy-ip', process.env.PROXY_IP);
    const r = spawnSync(process.execPath, runnerArgs, { stdio: 'inherit' });
    log(`runner 退出码=${r.status}`);
    return r.status == null ? 1 : r.status;
  } finally {
    try { await browser.deleteSession(); } catch (_) { /* ignore */ }
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    console.error('[e2e-verify] 失败:', e && (e.stack || e.message));
    writePlaceholder(e && (e.stack || e.message));
    process.exit(1);
  });
