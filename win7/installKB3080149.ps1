# 安装 Windows 更新 KB3080149
$output = "c:\vagrant\kb3080149.msu"
Write-Host "Installing KB3080149 update..."
Start-Process -FilePath "wusa.exe" -ArgumentList "/quiet", "/norestart", $output -Wait -NoNewWindow

while (-not (Get-Process -Name "TrustedInstaller" -ErrorAction SilentlyContinue)) {
    Start-Sleep -Seconds 5
    Write-Host "Waiting for installation to start..."
}

while ((Get-Process -Name "TrustedInstaller" -ErrorAction SilentlyContinue)) {
    Write-Host "Waiting for installation to finish..."
    Start-Sleep -Seconds 5
}

Write-Host "Installation completed."
