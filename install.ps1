<#
.SYNOPSIS
  Installs the ustcode CLI on Windows.

.DESCRIPTION
  Downloads the ustcode binary from GitHub Releases and installs it to
  $HOME\.ustcode\bin (adding that directory to the user PATH), mirroring the
  behavior of the bash `install` script for Linux/macOS.

.PARAMETER Version
  Install a specific version (e.g. "1.0.0"). Defaults to the latest release.

.PARAMETER Binary
  Install from a local ustcode.exe instead of downloading.

.PARAMETER NoModifyPath
  Don't add the install directory to the user PATH.

.PARAMETER Help
  Show this help.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Version 1.0.0

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Binary .\ustcode.exe -NoModifyPath
#>
[CmdletBinding()]
param(
  [Alias("v")]
  [string]$Version,
  [Alias("b")]
  [string]$Binary,
  [Alias("h")]
  [switch]$Help,
  [switch]$NoModifyPath
)

$ErrorActionPreference = "Stop"

if ($Help) {
  Get-Help $PSCommandPath
  exit 0
}

$App = "ustcode"

# ---- Resolve architecture -------------------------------------------------
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { "x64" }
  "ARM64" { "arm64" }
  default { throw "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}
$target = "windows-$arch"
$filename = "$App-$target.zip"
$url = "https://github.com/Enthusjast/ustcode/releases/latest/download/$filename"

# ---- Resolve version ------------------------------------------------------
if (-not $Version) {
  Write-Host "Resolving latest version..." -ForegroundColor DarkGray
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/Enthusjast/ustcode/releases/latest" -Headers @{ "User-Agent" = "ustcode-installer" }
  $Version = $release.tag_name.TrimStart("v")
  if (-not $Version) { throw "Failed to fetch the latest version from GitHub" }
} else {
  $Version = $Version.TrimStart("v")
  $url = "https://github.com/Enthusjast/ustcode/releases/download/v$Version/$filename"
  # Verify the release exists before downloading.
  try {
    $head = Invoke-WebRequest -Method Head -Uri "https://github.com/Enthusjast/ustcode/releases/tag/v$Version" -ErrorAction SilentlyContinue
    if ($head.StatusCode -eq 404) { throw "Release v$Version not found" }
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) {
      Write-Host "Error: Release v$Version not found" -ForegroundColor Red
      Write-Host "Available releases: https://github.com/Enthusjast/ustcode/releases"
      exit 1
    }
    throw
  }
}

# ---- Install dir ----------------------------------------------------------
$installDir = Join-Path $HOME ".ustcode\bin"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# ---- Local binary path ----------------------------------------------------
if ($Binary) {
  if (-not (Test-Path $Binary)) {
    Write-Host "Error: Binary not found at $Binary" -ForegroundColor Red
    exit 1
  }
  $exe = Join-Path $installDir "ustcode.exe"
  Copy-Item $Binary $exe -Force
  Write-Host "Installed ustcode from $Binary to $exe" -ForegroundColor Green
} else {
  Write-Host "Installing ustcode version: $Version" -ForegroundColor DarkGray

  $tmp = Join-Path $env:TEMP "ustcode_install_$PID"
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp $filename

  try {
    Write-Host "Downloading $url" -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    $extracted = Join-Path $tmp "ustcode.exe"
    if (-not (Test-Path $extracted)) { throw "The archive did not contain ustcode.exe" }

    $exe = Join-Path $installDir "ustcode.exe"
    Move-Item -Path $extracted -Destination $exe -Force
    Write-Host "Installed ustcode to $exe" -ForegroundColor Green
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

# ---- PATH -----------------------------------------------------------------
if (-not $NoModifyPath) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$installDir*") {
    $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    # Also update the current session so the command works immediately.
    $env:Path = "$env:Path;$installDir"
    Write-Host "Added $installDir to your user PATH (restart terminals to apply)." -ForegroundColor Yellow
  }
}

# ---- Completion -----------------------------------------------------------
Write-Host ""
Write-Host "ustcode installed!" -ForegroundColor Green
Write-Host ""
Write-Host "To get started:" -ForegroundColor DarkGray
Write-Host "  ustcode            # Run the TUI"
Write-Host "  ustcode --version  # Check the version"
Write-Host ""
Write-Host "For more information visit https://github.com/Enthusjast/ustcode" -ForegroundColor DarkGray
