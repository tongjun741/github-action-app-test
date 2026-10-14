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
  let browserRef = browser; // 重开分身后 CDP 实例会换，后续导航统一走 browserRef
  let status = 'fail';
  let detail = '';
  let proxyDiag = '';
  // 2026-10-13 诊断：先读 chrome://version（不走代理）拿分身启动命令行——
  // 若带 --proxy-server 则 ERR_PROXY_CONNECTION_FAILED 是分身代理通道问题（非脚本/网络问题）
  try {
    const diagPage = await browser.newPage();
    await diagPage.goto('chrome://version', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const cmdLine = await diagPage.evaluate(() => {
      // chrome://version 的 command_line 是完整命令行节点；兜底全文
      const el = document.querySelector('#command_line') || document.getElementById('command_line');
      if (el && el.innerText && el.innerText.length > 20) return el.innerText;
      const rows = [...document.querySelectorAll('table tr, .version-table tr')];
      const cmd = rows.map((r) => r.innerText).find((t) => /--/.test(t));
      return cmd || document.body.innerText;
    }).catch(() => '');
    await diagPage.close().catch(() => {});
    const full = String(cmdLine || '');
    const m = full.match(/--proxy-server[=\s]+([^\s]+)/);
    proxyDiag = m ? `分身代理参数: ${m[1]}` : '未见 --proxy-server 参数';
    log(`[diag] ${proxyDiag}（命令行总长 ${full.length}）`);
    // 打印含 proxy/tunnel/socks 的全部片段（不受 800 截断影响）
    const fragRe = /.{0,40}(proxy|tunnel|socks)[^\s]*[^\0]{0,40}/gi;
    const frags = full.match(fragRe) || [];
    if (frags.length) log(`[diag] 命令行相关片段: ${JSON.stringify(frags.slice(0, 6))}`);
    else log(`[diag] 命令行尾段(后300): ${full.slice(-300)}`);
  } catch (e) { log(`[diag] chrome://version 读取失败: ${e.message.slice(0, 80)}`); }
  let shotPath = '';
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    // 先探网络/代理就绪：ipapi.co 轻量页（Run#25 实测分身代理需要就绪时间）。
    // 2026-10-13 夜间全量轮实证：前序 4 平台 job 刚结束时第二台设备分身代理可能仍未就绪
    // （ipapi 6 次全挂）——窗口拉宽到 ~5 分钟，ipapi/example.com 双探（区分站点抽风 vs 代理未通）。
    let netOk = false;
    let netErr = '';
    for (let i = 0; i < 10; i++) {
      for (const probeUrl of ['https://ipapi.co/', 'https://example.com/']) {
        try {
          await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          netOk = true;
          log(`代理网络就绪（第 ${i + 1} 次探测 ${probeUrl}）`);
          break;
        } catch (e) {
          netErr = e.message.slice(0, 100);
          log(`网络探测失败(第 ${i + 1} 次 ${probeUrl}): ${netErr}`);
        }
      }
      if (netOk) break;
      await sleep(15000);
    }
    if (!netOk) {
      // 2026-10-13 #3 实证：分身带 PAC（data:base64 FindProxyForURL）启动，本地隧道端口未就绪/断开
      // → 全部外网导航 ERR_PROXY_CONNECTION_FAILED。兜底：关掉分身重开一次（tunnelRouter 重建隧道）。
      log('隧道不通——尝试重开分身重建隧道（一次）');
      try {
        const pages = await browser.pages().catch(() => []);
        for (const p of pages) { try { await p.goto('about:blank', { timeout: 5000 }).catch(() => {}); } catch (_) {} }
        await browser.disconnect().catch(() => {});
      } catch (_) {}
      const reopen = spawnSync(process.execPath, ['tests/e2e-verify.cjs'], {
        stdio: 'inherit',
        env: { ...process.env, OPEN_CLONE_ONLY: '1', OUT: `placeholder-reopen-${SLUG}.json` },
      });
      log(`重开分身退出码 ${reopen.status}`);
      if (reopen.status === 0) {
        const b2 = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 60000 }).catch((e) => { log(`重开后 CDP 连接失败: ${e.message.slice(0, 80)}`); return null; });
        if (b2) {
          const p2 = await b2.newPage();
          for (let i = 0; i < 6 && !netOk; i++) {
            try {
              await p2.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
              netOk = true;
              log(`重开后隧道就绪（第 ${i + 1} 次）`);
            } catch (e) {
              netErr = e.message.slice(0, 100);
              log(`重开后探测失败(第 ${i + 1} 次): ${netErr}`);
              await sleep(10000);
            }
          }
          if (!netOk) log('重开分身未能恢复隧道——PAC 指向的本地隧道端口持续不可达（客户端侧隧道问题，非脚本）');
          // 替换 browser 引用供后续导航用
          await p2.close().catch(() => {});
          browserRef = b2;
        }
      }
    }
    if (!netOk) {
      // 代理持续不可达 = 基础设施问题，判 error（区别于「到了页面但无登录态」的业务 fail）
      throw new Error(`分身代理网络持续不可达（含重开分身后仍失败，末次错误: ${netErr}）`);
    }
    // wdku.net 导航（有界重试）——用 browserRef（重开后是新实例）新建 page，不用可能已断开的旧 page
    let lastErr = '';
    let navOk = false;
    let page2 = null;
    for (let i = 0; i < 4; i++) {
      try {
        if (!page2) page2 = await browserRef.newPage();
        await page2.goto('https://www.wdku.net/', { waitUntil: 'domcontentloaded', timeout: 45000 });
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
    const probe = await page2.evaluate(() => {
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
    // 2026-10-14 用户要求：OS 全屏水印截图（shots/<平台>/ 目录）；视口截图保底
    try {
      const { fullShot } = require('./include/shot');
      shotPath = await fullShot('cookie-sync') || '';
    } catch (_) { shotPath = ''; }
    if (!shotPath) {
      shotPath = path.join(process.cwd(), `cookie-sync-${Date.now()}.png`);
      await page2.screenshot({ path: shotPath }).catch(() => { });
    }
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
    try { await browserRef.disconnect(); } catch (_) { }
    if (browserRef !== browser) { try { await browser.disconnect(); } catch (_) { } }
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
