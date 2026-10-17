/**
 * google-translate.cjs —— 右键 Google 翻译用例（源表 R22，脚本化 2026-10-12）
 *
 * 标准：分身开启谷歌翻译加速 → 访问 tiktok support → 右键翻译 → 页面被翻译。
 * 翻译方向随浏览器 UI 语言自适应（不再单向要求「页面变中文」）：
 *   - Windows runner 客户端 UI=中文 → 菜单「翻译成中文(简体)」→ 英文源页翻译后 CJK↑。
 *   - macOS/Ubuntu runner 客户端 UI=英文 → 菜单「Translate to English」→ 中文源页翻译后 CJK↓。
 *     （run#38859682117 实锤：mac 用英文源页时「Translate to English」对英文页是 no-op，CJK 恒 0% → 误判失败）
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
 *     （含原生菜单）→ 以点击坐标为锚点裁 ROI + 放大 2~3× → tesseract.js(chi_sim) 按行识别「翻译」项
 *     → 屏幕坐标经窗口位置+DPR 映射回视口坐标 → OS 真鼠标点击。
 *     页面级翻译触发仅以 OCR 命中右键菜单「翻译」项为准，不再以 API 探测/bubble/widget 兜底。
 *     （2026-10-14 修复：整页 OCR 读不出小号中文菜单——改 ROI 放大 + 行级匹配 + conf≥25 + /(翻译|译|translate)/）
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
// 平台相关目标页：浏览器 UI 语言决定右键菜单给出的「翻译方向」（run#38859682117 根因）。
//   Windows runner 客户端 UI=中文 → 菜单「翻译成中文(简体)」→ 需英文源页，翻译后页面变中文(CJK↑)。
//   macOS/Ubuntu runner 客户端 UI=英文 → 菜单「Translate to English」→ 需中文源页，翻译后页面变英文(CJK↓)。
// 2026-10-17 二换源页（run#38990702151/38992918628 双轮实锤）：
//   tiktok `?lang=zh` 给的是 zh-Hant 繁体 + **无 html lang 声明**（gt-diag htmlLang=""）——
//   Chrome 翻译引擎无法判定源语言 → 点击「Translate to English」后 no-op（CJK 恒 63%）。
//   且 tiktok 页会触发「Open xdg-open?」原生对话框偷焦点（Ubuntu 右键菜单根本不弹）。
//   改用人民网 `https://www.people.com.cn/`：lang="zh-CN" 简体 + 明确声明 + 无 app 唤起弹窗，
//   翻成英文后 CJK 占比大幅下降，双向判定均可靠。
const IS_ZH_UI = /windows/i.test(PLATFORM);
const URL_TARGET = IS_ZH_UI
  ? 'https://www.tiktok.com/support?lang=en'
  : 'https://www.people.com.cn/';

const log = (...a) => console.log('[gtranslate]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// G2 (2026-10-13)：用户先要求「真鼠标点」→ 现升级为 **OCR 方案**：
//   screenshot-desktop 截全屏（含原生右键菜单）→ tesseract.js 识别「翻译」项屏幕坐标
//   → 经窗口屏幕位置(window.screenX/Y)+DPR 映射回视口坐标 → CDP 真鼠标点击。
//   原生菜单 page.screenshot 截不到，故必须 OS 级截图。OCR 未命中/异常即判定失败，不降级网格扫描/API 探测。
let _gocrWorker = null;
async function ocrFindTranslateItem(fullPngBuf, screenCssW, clickScreen) {
  // 全屏 PNG buffer → OCR → 返回「翻译」项屏幕设备像素中心 + dpr
  //
  // 2026-10-14【OCR 修复】实锤根因（本地 tesseract.js 5.1.1 逐字复现 CI 日志）：
  //   a) 整页 OCR 把小号（~13px）中文菜单压在 busy 背景上读成拉丁乱码（"BEaE"/"@E" conf 0），全图无「翻/译」token；
  //   b) 即便裁出放大到可读，Tesseract 仍把「翻译成中文（简体）」逐字切词（`译`/`成`/`中`/`文`/`(简体`/`)`），
  //      **首字「翻」丢失**、且幸存「译」conf 仅 33 < 40 → 词级 /(翻译|translate)/ 结构上匹配不到。
  //   对照实验：chi_sim-only 识别 CJK 词数是 chi_sim+eng 的 2 倍（108 vs 52），+eng 反而产生拉丁乱码。
  // 修复四点：① 语言改 chi_sim（去掉 +eng）；② 以点击屏幕坐标为锚点裁 ROI + 放大 2~3× 再 OCR（菜单恒出现在点击处）；
  //          ③ 按行聚合词再匹配（应对逐字分词）；④ 置信度 40→25，正则扩为 /(翻译|译|translate)/。
  // 存 shots/<操作系统>/<平台>/ 目录（Excel 截图文件名含目录名）
  const { shotDirFor } = require('./include/shot');
  const dir = path.join(process.cwd(), shotDirFor(process.env.E2E_PLATFORM || 'unknown'));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const tmp = path.join(dir, `rc-menu-${stamp}.png`);
  fs.writeFileSync(tmp, fullPngBuf);
  const imgW = fullPngBuf.readUInt32BE(16); // PNG IHDR 宽（设备像素）
  const imgH = fullPngBuf.readUInt32BE(20); // PNG IHDR 高（设备像素）
  const dpr = imgW / screenCssW;            // 截图宽 / 主屏 CSS 宽 = DPR

  // ROI：以点击屏幕设备坐标为锚点，取覆盖右键菜单的窗口（Chrome 原生菜单自点击点向右下展开）
  let ox = 0, oy = 0, cw = imgW, ch = imgH, scale = 1, roiPath = null;
  if (clickScreen && Number.isFinite(clickScreen.sx) && Number.isFinite(clickScreen.sy)) {
    // 参数经实图扫描定标（win10_r0 实测 300x520@x3 / 220x430@x4 均可命中「译成中文(简体)」）
    // 2026-10-17 padB 520→1000：点中链接/图片区域时菜单插入大量链接项（Open link.../Save link...），
    // 把「Translate」顶出 520px 窗口（run#38997128285 实证）。1000px 覆盖最长菜单。
    const padL = 14, padT = 14, padR = 286, padB = 1000; // 设备像素；菜单自点击点向右下展开
    ox = Math.max(0, Math.min(imgW - 1, Math.round(clickScreen.sx - padL)));
    oy = Math.max(0, Math.min(imgH - 1, Math.round(clickScreen.sy - padT)));
    cw = Math.max(1, Math.min(imgW - ox, padR + padL));
    ch = Math.max(1, Math.min(imgH - oy, padB + padT));
    scale = cw < 260 ? 4 : 3;
    try {
      const { Jimp } = require('jimp');
      const im = await Jimp.read(tmp);
      im.crop({ x: ox, y: oy, w: cw, h: ch });
      im.scale(scale);
      roiPath = path.join(dir, `rc-menu-roi-${stamp}.png`);
      await im.write(roiPath);
    } catch (e) { // 裁剪失败 → 退回整页
      log(`[ocr-diag] ROI 裁剪失败，退回整页: ${String(e && e.message).slice(0, 60)}`);
      roiPath = null; ox = 0; oy = 0; cw = imgW; ch = imgH; scale = 1;
    }
  }
  const ocrTarget = roiPath || tmp;

  if (!_gocrWorker) _gocrWorker = await tesseract.createWorker('chi_sim');
  const { data } = await _gocrWorker.recognize(ocrTarget);
  const words = (data.words || []).filter((w) => w.bbox && w.confidence >= 25);
  // 诊断证据——OCR 词表（前25）；截图改为**点击之后**上传（2026-10-17：上传阻塞 ~1.5s 是菜单
  // 消失的风险窗口——mac run#38897029574 OCR 命中并点击后页面无翻译效果，疑似菜单已超时关闭）。
  log(`[ocr-diag] 截图 ${imgW}x${imgH} dpr=${dpr.toFixed(2)} ROI=(${ox},${oy},${cw}x${ch}) x${scale} 识别词数=${words.length} 词表(前25): ${words.slice(0, 25).map((w) => w.text).join(' | ')}`);

  // 按行聚合（y 容差随放大倍数放大），行文本 join 后再匹配——应对 Tesseract 逐字分词
  const tol = 12 * scale;
  const lines = [];
  for (const w of words.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
    let L = lines.find((l) => Math.abs(l.y - w.bbox.y0) <= tol);
    if (!L) { L = { y: w.bbox.y0, items: [] }; lines.push(L); }
    L.items.push(w);
  }
  for (const L of lines) L.items.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const RE = /(翻译|译|translate)/i;
  const hitLine = lines.find((L) => RE.test(L.items.map((i) => i.text).join('')));
  if (!hitLine) return null;
  const kw = hitLine.items.find((i) => RE.test(i.text)) || hitLine.items[0];
  // ROI 坐标 → 全图设备像素：ox + bbox/scale（无 ROI 时 ox=0, scale=1 即为整页坐标）
  return {
    sx: Math.round(ox + ((kw.bbox.x0 + kw.bbox.x1) / 2) / scale),
    sy: Math.round(oy + ((kw.bbox.y0 + kw.bbox.y1) / 2) / scale),
    dpr, text: hitLine.items.map((i) => i.text).join(''),
    shotFiles: [tmp, roiPath].filter(Boolean), // 供调用方在点击后再上传（避免上传阻塞致菜单超时消失）
  };
}
async function tryRightClickTranslate(page) {
  // 2026-10-17 修复（run#38994693658 三平台实锤）：目标块必须**在当前视口内**。
  // 旧选择器只查 offsetParent（可见）不查视口内——people.com.cn 首屏多图，首个长文本块
  // 在折线下（y=2020 > 视口高 1200）→ OS 右键点到屏幕外，菜单永不弹（ROI 被夹成 300x1）。
  // 修：① 只选视口内(r.y 在 80..innerHeight-120 且高度适中)的块；② 视口内无块 → 先滚到
  // 页面中部（触发懒加载+露出正文）再找一轮。
  const findTargetInViewport = () => page.evaluate(() => {
    const cands = ['article p', 'main p', 'p', 'h1', 'h2', 'section', 'div'];
    const vh = window.innerHeight;
    // 2026-10-17 第5层（run#38997128285）：人民网列表项全是 <a> 包裹——点中链接/图片区域时右键菜单
    // 会插入大量链接项（Open link in new tab / Save link as / Open image...），把「Translate」
    // 顶出 ROI 窗口。两道防线：① 优先选**非链接内**的纯文本块（closest('a') 为空）；
    // ② ROI 高度扩到 1000px（见 ocrFindTranslateItem 的 padB）。
    for (const pass of [0, 1]) { // pass 0=非链接块，pass 1=放宽（兜底接受链接内块）
      for (const s of cands) {
        const els = document.querySelectorAll(s);
        for (const el of els) {
          if (el.offsetParent === null) continue;
          if (pass === 0 && el.closest('a')) continue; // 第一轮只要非链接块
          const txt = (el.textContent || '').trim();
          if (txt.length <= 25) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 50 && r.height > 10 && r.height <= 400 && r.y > 80 && (r.y + r.height) < (vh - 120)) {
            return { x: Math.round(r.x + Math.min(r.width / 2, 300)), y: Math.round(r.y + Math.min(r.height / 2, 150)) };
          }
        }
      }
    }
    return null;
  }).catch(() => null);
  let target = await findTargetInViewport();
  if (!target) {
    // 视口内没有 → 滚到页面 40% 处再找一轮（首屏全是图片/头图的站点正文在中部）
    try { await page.evaluate(() => window.scrollTo(0, Math.round(document.body.scrollHeight * 0.4))); await new Promise((r) => setTimeout(r, 800)); } catch (_) {}
    target = await findTargetInViewport();
    if (target) console.log('[gtranslate] 首屏无可右键块——已滚动至页面中部重选');
  }
  if (!target) return { ok: false, err: '未找到可右键的文本块（视口内）' };
  let client;
  try { client = await page.target().createCDPSession(); } catch (e) { return { ok: false, err: 'CDP会话失败:' + e.message.slice(0, 40) }; }
  // 窗口屏幕位置（CSS px）+ 主屏 CSS 宽（用于 DPR 与坐标映射）
  const winfo = await page.evaluate(() => ({ screenX: window.screenX, screenY: window.screenY, screenCssW: window.screen.width, dpr: window.devicePixelRatio }))
    .catch(() => ({ screenX: 0, screenY: 0, screenCssW: 1920, dpr: 1 }));
  // 标题栏+工具栏偏移（HuaYoung 分身浏览器若为嵌入式 webview 则≈0；若点击偏，用 RC_MENU_TOOLBAR_PX 校准）
  const TB = Number(process.env.RC_MENU_TOOLBAR_PX || 0);
  const ratioNow = () => page.evaluate(() => {
    const t = (document.body ? document.body.innerText : '');
    const cjk = (t.match(/[一-鿿]/g) || []).length;
    return cjk / Math.max(t.length, 1);
  }).catch(() => 0);
  // 2026-10-14 用户铁律：永远不用 CDP 合成事件；OS 鼠标工具缺失就不测（直接 fail）。
  const { osRightClick, osLeftClick, osMouseSupported } = require('./include/osmouse');
  const vpToScreen = (vx, vy) => ({
    sx: Math.round((winfo.screenX + vx) * winfo.dpr),
    sy: Math.round((winfo.screenY + vy + TB) * winfo.dpr),
  });
  if (!osMouseSupported()) {
    const why = `OS 鼠标工具缺失（win=osmouse-win.ps1 / mac=cliclick / linux=xdotool）——按用户要求不降级 CDP 合成事件，本用例不执行`;
    log(`[osmouse] ${why}`);
    try { await client.detach(); } catch (_) {}
    return { ok: false, err: why };
  }
  log('[osmouse] OS 真鼠标可用');
  const doRightClick = async (vx, vy) => {
    const s = vpToScreen(vx, vy);
    log(`[osmouse] OS 右键：视口(${vx},${vy}) → 屏幕(${s.sx},${s.sy}) [win=(${winfo.screenX},${winfo.screenY}) dpr=${winfo.dpr} TB=${TB}]`);
    await osRightClick(s.sx, s.sy);
  };
  try { await page.bringToFront(); } catch (_) {}
  // 2026-10-14 mac 实锤修复（macx64_r0 现场图）：分身浏览器窗口可能被主壳（花漾客户端）窗口
  // 遮挡——全局菜单栏显示「花漾客户端」，OS 右键屏幕落点打在主壳上，浏览器右键菜单根本没弹；
  // page.bringToFront() 只保证 tab 在浏览器内激活，不保证浏览器窗口在 OS 层置前。
  // 修复：右键前先 OS 左键点击浏览器窗口标题栏（窗口顶部中心，避开 mac 红绿灯/关闭按钮），
  // 点击即激活并置前窗口。win 同做（无害）；linux 跳过（Xvfb 无 WM，点击不重排 z 序且可能误触页面）。
  if (process.platform !== 'linux') {
    try {
      const w2 = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, dpr: window.devicePixelRatio }));
      const ax = Math.round((w2.x + w2.w / 2) * w2.dpr);
      const ay = Math.round((w2.y + 8) * w2.dpr);
      log(`[osmouse] 窗口激活：OS 左键点浏览器标题栏(${ax},${ay}) [win=(${w2.x},${w2.y}) outerW=${w2.w} dpr=${w2.dpr}]`);
      await osLeftClick(ax, ay);
      await sleep(400);
    } catch (e) { log(`[osmouse] 窗口激活点击失败(继续右键): ${String(e && e.message).slice(0, 60)}`); }
  }
  // 2026-10-17 修复（run#38897029574 Ubuntu 实锤）：tiktok 页可能弹「Open xdg-open?」原生
  // 对话框偷走焦点——右键根本没弹菜单（OCR 4 连拍词数=0）。右键前先 OS 级发 Escape：
  // 此时浏览器菜单尚未打开，Esc 只会关掉前置对话框（或无操作），不会误关菜单。
  const { osPressEscape } = require('./include/osmouse');
  if (osPressEscape()) { log('[osmouse] 已发 Esc 清场（关前置对话框）'); await sleep(300); }
  await doRightClick(target.x, target.y);
  const clickScreen = vpToScreen(target.x, target.y); // 菜单锚点（屏幕设备像素）→ 供 OCR 裁 ROI
  await sleep(900);
  let triggered = false, ratio = 0, clicked = false, menuText = '';

  // —— OCR 主路径：OS 全屏截图 → 识别「翻译」→ OS 真鼠标左键点击菜单项（屏幕坐标直用 OCR bbox）——
  // 2026-10-16 run#38844581228 修复：macOS 的 screenshot-desktop 依赖 TCC 屏幕录制权限
  // （runner 无 → "No displays detected"），与 password-flow/shot.js 同策略：mac 走系统 screencapture -x。
  const takeOsShotBuf = async () => {
    if (process.platform === 'darwin') {
      try {
        const { execSync } = require('node:child_process');
        const p = require('node:path').join(require('node:os').tmpdir(), `gt-shot-${Date.now()}.png`);
        execSync(`screencapture -x ${JSON.stringify(p)}`, { timeout: 15000 });
        const fsM = require('node:fs');
        const buf = fsM.readFileSync(p);
        try { fsM.unlinkSync(p); } catch (_) {}
        return buf;
      } catch (e) { log(`[shot] screencapture 失败，回退 screenshot-desktop: ${e.message.slice(0, 50)}`); }
    }
    return await screenshotDesktop({ format: 'png' });
  };
  try { await takeOsShotBuf(); } catch (_) { /* 预热失败不阻塞 */ }
  try {
    let ocr = null; let fullBuf = null;
    for (let attempt = 1; attempt <= 4 && !ocr; attempt++) {
      fullBuf = await takeOsShotBuf();
      ocr = await ocrFindTranslateItem(fullBuf, winfo.screenCssW, clickScreen);
      if (!ocr) { log(`[ocr-retry ${attempt}] 未见「翻译」项，${attempt < 4 ? '300ms 后连拍' : '放弃'}`); await sleep(300); }
    }
    if (ocr) {
      // OCR bbox 就是屏幕设备像素坐标——OS 鼠标直接用。
      // 2026-10-17：先点击、后上传取证——上传阻塞 ~1.5s 是菜单超时消失的风险窗口
      // （run#38897029574 mac 双架构：OCR 命中→上传 2 图→再点击，点击后 CJK 恒 62.9% 无翻译效果）。
      menuText = ocr.text || '';
      const targetZh = /chinese|中文|简体|译成|翻译成|to\s*chinese/i.test(menuText);
      const targetEn = /english|英文|to\s*english/i.test(menuText);
      log(`OCR 命中右键菜单「${menuText}」屏幕(${ocr.sx},${ocr.sy}) dpr=${ocr.dpr.toFixed(2)} 翻译方向=${targetZh ? '→中文' : targetEn ? '→英文' : '未知'}`);
      clicked = true;
      await osLeftClick(ocr.sx, ocr.sy);
      // 点击完菜单已消耗，此刻上传取证不再有菜单消失风险
      try {
        if (process.env.CLOUDINARY_URL && ocr.shotFiles && ocr.shotFiles.length) {
          const mod = require('cloudinary');
          const cl = (mod.default && mod.default.v2) || mod.v2 || mod.default;
          cl.config({ secure: true });
          const now = new Date();
          const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          for (const p of ocr.shotFiles) {
            const r = await cl.uploader.upload(p, { asset_folder: `e2eTest_${mm}`, resource_type: 'raw' });
            log(`[ocr-diag] 菜单现场截图已上传(点击后): ${r.url}`);
          }
        }
      } catch (_) {}
      // 判定：页面主语言是否翻转到目标语言（不再单向要求 CJK↑，兼容两种方向，修复 mac no-op 误判）
      //   targetZh：基线英文页 → 翻译后 CJK 占比应 >10%
      //   targetEn：基线中文页 → 翻译后 CJK 占比应 <10%（页面变英文）
      for (let i = 1; i <= 8 && !triggered; i++) {
        await sleep(2500);
        ratio = await ratioNow();
        if (targetZh && ratio > 0.1) triggered = true;
        else if (targetEn && ratio < 0.1) triggered = true;
        else if (!targetZh && !targetEn && ratio > 0.1) triggered = true;
        if (!triggered) log(`[translate-poll ${i}/8] 点击后 ${(i * 2.5).toFixed(1)}s CJK=${(ratio * 100).toFixed(1)}% 方向=${targetZh ? '→中文' : targetEn ? '→英文' : '?'}`);
      }
      if (!triggered) {
        const t = await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 200)).catch(() => '');
        log(`点击后页面采样: ${t.replace(/\s+/g, ' ').slice(0, 80)} CJK=${(ratio * 100).toFixed(1)}% 方向=${targetZh ? '→中文' : targetEn ? '→英文' : '?'}`);
        // 2026-10-17 诊断增强（mac 双轮 CJK 恒 63.1% 疑翻译引擎对繁体页 no-op）：
        // dump html lang / Chrome translate 状态 / body 前 80 字，供区分「点击无效」vs「引擎拒绝翻译」
        try {
          const diag = await page.evaluate(() => ({
            htmlLang: document.documentElement.lang || '',
            bodyLang: (document.body && document.body.lang) || '',
            translated: !!document.documentElement.dataset || /translated/i.test(document.documentElement.className || ''),
            gtWidget: !!document.querySelector('#google_translate_element, .goog-te-banner-frame, iframe.goog-te-banner-frame'),
            head: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 80),
          }));
          log(`[gt-diag] ${JSON.stringify(diag)}`);
        } catch (_) {}
      }
      // 点击后证据截图（无论成败）——runner 占位图在本步之前拍，真正现场只有这里有
      try {
        const { fullShot } = require('./include/shot');
        const ev = await fullShot('gtranslate-post-click');
        if (ev) log(`[evidence] 点击后全屏截图: ${ev}`);
      } catch (_) {}
    } else {
      log('OCR 未识别到「翻译」项（原生菜单未截到 / OCR 误判）——按用户要求不降级');
      // 2026-10-17：miss 时上传末帧全屏取证（此前取证只在命中后上传，miss 无现场可查——
      // run#38990702151 Ubuntu 词数=0 但无图，无法判断菜单没弹还是 OCR 误判）
      try {
        if (process.env.CLOUDINARY_URL && fullBuf && fullBuf.length) {
          const mod = require('cloudinary');
          const cl = (mod.default && mod.default.v2) || mod.v2 || mod.default;
          cl.config({ secure: true });
          const { shotDirFor } = require('./include/shot');
          const dir = path.join(process.cwd(), shotDirFor(PLATFORM));
          fs.mkdirSync(dir, { recursive: true });
          const missShot = path.join(dir, `rc-menu-miss-${Date.now()}.png`);
          fs.writeFileSync(missShot, fullBuf);
          const now = new Date();
          const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const r = await cl.uploader.upload(missShot, { asset_folder: `e2eTest_${mm}`, resource_type: 'raw' });
          log(`[ocr-diag] OCR miss 末帧现场已上传: ${r.url}`);
        }
      } catch (_) {}
    }
  } catch (e) { log(`OCR 右键菜单异常(不降级): ${e.message.slice(0, 80)}`); }

  try { await client.detach(); } catch (_) {}
  return { ok: triggered, ratio, clicked, menuText };
}

