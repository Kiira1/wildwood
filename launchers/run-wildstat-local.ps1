# WildStat local test for Windows: the same as "Run Wildstat Local.command" on macOS.
# Started by "Run Wildstat Local.bat" (double-click that). It checks Node.js, installs the
# SpacetimeDB CLI if it is missing, switches it to the version this repository builds with,
# installs npm packages once, starts the local database in its own window, and opens the game.
# Everything stays on this computer: it never publishes to the live game.

# Not "Stop": Windows PowerShell 5.1 turns a native program's stderr into errors under it.
$ErrorActionPreference = "Continue"
# Windows PowerShell 5.1 may not offer TLS 1.2 by default, which the downloads need.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProjectDir = Split-Path -Parent $PSScriptRoot
$LocalUrl = "http://127.0.0.1:8000/"
$DatabaseUrl = "http://127.0.0.1:3000"

function Fail($message) {
  Write-Host ""
  Write-Host "FAILED: $message" -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

# Programs installed a moment ago are on the saved PATH, not yet on this window's.
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user;$env:LOCALAPPDATA\SpacetimeDB"
}

function Test-Database {
  try { & spacetime server ping $DatabaseUrl *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

Clear-Host
Write-Host "WILDSTAT LOCAL TEST"
Write-Host "Folder: $ProjectDir"
Write-Host ""

if (-not (Test-Path (Join-Path $ProjectDir "package.json"))) { Fail "Could not find WildStat's package.json above the launchers folder." }
Set-Location $ProjectDir

# ---- Node.js ----
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "Node.js (npm) is not installed. Install the LTS version from https://nodejs.org, then double-click this launcher again."
}

# ---- SpacetimeDB CLI: installed if missing, then switched to this repository's version ----
$wanted = (& node -p "require('./spacetimedb/package.json').dependencies.spacetimedb").Trim()
if (-not (Get-Command spacetime -ErrorAction SilentlyContinue)) {
  Write-Host "SpacetimeDB: not found, installing it (official installer from spacetimedb.com)"
  try {
    Invoke-Expression (Invoke-WebRequest -UseBasicParsing "https://windows.spacetimedb.com").Content
  } catch {
    Fail "Could not install SpacetimeDB: $($_.Exception.Message). Install it from https://spacetimedb.com/install, then try again."
  }
  Refresh-Path
  if (-not (Get-Command spacetime -ErrorAction SilentlyContinue)) {
    Fail "SpacetimeDB installed, but this window can't find it yet. Close this window and double-click the launcher again."
  }
}
$current = (& spacetime --version 2>$null | Out-String)
if ($wanted -and $current -notmatch "tool version $([regex]::Escape($wanted));") {
  Write-Host "SpacetimeDB: switching to $wanted (the version WildStat builds with)"
  & spacetime version install $wanted --use -y
  if ($LASTEXITCODE -ne 0) { Fail "Could not switch SpacetimeDB to $wanted." }
}
Write-Host "SpacetimeDB: $wanted"

# ---- Already running? Just open the tab ----
try {
  $dev = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$($LocalUrl)__wildstat_dev"
  if ($dev.Content -match "wildstat-local-dev") {
    Write-Host "Live development: already running"
    Start-Process $LocalUrl
    exit 0
  }
} catch { }

# ---- npm packages, once ----
if (-not (Test-Path (Join-Path $ProjectDir "node_modules"))) {
  Write-Host "Dependencies: installing (first run only, takes a few minutes)"
  & npm ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci failed." }
}

# ---- Local database, in its own window ----
if (Test-Database) {
  Write-Host "Database: already running"
} else {
  Write-Host "Database: opening a second window (keep it open while you test)"
  Start-Process powershell -WorkingDirectory $ProjectDir -ArgumentList @(
    "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'WildStat local database'; Write-Host 'WILDSTAT LOCAL DATABASE - keep this window open. Ctrl+C stops it.'; spacetime start"
  )
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if (Test-Database) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { Fail "The local database did not start within 60 seconds. Check its window." }
  Write-Host "Database: ready"
}

Write-Host "Live development: starting"
Write-Host "CSS changes apply in place; code changes rebuild and refresh the tab."
Write-Host "Server changes publish only to your local database, without deleting saves."
Write-Host "Keep this window and the database window open while editing."
Write-Host ""
& npm run dev:local -- --open
if ($LASTEXITCODE -ne 0) { Fail "The local game stopped with an error (see above)." }
