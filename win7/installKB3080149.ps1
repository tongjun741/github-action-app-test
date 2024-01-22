# 下载并安装 Windows 更新 KB3080149
$url = "https://download.microsoft.com/download/4/E/8/4E864B31-7756-4639-8716-0379F6435016/Windows6.1-KB3080149-x64.msu"
$output = "$env:TEMP\kb3080149.msu"

Write-Host "Downloading KB3080149 update..."
$webClient = New-Object System.Net.WebClient
$webClient.DownloadFile($url, $output)

Write-Host "Installing KB3080149 update..."
Start-Process -FilePath "wusa.exe" -ArgumentList "/quiet", "/norestart", $output -Wait