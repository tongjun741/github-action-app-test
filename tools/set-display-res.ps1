# set-display-res.ps1 —— 设置 Windows 桌面分辨率（GitHub runner 虚拟显示驱动）
# 2026-10-14 用户要求：所有平台桌面分辨率 ≥1440×1080 —— 设 1600x1200。
# 用法: powershell -File tools/set-display-res.ps1 [-Width 1600] [-Height 1200]
# 失败仅告警不阻塞（截图可能小于目标，但不影响验证流程）。
param(
  [int]$Width = 1600,
  [int]$Height = 1200
)
$ErrorActionPreference = 'Continue'

$code = @'
using System;
using System.Runtime.InteropServices;
public class DisplayRes {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize;
    public short dmDriverExtra; public int dmFields; public int dmPositionX;
    public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption;
    public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth;
    public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency;
    public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmICCManufacturer;
    public int dmICCDeviceName; public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);
  public static string Set(int w, int h) {
    DEVMODE dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (EnumDisplaySettings(null, -1, ref dm) == 0) return "EnumDisplaySettings failed";
    dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmBitsPerPel = 32;
    dm.dmFields = 0x80000 | 0x100000 | 0x40000;
    int r = ChangeDisplaySettings(ref dm, 0);
    return r == 0 ? "OK" : ("ChangeDisplaySettings=" + r);
  }
}
'@
try {
  Add-Type -TypeDefinition $code
  $r = [DisplayRes]::Set($Width, $Height)
  Write-Host "display-res ${Width}x${Height}: $r"
  if ($r -ne 'OK') { Write-Host "::warning::resolution not set ($r)" }
} catch {
  Write-Host "::warning::display-res exception: $($_.Exception.Message)"
}
