slmgr.vbs /upk

slmgr /ipk 33PXH-7Y6KF-2VJC9-XBBR8-HVTHH

slmgr /skms win.kms.pub

slmgr /ato


do {
  $activationInfo = Get-CimInstance SoftwareLicensingProduct -Filter "Name like 'Windows%'" | Where-Object { $_.PartialProductKey } | Select-Object Description, LicenseStatus

  if ($activationInfo.LicenseStatus -eq 1) {
    Write-Host "Windows 已激活。"
    break
  } else {
    Write-Host "等待系统激活完成..."
    Start-Sleep -Seconds 10
  }
} while ($true)
