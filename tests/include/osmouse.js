/**
 * osmouse.js —— OS 级真鼠标（跨平台，2026-10-14 用户要求）
 *
 * 背景：CDP Input.dispatchMouseEvent 合成事件不会触发 Chromium 原生右键菜单（38501855187 实锤：
 *   bringToFront + 连拍 4 张 OCR 全无菜单）。「右键翻译」要真过必须 OS 级真实输入。
 *
 * 平台实现：
 *   Windows：spawn powershell -File tools/osmouse-win.ps1（SetCursorPos + mouse_event）
 *   macOS：  cliclick（brew 装一次；workflow 已装）r:<x>,<y> / c:<x>,<y>
 *   Linux：  xdotool（apt）mousemove x y + click 3(右)/1(左)
 *
 * 坐标 = 屏幕设备像素（与 screenshot-desktop 截图同坐标系，可直接用 OCR bbox）。
 * 用法：const { osRightClick, osLeftClick, osMouseSupported } = require('./include/osmouse');
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PS1 = path.resolve(__dirname, '..', '..', 'tools', 'osmouse-win.ps1');

function run(cmd, args, timeoutMs = 12000) {
  const r = spawnSync(cmd, args, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

// Windows: 安全策略禁「从 Bash 直调 powershell」，但 Node spawn 不受限
function winClick(x, y, button) {
  const r = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-X', String(x), '-Y', String(y), '-Button', button]);
  if (r.code !== 0) throw new Error(`ps1 exit=${r.code} ${r.err.slice(0, 80)}`);
  return true;
}

function macClick(x, y, button) {
  // cliclick 语法（38508986590 实锤：r: 报 Unrecognized action shortcut "r"）：
  // c:x,y=左键点击；rc:x,y=右键点击
  const sub = button === 'right' ? `rc:${x},${y}` : `c:${x},${y}`;
  const r = run('cliclick', [sub]);
  if (r.code !== 0) throw new Error(`cliclick exit=${r.code} ${r.err.slice(0, 80)}`);
  return true;
}

function linuxClick(x, y, button) {
  // xdotool: click 3=右键 1=左键（先 mousemove）
  const btn = button === 'right' ? 3 : 1;
  let r = run('xdotool', ['mousemove', String(x), String(y)]);
  if (r.code !== 0) throw new Error(`xdotool move exit=${r.code}`);
  r = run('xdotool', ['click', String(btn)]);
  if (r.code !== 0) throw new Error(`xdotool click exit=${r.code}`);
  return true;
}

function osMouseSupported() {
  if (process.platform === 'win32') return true;
  if (process.platform === 'darwin') return run('which', ['cliclick']).code === 0;
  if (process.platform === 'linux') return run('which', ['xdotool']).code === 0;
  return false;
}

function osClick(x, y, button) {
  if (process.platform === 'win32') return winClick(x, y, button);
  if (process.platform === 'darwin') return macClick(x, y, button);
  if (process.platform === 'linux') return linuxClick(x, y, button);
  throw new Error(`unsupported platform ${process.platform}`);
}

// 2026-10-17：OS 级按 Escape 键——用于右键前关掉偷焦点的原生对话框
// （run 38897029574 Ubuntu 实锤：tiktok 页弹「Open xdg-open?」对话框，右键菜单根本没弹，
//  OCR 4 连拍词数=0）。在**右键之前**发 Esc：此时浏览器右键菜单尚未打开，Esc 只会关掉
// 前置对话框/无操作，不会误关菜单。
function osPressEscape() {
  try {
    if (process.platform === 'linux') {
      const r = run('xdotool', ['key', 'Escape']);
      return r.code === 0;
    }
    if (process.platform === 'darwin') {
      // cliclick -k 27 = Escape 键码
      const r = run('cliclick', ['-k', '27']);
      return r.code === 0;
    }
    if (process.platform === 'win32') {
      // PowerShell SendKeys {ESC}（Node spawn 不受「禁从 Bash 直调 powershell」限制）
      const r = run('powershell.exe', ['-NoProfile', '-Command', '$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys(\'{ESC}\')']);
      return r.code === 0;
    }
  } catch (_) {}
  return false;
}

module.exports = { osClick, osRightClick: (x, y) => osClick(x, y, 'right'), osLeftClick: (x, y) => osClick(x, y, 'left'), osMouseSupported, osPressEscape };
