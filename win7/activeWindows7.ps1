slmgr.vbs /upk

slmgr /ipk 33PXH-7Y6KF-2VJC9-XBBR8-HVTHH

slmgr /skms win.kms.pub

slmgr /ato


do {
  $activationInfo = Get-CimInstance SoftwareLicensingProduct -Filter "Name like 'Windows%'" | Where-Object { $_.PartialProductKey } | Select-Object Description, LicenseStatus

 if ($activationInfo.LicenseStatus -eq 1) {
    Write-Host "Windows is activated."
    break
  } else {
    Write-Host "Waiting for system activation to complete..."
    Start-Sleep -Seconds 10
  }
} while ($true)
