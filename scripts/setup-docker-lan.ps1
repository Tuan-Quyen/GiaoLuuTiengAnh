param(
  [string]$IP
)

$ErrorActionPreference = "Continue"

if (-not $IP) {
  try {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
    if ($route) {
      $IP = (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
    }
  } catch {}
}

if (-not $IP) {
  $IP = "127.0.0.1"
}

Write-Host ">>> Cau hinh Docker LAN cho IP: $IP" -ForegroundColor Cyan

# 1. Tạo chứng chỉ SSL
Write-Host "1. Kiem tra / Tao chung chi SSL cho IP $IP..." -ForegroundColor Gray
$certScript = Join-Path $PSScriptRoot "make-cert.ps1"
if (Test-Path $certScript) {
  & powershell -ExecutionPolicy Bypass -File $certScript $IP
}

# 2. Kiểm tra Windows Portproxy
Write-Host "2. Kiem tra chuyen tiep cong Windows (portproxy 3443)..." -ForegroundColor Gray
$allRules = (netsh interface portproxy show all | Out-String)
$needsUpdate = $true

if ($allRules -match ([regex]::Escape($IP) + "\s+3443")) {
  Write-Host "   -> Portproxy da tro dung IP $IP." -ForegroundColor Green
  $needsUpdate = $false
}

if ($needsUpdate) {
  Write-Host "   -> Can cap nhat portproxy cho IP moi $IP..." -ForegroundColor Yellow
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

  $syncScript = @"
`$all = netsh interface portproxy show all
foreach (`$line in `$all) {
  if (`$line -match '(\S+)\s+3443') {
    `$addr = `$matches[1]
    netsh interface portproxy delete v4tov4 listenaddress=`$addr listenport=3443 2>`$null
  }
}
netsh interface portproxy add v4tov4 listenaddress=$IP listenport=3443 connectaddress=127.0.0.1 connectport=3443
netsh advfirewall firewall add rule name="TOEIC 3D HTTPS" dir=in action=allow protocol=TCP localport=3443 2>`$null
"@

  if ($isAdmin) {
    Invoke-Expression $syncScript
    Write-Host "   -> Da cap nhat portproxy thanh cong." -ForegroundColor Green
  } else {
    Write-Host "   -> Dang yeu cau quyen Administrator de cap nhat portproxy..." -ForegroundColor Cyan
    Write-Host "   -> Vui long bam 'Yes' / 'Co' o hop thoai bao mat Windows (UAC)..." -ForegroundColor Yellow
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($syncScript)
    $encoded = [Convert]::ToBase64String($bytes)
    try {
      $proc = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile -EncodedCommand $encoded"
      Write-Host "   -> Da thuc thi cap nhat portproxy." -ForegroundColor Green
    } catch {
      Write-Host "   [!] Khong the tu dong mo UAC. Ban co the chuot phai vao file 'scripts\update-portproxy.bat' va chon 'Run as administrator'." -ForegroundColor Yellow
    }
  }
}

# 3. Khởi động Docker container
Write-Host "3. Khoi dong / Restart Docker container..." -ForegroundColor Gray
docker compose up -d
docker compose restart

$url = "https://" + $IP + ":3443"
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "   DOCKER LAN DA KHOI DONG THANH CONG!" -ForegroundColor Green
Write-Host "   - Tren may tinh nay : https://localhost:3443" -ForegroundColor White
Write-Host "   - Tren dien thoai LAN: $url" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Green
