/**
 * clone-helper.cjs —— e2e-verify 进程内创建/删除 E2E 分身（2026-10-15 新分身方案）
 *
 * 与 clone-manager.cjs（CLI 版）共用同一套 API：
 *   创建 POST /api/shop/batch；删除 POST /api/shop/delete；查询 POST /api/shop/pageV2
 * 认证从 .e2e-auth.json（e2e-verify 登录后导出的 jwt/teamId）。
 *
 * 命名规范：E2E-<平台>-<runId>-<时间戳>（runId 保证同轮可追溯，时间戳防碰撞）
 * 清理规范：按前缀 E2E- 清理（workflow always 步调用 cleanupStaleClones）
 */
const fs = require('node:fs');
const path = require('node:path');

const API_BASE = process.env.E2E_API_BASE || 'https://api.szdamai.com';
const AUTH_FILE = path.join(process.cwd(), '.e2e-auth.json');
const PLATFORMS = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };
const PREFIX = 'E2E-';

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

/** 创建本平台专属新分身（参照 UA152 规格：Global + 独立指纹 + 不录像），并继承参考分身的主 IP。
 *  refCloneName：参考分身（默认 UA152）——取其 primary 通道 ipId 绑到新分身，保证 IP 环境一致（用户要求 2026-10-15）。
 *  返回 { name, id, ipBound } */
async function createClone(platform, runId, refCloneName = 'UA152') {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const name = `${PREFIX}${String(platform).replace(/\s+/g, '_')}-${runId || 'local'}-${stamp}`;
  // 先取参考分身的主 IP（创建前取——绑定的 IP 才可用）
  let refIpId = null;
  try { refIpId = await getPrimaryIpId(refCloneName); } catch (e) { /* 查询失败按无 IP 处理 */ }
  const r = await api('POST', '/api/shop/batch', {
    namePrefix: name,
    count: 1,
    type: 'Global',
    clientPlatform: PLATFORMS[process.platform] || 'Windows',
    recordPolicy: 'Disabled',
  });
  const shop = (r.data || [])[0];
  if (!shop || !shop.id) throw new Error(`创建返回异常: ${JSON.stringify(r).slice(0, 150)}`);
  // 继承参考分身的主 IP（用户要求：新分身必须绑定现有 IP，保证出口一致）
  let ipBound = false;
  if (refIpId) {
    try { await bindIpToClone(refIpId, shop.id); ipBound = true; }
    catch (e) { throw new Error(`新分身已创建(id=${shop.id})但绑 IP 失败(ipId=${refIpId}): ${e.message.slice(0, 120)}`); }
  }
  return { name: shop.name || name, id: shop.id, ipBound };
}

/** 删除指定名字的分身（不存在时静默成功） */
async function deleteClone(name) {
  const r = await api('POST', '/api/shop/pageV2', { names: [name], pageNum: 1, pageSize: 10 });
  const list = (r.data && r.data.list) || [];
  if (!list.length) return false;
  await api('POST', '/api/shop/delete', { ids: list.map((s) => s.id) }, { recycled: 'false', deleteFingerprint: 'true' });
  return true;
}

/** 清理所有 E2E- 前缀残留分身（job 收尾 always 调用；返回删除数） */
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
