$bat = "C:\Users\MSCC\Documents\MSCC\start.bat"          # <-- change to your real path
$dir = Split-Path $bat

Start-Sleep -Seconds 15              # let Explorer / the shell finish loading
Import-Module VirtualDesktop

# make sure a second desktop exists
while ((Get-DesktopCount) -lt 2) { New-Desktop | Out-Null }
$desktop2 = Get-Desktop 1            # index is zero-based, so 1 = Desktop 2

Start-Process -FilePath $bat -WorkingDirectory $dir

# Windows appear over time (npm install / build can take a while),
# so keep moving any MSCC window to Desktop 2 for up to 5 minutes
$end = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $end) {
    Get-Process |
        Where-Object { $_.MainWindowTitle -like "MSCC*" } |
        ForEach-Object { Move-Window $desktop2 $_.MainWindowHandle }
    Start-Sleep -Seconds 2
}