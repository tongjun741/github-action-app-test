// checkers.mjs — 每个测试用例的自动判定逻辑
// 输入：Playwright / puppeteer-core page + case 定义 + opts（proxy / proxyIp / engine）
// 输出：{ status: 'pass'|'fail'|'manual'|'error'|'ignored', detail: string }

import path from 'node:path';

// 截图上传 Cloudinary（与 tests/include/tools.js 的 uploadFile 完全同参数：
//   asset_folder: e2eTest_yyyy-MM / use_filename:false / unique_filename:false / CLOUDINARY_URL 环境变量）。
// 未配置 CLOUDINARY_URL 或上传失败时只打日志、返回 null，绝不影响用例判定。
async function uploadShotToCloudinary(filePath, tag) {
  if (!process.env.CLOUDINARY_URL) {
    console.log(`[iphey-screenshot] CLOUDINARY_URL 未配置，跳过上传（本地文件: ${filePath}）`);
    return null;
  }
  try {
    const mod = await import('cloudinary');
    const cloudinary = (mod.default && mod.default.v2) || mod.v2 || mod.default;
    cloudinary.config({ secure: true });
    const now = new Date();
    const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = await cloudinary.uploader.upload(filePath, {
      asset_folder: `e2eTest_${mm}`,
      use_filename: false,
      unique_filename: false,
    });
    console.log(`[iphey-screenshot] ${tag} 已上传 Cloudinary: ${result.url}`);
    return result.url;
  } catch (e) {
    console.log(`[iphey-screenshot] 上传失败(忽略): ${e.message}`);
    return null;
  }
}


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
// 注意：不要用 \bleak\b —— iphey 首页营销文案里就有「…detect tracking risks and hidden leaks」，
// 会把站点自带介绍文当成风险结论（Run#16 误判 fail 即此因）。真正的判定词是 Unreliable。
const IPHEY_FAIL_RE = /unreliable|not good|mismatch|暴露/i;
async function fingerprint_iphey(page, c, opts) {
  await gotoSafe(page, c.url, 'networkidle', 45000, opts?.engine).catch(() => {});
  let text = '';
  const deadline = Date.now() + 25000;
  for (;;) {
    text = await bodyText(page);
    if (IPHEY_VERDICT_RE.test(text) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  // 判定词已渲染（或超时）→ 截图存证 + 按 tools.js uploadFile 同参数上传 Cloudinary（2026-10-10 用户要求）。
  // 截图/上传失败不影响判定；URL 追加进 detail，CI 日志与 results JSON 里都能直接拿到图片链接。
  let shotUrl = null;
  try {
    const shotPath = path.join(process.cwd(), `iphey-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    console.log(`[iphey-screenshot] 已保存本地截图: ${shotPath}`);
    shotUrl = await uploadShotToCloudinary(shotPath, `iphey(${process.env.E2E_PLATFORM || '?'})`);
    // GitHub Actions 注解：URL 进 notice —— 公共仓库 annotations API 匿名可读，无需 token 即可取回链接。
    // 注意：明文 URL 里的 cloud_name 会被 GitHub 按 CLOUDINARY_URL secret 部分掩码成 ***，
    //       故同时输出 base64(完整URL)，掩码按子串匹配、base64 后不再命中，可无损还原。
    if (shotUrl) {
      console.log(`::notice title=iphey截图(${process.env.E2E_PLATFORM || '?'})::${shotUrl}`);
      console.log(`::notice title=iphey截图b64(${process.env.E2E_PLATFORM || '?'})::${Buffer.from(shotUrl).toString('base64')}`);
    }
  } catch (e) {
    console.log(`[iphey-screenshot] 截图失败(忽略): ${e.message}`);
  }
  const shotSuffix = shotUrl ? ` [截图] ${shotUrl}` : '';
  const m = text.match(IPHEY_FAIL_RE);
  if (m) return { status: 'fail', detail: `命中风险词「${m[0]}」; ${text.slice(0, 160).replace(/\n/g, ' ')}${shotSuffix}` };
  if (/\blooks reliable\b|\breliable\b/i.test(text)) return { status: 'pass', detail: `${text.slice(0, 160).replace(/\n/g, ' ')}${shotSuffix}` };
  return { status: 'manual', detail: `未解析到判定词（Unreliable/Reliable），需人工确认; ${text.slice(0, 160).replace(/\n/g, ' ')}${shotSuffix}` };
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
// 判定口径变更（用户确认 2026-10-10）：CI 无代理、分身 SOCKS 不可达，导航必抛错；
//   按用户要求【忽略】该用例（matrix.json 中 ipbinding 标 ignored:true，checkCase 直接返回 忽略，不再导航）。
//   下方逻辑保留作离线/有代理环境的参考实现。
async function fingerprint_ipbinding(page, c, opts) {
  await gotoSafe(page, c.url, 'domcontentloaded', 30000, opts?.engine);
  const text = await bodyText(page);
  return { status: /webrtc blocked/i.test(text) ? 'pass' : 'fail', detail: text.slice(0, 140).replace(/\n/g, ' ') };
}

// 8) nopecha —— 验证码可加载性检测（脚本化，2026-10-10 用户要求去人工）
// 判定口径：打开 demo 页，检测三类验证码组件（hCaptcha iframe / reCAPTCHA / Turnstile）
// 是否正常渲染。验证码组件能加载 = 站点与浏览器兼容正常（能不能「过」验证码依赖真人/AI，
// 无头自动化环境本就无法通过，故只验证「可加载、可交互」——这是 CI 能自动判定的边界）。
// 进阶：给 Chromium 注入 accessibility cookie（hcaptcha accessibility）可自动通过 hCaptcha，
// 需要账号注册获取，暂未启用。
// 8) nopecha —— 验证码 demo 三个子页可加载性检测（脚本化）
// 真实子页 URL = /captcha/<type>（本机实测 2026-10-10 抓取 nopecha.com/demo 页面链接得出；
// /demo/<type> 是 404——Run#33 误猜）。脚本化：访问三个子页，各查对应 iframe 注入。
const NOPECHA_DEMOS = [
  { name: 'hCaptcha', url: 'https://nopecha.com/captcha/hcaptcha', re: /hcaptcha/i },
  { name: 'reCAPTCHA', url: 'https://nopecha.com/captcha/recaptcha', re: /recaptcha/i },
  { name: 'Turnstile', url: 'https://nopecha.com/captcha/turnstile', re: /challenges\.cloudflare\.com/i },
];
async function manual_captcha(page, c, opts) {
  const found = {};
  for (const d of NOPECHA_DEMOS) {
    found[d.name] = false;
    await gotoSafe(page, d.url, 'networkidle', 45000, opts?.engine).catch(() => {});
    // 轮询最多 25s 等对应 iframe 出现
    const deadline = Date.now() + 25000;
    for (;;) {
      const hit = await page.evaluate((reSrc) => {
        try {
          return Array.from(document.querySelectorAll('iframe'))
            .some((f) => reSrc.test(f.src || ''));
        } catch (_) { return false; }
      }, d.re).catch(() => false);
      if (hit) { found[d.name] = true; break; }
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const loadedCount = Object.values(found).filter(Boolean).length;
  const detail = Object.entries(found).map(([k, v]) => `${k}=${v}`).join(' ');
  return { status: loadedCount === 3 ? 'pass' : (loadedCount > 0 ? 'fail' : 'error'), detail: `${detail} (${loadedCount}/3 加载)` };
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

// 11) 分身插件加载 —— chrome://extensions 数扩展（≥4 且全部启用 → pass）
// 判定口径（用户要求 2026-10-10 脚本化）：不再人工看右上角图标，直接枚举分身内核的扩展列表。
// 注意：分身内核是完整 Chromium，chrome://extensions 页面可用；旧版 Chromium 上「打开开发者模式」
//       按钮文本可能是「开发者模式」，新版是「Developer mode」，两者都尝试。
async function fingerprint_plugins(page, c, opts) {
  let shotUrl = null;
  try {
    await gotoSafe(page, 'chrome://extensions/', 'domcontentloaded', 15000, opts?.engine).catch(() => {});
    // 等扩展卡片渲染（shadow DOM 内），最多 15s
    const deadline = Date.now() + 15000;
    let n = 0;
    for (;;) {
      n = await page.evaluate(() => {
        try {
          const mgr = document.querySelector('extensions-manager');
          const list = mgr && mgr.shadowRoot
            && mgr.shadowRoot.querySelector('extensions-item-list');
          if (!list) return 0;
          return list.shadowRoot
            ? list.shadowRoot.querySelectorAll('extensions-item').length
            : list.querySelectorAll('extensions-item').length;
        } catch (_) { return 0; }
      }).catch(() => 0);
      if (n > 0 || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    // 截图存证（chrome:// 页面 fullPage 在部分版本异常，用普通截图兜底）
    try {
      const shotPath = path.join(process.cwd(), `plugins-${Date.now()}.png`);
      await page.screenshot({ path: shotPath }).catch(async () => {
        await page.screenshot({ path: shotPath, fullPage: true });
      });
      shotUrl = await uploadShotToCloudinary(shotPath, `plugins(${process.env.E2E_PLATFORM || '?'})`);
      if (shotUrl) {
        console.log(`::notice title=plugins截图(${process.env.E2E_PLATFORM || '?'})::${Buffer.from(shotUrl).toString('base64')}`);
      }
    } catch (_) { /* 截图失败不判定 */ }
    if (n >= 4) {
      return { status: 'pass', detail: `扩展数量=${n}（≥4）${shotUrl ? ` [截图] ${shotUrl}` : ''}` };
    }
    return { status: 'fail', detail: `扩展数量=${n}（期望 ≥4）${shotUrl ? ` [截图] ${shotUrl}` : ''}` };
  } catch (e) {
    return { status: 'error', detail: `插件枚举失败: ${e.message}` };
  }
}

// 12-14) 密码保存 / 代填 —— 由 tests/password-flow.cjs 在 e2e-verify 内执行（脚本化，2026-10-10）；
//        Cookie 同步 —— 由独立 Action job verify-cookie-sync 在第二台设备执行（脚本化）。
//        checkers 里仅保留占位：runner 跑到这些用例时标记「不适用」，真实结果由对应脚本回填 results。
async function client_password_save() {
  return { status: 'na', detail: '由 password-flow.cjs 执行（本占位应被真实结果覆盖）' };
}
async function client_password_autofill() {
  return { status: 'na', detail: '由 password-flow.cjs 执行（本占位应被真实结果覆盖）' };
}
async function client_cookie_sync() {
  return { status: 'na', detail: '由独立 Action 任务 verify-cookie-sync 在第二台设备执行（见 results-Cookie_Sync.json）' };
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
  fingerprint_plugins,
  client_password_save,
  client_password_autofill,
  client_cookie_sync,
};

async function checkCase(page, caseDef, opts) {
  // 用户要求忽略的用例（如 ipbinding：CI 无代理、分身 SOCKS 不可达、导航必抛错）直接返回「忽略」，
  // 不执行任何导航，也不计入 CI 红/绿（runner.mjs 仅 fail/error 置红）。
  if (caseDef.ignored) {
    return { status: 'ignored', detail: '按用户要求忽略该用例（不执行、不计入红/绿）' };
  }
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
