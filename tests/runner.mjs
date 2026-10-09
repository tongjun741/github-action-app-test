#!/usr/bin/env node
// runner.mjs — 按 matrix.json 跑全部验证项，输出 results-<platform>.json
//
// 运行模式：
//   1) 真实客户端（CI 默认）：设 CLIENT_CDP_ENDPOINT=http://127.0.0.1:<port> 连接到花漾客户端 CDP
//   2) 无头浏览器（本地开发）：自动用 Playwright 启动 headless chromium（可加 --proxy 走代理）
//   3) 无浏览器（--smoke）：不启动浏览器，自动项标记 skipped、人工项标记 manual，仅验证流程并产出骨架报告
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
  }
  return out;
}

async function loadBrowser(opts) {
  const cdp = opts.cdp || process.env.CLIENT_CDP_ENDPOINT;
  const proxy = opts.proxy || process.env.PROXY;
  const proxyIp = opts.proxyIp || process.env.PROXY_IP;

  if (cdp) {
    const { chromium } = await import('playwright');
    const browser = await chromium.connectOverCDP(cdp);
    console.log(`[runner] 已连接真实客户端 CDP: ${cdp}`);
    return { browser, proxyIp, mode: 'cdp' };
  }
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      proxy: proxy ? { server: proxy, bypass: '<-loopback>' } : undefined,
    });
    console.log(`[runner] 已启动无头 chromium${proxy ? ` (proxy=${proxy})` : ''}`);
    return { browser, proxyIp, mode: 'headless' };
  } catch (e) {
    console.log(`[runner] 未找到 Playwright/Chromium，进入 smoke 模式: ${e.message}`);
    return { browser: null, proxyIp, mode: 'smoke' };
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const allPlatforms = matrix.meta.platforms;
  const scope = args.platforms
    ? args.platforms.split(',').map((s) => s.trim())
    : allPlatforms;

  const { browser, proxyIp, mode } = await loadBrowser(args);

  // 验证目标：团队内的「UA152」分身（CDP 端口 9221）。env 可覆盖 spec 默认值。
  const teamId = process.env.TEAM_ID || matrix.meta.teamId || '';
  const cloneName = process.env.CLONE_NAME || matrix.meta.cloneName || '';
  console.log(`[runner] 验证目标分身: team=${teamId || '(未指定)'} clone=${cloneName || '(未指定)'} (CDP=${matrix.meta.cloneCdpPort || 9221})`);

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
      context = await browser.newContext();
      page = await context.newPage();
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
          : { status: 'skipped', detail: '无浏览器环境，未执行自动判定' };
      } else {
        res = await checkCase(page, c, { proxyIp });
        if (page && c.url) {
          try { await page.close(); } catch (_) {}
          page = await context.newPage();
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
}

run().catch((e) => {
  console.error('[runner] 失败:', e);
  process.exit(1);
});
