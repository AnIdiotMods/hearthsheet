# Starts the app with WebView2's debugging port requested and records what happened: the WebView2
# processes and their command lines, listening ports, and a screenshot of the desktop.
param([Parameter(Mandatory = $true)][string]$App, [string]$Out = 'out')
New-Item -ItemType Directory -Force $Out | Out-Null
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$p = Start-Process $App -PassThru
Start-Sleep -Seconds 20
"App process: id $($p.Id), exited: $($p.HasExited) $(if ($p.HasExited) { "code $($p.ExitCode)" })" | Tee-Object "$Out/diagnose.txt"
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'hearthsheet|msedgewebview2' } |
  ForEach-Object { "$($_.ProcessId) $($_.Name) :: $($_.CommandLine)" } | Tee-Object -Append "$Out/diagnose.txt"
netstat -ano | Select-String 'LISTENING' | Select-String ':92|:4444' | Tee-Object -Append "$Out/diagnose.txt"
try { (Invoke-WebRequest http://127.0.0.1:9222/json/version -UseBasicParsing -TimeoutSec 5).Content | Tee-Object -Append "$Out/diagnose.txt" } catch { "port 9222: $($_.Exception.Message)" | Tee-Object -Append "$Out/diagnose.txt" }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save("$Out/diagnose-desktop.png")
"Session: $([System.Diagnostics.Process]::GetCurrentProcess().SessionId), user: $env:USERNAME, interactive: $([Environment]::UserInteractive)" | Tee-Object -Append "$Out/diagnose.txt"
Get-Process hearthsheet -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
