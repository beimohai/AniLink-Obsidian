param(
 [string]$PluginDataPath,
 [string]$InstallRoot = 'D:\Application\AniLink-services',
 [string]$QbExe = 'D:\Application\qBittorrent\qbittorrent.exe',
 [string]$QbProfile = 'D:\Application\qBittorrent\profile',
 [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\AniLink-downloads.lnk'
if ($Uninstall) {
 if (Test-Path -LiteralPath $startup) { Remove-Item -LiteralPath $startup }
 Write-Output 'AniLink 登录启动项已移除；已有下载任务与文件未修改。'
 exit
}
if (-not $PluginDataPath -or -not (Test-Path -LiteralPath $PluginDataPath -PathType Leaf)) { throw '请提供已配置插件的库外本机 JSON 文件绝对路径（连接设置 → 跨设备 → 打开本机数据目录）。' }
$dataDocument = Get-Content -LiteralPath $PluginDataPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $dataDocument.state.settings -and -not $dataDocument.settings) { throw '所选文件不包含本机设置，请不要选择库内的迁移标记 data.json。' }
if (-not (Test-Path -LiteralPath $QbExe -PathType Leaf)) { throw 'qBittorrent 可执行文件不存在。' }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$target = Join-Path $InstallRoot 'download-scheduler.ps1'
if ([IO.Path]::GetFullPath($target) -ne [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'download-scheduler.ps1'))) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'download-scheduler.ps1') -Destination $target -Force }
@{dataFile=[IO.Path]::GetFullPath($PluginDataPath);exe=[IO.Path]::GetFullPath($QbExe);profile=[IO.Path]::GetFullPath($QbProfile)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'scheduler.json') -Encoding UTF8
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startup)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -File `"$target`""
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output 'AniLink 登录启动项已准备，下次登录生效；安装脚本不会立即启动下载器。'
