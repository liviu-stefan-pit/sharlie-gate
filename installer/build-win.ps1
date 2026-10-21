# Builds dist/installer/SharlieGate-Setup.exe
# Requires Inno Setup 6.3 or newer (ISCC.exe) on this machine.
param(
  [string]$NodeVersion = "24.11.0"
)

$ErrorActionPreference = "Stop"
$InstallerDir = $PSScriptRoot
$Root = Split-Path -Parent $InstallerDir
Set-Location $Root

Write-Host "Building sharlie-gate"
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

$Staging = Join-Path $InstallerDir "staging"
$Cache = Join-Path $InstallerDir ".cache"
New-Item -ItemType Directory -Force -Path $Staging, $Cache | Out-Null
Get-ChildItem $Staging -Force | Remove-Item -Recurse -Force

$ZipName = "node-v$NodeVersion-win-x64.zip"
$ZipPath = Join-Path $Cache $ZipName
$Url = "https://nodejs.org/dist/v$NodeVersion/$ZipName"
if (-not (Test-Path $ZipPath)) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $ZipPath
}

$Extracted = Join-Path $Cache "node-v$NodeVersion-win-x64"
if (Test-Path $Extracted) { Remove-Item -Recurse -Force $Extracted }
Write-Host "Extracting Node.js $NodeVersion"
Expand-Archive -Path $ZipPath -DestinationPath $Cache -Force
$NodeExe = Join-Path $Extracted "node.exe"
if (-not (Test-Path $NodeExe)) { throw "node.exe was not in $ZipName" }
Copy-Item $NodeExe (Join-Path $Staging "node.exe")

Copy-Item (Join-Path $Root "dist\sharlie-gate.mjs") (Join-Path $Staging "sharlie-gate.mjs")
Copy-Item (Join-Path $Root "dist\tree-sitter.wasm") (Join-Path $Staging "tree-sitter.wasm")
Copy-Item (Join-Path $Root "dist\grammars") (Join-Path $Staging "grammars") -Recurse

$Version = (Get-Content -Raw (Join-Path $Root "package.json") | ConvertFrom-Json).version
$IsccCandidates = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$Iscc = $IsccCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $Iscc) {
  $Cmd = Get-Command iscc -ErrorAction SilentlyContinue
  if ($Cmd) { $Iscc = $Cmd.Source }
}
if (-not $Iscc) {
  throw "Inno Setup 6 compiler (ISCC.exe) was not found. Install Inno Setup 6.3 or newer, then run this script again."
}

Write-Host "Compiling setup exe with $Iscc"
& $Iscc "/DMyAppVersion=$Version" (Join-Path $InstallerDir "sharlie-gate.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed" }

$Setup = Join-Path $Root "dist\installer\SharlieGate-Setup.exe"
if (-not (Test-Path $Setup)) { throw "Expected $Setup" }
Write-Host "Wrote $Setup"
