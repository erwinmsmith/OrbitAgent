# 阿里云香港轻量应用服务器部署

目标：把前端和后端都放到阿里云中国香港轻量应用服务器。

当前推荐架构是 Docker Compose + 服务器现有 Nginx 反代：

```text
browser
  -> http://orbit.code-soul.com/            现有宝塔/Nginx vhost
      -> 127.0.0.1:3101                    前端 Nginx 容器
  -> http://orbit.code-soul.com/api/v1/*    现有宝塔/Nginx vhost
      -> 127.0.0.1:3100                    后端 Node 容器

Docker Compose
  -> orbit-agent-api                  Node 后端
  -> orbit-agent-web                  前端静态资源 Nginx
  -> orbit-agent-redis                内部 Redis

后端
  -> MongoDB Atlas                    继续使用现有云数据库
  -> DeepSeek/Zhipu 等模型 API
```

这样前后端都在香港服务器上；数据库暂时不搬，避免迁移用户和历史会话数据。Compose 默认只把前后端暴露到宿主机 `127.0.0.1`，不会直接公开容器端口。

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

Docker 部署使用仓库根目录：

```text
/opt/orbit-agent/.env.production
```

你需要把真实值填进去：

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority
REDIS_HOST=redis
REDIS_PORT=6379
DEEPSEEK_API_KEY=<your_deepseek_key>
DEEPSEEK_BASE_URL=https://api.deepseek.com
JWT_SECRET=<long_random_secret>
JWT_REFRESH_SECRET=<long_random_secret>
ORBIT_EMBEDDER=remote-zhipu
ZHIPU_API_KEY=<your_zhipu_key>
```

如果 MongoDB Atlas 没有放开服务器出口 IP，需要在 Atlas Network Access 中加入轻量服务器公网 IP。

## 第三步：部署

### 方案 A：Docker Compose，推荐用于已有业务的服务器

服务器上准备目录并拉取代码：

```bash
sudo mkdir -p /opt/orbit-agent
sudo chown -R "$USER:$USER" /opt/orbit-agent
git clone --branch main https://github.com/erwinmsmith/OrbitAgent.git /opt/orbit-agent
```

如果目录已存在：

```bash
cd /opt/orbit-agent
git fetch origin
git checkout main
git pull --ff-only origin main
```

创建生产环境文件：

```bash
cd /opt/orbit-agent
cp .env.production.example .env.production
nano .env.production
```

启动容器：

```bash
docker compose -f docker-compose.aliyun.yml up -d --build
docker compose -f docker-compose.aliyun.yml ps
```

安装当前服务器的宝塔/Nginx vhost：

```bash
SERVER_NAME=orbit.code-soul.com bash scripts/install-aliyun-docker-vhost.sh
```

如果 DNS 还没生效，可以先用 Host header 测试：

```bash
curl -H 'Host: orbit.code-soul.com' http://127.0.0.1/
curl -H 'Host: orbit.code-soul.com' http://127.0.0.1/api/v1/health
```

### 方案 B：systemd 部署，仅适合干净机器

`scripts/provision-aliyun-lightweight.sh` 会安装宿主机 Node/Nginx/Redis 并改写站点配置，只适合没有现有站点的干净机器。确认审计没有发现需要保留的已有站点后，才执行：

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
ssh root@<server-ip> 'cd /opt/orbit-agent && docker compose -f docker-compose.aliyun.yml logs -f api'
```

重启后端：

```bash
ssh root@<server-ip> 'cd /opt/orbit-agent && docker compose -f docker-compose.aliyun.yml restart api'
```

更新代码并重新构建：

```bash
ssh root@<server-ip> '
  cd /opt/orbit-agent &&
  git fetch origin &&
  git checkout main &&
  git pull --ff-only origin main &&
  docker compose -f docker-compose.aliyun.yml up -d --build &&
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
- Docker Compose project `orbit-agent`
- 宝塔 Nginx vhost `/www/server/panel/vhost/nginx/orbit.code-soul.com.conf`

如果审计发现 `3100` 或 `3101` 已被占用，可以通过 `API_PORT` / `WEB_PORT` 调整 compose 和 vhost 端口。
