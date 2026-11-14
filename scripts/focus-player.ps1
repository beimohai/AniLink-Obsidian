param([string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AniLinkPlayerWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  $player = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Executable -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($player) {
    $area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    [AniLinkPlayerWindow]::ShowWindow($player.MainWindowHandle, 9) | Out-Null
    [AniLinkPlayerWindow]::SetWindowPos($player.MainWindowHandle, [IntPtr]::Zero, $area.X, $area.Y, $area.Width, $area.Height, 0x0040) | Out-Null
    [AniLinkPlayerWindow]::SetForegroundWindow($player.MainWindowHandle) | Out-Null
    break
  }
  Start-Sleep -Milliseconds 250
}
