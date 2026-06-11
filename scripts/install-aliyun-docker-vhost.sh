#!/usr/bin/env bash
set -euo pipefail

SERVER_NAME="${SERVER_NAME:-orbit.code-soul.com}"
API_PORT="${API_PORT:-3100}"
WEB_PORT="${WEB_PORT:-3101}"
NGINX_BIN="${NGINX_BIN:-/www/server/nginx/sbin/nginx}"
NGINX_CONF="${NGINX_CONF:-/www/server/nginx/conf/nginx.conf}"
VHOST_DIR="${VHOST_DIR:-/www/server/panel/vhost/nginx}"
VHOST_FILE="$VHOST_DIR/$SERVER_NAME.conf"

if [[ ! -x "$NGINX_BIN" ]]; then
  echo "Nginx binary not found: $NGINX_BIN" >&2
  exit 1
fi

sudo mkdir -p "$VHOST_DIR"
sudo tee "$VHOST_FILE" >/dev/null <<CONF
server {
    listen 80;
    server_name $SERVER_NAME;

    access_log /www/wwwlogs/$SERVER_NAME.log;
    error_log /www/wwwlogs/$SERVER_NAME.error.log;

    client_max_body_size 20m;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:$API_PORT/api/v1/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF

sudo "$NGINX_BIN" -t -c "$NGINX_CONF"
sudo systemctl reload nginx

echo "Installed vhost: $VHOST_FILE"
echo "Test with: curl -H 'Host: $SERVER_NAME' http://127.0.0.1/"
