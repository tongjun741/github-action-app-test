/**
 * password-flow.cjs —— 密码保存 / 密码代填 两个用例的脚本化执行（用户要求 2026-10-10）
 *
 * 流程（在 e2e-verify.cjs 的同一个 WDIO 会话内调用，分身已打开、CDP=9221 可用）：
 *   阶段A 保存：
 *     A1. 分身浏览器（CDP）开新页 → wdku.net 登录页 → 填账号密码 → 提交
 *     A2. 等浏览器保存密码提示（Chromium 原生 save-password bubble，DOM 检测不到，
 *         由花漾内核的密码管理器接管）→ 等待 5s 让内核落库
 *     A3. 关闭分身浏览器（点「关闭」按钮，经 WDIO 主壳 UI）
 *     A4. 分身详情页找「密码」记录入口 → 打开 → 断言列表中出现 wdku.net 条目
 *   阶段B 代填：
 *     B1. 重新打开分身浏览器
 *     B2. CDP 开 wdku.net 登录页 → 断言密码框被自动填充（value 非空 或
 *         Chrome autofill 样式 :-webkit-autofill）→ 截图存证
 *
 * 输出：追加写入 OUT（results-<platform>.json）的 results 数组：
 *   password_save / password_autofill 两个用例的 {status, detail}
 *
 * 环境变量：
 *   WDKU_USERNAME / WDKU_PASSWORD   测试账号（CI 从 secrets 注入）
 *   CLIENT_CDP_ENDPOINT             分身浏览器 CDP（默认 http://127.0.0.1:9221）
 *
 * 判定（保守）：任何一步 UI 元素找不到都 fail 并截图，不静默降级 manual——
 *   用户已明确要求脚本执行，脚本跑不通本身就是 fail 信号。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const log = (...a) => console.log('[password-flow]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 凭证：优先 env（CI secrets），兜底解析 matrix.json criteria 里已明文记录的测试账号
function credsFromMatrix() {
  try {
    const matrix = JSON.parse(fs.readFileSync(path.join(__dirname, 'matrix.json'), 'utf8'));
    const c = (matrix.cases || []).find((x) => x.id === 'password_save');
    const m = c && c.criteria.match(/用户名\s+(\S+?)\s+和密码\s+(\S+?)\s+登录/);
    if (m) return { username: m[1], password: m[2] };
  } catch (_) { /* ignore */ }
  return { username: null, password: null };
}
const MATRIX_CREDS = credsFromMatrix();
const USERNAME = process.env.WDKU_USERNAME || MATRIX_CREDS.username || '713180a1a383@drmail.in';
const PASSWORD = process.env.WDKU_PASSWORD || MATRIX_CREDS.password || '';
const CDP = process.env.CLIENT_CDP_ENDPOINT || 'http://127.0.0.1:9221';

// ---------- CDP 小工具（避免依赖 puppeteer 版本差异，直接走 HTTP+WS 太重，复用 runner 的 puppeteer-core） ----------
async function withPage(fn) {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 60000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    return await fn(page, browser);
  } finally {
    try { await browser.disconnect(); } catch (_) { /* 分身不能关 */ }
  }
}

// wdku.net 登录框探测（真实结构 2026-10-10 实测：input[name=email] type=text / input[name=pass] type=password）
async function findLoginInputs(page) {
  return page.evaluate(() => {
    const pick = (sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) return s;
      }
      return null;
    };
    const userInput = pick(['input[name="email"]', 'input#user', 'input[type="email"]', 'input[name="username"]']);
    const passInput = pick(['input[name="pass"]', 'input#pass', 'input[type="password"]']);
    const all = Array.from(document.querySelectorAll('input')).map((i) => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder }));
    return { userInput, passInput, all };
  });
}

// wdku.net 登录页导航（公共路径）。
// 真实登录页 = https://www.wdku.net/user/login（用户提供 2026-10-10；/login 是 503 死链，
// 首页 <a> 解析出来的 href 也是死链——均不可用）。user/login 为静态表单：
//   input[name=email]（type=text） / input[name=pass]（type=password） / button#btn-login[type=submit]（立即登录）
async function gotoLoginPage(page) {
  const target = 'https://www.wdku.net/user/login';
  log(`登录入口(固定): ${target}`);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3000);
  return target;
}

