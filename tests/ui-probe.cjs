/**
 * ui-probe.cjs —— 客户端主壳 UI 探测（不猜测，拿真实 DOM）
 * 用户要求 2026-10-10：先全部调试完再跑全量。
 *
 * 流程：登录 → 分身列表 → 进 UA152 详情页 →
 *   1) dump 详情页完整 outerHTML（上传 Cloudinary）
 *   2) 枚举左侧菜单/tab 全部文本节点（class+text）
 *   3) 逐个尝试「密码」入口候选：点击 → dump 结果页 DOM → 记录哪个候选有效
 *   4) dump「打开浏览器/正在访问」按钮区的完整 HTML（拿「关闭」按钮真实结构）
 * 产出：全部上传 Cloudinary（.txt，URL 打日志+::notice），本地也存一份。
 */
const fs = require('node:fs');
const path = require('node:path');
const { remote } = require('webdriverio');
const login = require('./include/login');
const { productConfig } = require('./config');

const CLONE = process.env.CLONE_NAME || 'UA152';
const log = (...a) => console.log('[ui-probe]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadTxt(content, tag) {
  const p = path.join(process.cwd(), `uiprobe-${tag}-${Date.now()}.txt`);
  fs.writeFileSync(p, content);
  try {
    if (!process.env.CLOUDINARY_URL) return p;
    const mod = require('cloudinary');
    const cloudinary = (mod.default && mod.default.v2) || mod.v2 || mod.default;
    cloudinary.config({ secure: true });
    const now = new Date();
    const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const r = await cloudinary.uploader.upload(p, {
      asset_folder: `e2eTest_${mm}`, use_filename: false, unique_filename: false, resource_type: 'raw',
    });
    console.log(`::notice title=UI探测-${tag}::${Buffer.from(r.url).toString('base64')}`);
    return r.url;
  } catch (e) {
    log(`上传失败(${tag}): ${e.message}`);
    return p;
  }
}

async function main() {
  const config = {
    ...productConfig,
    teamName: process.env.TEAM_NAME || productConfig.teamName,
    username: process.env.WDIO_USERNAME || productConfig.username,
  };
  const password = process.env.PRODUCT_WDIO_PASSWORD || 'password';

  const caps = {
    browserName: 'chrome',
    browserVersion: '108',
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

    // 进分身列表
    await browser.$('.icon-shouye_24').waitForExist({ timeout: 60 * 1000 });
    await browser.$('.icon-shouye_24').click();
    await browser.$('.icon-chrome_outline').waitForExist({ timeout: 60 * 1000 });
    await browser.$('.icon-chrome_outline').click();
    await sleep(3000);

    // 点 UA152 进详情页 —— 复用 e2e-verify 的「放大每页条数 + 翻页」逻辑
    //（UA152 在第 2 页；首探 run 实测直接 //a[contains(.,"UA152")] 90s 超时即此因）
    let entered = false;
    // 1) 放大每页条数（Ant Design size-changer）
    try {
      const sel = browser.$('.ant-pagination-options .ant-select');
      if (await sel.isExisting()) {
        await sel.click();
        await sleep(600);
        const opts = await browser.$$('.ant-select-item-option');
        let best = null, bestV = -1;
        for (const o of opts) {
          const m = (((await o.getText()) || '').trim()).match(/(\d+)/);
          if (m && Number(m[1]) > bestV) { bestV = Number(m[1]); best = o; }
        }
        if (best) { await best.click(); await sleep(2500); log(`分页每页条数 -> ${bestV}`); }
      }
    } catch (_) {}
    // 2) 尝试点分身
    try {
      await browser.$(`//a[contains(.,"${CLONE}")]`).waitForExist({ timeout: 8000 });
      entered = true;
    } catch (_) {
      // 3) 翻页找（最多 10 页）
      for (let i = 0; i < 10 && !entered; i++) {
        try {
          const moved = await browser.execute(() => {
            const cont = document.querySelector('.ant-pagination');
            if (!cont) return false;
            const next = cont.querySelector('.ant-pagination-next');
            if (next && !next.className.includes('ant-pagination-disabled')) {
              (next.querySelector('button') || next).click(); return true;
            }
            return false;
          });
          if (!moved) break;
          await sleep(2000);
          await browser.$(`//a[contains(.,"${CLONE}")]`).waitForExist({ timeout: 4000 });
          entered = true;
        } catch (_) { /* 下一页 */ }
      }
    }
    if (!entered) throw new Error(`列表中未找到分身 ${CLONE}（翻页后仍无）`);
    await browser.$(`//a[contains(.,"${CLONE}")]`).click();
    // 等详情页特征（打开浏览器按钮）
    await browser.$('//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]').waitForExist({ timeout: 30 * 1000 });
    await sleep(3000);
    log('已进入详情页');

    // ---- 1) 详情页完整 DOM ----
    const html = await browser.getPageSource();
    log(`详情页 DOM ${html.length} 字符`);
    await uploadTxt(html, 'detail-page');

    // ---- 2) 枚举菜单/tab 项（class+text，找「密码」类入口真实结构）----
    const menu = await browser.execute(() => {
      const out = [];
      document.querySelectorAll('*').forEach((el) => {
        if (el.children.length === 0) {
          const t = (el.textContent || '').trim();
          if (t && t.length <= 14 && /密码|凭据|账号|记录|保存|自动|填/i.test(t)) {
            out.push({ tag: el.tagName, class: el.className, text: t, parent: el.parentElement ? el.parentElement.className : '' });
          }
        }
      });
      return out;
    });
    log('密码相关候选节点:', JSON.stringify(menu, null, 1).slice(0, 1500));
    await uploadTxt(JSON.stringify(menu, null, 1), 'pwd-candidates');

    // ---- 3) 逐个尝试入口候选（点击后 dump）----
    const candidates = [
      '//span[text()="密码"]',
      '//*[contains(text(),"密码记录")]',
      '//*[contains(text(),"账号密码")]',
      '//div[contains(@class,"tab")]/*[contains(text(),"密码")]',
    ];
    let clicked = 0;
    for (const sel of candidates) {
      try {
        const el = browser.$(sel);
        await el.waitForExist({ timeout: 2500 });
        await el.click();
        await sleep(2500);
        const after = await browser.getPageSource();
        await uploadTxt(after, `after-click-${++clicked}`);
        log(`候选 ${sel} 点击成功，已 dump`);
        // 回到详情页（点分身名）
        try {
          await browser.$(`//a[contains(.,"${CLONE}")]`).click();
          await sleep(2000);
        } catch (_) {}
      } catch (_) { /* 该候选不存在，下一个 */ }
    }
    if (!clicked) log('所有「密码」入口候选都不存在——看 detail-page DOM 找真实入口');

    // ---- 4) 打开按钮区 HTML（拿「关闭」按钮真实结构）----
    const btnArea = await browser.execute(() => {
      const el = document.querySelector('.open-btn-text')?.closest('div[class*="btn"]')
        || document.querySelector('span[class*="open-btn"]')?.parentElement?.parentElement;
      return el ? el.outerHTML : '(未找到 open-btn 区域)';
    });
    await uploadTxt(String(btnArea), 'open-btn-area');
    log('探测完成');
    process.exit(0);
  } finally {
    try { await browser.deleteSession(); } catch (_) {}
  }
}

main().catch((e) => {
  console.error('[ui-probe] 失败:', e && (e.stack || e.message));
  process.exit(1);
});
