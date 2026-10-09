// checkers.mjs — 每个测试用例的自动判定逻辑
// 输入：Playwright / puppeteer-core page + case 定义 + opts（proxy / proxyIp / engine）
// 输出：{ status: 'pass'|'fail'|'manual'|'error', detail: string }

function isPublicIp(ip) {
  if (!ip) return false;
  if (ip.includes(':')) return true; // IPv6 视为公网
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return false;
  if (p[0] === 10) return false;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
  if (p[0] === 192 && p[1] === 168) return false;
  if (p[0] === 127) return false;
  if (p[0] === 169 && p[1] === 254) return false;
  return true;
}

async function bodyText(page) {
  return page.evaluate(() => (document.body ? document.body.innerText : '') || '');
}

// waitUntil 兼容：Playwright 支持 'networkidle'；puppeteer-core 不支持，需映射为 'networkidle2'
async function gotoSafe(page, url, wait = 'domcontentloaded', timeout = 30000, engine = 'playwright') {
  const w = engine === 'puppeteer' && wait === 'networkidle' ? 'networkidle2' : wait;
  const resp = await page.goto(url, { waitUntil: w, timeout });
  return resp;
}

// 1) 打开会话是否成功 —— 导航到 qq.com 能正常加载
async function navigation(page, c, opts) {
  const resp = await gotoSafe(page, c.url, 'domcontentloaded', 30000, opts?.engine);
  const text = await bodyText(page);
  const ok = resp && resp.status() < 400 && text.length > 50;
  return { status: ok ? 'pass' : 'fail', detail: `status=${resp && resp.status()} bodyLen=${text.length}` };
}

// 2) 内核版本 —— 读取 UA 中的 Chromium 版本
async function kernel_version(page, c, opts) {
  await gotoSafe(page, 'about:blank', 'domcontentloaded', 30000, opts?.engine);
  const ua = await page.evaluate(() => navigator.userAgent);
  const pass = ua.includes(c.expected);
  return { status: pass ? 'pass' : 'fail', detail: `UA=${ua}` };
}

// 3) pixelscan —— 允许“使用了代理”，但不应有其它红色警告
async function fingerprint_pixelscan(page, c, opts) {
  await gotoSafe(page, c.url, 'networkidle', 45000, opts?.engine).catch(() => {});
  const text = await bodyText(page);
  const proxy = /very likely you are using proxy/i.test(text);
  const other = /very likely/i.test(text.replace(/very likely you are using proxy/i, ''));
  if (!proxy) return { status: 'manual', detail: '未检测到代理提示，需人工确认（本机直连场景）' };
  return { status: other ? 'fail' : 'pass', detail: `proxyHint=${proxy} otherWarn=${other}` };
}

// 4) iphey —— 全绿（无 Unreliable / leak / mismatch）
// 判定口径（用户确认 2026-10-09）：结果页出现 “Unreliable” 即算【真实失败 fail】，不降级。
// 注意：页面含 “detected / bad” 等泛化词（页头页脚营销文案），不可作判定依据，已从 red 词表剔除
//       （曾误命中 “detected”）；且判定词渲染较慢，需轮询等待出现，避免空文本/竞态误判。
const IPHEY_VERDICT_RE = /unreliable|looks reliable|\breliable\b/i;
const IPHEY_FAIL_RE = /unreliable|not good|mismatch|\bleak\b|暴露/i;
async function fingerprint_iphey(page, c, opts) {
  await gotoSafe(page, c.url, 'networkidle', 45000, opts?.engine).catch(() => {});
  let text = '';
  const deadline = Date.now() + 25000;
  for (;;) {
    text = await bodyText(page);
    if (IPHEY_VERDICT_RE.test(text) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const m = text.match(IPHEY_FAIL_RE);
  if (m) return { status: 'fail', detail: `命中风险词「${m[0]}」; ${text.slice(0, 160).replace(/\n/g, ' ')}` };
  if (/\blooks reliable\b|\breliable\b/i.test(text)) return { status: 'pass', detail: text.slice(0, 160).replace(/\n/g, ' ') };
  return { status: 'manual', detail: `未解析到判定词（Unreliable/Reliable），需人工确认; ${text.slice(0, 160).replace(/\n/g, ' ')}` };
}

// 5) browserleaks/ip —— 自采集 WebRTC IP，与代理 IP 比对
async function fingerprint_webrtc(page, c, opts) {
  await gotoSafe(page, c.url, 'domcontentloaded', 30000, opts?.engine);
  const rtcIps = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      const ips = new Set();
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.createDataChannel('');
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            const m = e.candidate.candidate;
            const ip = (m.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1];
            if (ip) ips.add(ip);
          }
        };
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
      } catch (_) {}
      setTimeout(() => resolve([...ips]), 3500);
    });
  });
  let publicIp = opts.proxyIp || null;
  if (!publicIp) {
    try {
      publicIp = await page.evaluate(async () => {
        const r = await fetch('https://api.ipify.org?format=json');
        return (await r.json()).ip;
      });
    } catch (_) {}
  }
  const leak = rtcIps.some((ip) => isPublicIp(ip) && ip !== publicIp);
  return { status: leak ? 'fail' : 'pass', detail: `rtcIps=${[...rtcIps].join(',')} publicIp=${publicIp || 'n/a'}` };
}

