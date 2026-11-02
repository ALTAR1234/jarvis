# Closes J.A.R.V.I.S., rebuilds release\win-unpacked (what starts at login), and opens it again.
$root = $PSScriptRoot
$exe = Join-Path $root 'release\win-unpacked\J.A.R.V.I.S. Assistant.exe'
Write-Output 'Closing J.A.R.V.I.S...'
Get-Process | Where-Object { $_.Path -eq $exe } | ForEach-Object { [void]$_.CloseMainWindow() }
Start-Sleep 5
Get-Process | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Write-Output 'Rebuilding...'
Push-Location $root
& (Join-Path $root 'node_modules\.bin\electron-builder.cmd') --win dir
Pop-Location
Write-Output 'Starting J.A.R.V.I.S...'
Start-Process $exe
Write-Output 'Done.'
