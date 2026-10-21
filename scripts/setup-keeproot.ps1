[CmdletBinding()]
param(
 [ValidateSet('Install','Update','Check')][string]$Mode='Install',
 [string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'Atlas'),
 [string]$SkillRoot,
 [string]$NodePath,
 [string]$PythonPath,
 [string]$ShortcutRoot,
 [switch]$RuntimeOnly,
 [switch]$NoStartMenuShortcut,
 [switch]$NoLaunch
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$bundle=Split-Path -Parent $PSScriptRoot
$stage='requirements'
try {
 if (-not $NodePath) {
  $command=Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { $NodePath=$command.Source }
  elseif (Test-Path -LiteralPath (Join-Path $InstallRoot 'atlas-install.json')) {
   $NodePath=(Get-Content -LiteralPath (Join-Path $InstallRoot 'atlas-install.json') -Raw | ConvertFrom-Json).node_path
  }
 }
 if (-not $NodePath) { throw 'Install Node.js 24+ from https://nodejs.org/en/download, reopen this folder and try again.' }
 $version=& $NodePath --version
 if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Node.js 24+ is required: https://nodejs.org/en/download' }
 if (-not $RuntimeOnly -and -not $PythonPath) {
  $component=Join-Path $InstallRoot 'desktop-ui/component.json'
  if (Test-Path -LiteralPath $component) { $PythonPath=(Get-Content -LiteralPath $component -Raw | ConvertFrom-Json).source_python }
  $managed=Join-Path $InstallRoot 'desktop-ui/venv/Scripts/python.exe'
  if (-not $PythonPath -and (Test-Path -LiteralPath $managed)) { $PythonPath=$managed }
  if (-not $PythonPath) {
   $launcher=Get-Command py.exe -ErrorAction SilentlyContinue
   if ($launcher) {
    $found=& $launcher.Source -3 -c 'import sys; print(sys.executable)' 2>$null
    if ($LASTEXITCODE -eq 0) { $PythonPath=($found | Select-Object -Last 1).Trim() }
   }
  }
  if (-not $PythonPath) {
   $command=Get-Command python.exe -ErrorAction SilentlyContinue
   if ($command -and $command.Source -notmatch '\\WindowsApps\\') { $PythonPath=$command.Source }
  }
 }
 if (-not $RuntimeOnly) {
  if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath)) { throw 'Install Python 3.11+ from https://www.python.org/downloads/windows/ (enable Add Python to PATH), then try again.' }
  & $PythonPath -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ is required: https://www.python.org/downloads/windows/' }
 }
 $stage='package'
 & $NodePath (Join-Path $PSScriptRoot 'release-bundle.js') --verify $bundle
 if ($LASTEXITCODE -ne 0) { throw 'Release package Hash changed. Extract a fresh official Keeproot Windows ZIP.' }
 $manifestFile=Join-Path $InstallRoot 'atlas-install.json'
 $existing=Test-Path -LiteralPath $manifestFile
 if ($Mode -eq 'Check') { [pscustomobject]@{status='ready';node=$version;python=$PythonPath;installed=$existing} | ConvertTo-Json -Compress; exit 0 }
 if ($Mode -eq 'Update' -and -not $existing) { throw 'Keeproot is not installed. Use Install-Keeproot.cmd first.' }
 if ($Mode -eq 'Install' -and $existing) { throw 'Keeproot is already installed. Close it and use Update-Keeproot.cmd.' }
 if ($existing -and -not $SkillRoot) { $SkillRoot=(Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json).skill_path }
 if (-not $SkillRoot -and $env:CODEX_HOME) { $SkillRoot=Join-Path $env:CODEX_HOME 'skills/keeproot' }
 $stage='installation'
 $arguments=@{Command=if($Mode -eq 'Update'){'upgrade'}else{'install'};InstallRoot=$InstallRoot;NodePath=$NodePath}
 if ($SkillRoot) { $arguments.SkillRoot=$SkillRoot }
 if (-not $RuntimeOnly) { $arguments.DesktopPythonPath=$PythonPath }
 if ($ShortcutRoot) { $arguments.ShortcutRoot=$ShortcutRoot }
 if ($NoStartMenuShortcut) { $arguments.NoStartMenuShortcut=$true }
 & (Join-Path $bundle 'install-atlas.ps1') @arguments
 if ($LASTEXITCODE -ne 0) { throw 'Installation did not finish. Existing state was retained; read the failing step above and retry the same package.' }
 $installed=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
 [pscustomobject]@{status=if($Mode -eq 'Update'){'updated'}else{'installed'};version=$installed.atlas_version;build=$installed.runtime_sha256;state=$installed.state_path;runtime_only=[bool]$RuntimeOnly} | ConvertTo-Json -Compress
 if (-not $NoLaunch -and -not $RuntimeOnly) {
  $entry=Join-Path $InstallRoot 'atlas-ui.ps1'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$entry+'"')) -WindowStyle Hidden
 }
 exit 0
} catch {
 [Console]::Error.WriteLine(('failed ['+$stage+']: '+$_.Exception.Message))
 exit 1
}
