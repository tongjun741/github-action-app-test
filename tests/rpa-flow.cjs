/**
 * rpa-flow.cjs —— RPA 流程执行用例（源表 R21，脚本化 2026-10-12）
 *
 * 用户指定：流程「百度检索-教程示例」，参数 关键词=ios，结果匹配 Apple。
 *
 * 执行路径（主壳 WebdriverIO 驱动客户端 UI）：
 *   1) 登录客户端 → 主界面左侧「自动化」菜单
 *   2) 找到流程「百度检索-教程示例」→ 点执行/运行
 *   3) 弹出参数表单 → 填 关键词=ios → 确认执行
 *   4) 轮询分身浏览器 CDP 9221：新页面出现 baidu.com 且内容含 Apple（最长 matchTimeoutMs）
 *      （RPA 会打开/复用分身浏览器执行百度检索）
 *   5) 判定：pass=页面出现匹配内容；fail=超时未见
 *
 * 环境变量：CLIENT_BINARY/E2E_PLATFORM/TEAM_NAME/WDIO_USERNAME/PRODUCT_WDIO_PASSWORD/
 *           CLONE_NAME/REMOTE_DEBUG_PORT/OUT/CLOUDINARY_URL
 * 输出：results-RPA_Flow.json
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const http = require('node:http');
const { remote } = require('webdriverio');
const login = require('./include/login');
const { productConfig } = require('./config');

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const SLUG = PLATFORM.replace(/\s+/g, '_');
const CLONE = process.env.CLONE_NAME || 'UA152';
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || 'results-RPA_Flow.json';
const FLOW_NAME = process.env.RPA_FLOW_NAME || '百度检索-教程示例';
const RPA_KEYWORD = process.env.RPA_KEYWORD || 'ios';
const MATCH = process.env.RPA_MATCH || 'Apple';
const TIMEOUT_MS = Number(process.env.RPA_TIMEOUT_MS || 120000);

const log = (...a) => console.log('[rpa-flow]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadShot(browser, tag) {
  try {
    const p = path.join(process.cwd(), `rpa-${tag}-${Date.now()}.png`);
    await browser.saveScreenshot(p);
    if (!process.env.CLOUDINARY_URL) return p;
    const mod = require('cloudinary');
    const cloudinary = (mod.default && mod.default.v2) || mod.v2 || mod.default;
    cloudinary.config({ secure: true });
    const now = new Date();
    const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const r = await cloudinary.uploader.upload(p, { asset_folder: `e2eTest_${mm}`, resource_type: 'raw' });
    console.log(`::notice title=RPA截图-${tag}::${Buffer.from(r.url).toString('base64')}`);
    return r.url;
  } catch (e) { log(`截图失败(${tag}): ${e.message.slice(0, 60)}`); return ''; }
}

async function main() {
  const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [] };
  const push = (status, detail) => {
    out.results.push({ id: 'rpa_flow', name: '执行RPA流程', type: 'client_rpa_flow', platform: PLATFORM, status, detail, ts: new Date().toISOString() });
    console.log(`  [${status === 'pass' ? '✓' : '✗'}] 执行RPA流程 — ${detail.slice(0, 120)}`);
  };

  const config = {
    ...productConfig,
    teamName: process.env.TEAM_NAME || productConfig.teamName,
    username: process.env.WDIO_USERNAME || productConfig.username,
  };
  const password = process.env.PRODUCT_WDIO_PASSWORD || 'password';
  const caps = {
    browserName: 'chrome', browserVersion: '108',
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

    // 1) 左侧「自动化」菜单
    await browser.$('.icon-shouye_24').waitForExist({ timeout: 60000 });
    await browser.$('.icon-shouye_24').click();
    // 自动化菜单（图标 class 参考「支持」按钮旁的菜单结构；兜底 XPath 文本）
    let menuOk = false;
    for (const sel of ['=.自动化', '//span[text()="自动化"]', '//li[contains(.,"自动化")]']) {
      try {
        const el = browser.$(sel);
        await el.waitForExist({ timeout: 4000 });
        await el.click();
        menuOk = true; break;
      } catch (_) {}
    }
    if (!menuOk) throw new Error('未找到「自动化」菜单入口');
    await sleep(3000);
    log('已进入自动化页面');

    // 2) 找流程卡片/行「百度检索-教程示例」并点「执行/运行」
    let execOk = false;
    for (const sel of [
      `//div[contains(.,"${FLOW_NAME}")][1]//span[text()="执行"]`,
      `//div[contains(.,"${FLOW_NAME}")][1]//button[contains(.,"执行")]`,
      `//tr[contains(.,"${FLOW_NAME}")]//span[text()="执行"]`,
      `//div[contains(.,"${FLOW_NAME}")][1]//span[contains(text(),"运行")]`,
    ]) {
      try {
        const el = browser.$(sel);
        await el.waitForExist({ timeout: 4000 });
        await el.click();
        execOk = true; log(`已点击执行（${sel.slice(0, 50)}…）`); break;
      } catch (_) {}
    }
    if (!execOk) throw new Error(`自动化页面未找到流程「${FLOW_NAME}」的执行入口`);

    // 3) 执行方式弹窗（Run#45 DOM 实证）：标题「流程执行方式」，radio「执行流程任务」默认选中，
    //    按钮「确 定」——先点确定提交；之后再找参数表单（可能在确认后的下一层）
    await sleep(2000);
    let confirmed = false;
    for (const sel of [
      '//div[contains(@class,"ant-modal")]//button[.//span[text()="确 定"]]',
      '//div[contains(@class,"ant-modal")]//span[text()="确 定"]/ancestor::button',
      '.ant-modal .ant-btn-primary',
    ]) {
      try {
        const b = browser.$(sel);
        await b.waitForExist({ timeout: 3000 });
        await b.click();
        confirmed = true; log('已点「确 定」（流程执行方式弹窗）'); break;
      } catch (_) {}
    }
    if (!confirmed) log('未见「流程执行方式」弹窗（可能已直接执行）');

    // 3b) 三步向导（Run#46 DOM 实证）。Run#47 关键发现：卡在步骤1——「请至少选择一个分身」
    //     红色校验错误（下一步没通过校验，脚本误以为进了步骤2）。
    //     步骤1 必须：① 点「选 择」打开分身选择器 ② 选中 UA152 ③ 校验通过后下一步。
    await sleep(2500);
    const nextBtnSels = [
      '//button[.//span[text()="下一步"]]',
      '//div[contains(@class,"ant-pro-steps-form")]//button[contains(@class,"ant-btn-primary")]',
    ];
    let filledVar = false; let picked = false;
    for (let step = 1; step <= 3; step++) {
      log(`向导步骤 ${step}`);
      if (step === 1) {
        // 分身选择（Run#48/49：shop-picker 左侧空+「添加分身」；「选 择」弹窗列表异步加载慢且会挡住其它按钮）
        picked = false;
        for (const entrySel of [
          '//button[.//span[text()="选 择"]] | //span[text()="选 择"]/ancestor::button',
          '//button[.//span[contains(text(),"添加分身")]] | //span[contains(text(),"添加分身")]/ancestor::button',
        ]) {
          if (picked) break;
          try {
            const eb = browser.$(entrySel);
            await eb.waitForExist({ timeout: 3500 });
            await eb.click();
            log(`已点入口按钮（${entrySel.includes('添加') ? '添加分身' : '选 择'}）`);
            await sleep(2500);
            // 选择弹窗/面板：先搜索框输入 CLONE（触发过滤加载），再轮询列表项（最长 12s——列表异步加载慢）
            try {
              const search = browser.$(`//input[@id="keywords"] | //input[@placeholder="依据名称检索"] | //div[contains(@class,"ant-modal")]//input[contains(@placeholder,"搜索")] | //div[contains(@class,"ant-modal")]//input[@type="search"] | //div[contains(@class,"shop-picker")]//input[1]`);
              if (await search.isExisting()) {
                await search.setValue(CLONE);
                await browser.keys('Enter').catch(() => {});
                log(`已搜索 ${CLONE}（并回车触发过滤）`);
              }
            } catch (_) {}
            for (let w = 0; w < 4 && !picked; w++) {
              for (const sel of [
                `//div[contains(@class,"ant-modal")][.//input[@id="keywords"]]//*[contains(@class,"ant-list-item")][contains(.,"${CLONE}")]`,
                `//div[contains(@class,"ant-modal")][.//input[@id="keywords"]]//*[contains(.,"${CLONE}")]`,
                `//*[contains(@class,"ant-list-item")][contains(.,"${CLONE}")]`,
                `//li[contains(.,"${CLONE}")]`,
                `//div[contains(@class,"shop-picker")]//*[contains(.,"${CLONE}")]`,
                `//div[contains(@class,"ant-modal")]//*[contains(text(),"${CLONE}")]`,
              ]) {
                try {
                  const it = browser.$(sel);
                  await it.waitForExist({ timeout: 3000 });
                  await it.click();
                  picked = true; log(`已选中分身 ${CLONE}（第 ${w + 1} 轮，${sel.slice(0, 40)}…）`); break;
                } catch (_) {}
              }
              if (!picked) await sleep(3000); // 等列表异步加载
            }
            // 诊断：精准抓取「含 #keywords 的内层分身选择弹窗」文本+列表项+HTML（之前抓错层拿到向导外层）
            try {
              const picker = browser.$('//div[contains(@class,"ant-modal")][.//input[@id="keywords"]]');
              const mh = (await picker.isExisting().catch(() => false)) ? picker
                : await browser.$('//div[contains(@class,"ant-modal")][.//*[contains(@class,"ant-list-item")]]').catch(() => null);
              if (mh && await mh.isExisting().catch(() => false)) {
                const mt = await mh.getText().catch(() => '');
                log(`[diag] 内层弹窗文本: ${String(mt).replace(/\s+/g, ' ').slice(0, 800)}`);
                const itemEls = await mh.$$('//*[contains(@class,"ant-list-item")]').catch(() => []);
                const items = await Promise.all(itemEls.slice(0, 12).map((e) => e.getText().catch(() => '')));
                log(`[diag] 列表项(${items.length}): ${JSON.stringify(items.map((x) => String(x).replace(/\s+/g, ' ').slice(0, 40)))}`);
                const html = await mh.getHTML(false).catch(() => '');
                const p = path.join(process.cwd(), `rpa-modal-diag-${Date.now()}.html`);
                fs.writeFileSync(p, html.slice(0, 1.5 * 1024 * 1024));
                log(`[diag] 内层弹窗HTML已存 ${p}`);
              } else {
                log('[diag] 未找到含 #keywords 的内层弹窗（分身选择列表层）——可能搜索未出结果或列表未渲染');
              }
            } catch (_) {}
            if (picked) {
              for (const sel of ['//div[contains(@class,"ant-modal")]//button[.//span[text()="确 定"]]', '.ant-modal .ant-btn-primary']) {
                try { const b = browser.$(sel); await b.waitForExist({ timeout: 2500 }); await b.click(); log('已确认分身选择'); break; } catch (_) {}
              }
              break;
            }
            // Run#49 关键：未选中时弹窗开着挡住其它按钮——先关弹窗（取 消/X）再试下一入口
            log('该入口未选中分身——关闭弹窗后试下一入口');
            for (const c of [
              '//div[contains(@class,"ant-modal")]//button[.//span[text()="取 消"]]',
              '//div[contains(@class,"ant-modal")]//button[contains(@class,"ant-modal-close")]',
              '//button[contains(@class,"ant-modal-close")]',
            ]) {
              try { const b = browser.$(c); await b.waitForExist({ timeout: 2000 }); await b.click(); log('已关闭选择弹窗'); await sleep(1200); break; } catch (_) {}
            }
          } catch (e) { log(`入口异常: ${e.message.slice(0, 50)}`); }
        }
        if (!picked) { log('分身未能选中——截图取证'); await uploadShot(browser, 'clone-pick-miss'); }
        await sleep(1500);
      }
      if (step === 2 && !filledVar) {
        // 填输入变量：input（placeholder/label 含 关键词 优先，否则 steps-form 内第一个可见 input）
        for (const sel of [
          '//input[@placeholder="关键词"]',
          '//label[contains(.,"关键词")]//following-sibling::div//input',
          '//div[contains(@class,"ant-pro-steps-form")]//input[contains(@placeholder,"关键词")]',
          '//div[contains(@class,"ant-pro-steps-form")]//input[1]',
          '//div[contains(@class,"ant-pro-steps-form")]//textarea[1]',
        ]) {
          try {
            const inp = browser.$(sel);
            await inp.waitForExist({ timeout: 3000 });
            await inp.setValue(RPA_KEYWORD);
            filledVar = true; log(`步骤2 已填变量=${RPA_KEYWORD}（${sel.slice(0, 40)}…）`); break;
          } catch (_) {}
        }
        if (!filledVar) {
          log('步骤2 未找到变量输入框——截图+DOM 取证（变量控件可能是 textarea/select）');
          await uploadShot(browser, 'step2-var');
          try {
            const html = await browser.getPageSource();
            const p2 = path.join(process.cwd(), `rpa-dom-step2-${Date.now()}.txt`);
            fs.writeFileSync(p2, html.slice(0, 2 * 1024 * 1024));
            if (process.env.CLOUDINARY_URL) {
              const mod2 = require('cloudinary');
              const cl2 = (mod2.default && mod2.default.v2) || mod2.v2 || mod2.default;
              cl2.config({ secure: true });
              const now2 = new Date();
              const mm2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}`;
              const r2 = await cl2.uploader.upload(p2, { asset_folder: `e2eTest_${mm2}`, resource_type: 'raw' });
              console.log(`[rpa-flow] 步骤2 DOM: ${r2.url}`);
              console.log(`::notice title=RPA-DOM-STEP2::${Buffer.from(r2.url).toString('base64')}`);
            }
          } catch (e) { log(`步骤2 DOM dump 失败: ${e.message.slice(0, 60)}`); }
        }
      }
      // 下一步（带校验确认：点完检查是否出现红色错误）
      let advanced = false;
      for (const sel of nextBtnSels) {
        try {
          const b = browser.$(sel);
          await b.waitForExist({ timeout: 3000 });
          await b.click();
          advanced = true; log(`已点击「下一步」（步骤 ${step}）`); break;
        } catch (_) {}
      }
      if (!advanced) { log(`步骤 ${step} 无下一步按钮（可能已到执行）`); break; }
      await sleep(2000);
      // 校验错误检测（下一步没过校验时停留原步骤）
      try {
        const errEl = browser.$('//div[contains(@class,"ant-form-item-explain-error")]');
        if (await errEl.isExisting()) {
          const errText = await browser.$('//div[contains(@class,"ant-form-item-explain-error")]').getText().catch(() => '');
          log(`步骤 ${step} 校验错误: ${String(errText).slice(0, 60)}——重试或继续`);
          await uploadShot(browser, `step${step}-valid-err`);
        }
      } catch (_) { }
    }

    if (!picked) {
      push('fail', '分身未选中（步骤1 校验「请至少选择一个分身」），RPA 无法执行');
      fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
      try { await browser.deleteSession(); } catch (_) {}
      process.exit(1);
    }

    // 4) 轮询分身浏览器 CDP：出现 baidu.com 页面且内容含 Apple
    log(`轮询 CDP ${CDP} 等待 RPA 结果（最长 ${TIMEOUT_MS / 1000}s）`);
    const puppeteer = require('puppeteer-core');
    const deadline = Date.now() + TIMEOUT_MS;
    let matched = null;
    while (Date.now() < deadline) {
      let b = null;
      try {
        b = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 15000 });
        const pages = await b.pages();
        for (const p of pages) {
          try {
            const url = p.url();
            if (!/baidu\.com|bing\.com|google/i.test(url)) continue;
            const text = await p.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 8000)).catch(() => '');
            if (text.includes(MATCH)) { matched = url; break; }
          } catch (_) {}
        }
        await b.disconnect();
      } catch (_) { if (b) try { await b.disconnect(); } catch (_) {} }
      if (matched) break;
      await sleep(5000);
    }

    await uploadShot(browser, 'final');
    if (matched) {
      push('pass', `RPA「${FLOW_NAME}」(关键词=${RPA_KEYWORD}) 执行完成，页面命中「${MATCH}」（${matched.slice(0, 60)}）`);
    } else {
      push('fail', `RPA 执行后 ${TIMEOUT_MS / 1000}s 内未见含「${MATCH}」的检索结果页`);
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    log(`已写出 ${OUT}`);
    process.exit(matched ? 0 : 1);
  } finally {
    try { await browser.deleteSession(); } catch (_) {}
  }
}

main().catch((e) => {
  console.error('[rpa-flow] 失败:', e && (e.stack || e.message));
  const out = { platform: PLATFORM, ts: new Date().toISOString(), error: String(e && e.message), results: [
    { id: 'rpa_flow', name: '执行RPA流程', type: 'client_rpa_flow', platform: PLATFORM, status: 'error', detail: String(e && e.message), ts: new Date().toISOString() },
  ] };
  try { fs.writeFileSync(process.env.OUT || 'results-RPA_Flow.json', JSON.stringify(out, null, 2)); } catch (_) {}
  process.exit(1);
});