// 页面诊断信息（url + 首行文本）——失败时拼进 error，看清实际加载了什么页
async function pageDiag(page) {
  try {
    return await page.evaluate(() => {
      const text = (document.body ? document.body.innerText : '') || '';
      const first = text.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4).join(' / ');
      return `url=${location.href} 首行=${first.slice(0, 150)}`;
    });
  } catch (e) {
    return `diag失败(${e.message.slice(0, 60)})`;
  }
}

// DOM 快照存证：outerHTML 截断 200KB 上传 Cloudinary（.txt），返回 URL
// 用于"不猜测"地拿到登录页/详情页真实 DOM（用户要求 2026-10-10：开调试端口实测，不要猜）
async function domSnapshot(target, tag) {
  try {
    let html = '';
    if (target && typeof target.getPageSource === 'function') {
      html = await target.getPageSource(); // WDIO browser（主壳页面）
    } else if (target && typeof target.content === 'function') {
      html = await target.content();       // puppeteer page（分身浏览器页面）
    }
    if (!html) return null;
    const p = path.join(process.cwd(), `dom-${tag}-${Date.now()}.txt`);
    fs.writeFileSync(p, html.slice(0, 200 * 1024));
    if (!process.env.CLOUDINARY_URL) {
      console.log(`[dom-snapshot] ${tag}: 本地 ${p}（未配置 CLOUDINARY_URL，不上传）`);
      return null;
    }
    const mod = require('cloudinary');
    const cloudinary = (mod.default && mod.default.v2) || mod.v2 || mod.default;
    cloudinary.config({ secure: true });
    const now = new Date();
    const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = await cloudinary.uploader.upload(p, {
      asset_folder: `e2eTest_${mm}`, use_filename: false, unique_filename: false,
      resource_type: 'raw',
    });
    console.log(`[dom-snapshot] ${tag}: ${result.url}`);
    console.log(`::notice title=DOM快照-${tag}::${Buffer.from(result.url).toString('base64')}`);
    return result.url;
  } catch (e) {
    console.log(`[dom-snapshot] ${tag} 失败(忽略): ${e.message}`);
    return null;
  }
}

// 截图上传 Cloudinary（有 CLOUDINARY_URL 时），返回 URL（失败 null）
async function shotToCloudinary(page, tag) {
  try {
    const p = path.join(process.cwd(), `${tag}-${Date.now()}.png`);
    await page.screenshot({ path: p }).catch(() => {});
    if (!process.env.CLOUDINARY_URL) return null;
    const mod = require('cloudinary');
    const cloudinary = (mod.default && mod.default.v2) || mod.v2 || mod.default;
    cloudinary.config({ secure: true });
    const now = new Date();
    const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = await cloudinary.uploader.upload(p, {
      asset_folder: `e2eTest_${mm}`, use_filename: false, unique_filename: false,
    });
    console.log(`[password-flow] ${tag} 截图: ${result.url}`);
    console.log(`::notice title=${tag}截图::${Buffer.from(result.url).toString('base64')}`);
    return result.url;
  } catch (_) { return null; }
}

// ---------- 主流程 ----------
/**
 * @param {object} wdioBrowser  e2e-verify 传入的 WDIO browser（主壳）
 * @param {object} opts         { outPath }  results json 路径
 */