// 6) whoer —— 解析匿名得分 >= 90
async function fingerprint_whoer(page, c, opts) {
  await gotoSafe(page, c.url, 'networkidle', 45000, opts?.engine).catch(() => {});
  const text = await bodyText(page);
  const m = text.match(/(\d{1,3})\s*%/);
  if (!m) return { status: 'manual', detail: '无法从页面解析得分，需人工确认' };
  const score = parseInt(m[1], 10);
  return { status: score >= 90 ? 'pass' : 'fail', detail: `score=${score}%` };
}

// 7) ipbinding —— WebRTC blocked
// 判定口径（用户确认 2026-10-09）：CI 无代理时，分身自配的 SOCKS 不可达 -> 导航抛错
//   -> 保持 error（不降级为 manual/skipped）。
async function fingerprint_ipbinding(page, c, opts) {
  await gotoSafe(page, c.url, 'domcontentloaded', 30000, opts?.engine);
  const text = await bodyText(page);
  return { status: /webrtc blocked/i.test(text) ? 'pass' : 'fail', detail: text.slice(0, 140).replace(/\n/g, ' ') };
}

// 8) nopecha —— 需人工过验证码
async function manual_captcha() {
  return { status: 'manual', detail: '需人工打开三个验证码链接并手工通过' };
}

// 9) fingerprint-scan —— 分数 < 50
async function fingerprint_score(page, c, opts) {
  await gotoSafe(page, c.url, 'networkidle', 45000, opts?.engine).catch(() => {});
  const text = await bodyText(page);
  const m = text.match(/score[^0-9]*(\d{1,3})/i) || text.match(/(\d{1,3})\s*\/\s*100/);
  if (!m) return { status: 'manual', detail: '无法解析指纹分数，需人工确认' };
  const score = parseInt(m[1], 10);
  return { status: score < 50 ? 'pass' : 'fail', detail: `score=${score}` };
}

// 10) devtools-detector —— devtools status: close
async function fingerprint_devtools(page, c, opts) {
  await gotoSafe(page, c.url, 'networkidle', 45000, opts?.engine).catch(() => {});
  const text = await bodyText(page);
  const close = /devtools status:\s*close/i.test(text);
  const open = /devtools status:\s*open/i.test(text);
  return { status: close ? 'pass' : open ? 'fail' : 'manual', detail: text.slice(0, 80).replace(/\n/g, ' ') };
}

// 11) 分身插件加载 —— 需 UI 检查
async function client_plugins() {
  return { status: 'manual', detail: '需人工确认右上角四个插件可加载并可点开' };
}

// 12-14) 密码保存 / 代填 / Cookie 同步 —— 需账号与 UI
async function client_password_save() {
  return { status: 'manual', detail: '需人工登录 wdku.net 并确认保存密码提示' };
}
async function client_password_autofill() {
  return { status: 'manual', detail: '需人工确认自动代填并登录成功' };
}
async function client_cookie_sync() {
  return { status: 'manual', detail: '需人工在另一台设备确认已登录态' };
}

const CHECKERS = {
  navigation,
  kernel_version,
  fingerprint_pixelscan,
  fingerprint_iphey,
  fingerprint_webrtc,
  fingerprint_whoer,
  fingerprint_ipbinding,
  manual_captcha,
  fingerprint_score,
  fingerprint_devtools,
  client_plugins,
  client_password_save,
  client_password_autofill,
  client_cookie_sync,
};

async function checkCase(page, caseDef, opts) {
  const fn = CHECKERS[caseDef.type];
  try {
    if (!fn) {
      if (caseDef.url) return await navigation(page, caseDef, opts);
      return { status: 'manual', detail: '未实现自动判定，需人工确认' };
    }
    return await fn(page, caseDef, opts);
  } catch (e) {
    return { status: 'error', detail: String((e && e.message) || e) };
  }
}

export { checkCase };
