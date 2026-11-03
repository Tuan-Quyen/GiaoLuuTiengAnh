#!/usr/bin/env bash
# Tạo cert tự ký cho IP LAN hiện tại (đổi IP thì chạy lại rồi `docker compose restart`).
set -euo pipefail
cd "$(dirname "$0")/.."

# Tắt tự động convert path kiểu Unix -> Windows trên Git Bash / MSYS
export MSYS_NO_PATHCONV=1

get_lan_ip() {
  if [ -n "${1:-}" ]; then
    echo "$1"
    return
  fi

  case "$(uname -s)" in
    Darwin)
      ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1"
      ;;
    Linux)
      (hostname -I 2>/dev/null | awk '{print $1}') || echo "127.0.0.1"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      local win_ip
      win_ip="$(powershell.exe -NoProfile -Command "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 | ForEach-Object { (Get-NetIPAddress -InterfaceIndex \$_.InterfaceIndex -AddressFamily IPv4).IPAddress })" 2>/dev/null | tr -d '\r\n' || true)"
      if [ -n "$win_ip" ]; then
        echo "$win_ip"
      else
        echo "127.0.0.1"
      fi
      ;;
    *)
      echo "127.0.0.1"
      ;;
  esac
}

IP="$(get_lan_ip "${1:-}")"
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=TOEIC 3D LAN" \
  -keyout certs/key.pem -out certs/cert.pem \
  -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost"
echo "Cert cho https://${IP}:3443 → certs/"
