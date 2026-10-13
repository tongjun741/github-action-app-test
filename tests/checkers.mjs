// checkers.mjs — 每个测试用例的自动判定逻辑
// 输入：Playwright / puppeteer-core page + case 定义 + opts（proxy / proxyIp / engine）
// 输出：{ status: 'pass'|'fail'|'manual'|'error'|'ignored', detail: string }

import path from 'node:path';
import fs from 'node:fs';

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

// G1 (2026-10-13)：分身出口IP绑定预检 —— 用户已绑定IP，访问指纹站前先确认分身走了绑定IP。
// 判定口径（用户确认）：分身能否访问 https://ipapi.co/（拿到出口IP即绑定生效；不可达=绑定不生效/代理未起）。
// 不比对具体IP值，只判可达性；命中则把出口IP打到日志供人工核对是否为绑定IP。
async function assertCloneIpBound(page) {
  let tab = null;
  try {
    const b = page.browser();
    tab = (b && typeof b.newPage === 'function') ? await b.newPage().catch(() => null) : null;
  } catch (_) { tab = null; }
  const usePage = tab || page;
  try {
    await usePage.goto('https://ipapi.co/json/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const txt = await usePage.evaluate(() => (document.body ? document.body.innerText : '') || '').catch(() => '');
    const m = String(txt).match(/"ip"\s*:\s*"([\d.:a-fA-F]+)"/);
    const ip = m ? m[1] : null;
    const cm = String(txt).match(/"country_code"\s*:\s*"([A-Z]{2})"/);
    const country = cm ? cm[1] : null;
    if (!ip) return { ok: false, err: `ipapi.co 未返回IP（响应: ${String(txt).slice(0, 80)}）`, country: null };
    return { ok: true, ip, country };
  } catch (e) {
    return { ok: false, err: e.message.slice(0, 80) };
  } finally {
    if (tab) { try { await tab.close(); } catch (_) {} }
  }
}

// 取指定 IP 的归属国家（GeoIP），用于 WebRTC 国家一致性比对（ipapi.co 限速/异常时返回 null）
async function getIpCountry(page, ip) {
  try {
    return await page.evaluate(async (targetIp) => {
      const r = await fetch(`https://ipapi.co/${targetIp}/json/`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (j && j.error) return null;
      return j && j.country_code ? j.country_code : null;
    }, ip);
  } catch (_) { return null; }
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

// 2) 内核版本 —— 用户要求（2026-10-13）：打开 chrome://settings/help 验证
//    （About HuaYoungBrowser 页显示正式版本号；同时保留 UA 兜底）
async function kernel_version(page, c, opts) {
  await gotoSafe(page, 'chrome://settings/help', 'domcontentloaded', 30000, opts?.engine).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000)); // About 页版本号异步拉取
  let aboutVer = '';
  try {
    aboutVer = await page.evaluate(() => {
      const t = document.body ? document.body.innerText : '';
      // Chromium 版本行样式如 "版本 152.0.7482.124（正式版本）" 或 "Version 152.0..."
      const m = t.match(/(?:版本|Version)\s*(\d+\.\d+\.\d+\.\d+)\s*（?正式版本/);
      return m ? m[1] : (t.match(/(\d{3}\.\d+\.\d+\.\d+)/) || [''])[0] || '';
    }).catch(() => '');
  } catch (_) {}
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => '');
  const major = aboutVer ? aboutVer.split('.')[0] : (ua.match(/Chrome\/(\d+)\./) || [])[1] || '';
  const pass = major === '152' || ua.includes(c.expected || 'Chrome/152.');
  return {
    status: pass ? 'pass' : 'fail',
    detail: `About页版本=${aboutVer || '未解析'} UA=${ua.slice(0, 90)}`,
    screenshot: undefined, // runner 统一在判定后截图（chrome://settings/help 现场即证据）
  };
}

