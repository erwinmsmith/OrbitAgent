#!/usr/bin/env bash
set -euo pipefail

section() {
  printf '\n========== %s ==========\n' "$1"
}

section "system"
hostnamectl || true
lsb_release -a 2>/dev/null || true
uptime || true
df -h || true
free -h || true

section "public network"
hostname -I || true
ip -brief address || true
ss -tulpn || true

section "web servers"
systemctl status nginx --no-pager 2>/dev/null || true
systemctl status apache2 --no-pager 2>/dev/null || true
systemctl status caddy --no-pager 2>/dev/null || true

section "nginx config"
nginx -T 2>/dev/null | sed -n '1,260p' || true

section "common web roots"
for dir in /var/www /usr/share/nginx/html /opt; do
  if [[ -d "$dir" ]]; then
    echo "# $dir"
    find "$dir" -maxdepth 3 -type f \( -name 'index.html' -o -name 'package.json' -o -name '*.conf' \) -print 2>/dev/null | sort || true
  fi
done

section "node and process managers"
node -v 2>/dev/null || true
npm -v 2>/dev/null || true
pm2 list 2>/dev/null || true
systemctl list-units --type=service --state=running --no-pager | grep -Ei 'node|pm2|orbit|nginx|redis|mongo|docker' || true

section "containers"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || true
docker compose ls 2>/dev/null || true

section "databases"
systemctl status redis-server --no-pager 2>/dev/null || true
systemctl status mongod --no-pager 2>/dev/null || true

section "cron"
crontab -l 2>/dev/null || true
ls -la /etc/cron.d 2>/dev/null || true

section "done"
echo "Audit completed. This script did not modify the server."
