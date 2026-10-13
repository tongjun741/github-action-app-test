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
 * 注：右键菜单是浏览器原生 UI（page.screenshot 截不到），故用 OCR 方案：screenshot-desktop 截全屏
 *     （含原生菜单）→ tesseract.js 识别「翻译」项 → 屏幕坐标经窗口位置+DPR 映射回视口坐标 → CDP 真鼠标点击。
 *     页面级翻译触发仅以 OCR 命中右键菜单「翻译」项为准，不再以 API 探测/bubble/widget 兜底。
 * 输出：results-GTranslate.json
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { remote } = require('webdriverio');
const puppeteer = require('puppeteer-core');
const { openClone, login, resolveBinary, resolveChromedriver, buildCaps } = require('./e2e-verify.cjs');
const { productConfig } = require('./config');
const screenshotDesktop = require('screenshot-desktop'); // OS 级全屏截图（含浏览器原生右键菜单，page.screenshot 截不到）
const tesseract = require('tesseract.js');               // OCR 词级识别，定位菜单项屏幕坐标

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || 'results-GTranslate.json';
const URL_TARGET = 'https://www.tiktok.com/support?lang=en';

const log = (...a) => console.log('[gtranslate]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// G2 (2026-10-13)：用户先要求「真鼠标点」→ 现升级为 **OCR 方案**：
//   screenshot-desktop 截全屏（含原生右键菜单）→ tesseract.js 识别「翻译」项屏幕坐标
//   → 经窗口屏幕位置(window.screenX/Y)+DPR 映射回视口坐标 → CDP 真鼠标点击。
//   原生菜单 page.screenshot 截不到，故必须 OS 级截图。OCR 未命中/异常即判定失败，不降级网格扫描/API 探测。
let _gocrWorker = null;
async function ocrFindTranslateItem(fullPngBuf, screenCssW) {
  // 全屏 PNG buffer → OCR 词级识别 → 返回「翻译」项屏幕设备像素中心 + dpr
  const tmp = path.join(process.cwd(), `rc-menu-${Date.now()}.png`);
  fs.writeFileSync(tmp, fullPngBuf);
  const imgW = fullPngBuf.readUInt32BE(16); // PNG IHDR 宽（设备像素）
  const dpr = imgW / screenCssW;            // 截图宽 / 主屏 CSS 宽 = DPR
  if (!_gocrWorker) _gocrWorker = await tesseract.createWorker('chi_sim+eng');
  const { data } = await _gocrWorker.recognize(tmp);
  const words = (data.words || []).filter((w) => w.confidence >= 40 && w.bbox);
  const hit = words.find((w) => /(翻译|translate)/i.test(w.text));
  if (!hit) return null;
  return {
    sx: Math.round((hit.bbox.x0 + hit.bbox.x1) / 2),
    sy: Math.round((hit.bbox.y0 + hit.bbox.y1) / 2),
    dpr, text: hit.text,
  };
}
async function tryRightClickTranslate(page) {
  const target = await page.evaluate(() => {
    const cands = ['article p', 'main p', 'p', 'h1', 'h2', 'section', 'div'];
    for (const s of cands) {
      const els = document.querySelectorAll(s);
      for (const el of els) {
        if (el.offsetParent !== null && (el.textContent || '').trim().length > 25) {
          const r = el.getBoundingClientRect();
          if (r.width > 50 && r.height > 10) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }
      }
    }
    return null;
  }).catch(() => null);
  if (!target) return { ok: false, err: '未找到可右键的文本块' };
  let client;
  try { client = await page.target().createCDPSession(); } catch (e) { return { ok: false, err: 'CDP会话失败:' + e.message.slice(0, 40) }; }
  // 窗口屏幕位置（CSS px）+ 主屏 CSS 宽（用于 DPR 与坐标映射）
  const winfo = await page.evaluate(() => ({ screenX: window.screenX, screenY: window.screenY, screenCssW: window.screen.width }))
    .catch(() => ({ screenX: 0, screenY: 0, screenCssW: 1920 }));
  // 标题栏+工具栏偏移（HuaYoung 分身浏览器若为嵌入式 webview 则≈0；若点击偏，用 RC_MENU_TOOLBAR_PX 校准）
  const TB = Number(process.env.RC_MENU_TOOLBAR_PX || 0);
  const ratioNow = () => page.evaluate(() => {
    const t = (document.body ? document.body.innerText : '');
    const cjk = (t.match(/[一-鿿]/g) || []).length;
    return cjk / Math.max(t.length, 1);
  }).catch(() => 0);
  const rightClick = async (x, y) => {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(120);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  };
  const leftClickVp = async (vx, vy) => {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vx, y: vy });
    await sleep(120);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: vx, y: vy, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: vx, y: vy, button: 'left', clickCount: 1 });
  };
  await rightClick(target.x, target.y);
  await sleep(900);
  let triggered = false, ratio = 0;

  // —— OCR 主路径：OS 全屏截图 → 识别「翻译」→ 屏幕坐标映射回视口 → CDP 点击 ——
  try {
    const fullBuf = await screenshotDesktop({ format: 'png' });
    const ocr = await ocrFindTranslateItem(fullBuf, winfo.screenCssW);
    if (ocr) {
      const vx = Math.round(ocr.sx / ocr.dpr - winfo.screenX);
      const vy = Math.round(ocr.sy / ocr.dpr - winfo.screenY - TB);
      log(`OCR 命中右键菜单「${ocr.text}」屏幕(${ocr.sx},${ocr.sy}) dpr=${ocr.dpr.toFixed(2)} → 视口(${vx},${vy}) [win=(${winfo.screenX},${winfo.screenY}) TB=${TB}]`);
      await leftClickVp(vx, vy);
      await sleep(1500);
      ratio = await ratioNow();
      if (ratio > 0.1) triggered = true;
    } else {
      log('OCR 未识别到「翻译」项（原生菜单未截到 / OCR 误判）——按用户要求不降级');
    }
  } catch (e) { log(`OCR 右键菜单异常(不降级): ${e.message.slice(0, 80)}`); }

  // （已移除原网格扫描降级：本用例仅用 OCR，命中即点；未命中记 ok=false 不降级）
  try { await client.detach(); } catch (_) {}
  return { ok: triggered, ratio };
}

