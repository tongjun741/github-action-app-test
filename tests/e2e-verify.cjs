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
 *   CLIENT_BINARY         客户端可执行文件（缺省按平台推断；Windows 下精确路径不存在时自动在
 *                         Program Files\HuaYoung / %LOCALAPPDATA%\Programs\HuaYoung 里扫 *.exe）
 *   CHROMEDRIVER_BIN      chromedriver 可执行文件（缺省用仓库内 tools/chromedriver/108.0.5359.71/<平台>）
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
const path = require('node:path');
const process = require('node:process');
const { spawnSync } = require('node:child_process');
const { remote } = require('webdriverio');

const login = require('./include/login');
const { productConfig } = require('./config');

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const SLUG = PLATFORM.replace(/\s+/g, '_');
const CLONE = process.env.CLONE_NAME || 'UA152';
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || `results-${SLUG}.json`;
const SHOT = `screenshot-${SLUG}.png`;
const OPEN_ONLY = process.env.OPEN_CLONE_ONLY === '1';

const LIST_LOAD_TIMEOUT = 120 * 1000;
const DETAIL_LOAD_TIMEOUT = 120 * 1000;

const log = (...a) => console.log('[e2e-verify]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 在给定目录里找「客户端主程序」exe（绕开 bat/GBK 中文路径编码坑）。
 * ⚠️ 直接取第一个 *.exe 会命中卸载器（如 `Uninstall 花漾客户端.exe`，字典序在前），
 *    导致 chromedriver 启动卸载器后立即退出（"Chrome has crashed"）。
 *    故排除 卸载/安装/更新/崩溃上报/提权 等辅助程序，并优先名字像客户端的。
 */
function firstClientExeIn(dir) {
  try {
    const exes = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.exe'));
    if (!exes.length) return null;
    const bad = /(uninst|卸载|update|setup|install|crash|report|helper|elevate|repair)/i;
    const good = exes.filter((n) => !bad.test(n));
    const pool = good.length ? good : exes;
    const score = (n) => (/花漾|huayoung|hua\s*young/i.test(n) ? 0 : 1);
    const pick = pool.slice().sort((a, b) => score(a) - score(b))[0];
    return pick ? path.join(dir, pick) : null;
  } catch (_) {
    return null;
  }
}

function resolveBinary() {
  if (process.env.CLIENT_BINARY && fs.existsSync(process.env.CLIENT_BINARY)) {
    return process.env.CLIENT_BINARY;
  }
  if (os.platform() === 'darwin') {
    return '/Applications/花漾客户端.app/Contents/MacOS/花漾客户端';
  }
  if (os.platform() === 'linux') {
    return '/opt/花漾客户端/huayoung';
  }
  // Windows：精确路径优先，找不到就在常见安装目录扫 *.exe（Win7 上 exe 名可能与 Win10 不同）
  const cands = [
    process.env.CLIENT_BINARY,
    'C:\\Program Files\\HuaYoung',
    process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'HuaYoung') : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'HuaYoung') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'HuaYoung') : null,
    'C:\\Program Files\\HuaYoung',
    'C:\\Program Files (x86)\\HuaYoung',
  ].filter(Boolean);
  for (const c of cands) {
    if (c.toLowerCase().endsWith('.exe') && fs.existsSync(c)) return c;
    const hit = firstClientExeIn(c);
    if (hit) return hit;
  }
  return 'C:\\Program Files\\HuaYoung\\花漾客户端.exe';
}

/**
 * chromedriver 108 的本地二进制。
 * 必须显式指定，否则 WDIO 会去 Chrome for Testing 下载 v108 → 404
 * （CfT 只提供 v115+）。见 https://webdriver.io/docs/driverbinaries
 */
