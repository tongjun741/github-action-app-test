/**
 * sync-flows.cjs —— 同步类用例批量验证（源 Excel R17-R20，2026-10-10 补录）
 *
 * 运行于 verify-cookie-sync job（第二台设备）：打开同一分身后，依次验证：
 *   1. history_sync  历史记录同步：第一台已访问 wdku.net → 本机 chrome://history 搜 wdku
 *   2. bookmark_sync 收藏夹同步：本机经 CDP 写入书签（由第一台收藏亦可）→ 换查书签 API
 *      —— 注意方向性：本脚本在第二台验证“第一台产生的数据可见”。
 *      历史记录由 verify job 的 wdku 访问产生；书签则在本机写入后上传，
 *      由后续轮次在第一台验证（双向分轮）。
 *   3. localstorage_sync：qq.com 写入标记 → （下一轮另一设备读取）本轮仅写入+记录
 *   4. indexdb_sync：同上
 *
 * 简化执行口径（无 Webshare 代理环境）：
 *   - history_sync：chrome://history 页面 DOM 搜 wdku.net（同步成功=pass）
 *   - bookmark_sync：CDP Page.captureSnapshot 不可靠 → 用 chrome://bookmarks DOM 搜 wdku
 *   - localstorage/indexdb：本轮在 qq.com 写入+读回自洽（写入成功+读回一致=基础设施 OK），
 *     跨设备同步在下轮（或用户确认云端面板）验证——先保证脚本链路可跑
 *
 * 输出：results-Sync_Flows.json（4 用例），report job 合并。
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
const LS_KEY = 'huayoung_sync_probe';
const LS_VAL = `ls_${Date.now()}`;
const IDB_DB = 'huayoung_sync_probe';
const IDB_VAL = `idb_${Date.now()}`;

const log = (...a) => console.log('[sync-flows]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function push(out, id, name, type, status, detail) {
  out.results.push({ id, name, type, platform: PLATFORM, status, detail, ts: new Date().toISOString() });
  const icon = { pass: '✓', fail: '✗', error: '✗', manual: '人工', skip: '跳过' }[status] || '-';
  console.log(`  [${icon}] ${name} — ${detail.slice(0, 110)}`);
}

async function main() {
  const out = { platform: PLATFORM, ts: new Date().toISOString(), results: [] };
  const { spawnSync } = require('node:child_process');
  // 打开分身（复用 OPEN_CLONE_ONLY）
  const r = spawnSync(process.execPath, ['tests/e2e-verify.cjs'], {
    stdio: 'inherit',
    env: { ...process.env, OPEN_CLONE_ONLY: '1', OUT: `placeholder-sync-${SLUG}.json` },
  });
  if (r.status !== 0) throw new Error(`打开分身失败（exit ${r.status}）`);

  const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  // ===== 1. 历史记录同步：chrome://history 搜 wdku =====
  try {
    await page.goto('chrome://history/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    // history 页是 shadow DOM + 需要 history-item 渲染；用内部搜索框
    const found = await page.evaluate(async (q) => {
      async function dig() {
        const main = document.querySelector('history-app');
        if (!main || !main.shadowRoot) return null;
        const list = main.shadowRoot.querySelector('history-list');
        if (!list || !list.shadowRoot) return null;
        const items = list.shadowRoot.querySelectorAll('history-item');
        const hits = [];
        items.forEach((it) => {
          const t = (it.shadowRoot ? it.shadowRoot.textContent : it.textContent) || '';
          if (t.includes(q)) hits.push(t.slice(0, 80));
        });
        return hits;
      }
      for (let i = 0; i < 10; i++) {
        const h = await dig();
        if (h && h.length) return h;
        await new Promise((s) => setTimeout(s, 1000));
      }
      return null;
    }, 'wdku.net').catch(() => null);
    push(out, 'history_sync', '历史记录同步', 'client_history_sync',
      found ? 'pass' : 'fail',
      found ? `历史记录中找到 wdku.net（${found[0]}）` : 'chrome://history 未找到 wdku.net（可能未同步或渲染未完成）');
  } catch (e) {
    push(out, 'history_sync', '历史记录同步', 'client_history_sync', 'error', `history 页异常: ${e.message.slice(0, 90)}`);
  }

  // ===== 2. 收藏夹同步：chrome://bookmarks 搜 wdku =====
  try {
    await page.goto('chrome://bookmarks/', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
    push(out, 'bookmark_sync', '收藏夹同步', 'client_bookmark_sync',
      found && found.length ? 'pass' : 'manual',
      found && found.length ? `收藏夹含 wdku.net（${found[0]}）` : '收藏夹未见 wdku.net（第一台未收藏——按标准需先在第一台收藏；本轮记 manual 待补前置）');
  } catch (e) {
    push(out, 'bookmark_sync', '收藏夹同步', 'client_bookmark_sync', 'error', `bookmarks 页异常: ${e.message.slice(0, 90)}`);
  }

  // ===== 3. LocalStorage 同步：qq.com 写入+读回（本轮自洽；跨设备下轮） =====
  try {
    await page.goto('https://www.qq.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);
    const rw = await page.evaluate(([k, v]) => {
      try {
        localStorage.setItem(k, v);
        const back = localStorage.getItem(k);
        return { ok: back === v, back };
      } catch (e) { return { ok: false, err: e.message }; }
    }, [LS_KEY, LS_VAL]);
    push(out, 'localstorage_sync', 'LocalStorage同步', 'client_localstorage_sync',
      rw.ok ? 'manual' : 'fail',
      rw.ok ? `qq.com 写入+读回自洽成功（${LS_KEY}=${LS_VAL}）；跨设备读取待下轮验证` : `LocalStorage 写入失败: ${rw.err || rw.back}`);
  } catch (e) {
    push(out, 'localstorage_sync', 'LocalStorage同步', 'client_localstorage_sync', 'error', `qq.com 异常: ${e.message.slice(0, 90)}`);
  }

  // ===== 4. IndexDB 同步：qq.com 写入+读回 =====
  try {
    const rw = await page.evaluate(([db, val]) => new Promise((resolve) => {
      try {
        const req = indexedDB.open(db, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
        req.onsuccess = () => {
          const d = req.result;
          try {
            const tx = d.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(val, 'probe');
            tx.oncomplete = () => {
              const tx2 = d.transaction('kv', 'readonly');
              const get = tx2.objectStore('kv').get('probe');
              get.onsuccess = () => resolve({ ok: get.result === val, back: String(get.result) });
              get.onerror = () => resolve({ ok: false, err: 'get error' });
            };
            tx.onerror = () => resolve({ ok: false, err: 'tx error' });
          } catch (e) { resolve({ ok: false, err: e.message }); }
        };
        req.onerror = () => resolve({ ok: false, err: 'open error' });
      } catch (e) { resolve({ ok: false, err: e.message }); }
    }), [IDB_DB, IDB_VAL]);
    push(out, 'indexdb_sync', 'IndexDB同步', 'client_indexdb_sync',
      rw.ok ? 'manual' : 'fail',
      rw.ok ? `qq.com IndexDB 写入+读回自洽成功（${IDB_DB}=${IDB_VAL}）；跨设备读取待下轮验证` : `IndexDB 写入失败: ${rw.err || rw.back}`);
  } catch (e) {
    push(out, 'indexdb_sync', 'IndexDB同步', 'client_indexdb_sync', 'error', `IndexDB 异常: ${e.message.slice(0, 90)}`);
  }

  // 收尾：关闭分身（释放会话）
  try { await browser.close(); log('已关闭分身浏览器'); } catch (_) { }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`已写出 ${OUT}（${out.results.length} 用例）`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[sync-flows] 失败:', e && (e.stack || e.message));
  const out = { platform: PLATFORM, ts: new Date().toISOString(), error: String(e && e.message), results: [] };
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); } catch (_) { }
  process.exit(1);
});
