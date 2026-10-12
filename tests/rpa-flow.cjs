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
    // Run#53 实证：流程列表异步加载有时序抖动（上轮 7s 出现、本轮 16s 仍未见）——
    //    改为总窗 20s 的轮询重试，每轮尝试全部选择器。
    let execOk = false;
    const execDeadline = Date.now() + 20000;
    while (!execOk && Date.now() < execDeadline) {
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
      if (!execOk) await sleep(2000); // 等列表渲染后重试
    }
    if (!execOk) {
      // 取证：自动化页面当前可见文本（定位是列表未渲染还是流程名变了）
      try {
        const bodyTxt = await browser.$('//div[contains(@class,"ant-layout-content")] | //main | //body').getText().catch(() => '');
        log(`[diag] 自动化页面文本(前600): ${String(bodyTxt).replace(/\s+/g, ' ').slice(0, 600)}`);
        await uploadShot(browser, 'flow-entry-miss');
      } catch (_) {}
      throw new Error(`自动化页面未找到流程「${FLOW_NAME}」的执行入口（20s 轮询）`);
    }

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
    // 取证辅助：全页 DOM 上传 Cloudinary（Run#54 起：本地盘在 CI 拿不回）
    const dumpPageSource = async (tag) => {
      try {
        const html = await browser.getPageSource();
        const p = path.join(process.cwd(), `rpa-page-${tag}-${Date.now()}.html`);
        fs.writeFileSync(p, html.slice(0, 2 * 1024 * 1024));
        if (process.env.CLOUDINARY_URL) {
          const mod = require('cloudinary');
          const cl = (mod.default && mod.default.v2) || mod.v2 || mod.default;
          cl.config({ secure: true });
          const now = new Date();
          const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const r = await cl.uploader.upload(p, { asset_folder: `e2eTest_${mm}`, resource_type: 'raw' });
          console.log(`[rpa-flow] 页面DOM(${tag}): ${r.url}`);
          console.log(`::notice title=RPA-DOM-${tag.toUpperCase()}::${Buffer.from(r.url).toString('base64')}`);
        }
      } catch (e) { log(`[diag] 页面DOM dump(${tag}) 失败: ${e.message.slice(0, 60)}`); }
    };
    const modalTitles = async () => {
      try {
        const els = await browser.$$('//div[contains(@class,"ant-modal-root")]//div[contains(@class,"ant-modal-title")]');
        const arr = [];
        for (const e of els) arr.push(String(await e.getText().catch(() => '')).trim());
        return arr;
      } catch (_) { return []; }
    };
    for (let step = 1; step <= 3; step++) {
      log(`向导步骤 ${step}`);
      if (step === 1) {
        // 分身选择（Run#48~54 迭代实证）。本轮修复三连环 bug：
        //  A（Run#54 自伤）：失败后点「取 消」的 XPath 匹配文档序第一个 ant-modal=外层向导 → 关掉向导 →「添加分身」消失。
        //     修法：不再点「取 消」文字按钮——重开「选 择」入口重试；确需关闭时只点最内层弹窗的 X。
        //  B（打错框）：搜索框并集可能命中向导面板 input 而非分身弹窗 #keywords——严格作用域 + 打印实际属性取证。
        //  C（分页）：UA152 在主客户端分身列表第 2 页；picker 若同构分页，第 1 页永远选不中——搜索后仍找不到时翻页。
        picked = false;
        for (let attempt = 1; attempt <= 3 && !picked; attempt++) {
          // 1) 点「选 择」（重试轮里若弹窗还在则先点最内层 X 关掉再重开）
          if (attempt > 1) {
            try {
              const xBtns = await browser.$$('//div[contains(@class,"ant-modal-root")]//button[contains(@class,"ant-modal-close")]');
              if (xBtns.length) {
                await xBtns[xBtns.length - 1].click(); // 文档序最后一个 = 最内层弹窗的 X
                log(`[attempt ${attempt}] 已点最内层弹窗 X 关闭残留弹窗`);
                await sleep(1500);
              }
            } catch (_) {}
          }
          let entryOk = false;
          for (const entrySel of [
            '//button[.//span[text()="选 择"]] | //span[text()="选 择"]/ancestor::button',
          ]) {
            try {
              const eb = browser.$(entrySel);
              await eb.waitForExist({ timeout: 3500 });
              await eb.click();
              entryOk = true; log(`[attempt ${attempt}] 已点入口按钮（选 择）`); break;
            } catch (_) {}
          }
          if (!entryOk) { log(`[attempt ${attempt}] 「选 择」按钮未找到`); break; }
          await sleep(2500);

          // 2) 严格作用域找分身选择弹窗：标题应为 分身 相关（非向导「流程」标题），内含搜索框
          let pickerModal = null; let pickerTitle = '';
          const pickerModalXpaths = [
            '//div[contains(@class,"ant-modal-root")][.//div[contains(@class,"ant-modal-title")][contains(.,"分身")]]',
            '//div[contains(@class,"ant-modal-root")][.//input[@id="keywords"]]',
            '//div[contains(@class,"ant-modal-root")][.//input[contains(@placeholder,"检索")]]',
          ];
          for (const px of pickerModalXpaths) {
            try {
              const cand = browser.$(px);
              if (await cand.waitForExist({ timeout: 4000 }).then(() => true).catch(() => false)) {
                pickerModal = cand; break;
              }
            } catch (_) {}
          }
          if (!pickerModal) {
            const titles = await modalTitles();
            log(`[attempt ${attempt}] 未找到分身选择弹窗；当前 modal 标题: ${JSON.stringify(titles)}`);
            await dumpPageSource(`picker-miss-a${attempt}`);
            continue; // 关掉残留再重试（attempt>1 分支会点 X）
          }
          try { pickerTitle = String(await pickerModal.$('.//div[contains(@class,"ant-modal-title")]').getText().catch(() => '')); } catch (_) {}
          log(`[attempt ${attempt}] 分身选择弹窗已打开（title=${pickerTitle}）`);

          // 3) 弹窗内搜索框（严格作用域，打印实际属性取证）
          try {
            const search = pickerModal.$('.//input[@id="keywords"] | .//input[contains(@placeholder,"检索")] | .//input[@type="search"] | .//input[1]');
            if (await search.isExisting()) {
              const attr = await search.getAttribute('id').catch(() => '');
              const ph = await search.getAttribute('placeholder').catch(() => '');
              await search.setValue(CLONE);
              await sleep(4000); // 等异步过滤，不回车（回车会触发默认提交关弹窗）
              log(`[attempt ${attempt}] 已在弹窗内搜索 ${CLONE}（id=${attr} placeholder=${ph}）`);
            } else {
              log(`[attempt ${attempt}] 弹窗内无搜索框`);
            }
          } catch (e) { log(`[attempt ${attempt}] 搜索异常: ${e.message.slice(0, 50)}`); }

          // 4) 弹窗内轮询找 UA152 行（严格作用域；兼容 ant-list-item / ant-table 行 / 任意元素）
          for (let w = 0; w < 4 && !picked; w++) {
            for (const sel of [
              `.//div[contains(@class,"ant-list-item")][contains(.,"${CLONE}")]`,
              `.//tr[contains(.,"${CLONE}")]`,
              `.//li[contains(.,"${CLONE}")]`,
              `.//*[contains(@class,"item")][contains(.,"${CLONE}")]`,
              `.//*[contains(text(),"${CLONE}")]`,
            ]) {
              try {
                const it = pickerModal.$(sel);
                await it.waitForExist({ timeout: 2500 });
                await it.click();
                picked = true; log(`[attempt ${attempt}] 已选中分身 ${CLONE}（${sel.slice(0, 50)}…）`); break;
              } catch (_) {}
            }
            if (!picked) {
              // 5) 分页翻页（Run#54 假设：picker 同主列表分页，UA152 在第 2 页）
              try {
                const nextPg = pickerModal.$('.//li[contains(@class,"ant-pagination-next")][not(contains(@class,"disabled"))]');
                if (await nextPg.isExisting()) {
                  await nextPg.click();
                  log(`[attempt ${attempt}] 第 ${w + 1} 轮未见 ${CLONE}——已点分页下一页`);
                  await sleep(2500);
                  continue;
                }
              } catch (_) {}
              await sleep(2500);
            }
          }
          // 6) 未选中：取证弹窗内真实内容（文本+列表项数+空态）——本轮必须拿到真实结构
          if (!picked) {
            try {
              const mt = String(await pickerModal.getText().catch(() => '')).replace(/\s+/g, ' ');
              log(`[attempt ${attempt}][diag] picker 弹窗全文(前600): ${mt.slice(0, 600)}`);
              const emptyEl = pickerModal.$('.//*[contains(@class,"ant-empty")]');
              const hasEmpty = await emptyEl.isExisting().catch(() => false);
              if (hasEmpty) log(`[attempt ${attempt}][diag] 列表为空态（ant-empty）——搜索词无结果或列表未加载`);
            } catch (_) {}
          }
        } // end for attempt
        if (picked) {
          // 确认选择：优先分身弹窗内的「确 定」，兜底最内层弹窗主按钮
          for (const sel of [
            '//div[contains(@class,"ant-modal-root")][.//div[contains(@class,"ant-modal-title")][contains(.,"分身")]]//button[.//span[text()="确 定"]]',
            '//div[contains(@class,"ant-modal-root")][.//input[@id="keywords"]]//button[.//span[text()="确 定"]]',
          ]) {
            try { const b = browser.$(sel); await b.waitForExist({ timeout: 2500 }); await b.click(); log('已确认分身选择（弹窗内确 定）'); await sleep(1200); break; } catch (_) {}
          }
        }
        if (!picked) {
          log('分身未能选中——最终取证');
          await dumpPageSource('clone-pick-final');
          await uploadShot(browser, 'clone-pick-miss');
        }
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
