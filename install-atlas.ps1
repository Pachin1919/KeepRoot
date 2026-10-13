[CmdletBinding()]
param(
  [ValidateSet('install', 'locate', 'upgrade', 'uninstall')]
  [string]$Command = 'install',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Atlas'),
  [string]$SkillRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex\skills\keeproot'),
  [string]$NodePath = 'node.exe',
  [string]$DesktopPythonPath,
  [string]$ShortcutRoot,
  [string[]]$LibraryRoot = @(),
  [switch]$NoStartMenuShortcut
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$manager = Join-Path $projectRoot 'scripts\runtime-manager.js'

try {
  $nodeCommand = Get-Command -Name $NodePath -ErrorAction Stop
  $nodeExecutable = $nodeCommand.Source
  $versionText = & $nodeExecutable --version
  if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(?<major>\d+)\.') {
    throw 'Unable to determine the Node.js version.'
  }
  if ([int]$Matches.major -lt 24) {
    throw "Atlas requires Node.js 24 or newer; found $versionText."
  }
} catch {
  [Console]::Error.WriteLine('Atlas Runtime was not installed. Install Node.js 24+ or pass -NodePath to a local portable Node executable.')
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

$arguments = @($manager, $Command, '--install-root', $InstallRoot, '--node', $nodeExecutable)
if ($Command -ne 'uninstall' -or $PSBoundParameters.ContainsKey('SkillRoot')) {
  $arguments += @('--skill-root', $SkillRoot)
}
if ($NoStartMenuShortcut) { $arguments += '--no-start-menu-shortcut' }
if ($ShortcutRoot) { $arguments += @('--shortcut-root', $ShortcutRoot) }
foreach ($root in $LibraryRoot) {
  $arguments += @('--library-root', $root)
}

& $nodeExecutable @arguments
$runtimeExitCode = $LASTEXITCODE

if ($runtimeExitCode -eq 0 -and $DesktopPythonPath -and $Command -in @('install', 'upgrade')) {
  $atlas = Join-Path $InstallRoot 'atlas.cmd'
  & $atlas ui install --python $DesktopPythonPath
  $runtimeExitCode = $LASTEXITCODE
}

# Runtime manager owns the shared, ownership-checked Keeproot shortcut path.

exit $runtimeExitCode
