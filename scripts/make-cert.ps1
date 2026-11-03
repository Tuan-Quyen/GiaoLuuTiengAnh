param(
  [string]$IP
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

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

if (-not (Test-Path "certs")) {
  New-Item -ItemType Directory -Path "certs" | Out-Null
}

$san = "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=TOEIC 3D LAN" `
  -keyout certs/key.pem -out certs/cert.pem `
  -addext $san

Write-Host "Cert cho https://${IP}:3443 → certs/" -ForegroundColor Green
