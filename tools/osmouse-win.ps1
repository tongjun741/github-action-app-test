# osmouse-win.ps1 —— OS 级真鼠标（Windows SendInput/SetCursorPos + mouse_event）
# 2026-10-14 用户要求：右键翻译必须真鼠标（CDP 合成事件不触发 Chromium 原生菜单）。
# 用法: powershell -File tools/osmouse-win.ps1 -X 800 -Y 400 -Button right|left|move
# 坐标 = 屏幕设备像素（多屏可为负）。
param(
  [int]$X,
  [int]$Y,
  [ValidateSet('right','left','move')][string]$Button = 'move'
)
$code = @'
using System;
using System.Runtime.InteropServices;
public class OMouse {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
Add-Type -TypeDefinition $code
if ($env:OSMOUSE_DRY -eq '1') {
  Write-Output "DRY: would $Button click at ($X,$Y)"
  exit 0
}
[OMouse]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 60
switch ($Button) {
  'right' {
    [OMouse]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)  # RIGHTDOWN
    Start-Sleep -Milliseconds 40
    [OMouse]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)  # RIGHTUP
  }
  'left' {
    [OMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
    Start-Sleep -Milliseconds 40
    [OMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
  }
  'move' { }
}
Write-Output "OK $Button ($X,$Y)"
