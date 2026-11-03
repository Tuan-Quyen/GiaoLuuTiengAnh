#!/usr/bin/env bash
# Tạo cert tự ký cho IP LAN hiện tại (đổi IP thì chạy lại rồi `docker compose restart`).
set -euo pipefail
cd "$(dirname "$0")/.."
IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I | awk '{print $1}')}"
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=TOEIC 3D LAN" \
  -keyout certs/key.pem -out certs/cert.pem \
  -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost" 2>/dev/null
echo "Cert cho https://${IP}:3443 → certs/"
