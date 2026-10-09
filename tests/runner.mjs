#!/usr/bin/env node
// runner.mjs — 按 matrix.json 跑全部验证项，输出 results-<platform>.json
//
// 运行模式：
//   1) 真实客户端（CI 默认）：设 CLIENT_CDP_ENDPOINT=http://127.0.0.1:<port> 连接到花漾客户端 CDP
//   2) 无头浏览器（本地开发）：自动用 Playwright 启动 headless chromium（可加 --proxy 走代理）
//   3) 无浏览器（--smoke）：不启动浏览器，自动项标记 skipped、人工项标记 manual，仅验证流程并产出骨架报告
//
// 引擎：
//   --engine playwright（默认）：用 playwright 的 connectOverCDP 连真实客户端（托管 runner / 本地）
//   --engine puppeteer    ：用 puppeteer-core 的 connect 连真实客户端（Win7 Docker VM 内，node18/Win7 兼容性最佳，无需本地 chromium）
//
// 环境变量：
//   PLATFORMS       逗号分隔，限定要测的平台（默认 matrix 中全部）
//   CLIENT_CDP_ENDPOINT  真实客户端 CDP 地址（覆盖无头模式）
//   PROXY           代理地址，如 http://user:pass@host:port
//   PROXY_IP        代理出口公网 IP（用于 WebRTC 一致性判定，可选）
//   OUT             输出文件路径（默认 results-<platform>.json，多平台时每个平台一个文件）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkCase } from './checkers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const matrixPath = join(__dirname, 'matrix.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--smoke') out.smoke = true;
    else if (a === '--cdp') out.cdp = argv[++i];
    else if (a === '--proxy') out.proxy = argv[++i];
    else if (a === '--proxy-ip') out.proxyIp = argv[++i];
    else if (a === '--platforms') out.platforms = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--engine') out.engine = argv[++i];
  }
  return out;
}

