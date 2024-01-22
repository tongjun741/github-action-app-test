# 安装 Windows 更新 KB3080149
$output = "c:\vagrant\kb3080149.msu"
Write-Host "Installing KB3080149 update..."
Start-Process -FilePath "wusa.exe" -ArgumentList "/quiet", "/norestart", $output -Wait