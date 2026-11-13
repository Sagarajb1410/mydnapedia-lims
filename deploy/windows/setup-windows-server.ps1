# Sets up the live MyDNAPedia LIMS on a Windows Server (2016, 2019, 2022 or 2025).
# Start it with SETUP-WINDOWS-SERVER.bat (right-click, Run as administrator) from
# the unzipped LIMS folder. It:
#   1. installs Node.js 22 if needed,
#   2. copies the LIMS to C:\MyDNAPedia\app (data lives in C:\MyDNAPedia\data),
#   3. installs Caddy, which gets and renews the https certificate on its own,
#   4. starts both when the server boots, and restarts them if they stop,
#   5. opens ports 80 and 443 in Windows Firewall,
#   6. shows the first admin sign-in.
# Running it again is safe: it keeps the data and only updates the program.
param(
  [string]$Domain = '',
  [string]$AdminEmail = '',
  [string]$Root = 'C:\MyDNAPedia'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($n, $text) { Write-Host ''; Write-Host "== $n/7 $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Red; Write-Host ''; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail 'Please right-click SETUP-WINDOWS-SERVER.bat and choose "Run as administrator".' }

$Src = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $Src 'src\server.js'))) { Fail 'Run this from inside the unzipped LIMS folder (deploy\windows).' }

$App = Join-Path $Root 'app'
$Data = Join-Path $Root 'data'
$CaddyDir = Join-Path $Root 'caddy'
$SettingsFile = Join-Path $Root 'settings.txt'

# Earlier answers are kept, so an update needs no typing.
$saved = @{}
if (Test-Path $SettingsFile) {
  foreach ($line in Get-Content $SettingsFile) { if ($line -match '^([A-Z_]+)=(.*)$') { $saved[$Matches[1]] = $Matches[2] } }
}
if (-not $Domain) { $Domain = $saved['DOMAIN'] }
if (-not $AdminEmail) { $AdminEmail = $saved['ADMIN_EMAIL'] }
if (-not $Domain) {
  Write-Host ''
  Write-Host '  The web address partners will use, for example  lims.mydnapedia.org' -ForegroundColor Yellow
  Write-Host '  Its DNS "A" record must already point to this server''s public IP address.' -ForegroundColor Yellow
  $Domain = Read-Host '  Web address'
}
$Domain = ($Domain -replace '^https?://', '' -replace '/.*$', '').Trim().ToLower()
if ($Domain -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { Fail "`"$Domain`" is not a web address like lims.mydnapedia.org" }
if (-not $AdminEmail) { $AdminEmail = Read-Host '  Your email (the first admin sign-in)' }
$AdminEmail = $AdminEmail.Trim()
if ($AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Fail "`"$AdminEmail`" is not an email address." }

# ---------------------------------------------------------------------------
Step 1 'Node.js 22'
function NodeOk {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $v = (& node -p 'process.versions.node').Trim().Split('.')
  return ([int]$v[0] -gt 22) -or ([int]$v[0] -eq 22 -and [int]$v[1] -ge 13)
}
if (-not (NodeOk)) {
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $rel = $index | Where-Object { $_.lts -and $_.version -like 'v22.*' } | Select-Object -First 1
  if (-not $rel) { Fail 'Could not find Node.js 22 on nodejs.org. Install the LTS version from https://nodejs.org by hand, then run this again.' }
  $msi = Join-Path $env:TEMP "node-$($rel.version)-x64.msi"
  Write-Host "  Downloading Node.js $($rel.version)..."
  Invoke-WebRequest "https://nodejs.org/dist/$($rel.version)/node-$($rel.version)-x64.msi" -OutFile $msi
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (NodeOk)) { Fail 'Node.js did not install. Install the LTS version from https://nodejs.org by hand, then run this again.' }
}
$NodeExe = (Get-Command node).Source
Write-Host "  Node.js $(& node -p 'process.versions.node') at $NodeExe"

# ---------------------------------------------------------------------------
Step 2 'A free port for the LIMS'
# Windows can reserve ports (Hyper-V, WSL, Docker). Pick one it allows and nothing uses.
function PortFree($p) {
  $reserved = netsh int ipv4 show excludedportrange protocol=tcp 2>$null | ForEach-Object {
    if ($_ -match '^\s*(\d+)\s+(\d+)') { @{ a = [int]$Matches[1]; b = [int]$Matches[2] } }
  }
  foreach ($r in $reserved) { if ($p -ge $r.a -and $p -le $r.b) { return $false } }
  $used = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
  return -not $used
}
$Port = 0
if ($saved['PORT']) { $Port = [int]$saved['PORT'] }
# An earlier install is stopped first (the task, then the programs it started).
foreach ($t in 'MyDNAPedia LIMS', 'MyDNAPedia Caddy') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue }
}
Get-CimInstance Win32_Process -Filter "Name='cmd.exe' OR Name='node.exe' OR Name='caddy.exe'" | Where-Object {
  ($_.CommandLine -like '*run-lims.cmd*') -or ($_.CommandLine -like '*run-caddy.cmd*') -or
  ($_.CommandLine -like '*src\server.js*' -and $_.CommandLine -notlike '*--demo*' -and $_.CommandLine -notlike '*--open*') -or ($_.ExecutablePath -like "$Root\*")
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
if (-not $Port -or -not (PortFree $Port)) {
  $Port = 0
  foreach ($p in 8080, 8088, 8800, 9090, 4300, 5080, 18080, 28080) { if (PortFree $p) { $Port = $p; break } }
  if (-not $Port) { Fail 'No free port found for the LIMS.' }
}
Write-Host "  The LIMS will listen on 127.0.0.1:$Port (only Caddy talks to it)."

# ---------------------------------------------------------------------------
Step 3 'The LIMS program'
New-Item -ItemType Directory -Force -Path $Root, $App, $Data, $CaddyDir | Out-Null
if ((Test-Path (Join-Path $Data 'lims.sqlite')) -and (Test-Path (Join-Path $App 'src\backup.js'))) {
  # Updating: today's backup is written first, with the version being replaced.
  $env:DATA_DIR = $Data
  & $NodeExe --no-warnings (Join-Path $App 'src\backup.js')
  if ($LASTEXITCODE -ne 0) { Fail 'The backup before updating failed, so nothing was changed. Send a photo of this window to Claude.' }
  Remove-Item Env:DATA_DIR
}
if ((Resolve-Path $Src).Path.TrimEnd('\') -ne (Resolve-Path $App).Path.TrimEnd('\')) {
  # /MIR keeps the program identical to the zip; data is outside it and never touched.
  robocopy $Src $App /MIR /XD data data-own node_modules .git /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "Copying the program to $App failed (robocopy code $LASTEXITCODE)." }
}
# Only administrators and the system may read client data.
icacls $Data /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

@"
DOMAIN=$Domain
ADMIN_EMAIL=$AdminEmail
PORT=$Port
"@ | Set-Content -Encoding ASCII $SettingsFile

$runLims = Join-Path $Root 'run-lims.cmd'
@"
@echo off
rem Started by the "MyDNAPedia LIMS" scheduled task. Do not edit; run the setup again instead.
set LIMS_STAGE=live
set HOST=127.0.0.1
set PORT=$Port
set DATA_DIR=$Data
set STORAGE=local
set FIRST_ADMIN_EMAIL=$AdminEmail
set PUBLIC_URL=https://$Domain
cd /d "$App"
rem If the LIMS ever stops, it is started again after 5 seconds.
:again
"$NodeExe" --no-warnings src\server.js >> "$Data\lims.log" 2>&1
ping -n 6 127.0.0.1 >nul
goto again
"@ | Set-Content -Encoding ASCII $runLims

# ---------------------------------------------------------------------------
Step 4 'Caddy (https certificate, fetched and renewed automatically)'
$CaddyExe = Join-Path $CaddyDir 'caddy.exe'
if (-not (Test-Path $CaddyExe)) {
  Write-Host '  Downloading Caddy...'
  Invoke-WebRequest 'https://caddyserver.com/api/download?os=windows&arch=amd64' -OutFile $CaddyExe
}
$caddyfile = (Get-Content -Raw (Join-Path $App 'deploy\Caddyfile')).Replace('{DOMAIN}', $Domain).Replace('127.0.0.1:3000', "127.0.0.1:$Port")
Set-Content -Encoding ASCII (Join-Path $CaddyDir 'Caddyfile') $caddyfile
& $CaddyExe validate --config (Join-Path $CaddyDir 'Caddyfile') --adapter caddyfile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'The Caddy settings are not valid. Send a photo of this window to Claude.' }

