# 阿里云香港节点前端测试部署

目标：把 `web/dist` 发布到阿里云 OSS 香港地域，用作国内用户不需要梯子的测试入口。

## 你需要准备

1. 阿里云账号。
2. OSS Bucket，地域选择 `中国香港`，Endpoint 为 `oss-cn-hongkong.aliyuncs.com`。
3. 一个 RAM 用户 AccessKey，建议只授予这个 Bucket 的读写权限。
4. 本机安装 `ossutil`，并完成登录配置。

## Bucket 配置

在 OSS 控制台中：

1. 创建 Bucket，例如 `orbit-agent-web-hk`。
2. 地域选择 `中国香港`。
3. 开启静态网站托管。
4. 默认首页：`index.html`。
5. 错误页面：`index.html`。

错误页面也设置为 `index.html` 是为了支持 React/Vite 单页应用的前端路由。

公开访问有两种做法：

- 测试期：Bucket 静态网站公开读。
- 更正式：绑定自定义域名或接 CDN，只开放静态站访问。

香港地域通常不需要大陆 ICP 备案；如果后续接入中国大陆 CDN 节点或大陆云资源，域名通常需要备案。

## 本机环境变量

不要把密钥写入仓库。建议在当前 shell 中临时导出：

```bash
export ALIYUN_OSS_BUCKET=orbit-agent-web-hk
export ALIYUN_OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com
export VITE_ORBIT_API_BASE=https://orbit-agent-api.onrender.com/api/v1
```

如果使用非默认的 `ossutil` 二进制路径：

```bash
export OSSUTIL_BIN=/path/to/ossutil
```

## 发布

```bash
npm run deploy:web:aliyun-hk
```

脚本会执行：

1. `npm --prefix web run build`
2. 上传 `web/dist/` 到 `oss://$ALIYUN_OSS_BUCKET/`

## 测试地址

OSS 静态网站域名可以在 Bucket 的“静态网站托管”页面查看。格式通常类似：

```text
http://<bucket>.oss-website-cn-hongkong.aliyuncs.com
```

如果绑定了自定义域名，则访问你的自定义域名。

## 重要说明

这只迁移前端。当前前端 API 默认仍调用：

```text
https://orbit-agent-api.onrender.com/api/v1
```

所以香港 OSS 能改善“页面打不开”的问题，但起卦、登录、对话是否稳定，还取决于国内用户能否稳定访问 Render 后端。后续如果要面向国内长期使用，后端也应迁到阿里云香港或大陆云服务。
