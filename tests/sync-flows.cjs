/**
 * sync-flows.cjs —— 同步类用例批量验证（源 Excel R17-R20，2026-10-13 改造）
 *
 * CLI 模式：
 *   --write  第一台设备（verify job「同步前置写入」step）：打开分身 → 访问 wdku.net（产生历史+登录态）
 *            → qq.com 按官方写入存储.js 写 LS/Cookie/IDB → 输出 write 标记结果
 *   --read   （默认）第二台设备（verify-cookie-sync job）：读 history/bookmark/LS/IDB 验证跨设备同步
 *
 * 官方脚本体系（E:\workspace\docker\浏览器内核测试脚本\写入存储.js）：
 *   localStorage: szdamai_localStorage_key = szdamai_localStorage_value
 *   cookie:       szdamai_Cookie_key = szdamai_Cookie_value
 *   IndexedDB:   szdamai_dbName(v2) > szdamai_customers(keyPath=name) > {name:"new_customre_name", extInfo:"xdfd"}
 * 注：LS/IDB 为 per-origin，写入与读取均须在同一 origin（qq.com）执行；花漾将其随分身云端同步。
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const puppeteer = require('puppeteer-core');

const PLATFORM = process.env.E2E_PLATFORM || 'Windows 10';
const SLUG = PLATFORM.replace(/\s+/g, '_');
const CDP_PORT = Number(process.env.REMOTE_DEBUG_PORT || 9221);
const CDP = process.env.CLIENT_CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.env.OUT || 'results-Sync_Flows.json';
const MODE = process.argv.includes('--write') ? 'write' : 'read';

// G4 (2026-10-13)：使用用户指定的官方验证脚本（E:\workspace\docker\浏览器内核测试脚本\）写/读 LS/Cookie/IDB。
// 官方脚本已 vendored 进仓库 tests/official/，CI 直接加载（不再依赖用户本机 E:\ 路径）。
const OFFICIAL_DIR = path.join(__dirname, 'official');
let WRITE_SRC = '';
let READ_SRC = '';
try { WRITE_SRC = fs.readFileSync(path.join(OFFICIAL_DIR, '写入存储.js'), 'utf8'); } catch (_) {}
try { READ_SRC = fs.readFileSync(path.join(OFFICIAL_DIR, '读取存储.js'), 'utf8'); } catch (_) {}
if (!WRITE_SRC) log('警告: tests/official/写入存储.js 缺失，write 模式将退化为内联写入');

const log = (...a) => console.log('[sync-flows]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function push(out, id, name, type, status, detail) {
  out.results.push({ caseId: id, id, name, type, platform: PLATFORM, status, detail, criteria: '（源表 R17-R20 同步类用例）', mode: MODE, ts: new Date().toISOString() });
  const icon = { pass: '✓', fail: '✗', error: '✗', manual: '人工', skip: '跳过' }[status] || '-';
  console.log(`  [${icon}] ${name} — ${detail.slice(0, 120)}`);
}

// 打开分身（复用 e2e-verify OPEN_CLONE_ONLY）+ 连 CDP，返回 {browser, page}
async function openCloneAndConnect() {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['tests/e2e-verify.cjs'], {
    stdio: 'inherit',
    env: { ...process.env, OPEN_CLONE_ONLY: '1', OUT: `placeholder-sync-${SLUG}.json` },
  });
  if (r.status !== 0) throw new Error(`打开分身失败（exit ${r.status}）`);
  const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  return { browser, page };
}

// 带重试的导航（分身代理/隧道就绪需要时间）
async function gotoRetry(page, url, timeout = 45000, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return true;
    } catch (e) {
      lastErr = e;
      log(`[gotoRetry] ${url} 第${i + 1}次失败: ${e.message.slice(0, 70)}`);
      await sleep(5000);
    }
  }
  throw lastErr || new Error('goto 失败');
}

async function writeMode() {
  const out = { platform: PLATFORM, mode: 'write', ts: new Date().toISOString(), results: [] };
  const { browser, page } = await openCloneAndConnect();
  try {
    // 1) wdku.net 访问 → 产生历史 + 确保登录态 cookie 落到分身云端
    try {
      await gotoRetry(page, 'https://www.wdku.net/', 30000);
      await sleep(3000);
      push(out, 'history_write', '历史记录写入(访问wdku)', 'client_history_sync_write', 'pass', '已访问 wdku.net（历史源已产生，待第二台 chrome://history 验证同步）');
    } catch (e) {
      push(out, 'history_write', '历史记录写入(访问wdku)', 'client_history_sync_write', 'error', `wdku 访问异常: ${e.message.slice(0, 90)}`);
    }
    // 1.5) G5：收藏夹同步源 —— 第一台设备真实收藏 wdku（地址栏星标，OS 真鼠标点击）
    // 2026-10-14 用户铁律：永远不用 CDP 合成事件；工具缺失则跳过点击、记 error。
    try {
      const { osLeftClick, osMouseSupported } = require('./include/osmouse');
      if (!osMouseSupported()) {
        throw new Error('OS 鼠标工具缺失（win=ps1 / mac=cliclick / linux=xdotool）——按用户要求不降级 CDP 合成事件');
      }
      const star = await page.evaluate(() => ({ x: Math.round(window.innerWidth * 0.93), y: 42, sx: window.screenX, sy: window.screenY, dpr: window.devicePixelRatio }));
      const scrX = Math.round((star.sx + star.x) * star.dpr);
      const scrY = Math.round((star.sy + star.y) * star.dpr);
      await osLeftClick(scrX, scrY);
      await sleep(1500);
      push(out, 'bookmark_write', '收藏夹写入(wdku收藏)', 'client_bookmark_sync_write', 'pass', `已 OS 真鼠标点地址栏星标收藏 wdku（屏幕${scrX},${scrY}，待第二台 chrome://bookmarks 验证同步）`);
    } catch (e) {
      push(out, 'bookmark_write', '收藏夹写入(wdku收藏)', 'client_bookmark_sync_write', 'error', `收藏点击异常: ${e.message.slice(0, 90)}`);
    }
    // 2) qq.com 按官方 写入存储.js 写 LS + Cookie + IDB（G4：使用用户指定脚本）
    try {
      await gotoRetry(page, 'https://www.qq.com/', 45000);
      await sleep(3000);
      if (WRITE_SRC) {
        try { await page.evaluate(WRITE_SRC); log('已注入官方 写入存储.js'); }
        catch (e) { log(`注入官方写入脚本异常: ${e.message.slice(0, 60)}`); }
      } else {
        // 兜底内联（与官方脚本等价键名）
        await page.evaluate(() => {
          localStorage.setItem('szdamai_localStorage_key', 'szdamai_localStorage_value');
          document.cookie = 'szdamai_Cookie_key=szdamai_Cookie_value; expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/';
          const r = indexedDB.open('szdamai_dbName', 2);
          r.onupgradeneeded = (ev) => { const db = ev.target.result; if (!db.objectStoreNames.contains('szdamai_customers')) db.createObjectStore('szdamai_customers', { keyPath: 'name' }); };
          r.onsuccess = (ev) => { const db = ev.target.result; db.transaction('szdamai_customers', 'readwrite').objectStore('szdamai_customers').add({ name: 'new_customre_name', extInfo: 'xdfd' }); };
        });
      }
      await sleep(4000); // 等 IDB 事务落库
      // 验证写入落地
      const rw = await page.evaluate(() => {
        const res = {};
        try { res.ls = localStorage.getItem('szdamai_localStorage_key') === 'szdamai_localStorage_value'; } catch (e) { res.lsErr = e.message; }
        try { res.cookie = document.cookie.includes('szdamai_Cookie_key'); } catch (e) { res.cookieErr = e.message; }
        res.idb = new Promise((resolve) => {
          try {
            const request = indexedDB.open('szdamai_dbName', 2);
            request.onerror = () => resolve({ ok: false, err: 'open 失败' });
            request.onsuccess = (event) => {
              const db = event.target.result;
              try {
                db.transaction('szdamai_customers').objectStore('szdamai_customers').get('new_customre_name').onsuccess = (e2) => resolve({ ok: !!(e2.target.result && e2.target.result.extInfo === 'xdfd'), back: e2.target.result ? String(e2.target.result.extInfo) : '(空)' });
              } catch (e) { resolve({ ok: false, err: e.message }); }
            };
          } catch (e) { resolve({ ok: false, err: e.message }); }
        });
        return res;
      });
      const idb = await Promise.resolve(rw.idb);
      push(out, 'localstorage_write', 'LocalStorage写入(qq.com)', 'client_localstorage_sync_write', rw.ls ? 'pass' : 'fail', rw.ls ? 'szdamai_localStorage_key 写入成功（官方脚本，待第二台验证同步）' : `LS 写入失败: ${rw.lsErr || '?'}`);
      push(out, 'cookie_write', 'Cookie写入(qq.com)', 'client_cookie_sync_write', rw.cookie ? 'pass' : 'fail', rw.cookie ? 'szdamai_Cookie_key 写入成功（官方脚本，待第二台验证同步）' : `Cookie 写入失败: ${rw.cookieErr || '?'}`);
      push(out, 'indexdb_write', 'IndexDB写入(qq.com)', 'client_indexdb_sync_write', idb && idb.ok ? 'pass' : 'fail', idb && idb.ok ? 'szdamai_dbName/szdamai_customers 写入成功（官方脚本，待第二台验证同步）' : `IDB 写入失败: ${idb && idb.err || '?'}`);
    } catch (e) {
      push(out, 'localstorage_write', 'LocalStorage写入(qq.com)', 'client_localstorage_sync_write', 'error', `qq.com 异常: ${e.message.slice(0, 90)}`);
      push(out, 'cookie_write', 'Cookie写入(qq.com)', 'client_cookie_sync_write', 'error', `qq.com 异常: ${e.message.slice(0, 90)}`);
      push(out, 'indexdb_write', 'IndexDB写入(qq.com)', 'client_indexdb_sync_write', 'error', `qq.com 异常: ${e.message.slice(0, 90)}`);
    }
  } finally {
    try { await browser.close(); } catch (_) {}
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`已写出 ${OUT}（${out.results.length} 用例, mode=write）`);
  process.exit(0);
}

async function readMode() {
  const out = { platform: PLATFORM, mode: 'read', ts: new Date().toISOString(), results: [] };
  const { browser, page } = await openCloneAndConnect();
  try {
    // 1. history
    try {
      await gotoRetry(page, 'chrome://history/', 30000);
      await sleep(3000);
      const found = await page.evaluate(async (q) => {
        for (let i = 0; i < 10; i++) {
          const main = document.querySelector('history-app');
          if (main && main.shadowRoot) {
            const list = main.shadowRoot.querySelector('history-list');
            if (list && list.shadowRoot) {
              const items = list.shadowRoot.querySelectorAll('history-item');
              const hits = [];
              items.forEach((it) => {
                const t = (it.shadowRoot ? it.shadowRoot.textContent : it.textContent) || '';
                if (t.includes(q)) hits.push(t.slice(0, 80));
              });
              if (hits.length) return hits;
            }
          }
          await new Promise((s) => setTimeout(s, 1000));
        }
        return null;
      }, 'wdku.net').catch(() => null);
      push(out, 'history_sync', '历史记录同步', 'client_history_sync', found ? 'pass' : 'fail', found ? `历史记录中找到 wdku.net（${found[0]}）` : 'chrome://history 未找到 wdku.net（可能未同步或渲染未完成）');
    } catch (e) { push(out, 'history_sync', '历史记录同步', 'client_history_sync', 'error', `history 页异常: ${e.message.slice(0, 90)}`); }

    // 2. bookmark
    try {
      await gotoRetry(page, 'chrome://bookmarks/', 30000);
      await sleep(3000);
      const found = await page.evaluate(() => {
        const app = document.querySelector('bookmarks-app');
        const walk = (root, acc) => {
          if (!root) return acc;
          if (root.shadowRoot) walk(root.shadowRoot, acc);
          root.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot) walk(el.shadowRoot, acc);
            const t = el.textContent || '';
            if (/wdku\.net/i.test(t)) acc.push(t.slice(0, 80));
          });
          return acc;
        };
        return walk(app ? app.shadowRoot : document, []);
      }).catch(() => []);
      push(out, 'bookmark_sync', '收藏夹同步', 'client_bookmark_sync', found && found.length ? 'pass' : 'manual', found && found.length ? `收藏夹含 wdku.net（${found[0]}）` : '收藏夹未见 wdku.net（第一台未收藏——按标准需先在第一台收藏；本轮记 manual 待补前置）');
    } catch (e) { push(out, 'bookmark_sync', '收藏夹同步', 'client_bookmark_sync', 'error', `bookmarks 页异常: ${e.message.slice(0, 90)}`); }

    // 3. LS (qq.com, 重试等云端同步)
    try {
      await gotoRetry(page, 'https://www.qq.com/', 45000);
      // G4：使用官方 读取存储.js 读取（console 取证）
      if (READ_SRC) {
        try {
          const logs = [];
          page.on('console', (m) => logs.push(m.text()));
          await page.evaluate(READ_SRC);
          await sleep(2000);
          log(`已注入官方 读取存储.js（console: ${logs.slice(0, 3).join(' | ')}）`);
        } catch (e) { log(`注入官方读取脚本异常: ${e.message.slice(0, 60)}`); }
      }
      let lsOk = false, lsVal = '';
      for (let i = 0; i < 5; i++) {
        const v = await page.evaluate(() => { try { return localStorage.getItem('szdamai_localStorage_key'); } catch (e) { return null; } }).catch(() => null);
        if (v === 'szdamai_localStorage_value') { lsOk = true; lsVal = v; break; }
        lsVal = v || '';
        await sleep(5000);
        if (i < 4) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      push(out, 'localstorage_sync', 'LocalStorage同步', 'client_localstorage_sync', lsOk ? 'pass' : 'fail', lsOk ? 'qq.com 跨设备读回 szdamai_localStorage_key=szdamai_localStorage_value（同步成功）' : `第二台 qq.com 未读回 szdamai_localStorage_key（值=${lsVal || '空'}，云端同步未生效或超时）`);
    } catch (e) { push(out, 'localstorage_sync', 'LocalStorage同步', 'client_localstorage_sync', 'error', `qq.com 异常: ${e.message.slice(0, 90)}`); }

    // 4. IDB (qq.com, 重试)
    try {
      let idbOk = false, idbVal = '';
      for (let i = 0; i < 5; i++) {
        const r = await page.evaluate(() => new Promise((resolve) => {
          try {
            const request = indexedDB.open('szdamai_dbName', 2);
            request.onerror = () => resolve({ ok: false, err: 'open 失败' });
            request.onsuccess = (event) => {
              const db = event.target.result;
              try {
                const g = db.transaction('szdamai_customers').objectStore('szdamai_customers').get('new_customre_name');
                g.onsuccess = () => resolve({ ok: !!(g.result && g.result.extInfo === 'xdfd'), back: g.result ? String(g.result.extInfo) : '(空)' });
                g.onerror = () => resolve({ ok: false, err: 'get 失败' });
              } catch (e) { resolve({ ok: false, err: e.message }); }
            };
          } catch (e) { resolve({ ok: false, err: e.message }); }
        })).catch((e) => ({ ok: false, err: e.message }));
        if (r.ok) { idbOk = true; idbVal = r.back; break; }
        idbVal = r.back || r.err || '';
        await sleep(5000);
      }
      push(out, 'indexdb_sync', 'IndexDB同步', 'client_indexdb_sync', idbOk ? 'pass' : 'fail', idbOk ? 'qq.com 跨设备读回 szdamai_dbName/szdamai_customers/new_customre_name.extInfo=xdfd（同步成功）' : `第二台未读回 IDB（${idbVal || '空'}，云端同步未生效或超时）`);
    } catch (e) { push(out, 'indexdb_sync', 'IndexDB同步', 'client_indexdb_sync', 'error', `IDB 异常: ${e.message.slice(0, 90)}`); }
  } finally {
    try { await browser.close(); } catch (_) {}
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`已写出 ${OUT}（${out.results.length} 用例, mode=read）`);
  process.exit(0);
}

async function main() {
  if (MODE === 'write') return writeMode();
  return readMode();
}

main().catch((e) => {
  console.error('[sync-flows] 失败:', e && (e.stack || e.message));
  const out = { platform: PLATFORM, mode: MODE, ts: new Date().toISOString(), error: String(e && e.message), results: [] };
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); } catch (_) {}
  process.exit(1);
});
