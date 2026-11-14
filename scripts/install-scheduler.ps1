param(
 [string]$PluginDataPath,
 [string]$InstallRoot = 'D:\Application\AniLink-services',
 [string]$QbExe = 'D:\Application\qBittorrent\qbittorrent.exe',
 [string]$QbProfile = '',
 [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\AniLink-downloads.lnk'
if ($Uninstall) {
 if (Test-Path -LiteralPath $startup) { Remove-Item -LiteralPath $startup }
 Write-Output 'AniLink login startup shortcut removed; downloads and files were not changed.'
 exit
}
if (-not $PluginDataPath -or -not (Test-Path -LiteralPath $PluginDataPath -PathType Leaf)) { throw 'A configured AniLink data.json path is required.' }
$dataDocument = Get-Content -LiteralPath $PluginDataPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $dataDocument.state.settings -and -not $dataDocument.settings) { throw 'The selected data document has no AniLink settings.' }
if (-not (Test-Path -LiteralPath $QbExe -PathType Leaf)) { throw 'qBittorrent executable does not exist.' }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$target = Join-Path $InstallRoot 'download-scheduler.ps1'
if ([IO.Path]::GetFullPath($target) -ne [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'download-scheduler.ps1'))) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'download-scheduler.ps1') -Destination $target -Force }
if ($QbProfile -and -not (Test-Path -LiteralPath $QbProfile -PathType Container)) { throw 'qBittorrent profile directory does not exist.' }
@{dataFile=[IO.Path]::GetFullPath($PluginDataPath);exe=[IO.Path]::GetFullPath($QbExe);profile=if($QbProfile){[IO.Path]::GetFullPath($QbProfile)}else{''}} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'scheduler.json') -Encoding UTF8
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startup)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -File `"$target`" -Once"
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output 'AniLink login startup shortcut created; it takes effect at the next login.'
