<#
.SYNOPSIS
  Uninstalls the ustcode CLI from Windows.

.DESCRIPTION
  Removes the ustcode binary directory ($HOME\.ustcode), removes the install
  directory from the user PATH, and (optionally) removes user data and config.
  Mirrors the behavior of the bash `uninstall` script.

.PARAMETER Purge
  Also remove user data and config (logs, sessions, settings).

.PARAMETER Help
  Show this help.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File uninstall.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Purge
#>
[CmdletBinding()]
param(
  [Alias("h")]
  [switch]$Help,
  [switch]$Purge
)

$ErrorActionPreference = "Stop"

if ($Help) {
  Get-Help $PSCommandPath
  exit 0
}

$App = "ustcode"

# ---- Remove binary dir -----------------------------------------------------
$installDir = Join-Path $HOME ".ustcode"
if (Test-Path $installDir) {
  Remove-Item -Recurse -Force $installDir
  Write-Host "Removed $installDir" -ForegroundColor Green
} else {
  Write-Host "No installation found at $installDir" -ForegroundColor DarkGray
}

# ---- Remove install dir from user PATH ------------------------------------
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -and $userPath -like "*$installDir*") {
  $bin = Join-Path $installDir "bin"
  $parts = $userPath.Split(";") | Where-Object { $_ -and $_ -ne $installDir -and $_ -ne $bin }
  $newPath = $parts -join ";"
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  # Also drop it from the current session.
  $env:Path = ($env:Path -split ";" | Where-Object { $_ -and $_ -ne $installDir -and $_ -ne $bin }) -join ";"
  Write-Host "Removed $installDir from your user PATH." -ForegroundColor Green
}

# ---- Purge user data ------------------------------------------------------
if ($Purge) {
  foreach ($dir in @(
    (Join-Path $env:LOCALAPPDATA "ustcode"),
    (Join-Path $env:APPDATA "ustcode")
  )) {
    if (Test-Path $dir) {
      Remove-Item -Recurse -Force $dir
      Write-Host "Removed $dir" -ForegroundColor Green
    }
  }
  Write-Host "User data and config removed." -ForegroundColor Yellow
} else {
  Write-Host "Tip: run 'uninstall.ps1 -Purge' to also remove user data and config." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "ustcode has been uninstalled." -ForegroundColor Green
Write-Host ""
Write-Host "Restart your terminal for the PATH change to take effect." -ForegroundColor DarkGray
