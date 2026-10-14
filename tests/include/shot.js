/**
 * shot.js —— 统一全屏截图 + 水印（2026-10-14 用户要求）
 *
 * 用户四项要求：
 *   1) 所有平台桌面分辨率 ≥1440×1080（workflow 侧设置；此处仅读取）
 *   2) 所有截图 = OS 级全屏（含任务栏/Dock），不能只截浏览器视口 —— 用 screenshot-desktop
 *   3) 截图顶部加明显水印：当前平台 + 安装包文件名
 *   4) Excel 里的截图文件名包含所在目录名 —— 存 shots/<平台>/ 下，screenshot 字段带目录前缀
 *
 * 用法：
 *   const { fullShot, shotDirFor, watermarkText } = require('./include/shot');
 *   const relPath = await fullShot('shot-Windows_10-open_session'); // → shots/Windows_10/shot-...-<ts>.png
 *
 * 失败兜底：screenshot-desktop 失败（如无显示服务器）返回 null，调用方记日志、不影响判定。
 */
const fs = require('node:fs');
const path = require('node:path');
const screenshotDesktop = require('screenshot-desktop');

const PLATFORM = (process.env.E2E_PLATFORM || 'unknown').replace(/\s+/g, '_');
const INSTALLER = process.env.E2E_INSTALLER_NAME || process.env.INSTALLER_NAME || '';

// 截图目录：shots/<平台>/。CI 工作目录即仓库根。
function shotDirFor(platform) {
  const p = String(platform || PLATFORM).replace(/\s+/g, '_');
  return path.join('shots', p);
}

function watermarkText() {
  // 水印 = 平台 + 安装包文件名（明显、单行）
  return INSTALLER ? `${PLATFORM} | ${INSTALLER}` : PLATFORM;
}

let _jimp = null;
async function loadJimp() {
  if (!_jimp) {
    const mod = await import('jimp');
    _jimp = mod.default || mod.Jimp || mod;
  }
  return _jimp;
}

/**
 * OS 级全屏截图 + 顶部水印条。
 * @param {string} baseName 截图基础名（不含扩展名），如 'shot-Windows_10-open_session'
 * @param {object} opts { upload: async (localPath)=>url } 可选上传函数（如 Cloudinary）
 * @returns {Promise<string|null>} 相对路径（shots/<平台>/<baseName>-<ts>.png）或 null（失败）
 */
async function fullShot(baseName, opts = {}) {
  try {
    const dir = shotDirFor();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${baseName}-${Date.now()}.png`);
    const buf = await screenshotDesktop({ format: 'png' });
    // 顶部水印条：高 ~56px（按图高自适应 4%），半透明深色底 + 白字，左上角
    try {
      const Jimp = await loadJimp();
      const img = await Jimp.read(buf);
      const barH = Math.max(40, Math.round(img.height * 0.045));
      const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
      const bar = new Jimp({ width: img.width, height: barH, color: 0x000000cc });
      // 水印文字：平台 | 安装包名（过长截断，避免溢出）
      const txt = watermarkText().slice(0, Math.floor(img.width / 18));
      bar.print({ font, x: 12, y: Math.max(4, Math.round((barH - 32) / 2)) }, txt);
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
    return file;
  } catch (e) {
    console.log(`[shot] 全屏截图失败: ${e.message.slice(0, 80)}`);
    return null;
  }
}

module.exports = { fullShot, shotDirFor, watermarkText };
