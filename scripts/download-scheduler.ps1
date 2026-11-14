param([switch]$InspectOnly, [switch]$Once, [switch]$ManageRunning, [string]$ConfigPath = (Join-Path $PSScriptRoot 'scheduler.json'))
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent ([IO.Path]::GetFullPath($ConfigPath))
$taskMutex = [Threading.Mutex]::new($false, 'Local\AniLinkDownloadScheduler')
if (-not $InspectOnly -and -not $taskMutex.WaitOne(0)) { exit }
$owned = $false
$idleSince = $null
$nextStart = [datetime]::MinValue
$startedAt = [datetime]::MinValue
$refreshed = $false
try {
 do {
  try {
   $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
   $document = Get-Content -LiteralPath $config.dataFile -Raw -Encoding UTF8 | ConvertFrom-Json
   $settings = if ($document.state) { $document.state.settings } else { $document.settings }
   if (-not $settings) { throw 'AniLink settings document is missing.' }
   $mode = if ($Once) { 'once' } else { $settings.downloadMode }
   if ($mode -eq 'off' -or -not $mode) { break }
   $wake = [Math]::Max(5, [int]$settings.wakeMinutes)
   $idle = [Math]::Min(120, [Math]::Max(1, [int]$settings.idleMinutes))
   $running = @(Get-CimInstance Win32_Process -Filter "Name='qbittorrent.exe'" | Where-Object { $_.ExecutablePath -eq $config.exe })
   if ($InspectOnly) {
    @{ mode=$mode; running=($running.Count -gt 0); wakeMinutes=$wake; idleMinutes=$idle; startup=(Test-Path -LiteralPath "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\AniLink-downloads.lnk") } | ConvertTo-Json -Compress
    break
   }
    if ($ManageRunning -and $running.Count -and -not $owned) { $owned = $true; $startedAt = Get-Date; $idleSince = $null }
    if (-not $running.Count -and (Get-Date) -ge $nextStart) {
    $args = @('--no-splash', '--minimized')
    if ($config.profile) { $args = @("--profile=$($config.profile)") + $args }
    Start-Process -FilePath $config.exe -ArgumentList $args -WindowStyle Hidden
    $owned = $true; $startedAt = Get-Date; $idleSince = $null
   }
   if ($owned) {
    $root = $settings.qbUrl.TrimEnd('/')
    $uri = [uri]$root
    if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1')) { throw 'Local scheduler requires loopback qBittorrent.' }
    Invoke-WebRequest -Uri "$root/api/v2/auth/login" -Method Post -Body @{username=$settings.qbUser; password=$settings.qbPassword} -SessionVariable qbSession -UseBasicParsing | Out-Null
     if (-not $refreshed) {
      $feeds = @(Invoke-RestMethod -Uri "$root/api/v2/rss/items" -WebSession $qbSession)
      foreach ($feed in $feeds.PSObject.Properties) { if ($feed.Name -like 'AniLink*') { Invoke-WebRequest -Uri "$root/api/v2/rss/refreshItem" -Method Post -Body @{itemPath=$feed.Name} -WebSession $qbSession -UseBasicParsing | Out-Null } }
      $refreshed = $true
     }
    $tasks = @(Invoke-RestMethod -Uri "$root/api/v2/torrents/info" -WebSession $qbSession)
     $other = @($tasks | Where-Object { $_.category -notlike 'AniLink*' -and ($_.progress -lt 1 -or $_.state -match 'checking|moving|allocating|error|missing') })
    $pending = @($tasks | Where-Object { $_.progress -lt 1 -or $_.state -match 'checking|moving|allocating|error|missing' })
    if ($other.Count -or $pending.Count) { $idleSince = $null }
    elseif (-not $idleSince) { $idleSince = Get-Date }
    if (($mode -eq 'once' -or $mode -eq 'cycle') -and $idleSince -and ((Get-Date)-$idleSince).TotalMinutes -ge $idle -and ((Get-Date)-$startedAt).TotalMinutes -ge $idle) {
     Invoke-WebRequest -Uri "$root/api/v2/app/shutdown" -Method Post -WebSession $qbSession -UseBasicParsing | Out-Null
     $owned = $false; $idleSince = $null
     if ($mode -eq 'once') { break }
     $nextStart = (Get-Date).AddMinutes($wake)
    }
   }
   @{checked=(Get-Date).ToString('o');mode=$mode;ownsDownloader=$owned;nextStart=$nextStart.ToString('o');error=$null} | ConvertTo-Json -Compress | Set-Content -LiteralPath "$taskRoot\scheduler-status.json" -Encoding UTF8
  } catch {
   $idleSince = $null
   if ($InspectOnly) { throw }
   @{checked=(Get-Date).ToString('o');error=$_.Exception.Message} | ConvertTo-Json -Compress | Set-Content -LiteralPath "$taskRoot\scheduler-status.json" -Encoding UTF8
  }
  if (-not $InspectOnly) { Start-Sleep -Seconds 15 }
  } while (-not $InspectOnly -and -not $Once)
} finally {
 if (-not $InspectOnly) { $taskMutex.ReleaseMutex() }
 $taskMutex.Dispose()
}
