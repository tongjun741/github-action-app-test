#!/usr/bin/env node
// launch-client.mjs — 启动花漾客户端并等待 CDP 就绪，把 CDP endpoint 写回 GITHUB_OUTPUT
//
// 环境变量：
//   CLIENT_BINARY        客户端可执行文件路径（必填，建议用 secret 提供）
//   REMOTE_DEBUG_PORT    远程调试端口（默认 9221 —— 分身浏览器 CDP 端口）
//   TEAM_ID              验证目标团队 ID（默认取 matrix meta，或 env 覆盖）
//   CLONE_NAME           验证目标分身名（默认取 matrix meta，或 env 覆盖）
//   WAIT_MS              等待 CDP 就绪的超时（默认 30000）
//
// 说明：验证目标为团队内的「UA152」分身，分身浏览器 CDP 端口为 9221。
// 客户端需已登录拥有该团队的账号，并打开目标分身。RELEASE/打包版若在 main.js
// 已注入 remoteDebugPort，则直接用该端口；否则用 --remote-debugging-port 启动参数。

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import http from 'node:http';

const binary = process.env.CLIENT_BINARY;
if (!binary) {
  console.warn('[launch] CLIENT_BINARY 未设置 → 跳过启动，下游将以 smoke 模式生成骨架报告（无真实客户端判定）');
  process.exit(0);
}
const port = process.env.REMOTE_DEBUG_PORT || '9221';
const waitMs = Number(process.env.WAIT_MS || 30000);
const teamId = process.env.TEAM_ID || '';
const cloneName = process.env.CLONE_NAME || '';
console.log(`[launch] 目标分身: team=${teamId || '(未指定)'} clone=${cloneName || '(未指定)'} port=${port}`);

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
  env: { ...process.env, TEAM_ID: teamId, CLONE_NAME: cloneName },
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
