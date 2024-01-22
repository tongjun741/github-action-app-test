# 下载并解压缩 Node.js 包
$url = "https://nodejs.org/dist/latest-v18.x/node-v18.19.0-win-x64.zip"
$output = "$env:TEMP\nodejs.zip"
$destination = "C:\nodejs"

Write-Host "Downloading Node.js package..."
$webClient.DownloadFile($url, $output)

Write-Host "Extracting Node.js package to $destination..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($output, $destination)

# 配置 Node.js 环境变量
$nodePath = Join-Path $destination "node-v18.19.0-win-x64"
$env:Path = "$nodePath;$env:Path"

$newPathValue = "$env:Path;$nodePath"
[Environment]::SetEnvironmentVariable("Path", $newPathValue, "Machine")

Write-Host "Setting NODE_SKIP_PLATFORM_CHECK environment variable..."
[Environment]::SetEnvironmentVariable("NODE_SKIP_PLATFORM_CHECK", "1", "Machine")

# 验证 Node.js 版本
Write-Host "Node.js version information:"
node --version