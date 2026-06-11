# 阿里云香港轻量应用服务器部署

目标：把前端和后端都放到阿里云中国香港轻量应用服务器。

推荐架构：

```text
browser
  -> http://<server-ip>/              Nginx 静态前端
  -> http://<server-ip>/api/v1/*      Nginx 反代本机 Node 后端

Node 后端
  -> MongoDB Atlas                    继续使用现有云数据库
  -> 本机 Redis                       用于临时记忆和队列
  -> DeepSeek/Zhipu 等模型 API
```

这样前后端都在香港服务器上；数据库暂时不搬，避免迁移用户和历史会话数据。

## 第一步：确认服务器现状

先不要部署。先 SSH 登录服务器并运行只读审计脚本，确认机器上是否已有网站、Nginx、Docker、PM2 或其他业务。

本机执行：

```bash
scp scripts/audit-aliyun-server.sh root@<server-ip>:/tmp/audit-aliyun-server.sh
ssh root@<server-ip> 'bash /tmp/audit-aliyun-server.sh | tee /tmp/orbit-server-audit.txt'
scp root@<server-ip>:/tmp/orbit-server-audit.txt ./orbit-server-audit.txt
```

把 `orbit-server-audit.txt` 发给 Codex 查看即可。这个脚本只读，不会修改服务器。

## 如何 SSH 登录

在阿里云轻量应用服务器控制台：

1. 找到公网 IP。
2. 确认防火墙/安全组开放 `22`、`80`。
3. 如果没有 SSH key，可在控制台重置实例 root 密码。
4. 本机登录：

```bash
ssh root@<server-ip>
```

第一次连接会询问是否信任主机，输入 `yes`。

如果你使用密钥：

```bash
chmod 600 /path/to/key.pem
ssh -i /path/to/key.pem root@<server-ip>
```

## 第二步：准备环境变量

部署脚本会在服务器创建：

```text
/opt/orbit-agent/.env
```

你需要把真实值填进去：

```env
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
```

如果 MongoDB Atlas 没有放开服务器出口 IP，需要在 Atlas Network Access 中加入轻量服务器公网 IP。

## 第三步：部署

确认审计没有发现需要保留的已有站点后，再执行：

```bash
scp scripts/provision-aliyun-lightweight.sh root@<server-ip>:/tmp/provision-aliyun-lightweight.sh
ssh root@<server-ip> 'SERVER_NAME=_ bash /tmp/provision-aliyun-lightweight.sh'
```

如果后续使用子域名，例如 `orbit.code-soul.com`：

```bash
ssh root@<server-ip> 'SERVER_NAME=orbit.code-soul.com bash /tmp/provision-aliyun-lightweight.sh'
```

部署完成后访问：

```text
http://<server-ip>/
http://<server-ip>/api/v1/health
```

## 常用维护命令

查看后端日志：

```bash
ssh root@<server-ip> 'journalctl -u orbit-agent -f'
```

重启后端：

```bash
ssh root@<server-ip> 'systemctl restart orbit-agent'
```

更新代码并重新构建：

```bash
ssh root@<server-ip> '
  cd /opt/orbit-agent &&
  git pull --ff-only origin main &&
  npm ci --include=dev &&
  npm run build &&
  npm --prefix web ci &&
  VITE_ORBIT_API_BASE=/api/v1 npm --prefix web run build &&
  rsync -a --delete web/dist/ /var/www/orbit-agent/ &&
  chown -R www-data:www-data /var/www/orbit-agent &&
  systemctl restart orbit-agent &&
  systemctl reload nginx
'
```

## 子域名 `code-soul.com`

可以建子域名，例如：

```text
orbit.code-soul.com  A  <server-ip>
```

因为服务器在中国香港，通常不需要大陆 ICP 备案。等 DNS 生效后，把 Nginx `server_name` 改成该域名，再加 HTTPS。

HTTPS 可后续使用 Certbot：

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d orbit.code-soul.com
```

## 注意

部署脚本会管理这些路径和服务：

- `/opt/orbit-agent`
- `/var/www/orbit-agent`
- `/etc/systemd/system/orbit-agent.service`
- `/etc/nginx/sites-available/orbit-agent`
- `/etc/nginx/sites-enabled/orbit-agent`

如果审计发现这些路径或 80 端口已有业务，需要先确认再部署。
