# ─── MSCC release helper ──────────────────────────────────────────────────────
# Usage (PowerShell, in the MSCC folder):   .\release.ps1 1.2.0
#
#  1. Sets "version" in package.json (shown in the app's top bar and login screen).
#  2. Copies the current source code into versions\v<version>\  (never the database,
#     node_modules, dist or cloudflared.exe — data is backed up separately).
#  3. Adds an empty entry to CHANGELOG.md if that version has none yet.
#
# Version numbers:  PATCH 1.1.x = bug fix   MINOR 1.x.0 = new feature   MAJOR x.0.0 = data/format change
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.0" }
$dest = Join-Path "versions" "v$Version"
if (Test-Path $dest) { throw "$dest already exists - pick a new version number." }

# 1. package.json version (text replace keeps the file's formatting)
$pkgPath = "package.json"
$pkg = [IO.File]::ReadAllText((Resolve-Path $pkgPath))
$pkg = [regex]::Replace($pkg, '"version"\s*:\s*"[^"]*"', "`"version`": `"$Version`"", 1)
[IO.File]::WriteAllText((Resolve-Path $pkgPath), $pkg)

# 2. snapshot
$files = "server.js","auth-utils.js","reset-password.js","migrate.js","package.json","package-lock.json",
         "index.html","vite.config.js","start.bat","start-on-desktop2.ps1","INSTALL.txt","CHANGELOG.md","release.ps1"
New-Item -ItemType Directory -Force (Join-Path $dest "SRC"), (Join-Path $dest "public\templates") | Out-Null
foreach ($f in $files) { if (Test-Path $f) { Copy-Item $f $dest } }
Copy-Item "SRC\*.jsx" (Join-Path $dest "SRC")
Copy-Item "public\templates\*" (Join-Path $dest "public\templates")

# 3. changelog stub
$cl = "CHANGELOG.md"
if (-not (Test-Path $cl)) { [IO.File]::WriteAllText((Join-Path $PWD $cl), "# Changelog`r`n") }
$text = [IO.File]::ReadAllText((Resolve-Path $cl))
if ($text -notmatch "## v$([regex]::Escape($Version))\b") {
  $entry = "## v$Version - $(Get-Date -Format yyyy-MM-dd)`r`n- (describe the changes)`r`n`r`n"
  $i = $text.IndexOf("## ")
  $text = if ($i -ge 0) { $text.Insert($i, $entry) } else { $text + "`r`n" + $entry }
  [IO.File]::WriteAllText((Resolve-Path $cl), $text)
}

Write-Host "Released v$Version -> $dest"
Write-Host "Run start.bat to rebuild and restart with the new version."