async function main() {
  const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [] };
  const push = (status, detail) => {
    out.results.push({ caseId: 'google_translate', id: 'google_translate', name: '右键Google翻译', type: 'client_google_translate', platform: PLATFORM, status, detail, criteria: '分身开启谷歌翻译加速，使用Webshare的IP访问https://www.tiktok.com/support?lang=en，右键选择翻译后应该能正常翻译页面', ts: new Date().toISOString() });
    console.log(`  [${status === 'pass' ? '✓' : '✗'}] 右键Google翻译 — ${detail.slice(0, 120)}`);
  };
  // 尊重大矩阵 ignored：用户要求忽略「右键Google翻译」时，直接记 ignored 不执行、不计入红/绿
  try {
    const m = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'matrix.json'), 'utf8'));
    const c = (m.cases || []).find((x) => x.id === 'google_translate');
    if (c && c.ignored) {
      push('ignored', '按用户要求忽略该用例（不执行、不计入红/绿）');
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
      log('右键Google翻译 按矩阵 ignored 跳过');
      process.exit(0);
    }
  } catch (_) {}

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

    let page = await pptr.newPage();
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

      // G2 (2026-10-13)：用户要求「右键翻译只使用 OCR，不要降级」。
      // 仅真鼠标右键 → OCR 识别「翻译」项 → CDP 点击；命中即 pass，未命中即 fail（不回退 API/bubble/widget）。
      let rc = null;
      try { rc = await tryRightClickTranslate(page); } catch (e) { rc = { ok: false, err: e.message.slice(0, 60) }; }
      if (rc && rc.ok) {
        push('pass', `右键菜单 OCR 命中「翻译」项并触发翻译生效（CJK 占比 ${(rc.ratio * 100).toFixed(1)}%，真鼠标右键→翻译项）`);
        fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
        log(`已写出 ${OUT}`);
        try { await pptr.disconnect(); } catch (_) {}
        process.exit(0);
      }
      // 仅 OCR：未命中即 fail，不回退 API 探测 / bubble / widget（那些是翻译加速代理证据，不等于右键翻译本身）
      push('fail', `OCR 未命中/未触发右键翻译菜单「翻译」项（${rc && rc.err || '菜单未命中'}），按用户要求仅用 OCR 不降级`);
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
      log(`已写出 ${OUT}`);
      try { await pptr.disconnect(); } catch (_) {}
      process.exit(1);

      // 触发翻译（Run#51 复盘：widget 曾在元素不存在时也置 triggered='widget'，把 API 探测短路——假触发）。
      // 正确顺序：API 探测无条件先跑（「翻译加速可达」最硬证据，不依赖页面组件）；
      // bubble/widget 仅在目标元素真实存在且操作成功时才计入。
      let apiProbe = null;
      // 全量轮#5 实证：R19 步后分身隧道可能已死（CDP 活着但导航/ fetch 全挂）——
      // API 探测失败且属代理类错误时，重开分身重建隧道后再试一轮。
      const doApiProbe = async () => page.evaluate(async () => {
        try {
          const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=hello', { method: 'GET' });
          const j = await r.json();
          return { ok: r.ok, translated: j && j[0] && j[0][0] ? String(j[0][0][0]) : '' };
        } catch (e) { return { ok: false, err: e.message.slice(0, 80) }; }
      }).catch(() => ({ ok: false, err: 'eval fail' }));
      apiProbe = await doApiProbe();
      log(`translate API 探测: ${JSON.stringify(apiProbe)}`);
      if (!apiProbe.ok && /fetch|proxy|network|timeout/i.test(String(apiProbe.err || '')) && alreadyOpen) {
        log('API 探测代理类失败——隧道疑死，重开分身重建（一次）');
        try { await pptr.disconnect(); } catch (_) {}
        try { require('node:child_process').execSync('taskkill /F /IM HuaYoungApp.exe /T 2>nul || true'); } catch (_) {}
        if (process.platform !== 'win32') { try { require('node:child_process').execSync('pkill -f 花漾客户端 || pkill -f HuaYoungApp || true'); } catch (_) {} }
        await sleep(3000);
        browser = await remote({ capabilities: buildCaps(binary, resolveChromedriver()), logLevel: 'warn' });
        log('客户端已重启');
        const config2 = {
          ...productConfig,
          teamName: process.env.TEAM_NAME || productConfig.teamName,
          username: process.env.WDIO_USERNAME || productConfig.username,
        };
        await login(config2, process.env.PRODUCT_WDIO_PASSWORD || 'password', browser);
        log('重新登录完成');
        await openClone(browser);
        log('分身已重开');
        for (let i = 0; i < 60; i++) {
          try {
            pptr = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 30000 });
            const p = await pptr.newPage();
            await p.goto('about:blank', { timeout: 10000 }).catch(() => {});
            await p.close();
            log('CDP 重连就绪');
            break;
          } catch (_) {
            if (pptr) { try { await pptr.disconnect(); } catch (_) {} pptr = null; }
            await sleep(3000);
          }
        }
        page = await pptr.newPage();
        page.setDefaultTimeout(60000);
        await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log(`重开导航: ${e.message.slice(0, 60)}`));
        await sleep(5000);
        apiProbe = await doApiProbe();
        log(`重开后 API 探测: ${JSON.stringify(apiProbe)}`);
      }
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