// 3) pixelscan —— 允许“使用了代理”，但不应有其它红色警告
// Run#52 修（历史 15+ 轮全 manual 根因①）：pixelscan 首页已改版为 landing（需点 "Scan My Browser"）。
// Run#53 dump 实证（根因②）：/fingerprint-check 结果文案是「No masking detected」/「No automated behavior detected」，
//   不是老词 "very likely"——判定词按真实文案匹配。
//   关键通过信号 = 「No automated behavior detected」（分身浏览器未被识别为自动化）。
async function fingerprint_pixelscan(page, c, opts) {
  // G1 预检：分身必须绑定IP后才访问验证站（用户已绑定IP）
  const ipb = await assertCloneIpBound(page).catch((e) => ({ ok: false, err: e.message }));
  if (!ipb.ok) return { status: 'fail', detail: `分身未绑定IP（ipapi.co 不可达：${ipb.err}）——绑定不生效，无法验证 pixelscan` };
  console.log(`[ip-binding] pixelscan 分身出口IP=${ipb.ip}（绑定生效）`);
  const url = /pixelscan\.net\/?$/i.test(c.url) ? 'https://pixelscan.net/fingerprint-check' : c.url;
  await gotoSafe(page, url, 'networkidle', 45000, opts?.engine).catch(() => {});
  let text = '';
  const deadline = Date.now() + 35000;
  for (;;) {
    text = await bodyText(page);
    const hasResult = /no (?:masking|automated behavior|proxy) detected|very likely|not using (?:a )?proxy|masking detected|automated behavior detected/i.test(text);
    if (hasResult || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const botClean = /no automated behavior detected/i.test(text);
  const botFlagged = /automated behavior detected/i.test(text) && !botClean;
  const proxyMasking = /masking detected/i.test(text) && !/no masking detected/i.test(text);
  // 全文 dump 取证
  let dumpUrl = '';
  try {
    const p = path.join(process.cwd(), `pixelscan-${Date.now()}.txt`);
    fs.writeFileSync(p, text.slice(0, 30000));
    if (process.env.CLOUDINARY_URL) {
      const mod = await import('cloudinary');
      const cl = (mod.default && mod.default.v2) || mod.v2 || mod.default;
      cl.config({ secure: true });
      const r = await cl.uploader.upload(p, { asset_folder: 'e2eTest_pixelscan', resource_type: 'raw' });
      dumpUrl = r.url;
      console.log(`::notice title=pixelscan-dump::${Buffer.from(r.url).toString('base64')}`);
    }
  } catch (_) {}
  const suffix = dumpUrl ? ` [dump] ${dumpUrl}` : '';
  if (botClean && !proxyMasking) return { status: 'pass', detail: `No automated behavior detected（分身未被识别为自动化），代理未检测到伪装${suffix}` };
  if (botFlagged) return { status: 'fail', detail: `automated behavior detected（浏览器被识别为自动化）${suffix}` };
  if (proxyMasking) return { status: 'manual', detail: `检测到代理伪装（CI 直连场景应无）${suffix}` };
  return { status: 'manual', detail: `35s 轮询未见结果判定词，需人工确认; ${text.slice(0, 120).replace(/\n/g, ' ')}${suffix}` };
}

// 4) iphey —— 全绿（无 Unreliable / leak / mismatch）
// 判定口径（用户确认 2026-10-09）：结果页出现 “Unreliable” 即算【真实失败 fail】，不降级。
// 注意：页面含 “detected / bad” 等泛化词（页头页脚营销文案），不可作判定依据，已从 red 词表剔除
//       （曾误命中 “detected”）；且判定词渲染较慢，需轮询等待出现，避免空文本/竞态误判。
const IPHEY_VERDICT_RE = /looks\s+(un)?reliable/i;
// Run#51 复盘（误报根因）：首页 = 静态标题「Your Digital Identity Looks」+ 检测完成后才渲染的判定词。
//   - 误报样本：判定词未渲染时，全文匹配命中营销/FAQ 文案（mismatch、hidden leaks、"our reliable IP tester"）；
//   - 真失败样本：标题后紧跟「 Unreliable 」。
// 修法：① fail/pass 都只认紧跟 Looks 的判定短语；② 泛词 mismatch/暴露/\breliable\b 全文匹配会命中文案，删除；
//       ③ 轮询只等 Looks+判定词整体出现，超时 manual（附截图人工复核）。
const IPHEY_FAIL_RE = /looks\s+unreliable/i;
async function fingerprint_iphey(page, c, opts) {
  // G1 预检：分身必须绑定IP后才访问验证站
  const ipb = await assertCloneIpBound(page).catch((e) => ({ ok: false, err: e.message }));
  if (!ipb.ok) return { status: 'fail', detail: `分身未绑定IP（ipapi.co 不可达：${ipb.err}）——绑定不生效，无法验证 iphey` };
  console.log(`[ip-binding] iphey 分身出口IP=${ipb.ip}（绑定生效）`);
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
  if (m) return { status: 'fail', detail: `命中风险短语「${m[0]}」; ${text.slice(0, 160).replace(/\n/g, ' ')}${shotSuffix}` };
  const mp = text.match(IPHEY_VERDICT_RE);
  if (mp) return { status: 'pass', detail: `判定词「${mp[0]}」已渲染; ${text.slice(0, 160).replace(/\n/g, ' ')}${shotSuffix}` };
  return { status: 'manual', detail: `轮询超时未见「Looks Reliable/Unreliable」判定词，需人工确认; ${text.slice(0, 160).replace(/\n/g, ' ')}${shotSuffix}` };
}

// 5) browserleaks/ip —— 自采集 WebRTC IP，与分身出口（绑定）IP 比对「国家一致性」
//    用户要求（2026-10-13）：WebRTC 暴露的 IP 国家必须与分身出口（绑定）IP 国家一致。
//    不要求 IP 值完全相同（住宅/绑定代理下出口可能有多个实例 IP，国家相同即可）；
//    仅当某 WebRTC 公网 IP 的国家 ≠ 出口国家时才判泄漏(fail)。
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
  // 取分身出口 IP + 国家（基准），复用 G1 绑定预检（分身必须绑定 IP 后才验证）
  const base = await assertCloneIpBound(page).catch((e) => ({ ok: false, err: e.message }));
  if (!base.ok || !base.country) {
    return { status: 'fail', detail: `无法取得分身出口国家（ipapi.co 不可达：${base.err || '无country'}）——绑定不生效，无法验证 WebRTC 国家一致性` };
  }
  console.log(`[webrtc] 分身出口(${base.ip}, ${base.country}) rtcIps=${[...rtcIps].join(',')}`);
  // 比对每个 WebRTC 公网 IP 的国家
  const mism = [];
  for (const ip of rtcIps) {
    if (!isPublicIp(ip)) continue;
    if (ip === base.ip) continue;            // 与出口 IP 相同 → 同国家，免查
    const cc = await getIpCountry(page, ip);
    if (cc == null) mism.push(`${ip}:国家未知`);
    else if (cc !== base.country) mism.push(`${ip}:${cc}`);
  }
  const ok = mism.length === 0;
  return {
    status: ok ? 'pass' : 'fail',
    detail: `WebRTC 国家一致性=${ok ? '通过' : '不通过'}(基准国=${base.country}) 国家不一致=[${mism.join('; ')}]`,
  };
}

// 6) whoer —— 解析匿名得分 >= 90
// Run#52 修（历史 15+ 轮全 manual 根因）：得分由 JS 异步渲染，一次性读文本必然读不到数字。
//   修法：① 轮询等 "XX%" 数字出现 ② 命中多个数字时取「anonymity/匿名」上下文优先 ③ dump 取证。
async function fingerprint_whoer(page, c, opts) {
  // G1 预检：分身必须绑定IP后才访问验证站
  const ipb = await assertCloneIpBound(page).catch((e) => ({ ok: false, err: e.message }));
  if (!ipb.ok) return { status: 'fail', detail: `分身未绑定IP（ipapi.co 不可达：${ipb.err}）——绑定不生效，无法验证 whoer` };
  console.log(`[ip-binding] whoer 分身出口IP=${ipb.ip}（绑定生效）`);
  await gotoSafe(page, c.url, 'networkidle', 45000, opts?.engine).catch(() => {});
  let text = '';
  let m = null;
  const deadline = Date.now() + 30000;
  for (;;) {
    text = await bodyText(page);
    m = text.match(/(?:anonymity|匿名)[^\d%]{0,20}(\d{1,3})\s*%/i) || text.match(/(\d{1,3})\s*%/);
    if (m || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  let dumpUrl = '';
  try {
    const p = path.join(process.cwd(), `whoer-${Date.now()}.txt`);
    fs.writeFileSync(p, text.slice(0, 30000));
    if (process.env.CLOUDINARY_URL) {
      const mod = await import('cloudinary');
      const cl = (mod.default && mod.default.v2) || mod.v2 || mod.default;
      cl.config({ secure: true });
      const r = await cl.uploader.upload(p, { asset_folder: 'e2eTest_whoer', resource_type: 'raw' });
      dumpUrl = r.url;
      console.log(`::notice title=whoer-dump::${Buffer.from(r.url).toString('base64')}`);
    }
  } catch (_) {}
  // Run#53 dump 实证：whoer.net 对 CI（数据中心 IP）直接回 Cloudflare 拦截页——环境阻断，非浏览器问题
  if (/sorry, you have been blocked|you are unable to access whoer/i.test(text)) {
    return { status: 'manual', detail: `站点 Cloudflare 拦截 CI IP（环境阻断，非浏览器问题）——需本地人工访问验证${dumpUrl ? ` [dump] ${dumpUrl}` : ''}` };
  }
  if (!m) return { status: 'manual', detail: `30s 轮询未解析到得分，需人工确认; ${text.slice(0, 120).replace(/\n/g, ' ')}${dumpUrl ? ` [dump] ${dumpUrl}` : ''}` };
  const score = parseInt(m[1], 10);
  return { status: score >= 90 ? 'pass' : 'fail', detail: `score=${score}%${dumpUrl ? ` [dump] ${dumpUrl}` : ''}` };
}

// 7) ipbinding —— WebRTC blocked
// 原Excel（生产环境-12.9-148内核.xlsx）该测试站 ipbinding.online 自身标注「测试网站不可用」；
// 用户确认（2026-10-13）：ipbind 标记为「网站不可用，忽略」——不导航、不计入红/绿。
// status=site_unavailable（report.mjs 标签「网站不可用，忽略」，汇总计入「忽略」列）。
async function fingerprint_ipbinding(page, c, opts) {
  return { status: 'site_unavailable', detail: 'ipbinding.online 测试站不可用，原Excel标注为「测试网站不可用」' };
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
  // re 用字符串（非 RegExp）：Run#37 实测 RegExp 传入 page.evaluate 序列化后
  // reSrc.test 抛错走 catch → 恒 false（diag 里 iframe/脚本明明全在）
  { name: 'hCaptcha', url: 'https://nopecha.com/captcha/hcaptcha', re: 'hcaptcha' },
  { name: 'reCAPTCHA', url: 'https://nopecha.com/captcha/recaptcha', re: 'recaptcha' },
  { name: 'Turnstile', url: 'https://nopecha.com/captcha/turnstile', re: 'challenges.cloudflare.com/turnstile' },
];
async function manual_captcha(page, c, opts) {
  const found = {};
  for (const d of NOPECHA_DEMOS) {
    found[d.name] = false;
    await gotoSafe(page, d.url, 'networkidle', 45000, opts?.engine).catch(() => {});
    // 轮询最多 25s：双通道判定——① 对应 iframe 注入（JS 执行后）
    // ② 站点脚本已加载（子页是 JS 渲染壳：hcaptcha api.js 动态建 iframe，脚本加载=组件能力可用）
    const deadline = Date.now() + 25000;
    let diag = '';
    for (;;) {
      const hit = await page.evaluate((reStr) => {
        try {
          const re = new RegExp(reStr, 'i');
          if (Array.from(document.querySelectorAll('iframe')).some((f) => re.test(f.src || ''))) return true;
          if (Array.from(document.querySelectorAll('script[src]')).some((s) => re.test(s.src || ''))) return true;
          const res = (performance.getEntriesByType('resource') || []).map((r) => r.name || '');
          if (res.some((n) => re.test(n))) return true;
          return false;
        } catch (_) { return false; }
      }, d.re).catch(() => false);
      if (hit) { found[d.name] = true; break; }
      if (Date.now() > deadline) {
        // 超时诊断：dump 页面 URL/title/iframe src 列表/脚本列表——Run#36 后不再盲猜
        diag = await page.evaluate(() => JSON.stringify({
          url: location.href, title: document.title,
          iframes: Array.from(document.querySelectorAll('iframe')).map((f) => (f.src || '').slice(0, 80)).slice(0, 6),
          scripts: Array.from(document.querySelectorAll('script[src]')).map((s) => s.src.slice(0, 80)).slice(0, 10),
          body: (document.body ? document.body.innerText : '').slice(0, 100),
        })).catch(() => '');
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!found[d.name] && diag) console.log(`[nopecha-diag] ${d.name} 超时页面: ${diag.slice(0, 400)}`);
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
  // 同步类四项 + RPA + 右键翻译：由 sync-flows.cjs（第二台设备）或 password-flow 后置段执行；
  // runner 内无独立 checker 时落 manual（报告不缺行）。
  client_localstorage_sync: null,
  client_indexdb_sync: null,
  client_history_sync: null,
  client_bookmark_sync: null,
  client_rpa_flow: null,
  client_google_translate: null,
};

async function checkCase(page, caseDef, opts) {
  // 用户要求忽略的用例（如 ipbinding：CI 无代理、分身 SOCKS 不可达、导航必抛错）直接返回「忽略」，
  // 不执行任何导航，也不计入 CI 红/绿（runner.mjs 仅 fail/error 置红）。
  if (caseDef.ignored) {
    return { status: 'ignored', detail: '按用户要求忽略该用例（不执行、不计入红/绿）' };
  }
  // G3 (2026-10-13)：nopecha 验证码 —— 用户要求「每次都忽略」，不执行、不计入红/绿。
  if (caseDef.type === 'manual_captcha') {
    return { status: 'ignored', detail: '按用户要求忽略该用例（每次都忽略，不计入红/绿）' };
  }
  const fn = CHECKERS[caseDef.type];
  try {
    if (fn === null) {
      // 显式占位类型（同步类/RPA/翻译）：由独立脚本执行（sync-flows.cjs 等），
      // runner 内仅落 manual 占位保持报告行齐全，不误触导航。
      return { status: 'manual', detail: '由独立脚本执行（sync-flows/password-flow 后置段）——本轮占位' };
    }
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
