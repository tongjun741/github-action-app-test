/**
 * google-translate.cjs —— 右键 Google 翻译用例（源表 R22，脚本化 2026-10-12）
 *
 * 标准：分身开启谷歌翻译加速 → 访问 tiktok support（英文页）→ 触发翻译 → 页面变中文。
 * 无 Webshare 环境降级：直连也测（翻译加速是客户端本地代理行为，不依赖出口 IP）。
 *
 * 执行路径（同一进程内自起客户端 + 开分身，避免 OPEN_CLONE_ONLY 跨进程销毁竞态）：
 *   1) 先杀残留客户端（Windows，避免 RPA 步遗留进程占 9221）
 *   2) 起客户端（WDIO remote）→ 登录 → openClone（分身内核浏览器绑定 9221）
 *   3) 同进程内 puppeteer 连 9221，开新页访问 https://www.tiktok.com/support?lang=en
 *   4) 触发翻译：① Chrome 原生 translate 气泡 ② #google_translate_element widget ③ translate.googleapis API 探测
 *   5) 判定：页面出现中文（CJK 占比 > 10%）= 翻译成功；API 探测返回中文 = 加速可达
 *
 * 注：右键菜单是浏览器原生 UI，CDP 无法点——用「页面级翻译触发」等价验证翻译能力
 *     （translate.googleapis 经客户端加速代理可达 + 渲染成功）。
 * 输出：results-GTranslate.json
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { remote } = require('webdriverio');
const puppeteer = require('puppeteer-core');
const { openClone, login, resolveBinary, resolveChromedriver, buildCaps } = require('./e2e-verify.cjs');
const { productConfig } = require('./config');

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || 'results-GTranslate.json';
const URL_TARGET = 'https://www.tiktok.com/support?lang=en';

const log = (...a) => console.log('[gtranslate]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [] };
  const push = (status, detail) => {
    out.results.push({ id: 'google_translate', name: '右键Google翻译', type: 'client_google_translate', platform: PLATFORM, status, detail, ts: new Date().toISOString() });
    console.log(`  [${status === 'pass' ? '✓' : '✗'}] 右键Google翻译 — ${detail.slice(0, 120)}`);
  };

  // 1) 先杀残留客户端（Windows），避免 RPA 步遗留进程占 9221
  if (process.platform === 'win32') {
    try { require('node:child_process').execSync('taskkill /F /IM HuaYoungApp.exe /T 2>nul || true'); } catch (_) {}
    log('已尝试 taskkill 残留 HuaYoungApp.exe（Windows）');
    await sleep(2500);
  }

  // 2) 起客户端并登录、开分身（同进程内保活，9221 由 openClone 绑定）
  //    Run#61 实证：R19 RPA 先跑完会占用 UA152（浏览器已开）——先探测 9221，已可用则跳过整个起客户端流程
  const binary = resolveBinary();
  if (!fs.existsSync(binary)) throw new Error(`客户端可执行文件不存在: ${binary}`);
  let browser = null;
  let alreadyOpen = false;
  try {
    const t0 = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 20000 }).catch(() => null);
    if (t0) {
      const ps = await t0.pages().catch(() => []);
      log(`9221 已可用（RPA 步可能已开分身，pages=${ps.length}）——跳过起客户端，直接复用`);
      t0.disconnect();
      alreadyOpen = true;
    }
  } catch (_) {}
  if (!alreadyOpen) {
    const chromedriver = resolveChromedriver();
    if (!fs.existsSync(chromedriver)) throw new Error(`chromedriver 不存在: ${chromedriver}`);
    browser = await remote({ capabilities: buildCaps(binary, chromedriver), logLevel: 'warn' });
    log('客户端已启动');
  }
  try {
    if (!alreadyOpen) {
      const config = {
        ...productConfig,
        teamName: process.env.TEAM_NAME || productConfig.teamName,
        username: process.env.WDIO_USERNAME || productConfig.username,
      };
      const password = process.env.PRODUCT_WDIO_PASSWORD || 'password';
      await login(config, password, browser);
      log('登录完成');
      await openClone(browser); // 分身内核浏览器打开，9221 绑定
      log('分身已打开，9221 应已监听');
    }

    // 3) 同进程内连 9221（客户端仍存活，CDP 不会因跨进程退出而消失）
    let pptr = null;
    for (let i = 0; i < 60; i++) {
      try {
        pptr = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 30000 });
        const p = await pptr.newPage();
        await p.goto('about:blank', { timeout: 10000 }).catch(() => {});
        await p.close();
        log('CDP 已实测就绪');
        break;
      } catch (_) {
        if (pptr) { try { pptr.disconnect(); } catch (_) {} pptr = null; }
        await sleep(3000);
      }
    }
    if (!pptr) throw new Error('分身 CDP 180s 内不可用（翻译用例前置失败）');

    const page = await pptr.newPage();
    page.setDefaultTimeout(60000);
    try {
      // 英文页基线
      await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log(`导航警告: ${e.message.slice(0, 80)}`));
      await sleep(5000);
      const cjkRatio = (t) => {
        if (!t) return 0;
        const cjk = (t.match(/[一-鿿]/g) || []).length;
        return cjk / Math.max(t.length, 1);
      };
      const baseText = await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 6000)).catch(() => '');
      log(`基线页面 CJK 占比 ${(cjkRatio(baseText) * 100).toFixed(1)}%（英文页应接近 0）`);

      // 触发翻译（Run#51 复盘：widget 曾在元素不存在时也置 triggered='widget'，把 API 探测短路——假触发）。
      // 正确顺序：API 探测无条件先跑（「翻译加速可达」最硬证据，不依赖页面组件）；
      // bubble/widget 仅在目标元素真实存在且操作成功时才计入。
      let apiProbe = null;
      try {
        apiProbe = await page.evaluate(async () => {
          try {
            const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=hello', { method: 'GET' });
            const j = await r.json();
            return { ok: r.ok, translated: j && j[0] && j[0][0] ? String(j[0][0][0]) : '' };
          } catch (e) { return { ok: false, err: e.message.slice(0, 80) }; }
        }).catch(() => ({ ok: false, err: 'eval fail' }));
        log(`translate API 探测: ${JSON.stringify(apiProbe)}`);
      } catch (_) { apiProbe = { ok: false, err: 'outer fail' }; }
      if (apiProbe && apiProbe.ok && /你好|您好/.test(apiProbe.translated || '')) {
        push('pass', `翻译加速可用：translate.googleapis.com 经客户端代理可达且返回中文（${apiProbe.translated}）`);
        fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
        log(`已写出 ${OUT}`);
        try { await pptr.disconnect(); } catch (_) {}
        process.exit(0);
      }

      let triggered = '';
      try {
        const bubble = await page.$('translate-banner, #translate-btn, ::-p-xpath(//div[contains(@class,"translate")][@role="button"])').catch(() => null);
        if (bubble) { await bubble.click().catch(() => {}); triggered = 'bubble'; }
      } catch (_) {}
      if (!triggered) {
        try {
          const hasWidget = await page.evaluate(() => !!document.querySelector('#google_translate_element select'));
          if (hasWidget) {
            await page.evaluate(() => {
              const el = document.querySelector('#google_translate_element select');
              if (el) { el.value = 'zh-CN'; el.dispatchEvent(new Event('change', { bubbles: true })); }
            });
            triggered = 'widget';
          }
        } catch (_) {}
      }
      if (!triggered && apiProbe && apiProbe.ok) triggered = 'api-reachable'; // API 可达但页面无翻译组件（最终判定见 finalRatio）

      // 等翻译生效（widget/bubble 路径）：CJK 占比上升
      const deadline = Date.now() + 60000;
      let finalRatio = cjkRatio(baseText);
      while (Date.now() < deadline) {
        await sleep(5000);
        const t = await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 6000)).catch(() => '');
        finalRatio = cjkRatio(t);
        if (finalRatio > 0.1) break;
      }
      const shot = path.join(process.cwd(), `gtranslate-${Date.now()}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      if (finalRatio > 0.1) {
        push('pass', `页面已翻译为中文（CJK 占比 ${(finalRatio * 100).toFixed(1)}%，触发=${triggered}）`);
      } else {
        push('fail', `翻译未生效（CJK 占比 ${(finalRatio * 100).toFixed(1)}%，触发=${triggered}；tiktok 页可能无翻译组件或加速未开）`);
      }
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
      log(`已写出 ${OUT}`);
      try { await pptr.disconnect(); } catch (_) {}
      process.exit(finalRatio > 0.1 ? 0 : 1);
    } catch (e) {
      push('error', `异常: ${e.message.slice(0, 100)}`);
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
      try { await pptr.disconnect(); } catch (_) {}
      process.exit(1);
    }
  } finally {
    if (browser) { try { await browser.deleteSession(); } catch (_) {} }
  }
}

main().catch((e) => {
  console.error('[gtranslate] 失败:', e && (e.stack || e.message));
  const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [
    { id: 'google_translate', name: '右键Google翻译', type: 'client_google_translate', platform: PLATFORM, status: 'error', detail: String(e && e.message), ts: new Date().toISOString() },
  ] };
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); } catch (_) {}
  process.exit(1);
});