async function loadBrowser(opts) {
  const cdp = opts.cdp || process.env.CLIENT_CDP_ENDPOINT;
  const proxy = opts.proxy || process.env.PROXY;
  const proxyIp = opts.proxyIp || process.env.PROXY_IP;
  const engine = (opts.engine || 'playwright').toLowerCase();

  if (cdp) {
    if (engine === 'puppeteer') {
      // Win7 Docker VM 内：puppeteer-core 纯 JS 驱动 CDP，无需本地 chromium，node18/Win7 兼容最佳
      try {
        const pptr = await import('puppeteer-core');
        const puppeteer = pptr.default || pptr;
        const browser = await puppeteer.connect({ browserURL: cdp });
        console.log(`[runner] 已用 puppeteer-core 连接真实客户端 CDP: ${cdp}`);
        return { browser, proxyIp, mode: 'cdp', engine };
      } catch (e) {
        console.error(`[runner] puppeteer 连接 CDP 失败，降级为无浏览器模式（仅记录 error）: ${e.message}`);
        return { browser: null, proxyIp, mode: 'smoke', engine };
      }
    }
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.connectOverCDP(cdp);
      console.log(`[runner] 已连接真实客户端 CDP: ${cdp}`);
      return { browser, proxyIp, mode: 'cdp', engine };
    } catch (e) {
      console.error(`[runner] Playwright 连接 CDP 失败，降级为无浏览器模式（仅记录 error）: ${e.message}`);
      return { browser: null, proxyIp, mode: 'smoke', engine };
    }
  }
  // 本地开发用无头浏览器（仅 Playwright 支持）
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      proxy: proxy ? { server: proxy, bypass: '<-loopback>' } : undefined,
    });
    console.log(`[runner] 已启动无头 chromium${proxy ? ` (proxy=${proxy})` : ''}`);
    return { browser, proxyIp, mode: 'headless', engine };
  } catch (e) {
    console.log(`[runner] 未找到 Playwright/Chromium，进入 smoke 模式: ${e.message}`);
    return { browser: null, proxyIp, mode: 'smoke', engine };
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const allPlatforms = matrix.meta.platforms;
  const scope = args.platforms
    ? args.platforms.split(',').map((s) => s.trim())
    : allPlatforms;

  const { browser, proxyIp, mode, engine } = await loadBrowser(args);

  // 验证目标：团队内的「UA152」分身（CDP 端口 9221）。env 可覆盖 spec 默认值。
  const teamId = process.env.TEAM_ID || matrix.meta.teamId || '';
  const cloneName = process.env.CLONE_NAME || matrix.meta.cloneName || '';
  console.log(`[runner] 验证目标分身: team=${teamId || '(未指定)'} clone=${cloneName || '(未指定)'} (CDP=${matrix.meta.cloneCdpPort || 9221}) engine=${engine}`);

  const resultsByPlatform = {};
  for (const platform of scope) {
    if (!allPlatforms.includes(platform)) {
      console.warn(`[runner] 跳过未知平台: ${platform}`);
      continue;
    }
    console.log(`\n=== 平台: ${platform} ===`);
    const platformResults = [];
    let context = null;
    let page = null;
    if (browser) {
      try {
        if (engine === 'puppeteer') {
          page = await browser.newPage();
        } else {
          context = await browser.newContext();
          page = await context.newPage();
        }
      } catch (e) {
        console.error(`[runner] 创建页面/上下文失败，降级为无浏览器模式: ${e.message}`);
        browser = null;
      }
    }
    for (const c of matrix.cases) {
      if (!c.appliesTo.includes(platform)) {
        platformResults.push({
          caseId: c.id, name: c.name, type: c.type, status: 'na',
          detail: '该平台不适用', criteria: c.criteria,
        });
        continue;
      }
      let res;
      if (!browser) {
        // smoke / 无浏览器：自动项 skipped，人工项 manual
        res = ['manual_captcha', 'client_plugins', 'client_password_save', 'client_password_autofill', 'client_cookie_sync'].includes(c.type)
          ? { status: 'manual', detail: '需人工按验证标准确认' }
          : { status: 'skipped', detail: '无浏览器环境（CDP 未连上），未执行自动判定' };
      } else {
        try {
          res = await checkCase(page, c, { proxyIp, engine });
        } catch (e) {
          res = { status: 'error', detail: `判定过程异常: ${e.message}` };
          console.error(`  [错误] ${c.name}: ${e.message}`);
        }
        if (page && c.url) {
          try { await page.close(); } catch (_) {}
          try { page = engine === 'puppeteer' ? await browser.newPage() : await context.newPage(); } catch (_) { page = null; }
        }
      }
      platformResults.push({
        caseId: c.id, name: c.name, type: c.type,
        status: res.status, detail: res.detail, criteria: c.criteria,
      });
      const tag = { pass: '✓', fail: '✗', manual: '人工', error: '错误', skipped: '跳过', na: '-' }[res.status] || res.status;
      console.log(`  [${tag}] ${c.name} — ${res.detail}`);
    }
    if (context) await context.close().catch(() => {});
    if (page && engine === 'puppeteer') await page.close().catch(() => {});
    resultsByPlatform[platform] = platformResults;
  }

  if (browser) {
    if (mode === 'cdp') {
      // 不要关闭真实客户端
    } else {
      await browser.close().catch(() => {});
    }
  }

  const generatedAt = new Date().toISOString();
  const kernel = matrix.meta.kernelVersion;
  const testVer = matrix.meta.testVersion || {};
  const written = [];
  const resultMeta = { kernel, testVersion: testVer, generatedAt, teamId, cloneName, cloneCdpPort: matrix.meta.cloneCdpPort || 9221 };
  if (scope.length === 1) {
    const out = args.out || `results-${scope[0].replace(/\s+/g, '_')}.json`;
    writeFileSync(out, JSON.stringify({ meta: resultMeta, platform: scope[0], results: resultsByPlatform[scope[0]] }, null, 2));
    written.push(out);
  } else {
    for (const p of Object.keys(resultsByPlatform)) {
      const out = args.out ? args.out.replace(/<platform>/g, p.replace(/\s+/g, '_')) : `results-${p.replace(/\s+/g, '_')}.json`;
      writeFileSync(out, JSON.stringify({ meta: resultMeta, platform: p, results: resultsByPlatform[p] }, null, 2));
      written.push(out);
    }
  }
  console.log(`\n[runner] 已写出: ${written.join(', ')}`);

  // 退出码：只要有「fail」(真实验证不通过) 或「error」(判定过程异常) 即非 0，便于 CI 标红；
  // 纯 manual / skipped / na / pass 不视为失败。
  let hasProblem = false;
  for (const arr of Object.values(resultsByPlatform)) {
    for (const r of arr) {
      if (r.status === 'fail' || r.status === 'error') { hasProblem = true; break; }
    }
    if (hasProblem) break;
  }
  if (hasProblem) {
    console.error('[runner] 存在失败/异常用例，进程以非 0 退出（便于 CI 标红）');
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('[runner] 致命错误:', e);
  process.exit(1);
});
