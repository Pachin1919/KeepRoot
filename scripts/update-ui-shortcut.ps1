param(
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [string]$ShortcutRoot = (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function ExistingPath([string]$Value, [bool]$Directory) {
  $resolved = (Resolve-Path -LiteralPath $Value).ProviderPath
  $item = Get-Item -LiteralPath $resolved -Force
  if ($item.PSIsContainer -ne $Directory) { throw "Unexpected path type: $resolved" }
  $cursor = $item
  while ($null -ne $cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked paths are refused: $resolved" }
    $cursor = if ($cursor.PSIsContainer) { $cursor.Parent } else { $cursor.Directory }
  }
  return [IO.Path]::GetFullPath($resolved)
}
$homePath = ExistingPath $InstallRoot $true
$menuPath = ExistingPath $ShortcutRoot $true
$manifestFile = ExistingPath (Join-Path $homePath 'atlas-install.json') $false
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$runtimePath = Join-Path $homePath 'runtime'
if ($manifest.install_format -ne 'atlas-runtime-install.v1' -or [IO.Path]::GetFullPath($manifest.runtime_path) -ne [IO.Path]::GetFullPath($runtimePath)) { throw 'The existing Atlas installation manifest does not match this home.' }
$wrapper = ExistingPath (Join-Path $homePath 'atlas-ui.ps1') $false
$icon = ExistingPath (Join-Path $runtimePath 'assets/keeproot.ico') $false
$target = ExistingPath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') $false
$newPath = Join-Path $menuPath 'Keeproot.lnk'
$oldPath = Join-Path $menuPath 'Atlas UI.lnk'
$shell = New-Object -ComObject WScript.Shell
function OwnShortcut([string]$File) {
  if (-not (Test-Path -LiteralPath $File)) { return $false }
  $null = ExistingPath $File $false
  $link = $shell.CreateShortcut($File)
  if ($link.TargetPath -ne $target) { return $false }
  $match = [regex]::Match($link.Arguments, '(?i)^\s*-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-WindowStyle\s+Hidden\s+-File\s+(?:"([^"]+)"|([^"\s]+))\s*$')
  if (-not $match.Success) { return $false }
  $fileArgument = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
  try { return [IO.Path]::GetFullPath($fileArgument) -eq $wrapper } catch { return $false }
}
$newExists = Test-Path -LiteralPath $newPath
if ($newExists -and -not (OwnShortcut $newPath)) { throw 'Keeproot.lnk belongs to another application or installation; refusing overwrite.' }
$oldOwned = OwnShortcut $oldPath
# Both direct children and ownership were checked before this single-file rename.
if ($oldOwned) { Move-Item -LiteralPath $oldPath -Destination $newPath -Force }
$link = $shell.CreateShortcut($newPath)
$link.TargetPath = $target
$link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $wrapper + '"'
$link.WorkingDirectory = $homePath
$link.IconLocation = $icon + ',0'
$link.Description = 'Keeproot'
$link.WindowStyle = 7
$link.Save()
[pscustomobject]@{ status = 'updated'; shortcut = $newPath; install_root = $homePath; icon = $icon; legacy_renamed = $oldOwned } | ConvertTo-Json -Compress
