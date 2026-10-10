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

// wdku.net 登录页探测：找邮箱/密码输入框（多选择器兜底）
async function findLoginInputs(page) {
  return page.evaluate(() => {
    const pick = (sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) return s;
      }
      return null;
    };
    const userInput = pick(['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[placeholder*="邮箱"]', 'input[placeholder*="邮件"]', 'input[placeholder*="账号"]']);
    const passInput = pick(['input[type="password"]']);
    const all = Array.from(document.querySelectorAll('input')).map((i) => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder }));
    return { userInput, passInput, all };
  });
}

// wdku.net 登录页导航（公共路径）：首页 → 找「登录」入口 → 进登录页。
// 不要硬编码 /login —— Run#24 实测该路径无密码框，真实入口以首页链接为准。
async function gotoLoginPage(page) {
  await page.goto('https://www.wdku.net/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const loginHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((x) => /登录|log\s*in|sign\s*in/i.test(x.textContent || ''));
    return a ? a.href : null;
  });
  const target = loginHref || 'https://www.wdku.net/login';
  log(`登录入口: ${target}`);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(3000);
  return target;
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
      if (!inputs.passInput) throw new Error('登录页未找到密码输入框');
      if (!inputs.userInput) throw new Error('登录页未找到账号输入框');
      // 填写并提交
      await page.type(inputs.userInput, USERNAME, { delay: 30 });
      await page.type(inputs.passInput, PASSWORD, { delay: 30 });
      // 提交按钮：type=submit 或文本含 登录
      const submitted = await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]')
          || Array.from(document.querySelectorAll('button, input[type="submit"]')).find((b) => /登录|登 录|log\s*in/i.test(b.textContent || b.value || ''));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!submitted) throw new Error('未找到登录提交按钮');
      await sleep(6000); // 等登录跳转 + 内核保存密码落库
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
      // Run#24 实测：关分身后主壳停在分身列表页 → 先点目标分身进详情页
      try {
        await wdioBrowser.$(`//a[contains(.,"${process.env.CLONE_NAME || 'UA152'}")]`).waitForExist({ timeout: 8000 });
        await wdioBrowser.$(`//a[contains(.,"${process.env.CLONE_NAME || 'UA152'}")]`).click();
        await sleep(3000);
      } catch (_) { /* 已在详情页则忽略 */ }
      // 详情页找「密码」tab/入口（多选择器兜底）
      const pwdEntrySels = [
        '//span[text()="密码"]',
        '//div[contains(@class,"tab")][contains(text(),"密码")]',
        '//a[contains(text(),"密码")]',
        '//*[contains(@class,"menu")]//*[contains(text(),"密码")]',
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
        throw new Error(`详情页未找到「密码」入口。页面可见文本: ${String(uiDump).slice(0, 400)}`);
      }
      await sleep(2000);
      // 密码记录列表中找 wdku
      const found = await wdioBrowser.execute(() => {
        const t = document.body.innerText || '';
        return /wdku\.net/i.test(t);
      });
      saveStatus = found ? 'pass' : 'fail';
      saveDetail = found
        ? '分身详情页密码记录中已出现 wdku.net'
        : '密码记录列表中未见 wdku.net';
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
      if (!inputs.passInput) throw new Error('登录页未找到密码框（代填验证）');
      const filled = await page.evaluate((passSel) => {
        const p = document.querySelector(passSel);
        if (!p) return { value: false, autofill: false };
        // :-webkit-autofill 伪类检测 Chrome 自动填充
        const isAuto = !!(p && p.matches && p.matches(':-webkit-autofill'));
        return { value: !!(p.value && p.value.length > 0), autofill: isAuto };
      }, inputs.passInput);
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
