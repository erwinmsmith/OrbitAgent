#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root or with sudo." >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/orbit-agent}"
WEB_ROOT="${WEB_ROOT:-/var/www/orbit-agent}"
APP_USER="${APP_USER:-orbit}"
SERVER_NAME="${SERVER_NAME:-_}"
REPO_URL="${REPO_URL:-https://github.com/erwinmsmith/OrbitAgent.git}"
BRANCH="${BRANCH:-main}"
API_PORT="${API_PORT:-3000}"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  git \
  nginx \
  nodejs \
  npm \
  redis-server \
  rsync \
  sudo \
  ufw

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

mkdir -p "$APP_DIR" "$WEB_ROOT"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$WEB_ROOT"

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

cat > "$APP_DIR/.env.example.server" <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
DEEPSEEK_API_KEY=<your_deepseek_key>
DEEPSEEK_BASE_URL=https://api.deepseek.com
JWT_SECRET=<long_random_secret>
JWT_REFRESH_SECRET=<long_random_secret>
ORBIT_EMBEDDER=hash
ENV

NEEDS_ENV=0
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example.server" "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "Created $APP_DIR/.env. Fill it before starting orbit-agent."
  NEEDS_ENV=1
fi

sudo -u "$APP_USER" npm ci --include=dev --prefix "$APP_DIR"
sudo -u "$APP_USER" npm run build --prefix "$APP_DIR"
sudo -u "$APP_USER" npm --prefix "$APP_DIR/web" ci
sudo -u "$APP_USER" VITE_ORBIT_API_BASE=/api/v1 npm --prefix "$APP_DIR/web" run build
rsync -a --delete "$APP_DIR/web/dist/" "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"

cat > /etc/systemd/system/orbit-agent.service <<SERVICE
[Unit]
Description=OrbitAgent API
After=network.target redis-server.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node dist/app.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/nginx/sites-available/orbit-agent <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;

    root $WEB_ROOT;
    index index.html;

    client_max_body_size 20m;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:$API_PORT/api/v1/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

ln -sfn /etc/nginx/sites-available/orbit-agent /etc/nginx/sites-enabled/orbit-agent
rm -f /etc/nginx/sites-enabled/default
nginx -t

systemctl enable redis-server
systemctl restart redis-server
systemctl daemon-reload
systemctl enable orbit-agent
if [[ "$NEEDS_ENV" -eq 0 ]] && ! grep -q '<.*>' "$APP_DIR/.env"; then
  systemctl restart orbit-agent
else
  echo "Skip starting orbit-agent because $APP_DIR/.env still needs real secrets."
  echo "After editing it, run: systemctl restart orbit-agent"
fi
systemctl reload nginx

ufw allow OpenSSH || true
ufw allow 'Nginx HTTP' || true

echo "Provision complete."
echo "Check API: curl http://127.0.0.1:$API_PORT/api/v1/health"
echo "Check logs: journalctl -u orbit-agent -f"
