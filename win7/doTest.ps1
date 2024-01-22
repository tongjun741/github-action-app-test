# 安装花漾客户端
Start-Process -FilePath "c:\vagrant\your_software_installer.exe" -ArgumentList "/S /qn" -Wait

# 检查安装目录是否存在
Get-ChildItem -Path "$env:LOCALAPPDATA\Programs"
Test-Path "$env:LOCALAPPDATA\Programs\HuaYoung\花漾客户端.exe"  

# 安装chromedriver
$destination = "$env:TEMP\chromedriver\win64-108\chromedriver-win64"
Write-Host "Extracting chromedriver package to $destination..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory("c:\vagrant\chromedriver_win32.zip", $destination)
Get-ChildItem -Path "$env:TEMP\chromedriver\win64-108"

# 执行测试
cd c:\vagrant
nmp install yarn -g
yarn
yarn wdio