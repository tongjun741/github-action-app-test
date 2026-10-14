/**
 * shot.js —— 统一全屏截图 + 水印（2026-10-14 用户要求）
 *
 * 用户四项要求：
 *   1) 所有平台桌面分辨率 ≥1440×1080（workflow 侧设置；此处仅读取）
 *   2) 所有截图 = OS 级全屏（含任务栏/Dock），不能只截浏览器视口 —— 用 screenshot-desktop
 *   3) 截图顶部加明显水印：当前平台 + 安装包文件名
 *   4) Excel 里的截图文件名包含所在目录名 —— 存 shots/<操作系统>/<平台>/ 下，screenshot 字段带目录前缀
 *
 * 2026-10-14（补充）：截图按操作系统分目录。结构示例：
 *   shots/windows/Windows_10/、shots/windows/Windows_7/
 *   shots/macos/macOS_arm64/、shots/macos/macOS_x64/
 *   shots/linux/Ubuntu_22/
 *
 * 用法：
 *   const { fullShot, shotDirFor, watermarkText } = require('./include/shot');
 *   const relPath = await fullShot('shot-Windows_10-open_session'); // → shots/windows/Windows_10/shot-...-<ts>.png
 *
 * 失败兜底：screenshot-desktop 失败（如无显示服务器）返回 null，调用方记日志、不影响判定。
 */
const fs = require('node:fs');
const path = require('node:path');
const screenshotDesktop = require('screenshot-desktop');

const PLATFORM = (process.env.E2E_PLATFORM || 'unknown').replace(/\s+/g, '_');
const INSTALLER = process.env.E2E_INSTALLER_NAME || process.env.INSTALLER_NAME || '';

// 操作系统家族映射：平台名 → 顶层目录（windows / macos / linux）
function osFamilyOf(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.startsWith('windows') || p === 'win' || p === 'win32') return 'windows';
  if (p.startsWith('macos') || p.startsWith('mac') || p === 'darwin') return 'macos';
  if (p.startsWith('ubuntu') || p.startsWith('linux') || p === 'debian') return 'linux';
  return 'other';
}

// 截图目录：shots/<操作系统>/<平台>/。CI 工作目录即仓库根。
// 例：shots/windows/Windows_10/、shots/macos/macOS_arm64/、shots/linux/Ubuntu_22/
function shotDirFor(platform) {
  const p = String(platform || PLATFORM).replace(/\s+/g, '_');
  const os = osFamilyOf(p);
  return path.join('shots', os, p);
}

function watermarkText() {
  // 水印 = 平台 + 安装包文件名（明显、单行）
  return INSTALLER ? `${PLATFORM} | ${INSTALLER}` : PLATFORM;
}

let _jimpMod = null;
async function loadJimp() {
  // jimp v1 API（本地实测 2026-10-14）：具名导出 { Jimp, loadFont, measureText }；
  // 字体常量已移除——.fnt 文件在 @jimp/plugin-print/fonts/open-sans/<size>-white/ 下。
  if (!_jimpMod) {
    const mod = require('jimp');
    _jimpMod = mod.default || mod;
  }
  return _jimpMod;
}

let _font32 = null;
async function loadFont32() {
  if (_font32) return _font32;
  const path = require('node:path');
  const { loadFont } = await loadJimp();
  let fnt = null;
  for (const cand of [
    '@jimp/plugin-print/fonts/open-sans/open-sans-32-white/open-sans-32-white.fnt',
    'jimp/fonts/open-sans/open-sans-32-white/open-sans-32-white.fnt',
  ]) {
    try {
      const base = path.dirname(require.resolve(cand.split('/fonts/')[0] + '/package.json'));
      const p = path.join(base, 'fonts', 'open-sans', 'open-sans-32-white', 'open-sans-32-white.fnt');
      if (require('node:fs').existsSync(p)) { fnt = p; break; }
    } catch (_) {}
  }
  if (!fnt) throw new Error('32px white font not found');
  _font32 = await loadFont(fnt);
  return _font32;
}

/**
 * OS 级全屏截图 + 顶部水印条。
 * @param {string} baseName 截图基础名（不含扩展名），如 'shot-Windows_10-open_session'
 * @param {object} opts { upload: async (localPath)=>url } 可选上传函数（如 Cloudinary）
 * @returns {Promise<string|null>} 相对路径（shots/<操作系统>/<平台>/<baseName>-<ts>.png）或 null（失败）
 */
async function fullShot(baseName, opts = {}) {
  try {
    const dir = shotDirFor();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${baseName}-${Date.now()}.png`);
    // macOS：screenshot-desktop 依赖 TCC 屏幕录制权限（runner 无 → No displays detected）。
    // 改用系统 screencapture -x（静默全屏）；仍失败（如完全无 GUI 会话）由外层兜底。
    let buf = null;
    if (process.platform === 'darwin') {
      try {
        const { execSync } = require('node:child_process');
        const tmpCap = path.join(require('node:os').tmpdir(), `scap-${Date.now()}.png`);
        execSync(`screencapture -x ${JSON.stringify(tmpCap)}`, { timeout: 15000 });
        buf = fs.readFileSync(tmpCap);
        try { fs.unlinkSync(tmpCap); } catch (_) {}
      } catch (e) {
        console.log(`[shot] screencapture 失败: ${e.message.slice(0, 60)}`);
      }
    }
    if (!buf) buf = await screenshotDesktop({ format: 'png' });
    // 顶部水印条：高 ~56px（按图高自适应 4%），半透明深色底 + 白字，左上角
    // jimp v1（本地实测）：loadFont 顶层函数；print({font,text,x,y})；measureText 顶层。
    try {
      const { Jimp, measureText } = await loadJimp();
      const font = await loadFont32();
      const img = await Jimp.read(buf);
      const barH = Math.max(40, Math.round(img.height * 0.045));
      const txt = watermarkText();
      // 文本过长时缩字号不可行（位图字体固定）——按宽度截断
      const maxW = img.width - 24;
      let shown = txt;
      try {
        while (shown.length > 8 && measureText(font, shown) > maxW) shown = shown.slice(0, -8) + '…';
      } catch (_) { shown = shown.slice(0, Math.floor(maxW / 18)); }
      const bar = new Jimp({ width: img.width, height: barH, color: 0x000000cc });
      bar.print({ font, text: shown, x: 12, y: Math.max(4, Math.round((barH - 32) / 2)) });
      const composited = img.composite(bar, 0, 0);
      await composited.write(file);
    } catch (e) {
      // 水印失败（jimp 异常）→ 保底落原始截图，水印缺失不丢证据
      fs.writeFileSync(file, buf);
      console.log(`[shot] 水印失败(保底原图): ${e.message.slice(0, 60)}`);
    }
    if (opts.upload) {
      try { const url = await opts.upload(file); if (url) console.log(`[shot] 已上传: ${url}`); } catch (_) {}
    }
    console.log(`[shot] 全屏截图: ${file}`);
    // 统一正斜杠（Windows path.join 产生 \，Excel 引用与 zip 内路径需一致）
    return file.replace(/\\/g, '/');
  } catch (e) {
    console.log(`[shot] 全屏截图失败: ${e.message.slice(0, 80)}`);
    return null;
  }
}

module.exports = { fullShot, shotDirFor, watermarkText };