function resolveChromedriver() {
  if (process.env.CHROMEDRIVER_BIN && fs.existsSync(process.env.CHROMEDRIVER_BIN)) return process.env.CHROMEDRIVER_BIN;
  const base = path.resolve(__dirname, '..', 'tools', 'chromedriver', '108.0.5359.71');
  let p;
  if (os.platform() === 'darwin') {
    p = path.join(base, os.arch() === 'arm64' ? 'mac-arm64' : 'mac-x64', 'chromedriver');
  } else if (os.platform() === 'linux') {
    p = path.join(base, 'linux64', 'chromedriver');
  } else {
    p = path.join(base, 'win32', 'chromedriver.exe');
  }
  try {
    if (os.platform() !== 'win32') fs.chmodSync(p, 0o755); // git 从 Windows 提交后可能丢执行位
  } catch (_) { /* ignore */ }
  return p;
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

async function saveShot(browser, name) {
  try {
    const b64 = await browser.takeScreenshot();
    fs.writeFileSync(name, Buffer.from(b64, 'base64'));
    log(`已保存截图: ${name}`);
  } catch (e) {
    log(`截图失败(忽略): ${e.message}`);
  }
}

async function dumpAnchorTexts(browser) {
  try {
    const all = await browser.execute(() =>
      Array.from(document.querySelectorAll('a')).map((a) => (a.textContent || '').trim()).filter(Boolean));
    log(`[diag] 当前 <a> 文本(${all.length}): ${JSON.stringify(all.slice(0, 80))}`);
  } catch (e) {
    log(`[diag] dump <a> 失败: ${e.message}`);
  }
}

/** 分身列表里的分身名（找到 <a> 里形如 UA123 的文本） */
async function listCloneNamesFromAnchors(browser) {
  try {
    return await browser.execute(() =>
      Array.from(document.querySelectorAll('a'))
        .map((a) => (a.textContent || '').trim())
        .filter((t) => /^UA\d+$/i.test(t)));
  } catch (_) {
    return [];
  }
}

/** 兜底：任意叶子节点上恰好是 UA123 的文本（新版 UI 可能不是 <a>） */
async function listCloneNamesAnyEl(browser) {
  try {
    return await browser.execute(() => {
      const s = new Set();
      document.querySelectorAll('*').forEach((el) => {
        if (el.children.length === 0) {
          const t = (el.textContent || '').trim();
          if (/^UA\d+$/i.test(t)) s.add(t);
        }
      });
      return Array.from(s);
    });
  } catch (_) {
    return [];
  }
}

/** 在候选名里匹配目标分身（精确 → 包含） */
function matchClone(names, want) {
  const W = String(want).toUpperCase();
  return names.find((n) => String(n).toUpperCase() === W)
    || names.find((n) => String(n).toUpperCase().includes(W))
    || null;
}

/**
 * 尝试把分页每页条数调大（Ant Design size-changer，如 15条/页 → 100条/页），
 * 这样多数情况下一页就能看到全部分身，省去逐页点。失败静默忽略。
 */
async function tryIncreasePageSize(browser) {
  try {
    const sel = browser.$('.ant-pagination-options .ant-select');
    if (!(await sel.isExisting())) return false;
    await sel.click();
    await sleep(600);
    const opts = await browser.$$('.ant-select-item-option');
    let best = null;
    let bestV = -1;
    for (const o of opts) {
      const t = ((await o.getText()) || '').trim();
      const m = t.match(/(\d+)/);
      if (m && Number(m[1]) > bestV) { bestV = Number(m[1]); best = o; }
    }
    if (best) {
      await best.click();
      await sleep(2500);
      log(`分页每页条数 -> ${bestV}`);
      return true;
    }
    await browser.keys(['Escape']).catch(() => {});
  } catch (e) {
    log(`调整每页条数失败(忽略): ${e.message}`);
  }
  return false;
}

/**
 * 点击分页「下一页」；返回是否真的翻动了。
 * 优先 Ant Design 分页控件（`.ant-pagination-next`），兜底点当前页的下一个页码。
 * 整个点击在页面上下文内原子完成，避免元素句柄失效。
 */
async function clickNextPage(browser) {
  try {
    return await browser.execute(() => {
      const txt = (el) => (el.textContent || '').trim();
      const cont = document.querySelector('.ant-pagination');
      if (cont) {
        const next = cont.querySelector('.ant-pagination-next');
        if (next && !next.className.includes('ant-pagination-disabled')) {
          (next.querySelector('button') || next).click();
          return true;
        }
        const items = Array.from(cont.querySelectorAll('.ant-pagination-item'));
        const idx = items.findIndex((li) => li.className.includes('ant-pagination-item-active'));
        if (idx >= 0 && idx + 1 < items.length) { items[idx + 1].click(); return true; }
        return false;
      }
      // 兜底：无 Ant class 时，找「下一页」按钮，或点最后一个纯数字 <a>
      const nxt = Array.from(document.querySelectorAll('a,button,span,li'))
        .find((el) => txt(el) === '下一页' || el.getAttribute('aria-label') === 'next');
      if (nxt) { nxt.click(); return true; }
      const nums = Array.from(document.querySelectorAll('a')).filter((a) => /^\d+$/.test(txt(a)));
      if (nums.length >= 2) { nums[nums.length - 1].click(); return true; }
      return false;
    });
  } catch (_) {
    return false;
  }
}

/** 进入分身列表并打开目标分身（复用 origin e2eTest 的 UI 路径与选择器） */
async function openClone(browser) {
  log('进入首页');
  await browser.$('.icon-shouye_24').waitForExist({ timeout: 60 * 1000 });
  await browser.$('.icon-shouye_24').click();

  log('进入分身列表');
  await browser.$('.icon-chrome_outline').waitForExist({ timeout: 60 * 1000 });
  await browser.$('.icon-chrome_outline').click();

  // 分身列表在 12.9 为异步渲染 + 分页（默认 15条/页）：轮询等待第 1 页出现 UAxxx，最多 90s。
  let names = [];
  const deadline = Date.now() + 90 * 1000;
  let lastDump = 0;
  while (Date.now() < deadline) {
    names = await listCloneNamesFromAnchors(browser);
    if (names.length) break;
    if (Date.now() - lastDump > 15000) {
      lastDump = Date.now();
      await dumpAnchorTexts(browser);
    }
    await sleep(2000);
  }
  log(`[diag] 第 1 页分身名(<a> 中 ${names.length}): ${JSON.stringify(names)}`);

  let target = matchClone(names, CLONE);

  // 第 1 页没命中 → 先尝试放大每页条数（多数情况一次搞定）
  if (!target) {
    await tryIncreasePageSize(browser);
    names = await listCloneNamesFromAnchors(browser);
    log(`[diag] 放大每页条数后分身名(${names.length}): ${JSON.stringify(names)}`);
    target = matchClone(names, CLONE);
  }

  // 仍未命中 → 逐页翻（最多 20 页），跨页累积用于失败诊断
  if (!target) {
    const all = new Set(names);
    for (let i = 0; i < 20; i++) {
      const moved = await clickNextPage(browser);
      if (!moved) { log(`分页：已到最后一页（翻了 ${i} 次）`); break; }
      await sleep(2000);
      const pageNames = await listCloneNamesFromAnchors(browser);
      log(`[diag] 第 ${i + 2} 页分身名(${pageNames.length}): ${JSON.stringify(pageNames)}`);
      pageNames.forEach((n) => all.add(n));
      target = matchClone(pageNames, CLONE);
      if (target) break;
    }
    names = Array.from(all);
  }

  // 兜底：任意元素文本匹配（新版 UI 可能不是 <a>）
  let viaAnyEl = false;
  if (!target) {
    const any = await listCloneNamesAnyEl(browser);
    log(`[diag] 分身名(任意元素 ${any.length}): ${JSON.stringify(any)}`);
    target = matchClone(any, CLONE);
    viaAnyEl = !!target;
  }

  if (!target) {
    await dumpAnchorTexts(browser);
    await saveShot(browser, SHOT);
    throw new Error(`分身列表未找到「${CLONE}」；可见分身(${names.length}): ${names.length ? names.join(', ') : '(空/列表未渲染)'}`);
  }

  log(`选中分身: ${target}${viaAnyEl ? '（经任意元素定位）' : ''}`);
  if (viaAnyEl) {
    await browser.$(`//*[normalize-space(text())="${target}"]`).click();
  } else {
    await browser.$(`//a[contains(.,"${target}")]`).click();
  }

  log('进入分身详情页，等待「打开浏览器」');
  const openBtn = '//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]';
  await browser.$(openBtn).waitForExist({ timeout: DETAIL_LOAD_TIMEOUT });
  await browser.$(openBtn).click();

  log('处理「继续访问」并等待「正在访问」');
  let n = 0;
  for (;;) {
    if (++n > 100) {
      await saveShot(browser, SHOT);
      throw new Error('等待打开会话超时（未出现「正在访问」）');
    }

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
    throw new Error(`客户端可执行文件不存在: ${binary}（已尝试扫描 Program Files\\HuaYoung / %LOCALAPPDATA%\\Programs\\HuaYoung）`);
  }
  const chromedriver = resolveChromedriver();
  if (!fs.existsSync(chromedriver)) {
    throw new Error(`chromedriver 不存在: ${chromedriver}`);
  }

  const config = {
    ...productConfig,
    teamName: process.env.TEAM_NAME || productConfig.teamName,
    username: process.env.WDIO_USERNAME || productConfig.username,
  };
  const password = process.env.PRODUCT_WDIO_PASSWORD || process.env.WDIO_PASSWORD || 'password';

  log(`平台=${PLATFORM} 目标分身=${CLONE} 团队=${config.teamName} 账号=${config.username} CDP=${CDP}`);
  log(`客户端=${binary}`);
  log(`chromedriver=${chromedriver}`);

  const caps = {
    browserName: 'chrome',
    browserVersion: '108',
    'goog:chromeOptions': { binary },
    // 必须显式指定，禁用 WDIO 自动下载（CfT 无 v108 → 404）
    'wdio:chromedriverOptions': { binary: chromedriver },
  };
  if (os.platform() === 'darwin') {
    caps['wdio:chromedriverOptions'].cacheDir = '/tmp';
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
      await saveShot(browser, SHOT);
      throw e;
    }
    log('登录完成');

    try {
      await openClone(browser);
    } catch (e) {
      await saveShot(browser, SHOT);
      throw e;
    }

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