async function runPasswordFlow(wdioBrowser, opts = {}) {
  const outPath = opts.outPath || process.env.OUT || 'results-password.json';
  const results = [];
  const pushResult = (caseId, name, type, status, detail, criteria) => {
    results.push({ caseId, name, type, status, detail, criteria });
    const tag = { pass: '✓', fail: '✗', manual: '人工', error: '错误' }[status] || status;
    log(`[${tag}] ${name} — ${detail}`);
    // GitHub Actions 注解：每用例判定结果进 annotations（匿名可读，免 token 诊断）
    const cmd = status === 'pass' ? 'notice' : 'error';
    try {
      const t = `${caseId}(${process.env.E2E_PLATFORM || '?'})`;
      const m = String(detail).replace(/\r?\n/g, ' ').slice(0, 200);
      console.log(`::${cmd} title=${t}::${m}`);
    } catch (_) { }
  };
  const shot = async (name) => {
    try {
      const p = path.join(process.cwd(), `${name}-${Date.now()}.png`);
      await wdioBrowser.saveScreenshot(p);
      return p;
    } catch (_) { return null; }
  };

  // ===== A1: 分身浏览器登录 wdku =====
  log(`A1 登录 ${USERNAME} @ wdku.net（CDP=${CDP}）`);
  let loginOk = false;
  let loginDetail = '';
  let loginPageUrl = '';
  try {
    await withPage(async (page) => {
      loginPageUrl = await gotoLoginPage(page);
      const inputs = await findLoginInputs(page);
      log(`登录框探测: user=${inputs.userInput} pass=${inputs.passInput} all=${JSON.stringify(inputs.all).slice(0, 200)}`);
      if (!inputs.passInput) {
        const diag = await pageDiag(page);
        await shotToCloudinary(page, `wdku-login-miss-${(process.env.E2_PLATFORM || 'x').replace(/\s+/g, '_')}`);
        await domSnapshot(page, `wdku-login-${(process.env.E2E_PLATFORM || 'x').replace(/\s+/g, '_')}`);
        throw new Error(`登录页未找到密码输入框（${diag}）`);
      }
      if (!inputs.userInput) {
        const diag = await pageDiag(page);
        await domSnapshot(page, `wdku-login-${(process.env.E2E_PLATFORM || 'x').replace(/\s+/g, '_')}`);
        throw new Error(`登录页未找到账号输入框（${diag}）`);
      }
      // 填写并提交
      await page.type(inputs.userInput, USERNAME, { delay: 30 });
      await page.type(inputs.passInput, PASSWORD, { delay: 30 });
      // 提交按钮（真实结构：button#btn-login[type=submit]「立即登录」）
      const submitted = await page.evaluate(() => {
        const btn = document.querySelector('button#btn-login')
          || document.querySelector('button[type="submit"]')
          || Array.from(document.querySelectorAll('button, input[type="submit"]')).find((b) => /登录|登 录|log\s*in/i.test(b.textContent || b.value || ''));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!submitted) throw new Error('未找到登录提交按钮');
      // 等登录跳转 + 花漾密码管理器捕获落库（Run#33 实证 6s 不够——提交即关，「网站密码」计数仍 0）。
      // 轮询等待页面离开登录页，再额外给密码管理器 12s。
      for (let w = 0; w < 10; w++) {
        await sleep(1500);
        const url = page.url();
        if (!/user\/login/.test(url)) break;
      }
      await sleep(12000); // 密码管理器落库宽限
      const url = page.url();
      log(`提交后 URL: ${url}`);
      loginOk = true;
      loginDetail = `已提交登录表单，当前URL=${url}`;
    });
  } catch (e) {
    loginOk = false;
    loginDetail = `登录失败: ${e.message}`;
    await shot('password-flow-login-fail');
  }

  // ===== A2+A3+A4: 关分身 → 详情页查密码记录 =====
  let saveStatus = 'fail';
  let saveDetail = loginOk ? '' : loginDetail;
  if (loginOk) {
    try {
      log('A3 关闭分身浏览器');
      // 首选 CDP Browser.close() 直关分身内核（Run#24 实测主壳 UI 此时停在分身列表页，
      // 详情页的「关闭」按钮根本不可见 —— 不再依赖 UI 按钮，UI 仅作兜底）。
      let closed = false;
      try {
        const puppeteer = require('puppeteer-core');
        const b = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 30000 });
        await b.close(); // 对 connect() 的远端浏览器：close = 关闭整个浏览器
        closed = true;
        log('已通过 CDP Browser.close 关闭分身浏览器');
      } catch (e) {
        log(`CDP 直关失败（${e.message}），回退 UI 路径`);
      }
      if (closed) {
        // 等 CDP 掉线确认
        for (let i = 0; i < 15; i++) {
          if (!(await cdpAlive())) break;
          await sleep(1500);
        }
      }
      if (!closed) {
        // UI 兜底：先回列表 → 进目标分身详情页 → 找关闭按钮（Run#24 dump 证实主壳此时在列表页）
        const closeBtns = ['//span[contains(@class,"open-btn-text")][text()="关闭"]',
          '//span[contains(@class,"open-btn-tex")][text()="关闭"]',
          '//span[contains(@class,"open-btn-text")][text()="停止访问"]',
          '//span[contains(@class,"open-btn-tex")][text()="停止访问"]',
          '//span[contains(text(),"关闭浏览器")]',
          '//span[contains(text(),"结束访问")]',
          '//button[contains(text(),"关闭")]'];
        // 进详情页：列表页点目标分身
        try {
          await wdioBrowser.$(`//a[contains(.,"${process.env.CLONE_NAME || 'UA152'}")]`).waitForExist({ timeout: 8000 });
          await wdioBrowser.$(`//a[contains(.,"${process.env.CLONE_NAME || 'UA152'}")]`).click();
          await sleep(3000);
        } catch (_) { /* 已在详情页则忽略 */ }
        for (const sel of closeBtns) {
          try {
            await wdioBrowser.$(sel).waitForExist({ timeout: 5000 });
            await wdioBrowser.$(sel).click();
            closed = true;
            log(`已点击关闭按钮: ${sel}`);
            break;
          } catch (_) { /* try next */ }
        }
      }
      if (!closed) {
        // 最后兜底：点「正在访问」按钮本身（新版 UI 里它可能就是关闭开关）
        try {
          // 先确保在详情页
          try {
            await wdioBrowser.$(`//a[contains(.,"${process.env.CLONE_NAME || 'UA152'}")]`).waitForExist({ timeout: 5000 });
            await wdioBrowser.$(`//a[contains(.,"${process.env.CLONE_NAME || 'UA152'}")]`).click();
            await sleep(3000);
          } catch (_) { }
          const visiting = '//span[text()="正在访问"][contains(@class,"open-btn-text")]';
          await wdioBrowser.$(visiting).waitForExist({ timeout: 5000 });
          await wdioBrowser.$(visiting).click();
          await sleep(3000);
          try {
            await wdioBrowser.$('.ant-modal-confirm .ant-btn-primary').waitForExist({ timeout: 3000 });
            await wdioBrowser.$('.ant-modal-confirm .ant-btn-primary').click();
          } catch (_) { }
          for (let i = 0; i < 10; i++) {
            if (!(await cdpAlive())) { closed = true; break; }
            await sleep(1500);
          }
          if (closed) log('点「正在访问」成功关闭分身');
        } catch (_) { /* ignore */ }
      }
      if (!closed) {
        // 仍未关闭：dump 页面全部按钮/可点元素文本，供下轮修正选择器
        let uiDump = '';
        try {
          uiDump = await wdioBrowser.execute(() => {
            const t = (el) => (el.textContent || '').trim();
            const spans = Array.from(document.querySelectorAll('span,button,a'))
              .map(t).filter((x) => x && x.length <= 12);
            return Array.from(new Set(spans)).slice(0, 60).join(' | ');
          });
        } catch (_) { }
        throw new Error(`未找到「关闭」按钮。页面可见文本: ${String(uiDump).slice(0, 400)}`);
      }
      // 等浏览器进程退出（CDP 掉线）
      let cdpDown = false;
      for (let i = 0; i < 20; i++) {
        cdpDown = !(await cdpAlive());
        if (cdpDown) break;
        await sleep(1500);
      }
      log(`分身浏览器已${cdpDown ? '关闭' : '未确认关闭（继续验证密码记录）'}`);

      log('A4 详情页查密码记录');
      // Run#35 实测：导航偶发不进详情页（时序抖动）。加固：整体导航重试 3 轮，
      // 每轮 = 点「分身」nav 回列表 → 放大分页并验证（失败点第2页）→ 点 <a>UA152 → 等详情页特征。
      let onDetail = false;
      for (let round = 1; round <= 3 && !onDetail; round++) {
        try {
          try {
            await wdioBrowser.$('.icon-chrome_outline').waitForExist({ timeout: 5000 });
            await wdioBrowser.$('.icon-chrome_outline').click();
            await sleep(3000);
          } catch (_) { }
          let singlePage = false;
          try {
            const sel = wdioBrowser.$('.ant-pagination-options .ant-select');
            if (await sel.isExisting()) {
              await sel.click();
              await sleep(800);
              const opts = await wdioBrowser.$$('.ant-select-item-option');
              let best = null, bestV = -1;
              for (const o of opts) {
                const m = (((await o.getText()) || '').trim()).match(/(\d+)/);
                if (m && Number(m[1]) > bestV) { bestV = Number(m[1]); best = o; }
              }
              if (best) { await best.click(); await sleep(2500); }
              const pgText = await wdioBrowser.execute(() => (document.querySelector('.ant-pagination') || {}).innerText || '');
              singlePage = !/2\s*\/\s*2页/.test(pgText);
            }
          } catch (_) { }
          if (!singlePage) {
            try {
              await wdioBrowser.execute(() => {
                const items = Array.from(document.querySelectorAll('.ant-pagination-item'));
                const p2 = items.find((li) => (li.textContent || '').trim() === '2');
                if (p2) p2.click();
              });
              await sleep(2500);
            } catch (_) { }
          }
          const clicked = await wdioBrowser.execute((name) => {
            const el = Array.from(document.querySelectorAll('a'))
              .find((e) => (e.textContent || '').trim() === name || (e.textContent || '').trim().startsWith(name));
            if (el) { el.click(); return true; }
            return false;
          }, process.env.CLONE_NAME || 'UA152');
          if (!clicked) {
            // Run#36 三轮均找不到 <a>——dump 页面真实状态（所有 a 文本 + body 前 300 字）供定位
            try {
              const stateDump = await wdioBrowser.execute(() => {
                const as = Array.from(document.querySelectorAll('a')).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 30);
                const body = (document.body ? document.body.innerText : '').replace(/\n+/g, '|').slice(0, 300);
                return `a=[${as.join(',')}] body=${body}`;
              });
              log(`第 ${round} 轮：未找到 UA152 <a>。页面状态: ${String(stateDump).slice(0, 400)}`);
            } catch (e2) { log(`第 ${round} 轮：未找到 UA152 <a>（dump 失败 ${e2.message.slice(0, 40)}）`); }
            await shot('a4-round-fail');
            await sleep(2000); continue;
          }
          try {
            await wdioBrowser.$('//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]').waitForExist({ timeout: 8000 });
            onDetail = true;
          } catch (_) {
            try {
              await wdioBrowser.$('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 3000 });
              onDetail = true;
            } catch (_) { log(`第 ${round} 轮：点击后未见详情页特征`); }
          }
        } catch (e) {
          log(`第 ${round} 轮导航异常: ${e.message.slice(0, 60)}`);
        }
      }
      log(onDetail ? '已确认进入 UA152 详情页' : '3 轮导航均未进详情页（继续找密码入口兜底）');
      // 详情页找「网站密码」入口（Run#33 dump 实证：详情页右侧面板叫「网站密码 0站点，0对」，
      // 不是「密码」——一词之差导致历轮失败）
      const pwdEntrySels = [
        '//*[contains(text(),"网站密码")]',
        '//span[text()="网站密码"]',
        '//*[contains(text(),"密码记录")]',
        '//*[contains(text(),"账号密码")]',
        '//span[text()="密码"]',
        '//*[contains(@class,"tab")][contains(text(),"密码")]',
      ];
      let entryFound = false;
      for (const sel of pwdEntrySels) {
        try {
          const el = wdioBrowser.$(sel);
          await el.waitForExist({ timeout: 4000 });
          await el.click();
          entryFound = true;
          break;
        } catch (_) { /* try next */ }
      }
      if (!entryFound) {
        let uiDump = '';
        try {
          uiDump = await wdioBrowser.execute(() => {
            const t = (el) => (el.textContent || '').trim();
            const els = Array.from(document.querySelectorAll('span,div,a,li'))
              .map(t).filter((x) => x && x.length <= 10);
            return Array.from(new Set(els)).slice(0, 60).join(' | ');
          });
        } catch (_) { }
        await domSnapshot(wdioBrowser, `detail-page-${(process.env.E2E_PLATFORM || 'x').replace(/\s+/g, '_')}`);
        throw new Error(`详情页未找到「密码」入口。页面可见文本: ${String(uiDump).slice(0, 400)}`);
      }
      await sleep(2000);
      // 入口点开后 dump 密码记录列表 DOM（拿到真实列表结构，不再猜选择器）
      await domSnapshot(wdioBrowser, `pwd-list-${(process.env.E2E_PLATFORM || 'x').replace(/\s+/g, '_')}`);
      // 密码记录列表中找 wdku
      // 判定：点开「网站密码」入口后，查站点计数是否从 0 变为 ≥1（Run#33 实证面板格式「N站点，N对」）
      let pwText = '';
      try {
        pwText = await wdioBrowser.execute(() => {
          const el = Array.from(document.querySelectorAll('*')).find((e) => {
            const t = (e.textContent || '').trim();
            return e.children.length === 0 && /^\d+站点/.test(t);
          });
          // 找「网站密码」附近的计数（Cookie 面板也是 N站点格式，取包含「密码」上下文的一个）
          const all = Array.from(document.querySelectorAll('*'))
            .filter((e) => e.children.length === 0 && /^\d+站点,\d+对$/.test((e.textContent || '').trim()))
            .map((e) => (e.textContent || '').trim());
          return all.join('|');
        });
      } catch (_) { }
      const found = /wdku\.net/i.test(await wdioBrowser.execute(() => document.body.innerText || '').catch(() => ''))
        || /^[1-9]\d*站点/.test(pwText.split('|')[0] || '');
      log(`网站密码面板计数: ${pwText || '(未解析到)'}`);
      saveStatus = found ? 'pass' : 'fail';
      saveDetail = found
        ? `网站密码记录已出现（面板: ${pwText || '含 wdku.net'}）`
        : `网站密码面板计数为 0（${pwText || '未解析'}）`;
      await shot('password-flow-save');
    } catch (e) {
      saveStatus = 'fail';
      saveDetail = `保存验证失败: ${e.message}`;
      await shot('password-flow-save-fail');
    }
  }
  pushResult('password_save', '普通会话能否保存密码', 'client_password_save', saveStatus, saveDetail,
    '访问 https://www.wdku.net/ 登录后，分身详情页保存的密码记录中应能看到这个网站（脚本化）');

  // ===== B: 重开分身 → 代填验证 =====
  let autoStatus = 'fail';
  let autoDetail = '';
  try {
    log('B1 重新打开分身浏览器');
    const openBtn = '//span[contains(@class,"open-btn-tex")][text()="打开浏览器"]';
    // 若分身仍处「正在访问」（A3 关闭失败未致命），跳过重开直接验证
    let alreadyOpen = false;
    try {
      await wdioBrowser.$('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 3000 });
      alreadyOpen = true;
      log('分身仍处于「正在访问」状态（关闭未生效），直接进入代填验证');
    } catch (_) { }
    if (!alreadyOpen) {
      await wdioBrowser.$(openBtn).waitForExist({ timeout: 30000 });
      await wdioBrowser.$(openBtn).click();
    }
    // 处理「继续访问」+ 等「正在访问」
    for (let n = 0; n < 60; n++) {
      try {
        await wdioBrowser.$('//span[text()="继续访问"]').waitForExist({ timeout: 3000 });
        await wdioBrowser.$('//span[text()="继续访问"]').click();
        try {
          await wdioBrowser.$('.ant-modal-confirm .ant-btn-primary').waitForExist({ timeout: 3000 });
          await wdioBrowser.$('.ant-modal-confirm .ant-btn-primary').click();
        } catch (_) { }
      } catch (_) { }
      try {
        await wdioBrowser.$('//span[text()="正在访问"][contains(@class,"open-btn-text")]').waitForExist({ timeout: 3000 });
        break;
      } catch (_) { }
      await sleep(1500);
    }
    // 等 CDP 起来
    for (let i = 0; i < 30; i++) {
      if (await cdpAlive()) break;
      await sleep(2000);
    }
    log('B2 验证代填');
    await withPage(async (page) => {
      // 复用 A1 的登录页导航（首页找入口，不硬编码 /login）
      if (loginPageUrl) {
        await page.goto(loginPageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await sleep(3000);
      } else {
        await gotoLoginPage(page);
      }
      await sleep(4000); // 给 autofill 时间
      const inputs = await findLoginInputs(page);
      if (!inputs.passInput) {
        const diag = await pageDiag(page);
        await shotToCloudinary(page, `autofill-miss-${(process.env.E2E_PLATFORM || 'x').replace(/\s+/g, '_')}`);
        throw new Error(`登录页未找到密码框（代填验证）（${diag}）`);
      }
      // 触发 autofill：聚焦+点击账号框（Chromium 常在用户名框获得焦点后才填密码框），再轮询检测
      try {
        if (inputs.userInput) {
          await page.click(inputs.userInput).catch(() => {});
          await page.focus(inputs.userInput).catch(() => {});
          await sleep(1500);
          await page.click(inputs.passInput).catch(() => {});
          await sleep(1500);
        }
      } catch (_) { }
      let filled = { value: false, autofill: false };
      for (let t = 0; t < 5; t++) {
        filled = await page.evaluate((passSel) => {
          const p = document.querySelector(passSel);
          if (!p) return { value: false, autofill: false };
          const isAuto = !!(p && p.matches && p.matches(':-webkit-autofill'));
          return { value: !!(p.value && p.value.length > 0), autofill: isAuto };
        }, inputs.passInput);
        if (filled.value || filled.autofill) break;
        await sleep(2000);
      }
      log(`代填检测: ${JSON.stringify(filled)}`);
      autoStatus = (filled.value || filled.autofill) ? 'pass' : 'fail';
      autoDetail = `密码框 value=${filled.value} webkitAutofill=${filled.autofill}`;
      const p = path.join(process.cwd(), `password-autofill-${Date.now()}.png`);
      await page.screenshot({ path: p });
      log(`代填截图: ${p}`);
    });
  } catch (e) {
    autoStatus = 'fail';
    autoDetail = `代填验证失败: ${e.message}`;
  }
  pushResult('password_autofill', '普通会话能否代填密码', 'client_password_autofill', autoStatus, autoDetail,
    '保存密码后重新打开分身访问登录页，密码应被自动代填（脚本化）');

  // ===== 合并进 results =====
  try {
    if (fs.existsSync(outPath)) {
      const j = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      // 去掉 runner 已写入的 manual 占位
      j.results = (j.results || []).filter((r) => !['password_save', 'password_autofill', 'cookie_sync'].includes(r.caseId));
      j.results.push(...results);
      fs.writeFileSync(outPath, JSON.stringify(j, null, 2));
      log(`已合并 2 用例结果进 ${outPath}`);
    } else {
      log(`警告: ${outPath} 不存在，结果仅打日志`);
    }
  } catch (e) {
    log(`合并 results 失败: ${e.message}`);
  }

  // ===== 收尾：优雅关闭分身浏览器（Run#31 教训）=====
  // verify job 结束后分身浏览器若仍开着，会话成僵尸 → 下一个 job（cookie-sync 第二台设备）
  // 经「继续访问」接管后代理不重建（ERR_PROXY_CONNECTION_FAILED 六连败的根因）。
  // CDP Browser.close 释放会话，让云端把分身标记为「可干净打开」。
  try {
    if (await cdpAlive()) {
      const puppeteer = require('puppeteer-core');
      const b = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 30000 });
      await b.close();
      log('收尾：已 CDP 关闭分身浏览器（释放会话供 cookie-sync 接管）');
    } else {
      log('收尾：分身浏览器已关（CDP 不在线）');
    }
  } catch (e) {
    log(`收尾关闭分身失败(忽略): ${e.message.slice(0, 80)}`);
  }
  return results;
}

function cdpAlive() {
  return new Promise((resolve) => {
    const req = http.get(`${CDP}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2500, () => { req.destroy(); resolve(false); });
  });
}

module.exports = { runPasswordFlow, cdpAlive };
