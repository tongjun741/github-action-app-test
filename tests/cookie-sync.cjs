/**
 * cookie-sync.cjs —— Cookie 同步用例的脚本化执行（独立 Action job = 另一台电脑，用户要求 2026-10-10）
 *
 * 前置：verify job 已在同一分身内完成 wdku.net 登录（密码流程 A1）。
 * 本 job 在**另一台 runner** 上打开同一分身，访问 wdku.net 验证已处于登录态
 * （Cookie 经花漾云端同步到分身）。
 *
 * 判定：登录态检测优先级：
 *   1) 页面出现「退出/注销/我的账号」类元素或 localStorage/sessionStorage 带 token
 *   2) 跳转后 URL 不再是 /login
 *   3) document.cookie 含 session 标记（可读部分）
 * 全都不满足 → fail。
 *
 * 输出：results-Cookie_Sync.json（含单条 cookie_sync 用例），供 report job 合并。
 *
 * 环境变量：与 e2e-verify 相同（CLIENT_BINARY/E2E_PLATFORM/CLONE_NAME/TEAM_NAME/
 *           WDIO_USERNAME/PRODUCT_WDIO_PASSWORD/REMOTE_DEBUG_PORT/OUT）
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { remote } = require('webdriverio');
const puppeteer = require('puppeteer-core');
const http = require('node:http');

const login = require('./include/login');
const { productConfig } = require('./config');

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const SLUG = PLATFORM.replace(/\s+/g, '_');
const CLONE = process.env.CLONE_NAME || 'UA152';
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || 'results-Cookie_Sync.json';

const log = (...a) => console.log('[cookie-sync]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 复用 e2e-verify 的启动与打开分身逻辑（require 会执行整个 main() —— 不行，抽函数出来）
// 这里直接复制 e2e-verify 的 resolveBinary/resolveChromedriver/openClone 核心路径太重，
// 改为 spawn e2e-verify.cjs 且 OPEN_CLONE_ONLY=1（只打开分身），然后本进程连 CDP 验证登录态。
async function main() {
  log(`平台=${PLATFORM} 分身=${CLONE} CDP=${CDP}`);

  // 1) 用 OPEN_CLONE_ONLY 模式跑 e2e-verify：登录客户端 + 打开分身 + 等 CDP
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['tests/e2e-verify.cjs'], {
    stdio: 'inherit',
    env: { ...process.env, OPEN_CLONE_ONLY: '1', OUT: `placeholder-${SLUG}.json` },
  });
  if (r.status !== 0) {
    throw new Error(`打开分身失败（e2e-verify OPEN_CLONE_ONLY 退出码 ${r.status}）`);
  }

  // 2) 连 CDP 验证 wdku.net 登录态
  log('连接分身浏览器 CDP 验证登录态');
  const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 60000 });
  let status = 'fail';
  let detail = '';
  let shotPath = '';
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    // Run#24 实测首跳可能 ERR_PROXY_CONNECTION_FAILED（分身代理尚未就绪/抖动）→ 有界重试
    let lastErr = '';
    let navOk = false;
    for (let i = 0; i < 4; i++) {
      try {
        await page.goto('https://www.wdku.net/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        navOk = true;
        break;
      } catch (e) {
        lastErr = e.message;
        log(`导航失败(第 ${i + 1} 次): ${e.message.slice(0, 120)}，10s 后重试`);
        await sleep(10000);
      }
    }
    if (!navOk) throw new Error(`wdku.net 导航重试 4 次仍失败: ${lastErr.slice(0, 160)}`);
    await sleep(5000);
    const probe = await page.evaluate(() => {
      // 页面可能未真正到达 wdku.net（about:blank / 错误页 / opaque origin）——全部信息带上
      const text = document.body ? document.body.innerText : '';
      const firstLine = text.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5).join(' / ');
      const loggedOut = /登录\s*\/?\s*注册|请登录|立即登录/i.test(text.slice(0, 2000));
      const loggedHints = /(退出|注销|我的账号|个人中心|welcome)/i.test(text.slice(0, 2000));
      let storageToken = false;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const v = localStorage.getItem(k) || '';
          if (/token|session|user/i.test(k) && v.length > 20) { storageToken = true; break; }
        }
      } catch (_) { }
      let cookie = '';
      try { cookie = document.cookie ? document.cookie.slice(0, 120) : ''; } catch (_) { cookie = '(cookie读取受限)'; }
      return {
        url: location.href,
        origin: location.origin,
        firstLine,
        loggedOut, loggedHints, storageToken,
        cookie,
      };
    });
    log(`探测结果: ${JSON.stringify(probe)}`);
    shotPath = path.join(process.cwd(), `cookie-sync-${Date.now()}.png`);
    await page.screenshot({ path: shotPath }).catch(() => { });
    // 判定：URL 确实在 wdku.net 域 +（storage token 或页面元素）且没有「登录/注册」主导航 → pass
    const onWdku = /wdku\.net/i.test(probe.url);
    if (onWdku && (probe.storageToken || (probe.loggedHints && !probe.loggedOut))) {
      status = 'pass';
      detail = `检测到登录态（storageToken=${probe.storageToken} pageHint=${probe.loggedHints} url=${probe.url}）`;
    } else if (!onWdku) {
      status = 'error';
      detail = `页面未到达 wdku.net（url=${probe.url} origin=${probe.origin} 首行=${probe.firstLine}）`;
    } else {
      status = 'fail';
      detail = `未检测到登录态 url=${probe.url} 首行=${probe.firstLine} cookie=${probe.cookie}`;
    }
  } catch (e) {
    status = 'error';
    detail = `验证过程异常: ${e.message}`;
  } finally {
    try { await browser.disconnect(); } catch (_) { }
  }

  // 3) 写 results
  const result = {
    meta: {
      kernel: '152',
      generatedAt: new Date().toISOString(),
      teamId: process.env.TEAM_ID || '',
      cloneName: CLONE,
      cloneCdpPort: CDP_PORT,
    },
    platform: `${PLATFORM} (第二台设备)`,
    results: [{
      caseId: 'cookie_sync',
      name: 'Cookie同步',
      type: 'client_cookie_sync',
      status,
      detail: `${detail}${shotPath ? ` [截图] ${shotPath}` : ''}`,
      criteria: '在另一台电脑打开分身浏览器访问 wdku.net，应处于已登录状态（脚本化：独立 Action job）',
    }],
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log(`已写出 ${OUT}（status=${status}）`);
  // GitHub Actions 注解：判定结果进 annotations（匿名可读）
  try {
    const cmd = status === 'pass' ? 'notice' : 'error';
    console.log(`::${cmd} title=cookie_sync(第二台设备)::${detail.replace(/\r?\n/g, ' ').slice(0, 200)}`);
  } catch (_) { }
  process.exit(status === 'pass' ? 0 : 1);
}

main().catch((e) => {
  console.error('[cookie-sync] 失败:', e && (e.stack || e.message));
  try {
    fs.writeFileSync(OUT, JSON.stringify({
      meta: { kernel: '152', generatedAt: new Date().toISOString(), teamId: process.env.TEAM_ID || '', cloneName: CLONE, cloneCdpPort: CDP_PORT },
      platform: `${PLATFORM} (第二台设备)`,
      results: [{ caseId: 'cookie_sync', name: 'Cookie同步', type: 'client_cookie_sync', status: 'error', detail: String(e && e.message || e), criteria: '（脚本化）' }],
    }, null, 2));
  } catch (_) { }
  process.exit(1);
});