async function main() {
  const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [] };
  const push = (status, detail) => {
    out.results.push({ caseId: 'google_translate', id: 'google_translate', name: '右键Google翻译', type: 'client_google_translate', platform: PLATFORM, status, detail, criteria: '分身开启谷歌翻译加速，访问 tiktok support 后右键翻译，页面应被翻译（Windows→译中文 CJK↑ / macOS·Ubuntu→译英文 CJK↓）', ts: new Date().toISOString() });
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
      log(`基线页面 CJK 占比 ${(cjkRatio(baseText) * 100).toFixed(1)}%（${IS_ZH_UI ? '英文源页应接近 0' : '中文源页应 >40%，翻译后应 <10%'}）`);

      // G2 (2026-10-13)：用户要求「右键翻译只使用 OCR，不要降级」。
      // 仅真鼠标右键 → OCR 识别「翻译」项 → CDP 点击；命中即 pass，未命中即 fail（不回退 API/bubble/widget）。
      let rc = null;
      try { rc = await tryRightClickTranslate(page); } catch (e) { rc = { ok: false, err: e.message.slice(0, 60) }; }
      // 2026-10-17：点击命中但页面未翻译（run#38897029574 mac 双架构 CJK 恒 62.9%）——
      // 可能是首次点击落在菜单超时边缘。整轮重试一次：重新右键→OCR→点击（页面基线不变，方向判定重算）。
      if (rc && rc.clicked && !rc.ok) {
        log('首次点击未触发翻译——整轮重试一次（重新右键→OCR→点击）');
        await sleep(1500);
        const rc1 = rc; // 首轮证据兜底：重试轮若未命中菜单，失败文案仍报首轮的命中+点击
        try { rc = await tryRightClickTranslate(page); } catch (e) { rc = { ok: false, err: e.message.slice(0, 60) }; }
        if (!rc.clicked && rc1.clicked) { rc.clicked = rc1.clicked; rc.menuText = rc.menuText || rc1.menuText; rc.firstAttemptClicked = true; }
        if (rc && rc.ok) rc.retried = true;
      }
      if (rc && rc.ok) {
        push('pass', `右键菜单 OCR 命中「翻译」项并触发翻译生效（CJK 占比 ${(rc.ratio * 100).toFixed(1)}%，真鼠标右键→翻译项）`);
        fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
        log(`已写出 ${OUT}`);
        try { await pptr.disconnect(); } catch (_) {}
        process.exit(0);
      }
      // 仅 OCR：未命中即 fail，不回退 API 探测 / bubble / widget（那些是翻译加速代理证据，不等于右键翻译本身）
      if (rc && rc.clicked) {
        const dir = /chinese|中文|简体|译成|翻译成|to\s*chinese/i.test(rc.menuText || '') ? '→中文' : /english|英文|to\s*english/i.test(rc.menuText || '') ? '→英文' : '';
        push('fail', `OCR 命中右键菜单「${rc.menuText || '翻译'}」项并已点击，但页面未翻转到目标语言（点击后 CJK=${(rc.ratio * 100).toFixed(1)}%），翻译加速未生效（方向${dir}）`);
      } else {
        push('fail', `OCR 未命中/未触发右键翻译菜单「翻译」项（${rc && rc.err || '菜单未命中'}），按用户要求仅用 OCR 不降级`);
      }
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
      log(`已写出 ${OUT}`);
      try { await pptr.disconnect(); } catch (_) {}
      process.exit(1);

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

module.exports = { ocrFindTranslateItem, tryRightClickTranslate };

if (require.main === module) {
  main().catch((e) => {
    console.error('[gtranslate] 失败:', e && (e.stack || e.message));
    const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [
      { id: 'google_translate', name: '右键Google翻译', type: 'client_google_translate', platform: PLATFORM, status: 'error', detail: String(e && e.message), ts: new Date().toISOString() },
    ] };
    try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); } catch (_) {}
    process.exit(1);
  });
}
