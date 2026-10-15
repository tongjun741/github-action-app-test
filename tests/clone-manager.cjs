/**
 * clone-manager.cjs —— E2E 专用分身生命周期管理（2026-10-15 用户要求）
 *
 * 背景：所有平台共用同一分身（UA152）导致 password_save / localstorage 同步等用例互相干扰。
 * 新方案：每个平台 job 开始时创建**新分身**，job 内所有连续测试步骤共用它，job 结束(always)删除。
 *
 * 接口来源：客户端源码 E:\workspace\portalstatics（src/services/api-ShopAPI/ShopController.ts）
 *   - 创建分身：POST {API}/api/shop/batch            body: CreateShopsRequest
 *       （namePrefix + count:1 + type:'Global' + clientPlatform → 自动生成新指纹；返回 data[0].id/name）
 *   - 删除分身：POST {API}/api/shop/delete?recycled=false&deleteFingerprint=true   body: {ids:[...]}
 *   - 查询分身：POST {API}/api/shop/pageV2           body: {names:[前缀], pageNum:1, pageSize:50}
 *   - 认证：Header Authorization: <jwt>（客户端登录后 localStorage.jwt，无 Bearer 前缀）
 *           + x-dm-team-id: <团队ID>（与 UI teamIdHeaderInterceptor 一致）
 *   - 生产 API 基址：https://api.szdamai.com（db-生产.json API_URL 实证）
 *
 * jwt/teamId 获取：e2e-verify 登录进主界面后由 WDIO browser.execute() 从客户端 web 页面读取，
 * 写入 .e2e-auth.json（repo 根，workflow 内 job 级共享）。
 *
 * 用法（CI 步骤）：
 *   node tests/clone-manager.cjs create --platform Windows_10 [--run 38687447544]   # 创建，打印 CLONE_NAME=
 *   node tests/clone-manager.cjs delete --name E2E-xxx                               # 删除指定
 *   node tests/clone-manager.cjs cleanup --prefix E2E-                               # 按前缀清理残留（容错）
 */
const fs = require('node:fs');
const path = require('node:path');

const API_BASE = process.env.E2E_API_BASE || 'https://api.szdamai.com';
const AUTH_FILE = path.join(process.cwd(), '.e2e-auth.json');
const PLATFORMS = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };

function loadAuth() {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(`认证文件不存在: ${AUTH_FILE}（需先跑 e2e-verify 登录生成）`);
  }
  const { jwt, teamId } = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  if (!jwt || !teamId) throw new Error(`认证不完整: jwt=${!!jwt} teamId=${!!teamId}`);
  return { jwt, teamId };
}

async function api(method, urlPath, body, query) {
  const { jwt, teamId } = loadAuth();
  const u = new URL(API_BASE + urlPath);
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, String(v));
  const res = await fetch(u, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: jwt,          // 客户端约定：裸 jwt，无 Bearer 前缀（app.tsx authHeaderInterceptor）
      'x-dm-team-id': String(teamId),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} 非 JSON 响应: ${text.slice(0, 120)}`); }
  if (!res.ok || json.success === false) {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

// —— 创建：参照 UA152 规格（type=Global、count=1、自动生成新指纹、不绑 IP 直连）——
async function create(platform, runId) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `E2E-${platform}-${runId || 'local'}-${stamp}`;
  const r = await api('POST', '/api/shop/batch', {
    namePrefix: name,
    count: 1,
    type: 'Global',
    clientPlatform: PLATFORMS[process.platform] || 'Windows',
    recordPolicy: 'Disabled',      // E2E 分身不录像
  });
  const shop = (r.data || [])[0];
  if (!shop || !shop.id) throw new Error(`创建返回异常: ${JSON.stringify(r).slice(0, 200)}`);
  console.log(`[clone-manager] 已创建分身: id=${shop.id} name=${shop.name}`);
  console.log(`CLONE_ID=${shop.id}`);
  console.log(`CLONE_NAME=${shop.name}`);
  return shop;
}

async function del(names) {
  // 先按名查 id（pageV2 names 精确匹配）
  const r = await api('POST', '/api/shop/pageV2', { names, pageNum: 1, pageSize: 50 });
  const list = (r.data && r.data.list) || [];
  if (!list.length) { console.log(`[clone-manager] 未找到分身: ${names.join(',')}（可能已删）`); return; }
  const ids = list.map((s) => s.id);
  await api('POST', '/api/shop/delete', { ids }, { recycled: 'false', deleteFingerprint: 'true' });
  console.log(`[clone-manager] 已删除分身: ${ids.join(',')} (${list.map((s) => s.name).join(',')})`);
}

// —— 清理：按前缀找残留（names 传前缀时服务端做包含匹配，UI 行为一致）——
async function cleanup(prefix) {
  const r = await api('POST', '/api/shop/pageV2', { names: [prefix], pageNum: 1, pageSize: 100 });
  const list = (r.data && r.data.list) || [];
  const targets = list.filter((s) => (s.name || '').startsWith(prefix));
  if (!targets.length) { console.log(`[clone-manager] 无 ${prefix}* 残留`); return; }
  const ids = targets.map((s) => s.id);
  await api('POST', '/api/shop/delete', { ids }, { recycled: 'false', deleteFingerprint: 'true' });
  console.log(`[clone-manager] 已清理 ${targets.length} 个残留: ${targets.map((s) => s.name).join(', ')}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'create') {
    await create(arg('platform') || 'X', arg('run'));
  } else if (cmd === 'delete') {
    const name = arg('name');
    if (!name) throw new Error('delete 需要 --name');
    await del([name]);
  } else if (cmd === 'cleanup') {
    const prefix = arg('prefix') || 'E2E-';
    await cleanup(prefix);
  } else {
    console.log('用法: clone-manager.cjs <create|delete|cleanup> [--platform X] [--run N] [--name E2E-xx] [--prefix E2E-]');
    process.exit(2);
  }
}

main().catch((e) => { console.error(`[clone-manager] 失败: ${e.message}`); process.exit(1); });
