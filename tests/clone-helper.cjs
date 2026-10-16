/**
 * clone-helper.cjs —— e2e-verify 进程内创建/删除 E2E 分身（2026-10-15 新分身方案）
 *
 * 与 clone-manager.cjs（CLI 版）共用同一套 API：
 *   创建 POST /api/shop/batch；删除 POST /api/shop/delete；查询 POST /api/shop/pageV2
 * 认证从 .e2e-auth.json（e2e-verify 登录后导出的 jwt/teamId）。
 *
 * 命名规范：152-<平台>-<runId>-<时间戳>（「152-」前缀标记内核版本；runId 保证同轮可追溯，时间戳防碰撞）
 * 清理规范：按前缀 152- 清理（workflow always 步调用 cleanupStaleClones）
 */
const fs = require('node:fs');
const path = require('node:path');

const API_BASE = process.env.E2E_API_BASE || 'https://api.szdamai.com';
const AUTH_FILE = path.join(process.cwd(), '.e2e-auth.json');
const PLATFORMS = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };
const PREFIX = '152-';                 // 2026-10-16 用户要求：分身名以「152-」开头标记内核版本
const PLATFORM_ID = 45343429365818;   // 2026-10-16 用户指定固定平台ID（创建分身必填，取代原先动态 GET /api/meta/platforms）

function loadAuth() {
  const { jwt, teamId } = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  if (!jwt || !teamId) throw new Error('jwt/teamId 缺失');
  return { jwt, teamId };
}

async function api(method, urlPath, body, query) {
  const { jwt, teamId } = loadAuth();
  const u = new URL(API_BASE + urlPath);
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, String(v));
  const res = await fetch(u, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: jwt, 'x-dm-team-id': String(teamId) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} 非 JSON: ${text.slice(0, 100)}`); }
  if (!res.ok || json.success === false) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 150)}`);
  return json;
}

/** 查询指定分身的主通道 ipId（pageV2 → list[0].channels[] 里 primary=true 的 ipId；无绑 IP 返回 null） */
async function getPrimaryIpId(cloneName) {
  const r = await api('POST', '/api/shop/pageV2', { names: [cloneName], pageNum: 1, pageSize: 10 });
  const shop = ((r.data && r.data.list) || [])[0];
  if (!shop) return null;
  const channels = shop.channels || [];
  const primary = channels.find((c) => c.primary) || channels[0];
  return (primary && primary.ipId) || null;
}

/** 把 ipId 绑到分身（PUT /api/ip/bindShop，primary=true 主通道）。返回是否成功 */
async function bindIpToClone(ipId, shopId) {
  await api('PUT', '/api/ip/bindShop', { ipId, shopIdList: [shopId], primary: true });
  return true;
}

/** 创建本平台专属新分身（2026-10-16 起按用户指定参考参数：152 内核 + 系统 IP 隔离 + 系统本地代理）。
 *  参考 payload（用户指定）：
 *    { count:1, namePrefix:"152-...", platformId:45343429365818, ipIsolationType:"system",
 *      homePageType:"defaults", pcParams:{platform:"Windows",browser:"Chrome",version:152},
 *      shopLanProxy:{enabled:true,networkType:"UseSystem",probeOnSession:true}, clientPlatform:"Windows" }
 *  说明：
 *   - clientPlatform 用实际宿主 OS（Win/Mac/Linux）——分身在哪类客户端启动由宿主决定，参考里的 "Windows" 是其手动测试环境；
 *   - pcParams.platform 按参考固定 "Windows"（分身浏览器指纹/UA 模拟 Windows）；
 *   - 不再继承参考分身 ipId（与 shopLanProxy 互斥），改走 ipIsolationType=system + shopLanProxy UseSystem。
 *  返回 { name, id } */
async function createClone(platform, runId) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const name = `${PREFIX}${String(platform).replace(/\s+/g, '_')}-${runId || 'local'}-${stamp}`;
  const clientPlatform = PLATFORMS[process.platform] || 'Windows';
  const r = await api('POST', '/api/shop/batch', {
    namePrefix: name,
    count: 1,
    type: 'Global',                 // 全局分身（验证规格）
    clientPlatform,                 // 实际宿主 OS（Win/Mac/Linux）
    recordPolicy: 'Disabled',       // 不录像
    platformId: PLATFORM_ID,        // 固定平台ID（用户 2026-10-16 指定）
    ipIsolationType: 'system',      // 系统级 IP 隔离（参考参数）
    homePageType: 'defaults',       // 默认主页（参考参数）
    // 创建分身时指定内核版本（用户要求 2026-10-16：固定 152，与本轮验证目标 Chrome/152. 一致）
    pcParams: { platform: 'Windows', browser: 'Chrome', version: await getLatestKernelVersion() },
    bindFingerprint: true,          // 独立指纹
    // 系统本地代理（UseSystem + 会话内探测）；与 ipId 互斥，故不再继承参考分身 IP
    shopLanProxy: { enabled: true, networkType: 'UseSystem', probeOnSession: true },
  });
  const shop = (r.data || [])[0];
  if (!shop || !shop.id) throw new Error(`创建返回异常: ${JSON.stringify(r).slice(0, 150)}`);
  return { name: shop.name || name, id: shop.id };
}

/** 内核版本：创建分身时传给 pcParams.version 的浏览器内核大版本。
 *  用户要求 2026-10-16：固定 152（本轮验证目标就是 Chromium 152 内核 Chrome/152.）。
 *  此前按 portalstatics 默认填 138，会导致创建出的分身内核=138、与验证断言 152 对不上；现已改为 152。 */
async function getLatestKernelVersion() {
  return '152';
}

/** 删除指定名字的分身（不存在时静默成功） */
async function deleteClone(name) {
  const r = await api('POST', '/api/shop/pageV2', { names: [name], pageNum: 1, pageSize: 10 });
  const list = (r.data && r.data.list) || [];
  if (!list.length) return false;
  await api('POST', '/api/shop/delete', { ids: list.map((s) => s.id) }, { recycled: 'false', deleteFingerprint: 'true' });
  return true;
}

/** 清理所有 152- 前缀残留分身（job 收尾 always 调用；返回删除数） */
async function cleanupStaleClones(maxAgeMin = 0) {
  const r = await api('POST', '/api/shop/pageV2', { names: [PREFIX], pageNum: 1, pageSize: 100 });
  const list = (r.data && r.data.list) || [];
  const targets = list.filter((s) => (s.name || '').startsWith(PREFIX));
  if (!targets.length) return 0;
  const ids = targets.map((s) => s.id);
  await api('POST', '/api/shop/delete', { ids }, { recycled: 'false', deleteFingerprint: 'true' });
  return targets.length;
}

module.exports = { createClone, deleteClone, cleanupStaleClones, getPrimaryIpId, bindIpToClone };
