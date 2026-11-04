# AURA: install the Microsoft Store package on this PC to try it before submitting.
# (Added by aura-store-setup.cjs)
#
# The Store signs AURA when it's published, so the package GitHub builds isn't signed and Windows
# won't install it as it is. This makes a TEST copy, signs it with a temporary certificate made just
# for this PC, and installs it. Upload the ORIGINAL AURA-Store-x.x.x.appx to Partner Center, never
# the test copy.
#
# How to use (needs the free Windows SDK for signtool, and PowerShell "Run as administrator"):
#   powershell -ExecutionPolicy Bypass -File build\aura-store-test.ps1 -Package C:\path\AURA-Store-1.36.3.appx
# To remove it again:
#   powershell -ExecutionPolicy Bypass -File build\aura-store-test.ps1 -Remove
param([string]$Package, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$Publisher = 'CN=E6B56AB7-1B45-4740-A412-E234538BDD63'
$Friendly = 'AURA Store test certificate'

if ($Remove) {
  Get-AppxPackage -Name 'TraylorDigital.AuraGamingHub' | Remove-AppxPackage
  Get-ChildItem Cert:\LocalMachine\TrustedPeople, Cert:\CurrentUser\My | Where-Object { $_.FriendlyName -eq $Friendly } | Remove-Item
  Write-Host 'Removed the test copy of Aura Gaming Hub and its test certificate.' -ForegroundColor Green
  exit 0
}
if (-not $Package -or -not (Test-Path $Package)) { throw 'Give the path to the .appx from the GitHub release, like -Package C:\Downloads\AURA-Store-1.36.3.appx' }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Open PowerShell with "Run as administrator" and run this again (Windows only trusts the test certificate for everyone on the PC).' }

$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found. Install the Windows SDK (free from Microsoft), then run this again.' }

$work = Join-Path $env:TEMP 'aura-store-test'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$test = Join-Path $work ('TEST-' + (Split-Path $Package -Leaf))
Copy-Item $Package $test -Force

# A certificate whose name matches AURA's publisher, used only to sign the test copy
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.FriendlyName -eq $Friendly } | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature -FriendlyName $Friendly `
    -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddMonths(3) `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
}
$pass = [guid]::NewGuid().ToString('N')
$pfx = Join-Path $work 'test.pfx'
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $pass -AsPlainText -Force) | Out-Null
$cer = Join-Path $work 'test.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

& $signtool.FullName sign /fd SHA256 /f $pfx /p $pass $test
if ($LASTEXITCODE -ne 0) { throw 'Signing the test copy failed (see above).' }
Remove-Item $pfx -Force

Get-AppxPackage -Name 'TraylorDigital.AuraGamingHub' | Remove-AppxPackage -ErrorAction SilentlyContinue
Add-AppxPackage -Path $test
Write-Host ''
Write-Host 'Installed the test copy of Aura Gaming Hub.' -ForegroundColor Green
Write-Host 'Quit your normal AURA from the tray first, then open "Aura Gaming Hub" from the Start menu.'
Write-Host 'When you are done:  powershell -ExecutionPolicy Bypass -File build\aura-store-test.ps1 -Remove'
