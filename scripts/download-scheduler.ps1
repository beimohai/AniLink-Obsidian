param([switch]$InspectOnly, [switch]$Once, [switch]$ManageRunning, [string]$ConfigPath = (Join-Path $PSScriptRoot 'scheduler.json'))
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent ([IO.Path]::GetFullPath($ConfigPath))
$taskMutex = [Threading.Mutex]::new($false, 'Local\AniLinkDownloadScheduler')
if (-not $InspectOnly) {
 try { $schedulerAcquired = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $schedulerAcquired = $true }
 if (-not $schedulerAcquired) { $taskMutex.Dispose(); exit }
}
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
   if ($config.deviceSettingsFile -and (Test-Path -LiteralPath $config.deviceSettingsFile)) {
    $device = Get-Content -LiteralPath $config.deviceSettingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in $device.settings.PSObject.Properties) { $settings | Add-Member -MemberType NoteProperty -Name $entry.Name -Value $entry.Value -Force }
   }
   $mode = if ($Once) { 'once' } else { $settings.downloadMode }
   if ($mode -eq 'off' -or -not $mode) { break }
   $wake = [Math]::Max(5, [int]$settings.wakeMinutes)
   $idle = [Math]::Min(120, [Math]::Max(1, [int]$settings.idleMinutes))
   $running = @(Get-CimInstance Win32_Process -Filter "Name='qbittorrent.exe'" | Where-Object { $_.ExecutablePath -eq $config.exe })
   if ($InspectOnly) {
    @{ mode=$mode; running=($running.Count -gt 0); wakeMinutes=$wake; idleMinutes=$idle; startup=(Test-Path -LiteralPath "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\AniLink-downloads.lnk") } | ConvertTo-Json -Compress
    break
   }
    if (($ManageRunning -or $Once) -and $running.Count -and -not $owned) { $owned = $true; $startedAt = Get-Date; $idleSince = $null; $refreshed = $false }
    if (-not $running.Count -and (Get-Date) -ge $nextStart) {
    $args = @('--no-splash')
    if ($config.profile) { $args = @("--profile=$($config.profile)") + $args }
    Start-Process -FilePath $config.exe -ArgumentList $args -WindowStyle Minimized
    $owned = $true; $startedAt = Get-Date; $idleSince = $null; $refreshed = $false
   }
   if ($owned) {
    $root = $settings.qbUrl.TrimEnd('/')
    $uri = [uri]$root
    if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1')) { throw 'Local scheduler requires loopback qBittorrent.' }
    Invoke-WebRequest -Uri "$root/api/v2/auth/login" -Method Post -Body @{username=$settings.qbUser; password=$settings.qbPassword} -SessionVariable qbSession -TimeoutSec 20 -UseBasicParsing | Out-Null
     if (-not $refreshed) {
      $feeds = Invoke-RestMethod -Uri "$root/api/v2/rss/items" -WebSession $qbSession -TimeoutSec 20
      foreach ($feed in $feeds.PSObject.Properties) { if ($feed.Name -like 'AniLink*') { Invoke-WebRequest -Uri "$root/api/v2/rss/refreshItem" -Method Post -Body @{itemPath=$feed.Name} -WebSession $qbSession -TimeoutSec 20 -UseBasicParsing | Out-Null } }
      $refreshed = $true
     }
    $tasks = Invoke-RestMethod -Uri "$root/api/v2/torrents/info" -WebSession $qbSession -TimeoutSec 20
    if ($settings.clearCompletedTasks) {
     $completed = @($tasks | Where-Object {
      $_.state -notmatch 'checking|moving|allocating' -and
      ($_.progress -ge 1 -or ($_.state -eq 'missingFiles' -and $_.completion_on -gt 0))
     })
     if ($completed.Count) {
      $hashes = ($completed | ForEach-Object { $_.hash }) -join '|'
      Invoke-WebRequest -Uri "$root/api/v2/torrents/delete" -Method Post -Body @{hashes=$hashes;deleteFiles='false'} -WebSession $qbSession -TimeoutSec 20 -UseBasicParsing | Out-Null
     }
    }
    # Missing, errored and stopped tasks cannot make download progress.
    $pending = @($tasks | Where-Object {
     $_.state -match 'checking|moving|allocating' -or
     ($_.progress -lt 1 -and $_.state -notmatch 'missing|error|paused|stopped')
    })
    if ($pending.Count) { $idleSince = $null }
    elseif (-not $idleSince) { $idleSince = Get-Date }
    if (($mode -eq 'once' -or $mode -eq 'cycle') -and $idleSince -and ((Get-Date)-$idleSince).TotalMinutes -ge $idle -and ((Get-Date)-$startedAt).TotalMinutes -ge $idle) {
     Invoke-WebRequest -Uri "$root/api/v2/app/shutdown" -Method Post -WebSession $qbSession -TimeoutSec 20 -UseBasicParsing | Out-Null
     $owned = $false; $idleSince = $null
     if ($mode -eq 'once') {
      @{checked=(Get-Date).ToString('o');mode=$mode;ownsDownloader=$false;pendingDownloads=0;state='idle-exit';error=$null} | ConvertTo-Json -Compress | Set-Content -LiteralPath "$taskRoot\scheduler-status.json" -Encoding UTF8
      break
     }
     $nextStart = (Get-Date).AddMinutes($wake)
    }
   }
   @{checked=(Get-Date).ToString('o');mode=$mode;ownsDownloader=$owned;idleSince=($idleSince);pendingDownloads=$pending.Count;nextStart=$nextStart.ToString('o');error=$null} | ConvertTo-Json -Compress | Set-Content -LiteralPath "$taskRoot\scheduler-status.json" -Encoding UTF8
  } catch {
   $idleSince = $null
   if ($InspectOnly) { throw }
   @{checked=(Get-Date).ToString('o');error=$_.Exception.Message} | ConvertTo-Json -Compress | Set-Content -LiteralPath "$taskRoot\scheduler-status.json" -Encoding UTF8
  }
  if (-not $InspectOnly) { Start-Sleep -Seconds 15 }
  } while (-not $InspectOnly)
} finally {
 if (-not $InspectOnly) { $taskMutex.ReleaseMutex() }
 $taskMutex.Dispose()
}
