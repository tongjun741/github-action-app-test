#!/usr/bin/env node
// launch-client.mjs — 启动花漾客户端并等待 CDP 就绪，把 CDP endpoint 写回 GITHUB_OUTPUT
//
// 环境变量：
//   CLIENT_BINARY        客户端可执行文件路径（必填，建议用 secret 提供）
//   REMOTE_DEBUG_PORT    远程调试端口（默认 9222）
//   WAIT_MS              等待 CDP 就绪的超时（默认 30000）
//
// 说明：Electron/Chromium 均支持 --remote-debugging-port 启动参数；
// 如项目 E2E 已在 main.js 注入 remoteDebugPort，则直接用该端口即可。

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import http from 'node:http';

const binary = process.env.CLIENT_BINARY;
if (!binary) {
  console.error('[launch] CLIENT_BINARY 未设置（建议用 repository secret 提供）');
  process.exit(2);
}
const port = process.env.REMOTE_DEBUG_PORT || '9222';
const waitMs = Number(process.env.WAIT_MS || 30000);

function waitCdp() {
  const url = `http://127.0.0.1:${port}/json/version`;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      });
      req.on('error', () => {
        if (Date.now() - start > waitMs) reject(new Error('CDP 在超时内未就绪'));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

const child = spawn(binary, [`--remote-debugging-port=${port}`], {
  stdio: 'ignore',
  detached: true,
});
child.unref();

try {
  const info = await waitCdp();
  const endpoint = `http://127.0.0.1:${port}`;
  console.log(`[launch] CDP 就绪: ${info.Browser || ''} @ ${endpoint}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `cdp=${endpoint}\n`);
  else console.log(`cdp=${endpoint}`);
} catch (e) {
  console.error('[launch] 启动失败:', e.message);
  process.exit(1);
}