$runCaddy = Join-Path $Root 'run-caddy.cmd'
@"
@echo off
rem Started by the "MyDNAPedia Caddy" scheduled task. Certificates are kept in $CaddyDir\data.
set XDG_DATA_HOME=$CaddyDir\data
set XDG_CONFIG_HOME=$CaddyDir\config
cd /d "$CaddyDir"
:again
"$CaddyExe" run --config Caddyfile --adapter caddyfile >> "$CaddyDir\caddy.log" 2>&1
ping -n 6 127.0.0.1 >nul
goto again
"@ | Set-Content -Encoding ASCII $runCaddy

# ---------------------------------------------------------------------------
Step 5 'Start on boot, restart if stopped'
function AddTask($name, $cmd) {
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $name
}
AddTask 'MyDNAPedia LIMS' $runLims
AddTask 'MyDNAPedia Caddy' $runCaddy

# ---------------------------------------------------------------------------
Step 6 'Windows Firewall: allow web traffic (ports 80 and 443)'
foreach ($p in 80, 443) {
  $name = "MyDNAPedia LIMS https $p"
  if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow | Out-Null
  }
}
Write-Host '  Done. If your server provider has its own firewall (for example an Azure or AWS "security group"), open ports 80 and 443 there too.'

# ---------------------------------------------------------------------------
Step 7 'Checking'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop | Out-Null; $ok = $true; break }
  catch { if ($_.Exception.Response) { $ok = $true; break } }
}
if (-not $ok) { Fail "The LIMS did not start. Its messages are in $Data\lims.log. Send a photo of that file to Claude." }
Write-Host '  The LIMS is running.' -ForegroundColor Green

$first = Join-Path $Data 'FIRST-SIGN-IN.txt'
Write-Host ''
Write-Host "  Open  https://$Domain  in a browser." -ForegroundColor Green
Write-Host '  The https certificate can take a minute or two the first time.'
if (Test-Path $first) {
  Write-Host ''
  Get-Content $first | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
  Write-Host "  (saved in $first)"
}
Write-Host ''
