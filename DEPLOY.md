# Docker 公开演示部署

此镜像用于让大家体验接单、厨房制作与交接流程，**仅允许虚构演示数据**。每位访客进入后获得独立演示空间；不接入真实美团、不接受营业模式，也不应输入真实顾客信息。部队锅与拌饭菜单、价格均为示例。

应用保留 React + TypeScript + Vinext 的服务端构建，在容器内部使用 Wrangler/Miniflare 的本地 Worker 与 D1 兼容 SQLite 持久化。它不需要 Cloudflare 账号、ChatGPT 登录或美团密钥。此运行方案适合小规模功能演示，不是高可用的正式门店生产部署。

## 本机启动

需要 Docker Engine（或开启 Linux 容器的 Docker Desktop）与 Docker Compose v2。项目中须已包含生成并提交的 `drizzle/*.sql` 初始迁移。

```sh
docker compose up -d --build
docker compose logs -f stonebowl
```

打开 `http://localhost:8080`，阅读演示说明并点击“进入我的演示空间”，随后载入演示订单。镜像标签为 `stonebowl-demo:1.0.0`。构建阶段安装锁定依赖、运行领域与容器测试、执行 `npm run build`；运行时不再编译。

开发检查可运行 `node --test tests/domain.test.mjs tests/container.test.mjs`。可选的真实本地 D1 迁移集成测试为 `RUN_CONTAINER_RUNTIME_TESTS=1 node --test tests/container-runtime.test.mjs`；PowerShell 先设置 `$env:RUN_CONTAINER_RUNTIME_TESTS='1'` 再运行该测试。它使用隔离的临时数据库，验证首次应用、重启跳过与 SQL 改动拒绝，不会触碰门店数据。

## 部署给其他人访问

将项目复制到装有 Docker 的服务器，设置浏览器实际访问的精确 origin（协议、域名或 IP、端口），然后启动：

```sh
PUBLIC_ORIGIN=http://192.0.2.10:8080 docker compose up -d --build
```

`192.0.2.10` 仅是文档示例地址，请替换为服务器实际地址。PowerShell 可先执行 `$env:PUBLIC_ORIGIN='http://你的服务器IP:8080'`，再执行 `docker compose up -d --build`。如修改映射端口，同时设置 `HTTP_PORT` 以及包含该端口的 `PUBLIC_ORIGIN`。配置不匹配的 Host/Origin 会被网关拒绝。

如经 Caddy/Nginx 等反向代理提供 HTTPS，配置 `PUBLIC_ORIGIN=https://你的域名`，上游转发到容器 8080 并保留原始 `Host`。浏览器 HTTPS 模式会启用 Secure Cookie。不要直接暴露 Wrangler 的 8787 端口：它只绑定容器内 `127.0.0.1`，Compose 仅映射网关端口。

## 保存或传递镜像

```sh
docker build -t stonebowl-demo:1.0.0 .
docker save -o stonebowl-demo-1.0.0.tar stonebowl-demo:1.0.0
```

如果 Docker Hub 网络超时，可只为这一次构建指定 Docker 官方在 AWS ECR Public 分发的 Node 基础镜像，不改宿主 Docker 配置：

```sh
docker build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim -t stonebowl-demo:1.0.0 .
```

该来源可在 [AWS ECR 的 Docker 官方 Node Gallery](https://gallery.ecr.aws/docker/library/node) 核对。默认仍使用 `node:24-bookworm-slim`。镜像层下载、构建和启动需分别验证；仅取得 manifest 不能证明已构建镜像。

在另一台机器执行 `docker load -i stonebowl-demo-1.0.0.tar`，再运行 `docker compose up -d --no-build`。未执行成功的 `docker build` 不能称为已产出镜像；此项目提供的是可构建镜像的完整源文件。

## 持久化、迁移与升级

命名卷 `stonebowl_demo_data` 挂载到 `/app/.wrangler/state`，保存 D1 本地数据库及随机会话签名密钥。普通容器重启、重建不会丢失该卷；浏览器 Cookie 有效期为 8 小时。清除 Cookie 或换浏览器会进入新演示空间；旧演示记录不会自动迁移到新访客身份。

启动前将 Drizzle 每份 SQL 的完整 SHA256 加入迁移文件名，并由 Wrangler 的 `_container_migrations` 表在迁移事务中记录执行情况。再次启动会跳过已执行版本；修改、删除或重排已经执行的迁移会拒绝启动。升级时只追加迁移，先备份再构建新镜像。失败迁移不会启动服务。只运行一个应用副本，不要让多个容器共享写同一卷。

停止应用后可将命名卷导出备份（实际卷名通常带 Compose 项目前缀）：

```sh
docker compose stop stonebowl
docker volume ls
docker run --rm -v 实际卷名:/data:ro -v "$PWD:/backup" alpine tar czf /backup/stonebowl-data.tgz -C /data .
docker compose start stonebowl
```

不要执行 `docker compose down -v`，除非明确希望删除所有演示数据库及签名密钥。普通停止请使用 `docker compose stop`，普通移除容器使用 `docker compose down`。

## 访问与安全边界

网关剥除来自外网的 `oai-*`、认证、Cookie 和代理身份头，再根据签名会话注入仅内部有效的访客身份。每个 API 继续按访客 ID 隔离数据；网关额外拒绝营业模式与非白名单写接口。Cookie 具有 HttpOnly、SameSite=Strict、固定过期及签名校验，写操作校验 Origin，退出使用 POST。会话创建与请求带有进程内限速；这不能替代公网入口的 HTTPS、基础 DDoS 防护与资源预算。

`GET /healthz` 用于容器健康检查；`GET /container/session` 返回公开演示模式和是否已进入演示空间。应用只应展示演示能力。此网关没有店员账号、密码登录或真实美团授权能力。

Wrangler 本地迁移和目录约定参考 [Cloudflare D1 迁移文档](https://developers.cloudflare.com/d1/reference/migrations/) 与 [Wrangler D1 命令文档](https://developers.cloudflare.com/d1/wrangler-commands/)。
