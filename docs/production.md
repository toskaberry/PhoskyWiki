# D01：生产容器与空库初始化

实现范围：[D01 / #35](https://github.com/raime7/PhoskyWiki/issues/35)。本票提供固定构建、私有源站、数据库迁移、安全初始化、搜索重建和隔离验收入口。公网 TLS、Cloudflare 来源策略、真实 R2、发布前备份和 2 GB Vultr 容量验收仍需各自任务完成，不能据本票宣布可公开试运行。

## 运行版本与秘密

固定 Node `24.14.0-bookworm-slim`、pnpm `10.30.3`、提交内的 `pnpm-lock.yaml`；PG `18.3-alpine3.23`、Meilisearch `v1.15.0`、Caddy `2.11.2-alpine`。镜像还固定已拉取核验的 SHA-256 digest，升级任一版本后重新执行容器验收。应用镜像保留运行和运维所需锁定依赖（包括 tsx、Drizzle 和 pg），生产启动使用 `next start`；无启动时安装、迁移或 seed。

在 CI 或构建机从已检查的固定提交构建，2 GB 服务器只拉取产物：

```sh
docker build --build-arg APP_REVISION="$(git rev-parse HEAD)" -t registry.example/phoskywiki:COMMIT .
```

发布到自己的镜像库后，将 `APP_IMAGE` 设为 `registry.example/phoskywiki@sha256:实际摘要`。本票不自动推送镜像或发布到服务器；后续 D04 接入手动发布门禁。镜像 `org.opencontainers.image.revision` 与 `APP_REVISION` 记录源码提交。构建上下文使用白名单，不包含 `.env`、本地数据、测试输出、管理员配置或真实秘密；构建没有数据库服务依赖。Better Auth 收集路由时需要配置，Dockerfile 仅给该构建进程提供明确的占位密钥与无效域名，不带入运行阶段的环境；运行入口强制加载独立配置。不要给 Docker build 传生产凭据。

在服务器仓库之外建立目录，例如 `/etc/phoskywiki/secrets`，目录权限 `0700`。从 `deploy/runtime.example.json` 和 `deploy/admins.example.json` 填写真实配置，另创建 `postgres-password` 和 `meili-key` 两个只含秘密的文本文件。秘密在密码管理器与受保护文件间交付，不发到聊天、不作为 CLI 参数、不输出到 CI。管理员各自保存自己的密码。

- `runtime.json`：应用运行配置；数据库密码需 URL 编码，必须与 `postgres-password` 一致；搜索 key 必须与 `meili-key` 一致。`BETTER_AUTH_URL` 必须匹配浏览器实际来源。R2 使用应用专属私有桶凭据。
- `admins.json`：恰好两组不同邮箱、名称和 8–128 字符密码；使用长随机独立密码。初始化对邮箱 trim + lowercase。此文件只挂给 `ops`，应用不能读取。
- Linux 文件由 UID 1000 拥有、权限 `0600` 或 `0400`；容器应用和 ops 使用 `1000:1000`。挂载源目录由维护者/root 管理。Windows 本地 ACL 由维护者限制；自动化容器测试在 Linux volume 内创建正确权限，避免 Docker Desktop bind mount 的权限映射差异。
- 初始化不会打印密码、账号散列、连接串、异常参数或签名链接。出错仅返回固定分类诊断。不要用 `set -x`、`cat` 或完整环境转储排查秘密。

设置一个仅含非秘密的部署环境文件，例如 `/etc/phoskywiki/compose.env`：

```dotenv
APP_IMAGE=registry.example/phoskywiki@sha256:REPLACE_WITH_DIGEST
SECRETS_DIR=/etc/phoskywiki/secrets
ORIGIN_PORT=8080
```

以下命令都在仓库根目录执行，`dc` 仅缩写固定配置，不加载开发 Compose：

```sh
dc() { docker compose --env-file /etc/phoskywiki/compose.env -f compose.production.yml "$@"; }
dc pull
dc up -d --wait postgres meilisearch
dc run --rm --no-deps ops verify --target postgres:5432/phoskywiki/phosky
dc run --rm --no-deps ops migrate --target postgres:5432/phoskywiki/phosky
dc run --rm --no-deps ops bootstrap --target postgres:5432/phoskywiki/phosky --credentials /run/secrets/admins.json
dc up -d --wait app proxy
dc run --rm --no-deps ops reindex --target postgres:5432/phoskywiki/phosky --search http://meilisearch:7700/pages
curl --fail http://127.0.0.1:8080/healthz
```

容器之外也可使用 `pnpm ops:production <命令> ...`，此入口故意不加载 `.env`，需显式注入环境。`--target` 必须与 `DATABASE_URL` 的 `host:port/database/user` 完全一致，连接后再核验 `current_database()` / `current_user`；禁止 URL query 参数覆盖连接目标。此入口服务于内部 PostgreSQL 网络，不支持远程 URL 的 SSL query 参数。搜索重建另要求确认完整 `MEILI_HOST/MEILI_INDEX_UID`，配置缺失不会静默落到空索引实现。目标确认是防误操作检查，不能替代数据库凭据隔离或识别被人为替换的同名数据库集群。

## 首次内容与重试

初始化只建两位缺失管理员；不建任何内容页面。管理员登录后从“新建词条”填写名称、简介、别名和关键文本，再另行添加具名诠释者视角。

迁移 0019 会永久删除编委会页面、视角、历史和旧词条正文提案，并取消公共置顶。部署时必须在迁移后运行上面的 `reindex` 命令，清理搜索索引中已删除的内容；已记录的索引状态会标记为需要重建。该迁移删除了旧版依赖的列，迁移成功后应运行配套新版应用；发布流程会阻止自动回退到旧应用。

初始化先在事务中获取并发锁，核验所有账号，再创建账号和凭据；任何失败整体回滚。重复或并发执行保留密码、角色、页面、正文及图片记录。已有管理员必须有完整且符合 better-auth 命名空间的 credential 账号。普通编者同邮箱、大小写歧义、半成账号均明确失败；不能靠修改初始化参数静默提权/重设。先检查冲突原因，由账号恢复/内容管理流程处理，再运行相同命令。

缺配置、错误目标：修正受保护配置及 `--target`，确认数据库后重试。迁移失败：停止继续上线，检查迁移与数据库兼容性；不要运行 seed。初始化不完整：事务应无部分写入，修复原故障后重试。已有密码遗失：走账号恢复，不运行演示 seed。`db:seed` 及其两个内部入口在 `NODE_ENV=production` 或 `PHOSKYWIKI_ENV=production` 下拒绝执行。

## 网络、卷与预算

PG/Meilisearch/应用不发布宿主端口；PG 和搜索只接内部 backend 网络。应用另接 egress 网络以调用 R2/BYOK 外部服务。Caddy 只映射 `127.0.0.1:8080`，提供本机 HTTP 源站；可经 SSH 端口转发验收。此阶段不会直接对公网开放 HTTP，也没有冒充已经完成 Cloudflare/TLS 配置。Caddy 保留 Next 的缓存头和流式响应，不启用共享响应缓存或带 URL 的访问日志。

`pgdata` 保存账号、内容、修订和图片元数据；`meili_data` 保存可重建索引；`caddy_data` / `caddy_config` 保存代理状态。图片字节在 R2，不在应用容器。停止用 `dc stop`，恢复用 `dc up -d --wait`；移除容器保留卷用 `dc down`，生产不要加 `--volumes`。替换应用只用 `dc up -d --no-deps app`，不要重新初始化数据库卷。

PG 官方 entrypoint 仅在准备数据目录时使用 root，数据库进程降到 postgres 用户；Meilisearch/Caddy 使用镜像内 root 以初始化命名卷（宿主不共享数据目录、禁用新增权限）。所有常驻服务设置 `unless-stopped`、健康检查、每容器 `10m × 3` 日志轮转；应用优雅停止等待 30 秒。

| 服务 | 容器内存上限 | 额外预算 |
| --- | --- | --- |
| 应用 | 640 MiB | Node heap 384 MiB |
| PostgreSQL | 384 MiB | shared buffers 96 MiB，40 连接，work_mem 2 MiB |
| Meilisearch | 384 MiB | 索引内存 128 MB，1 个索引线程 |
| Caddy | 64 MiB | 无响应缓存 |
| 按需 ops | 384 MiB | Node heap 256 MiB；只运行一个运维任务 |

常驻上限合计 1472 MiB，ops 同时工作合计 1856 MiB，尚需主机内核、Docker、页缓存等空间。**这是防失控的限额，不是 2 GB 已足够的证明**。首次迁移/初始化先不开应用；真实 1 vCPU / 2 GB 机器须记录同时浏览、登录、搜索、图片和索引工作的峰值（D03 完成后再组合备份），OOM/持续内存不足则停止容量验收并报告。Meilisearch 参数依据[官方配置参考](https://www.meilisearch.com/docs/resources/self_hosting/configuration/reference)。

```sh
dc ps
dc images
dc logs --tail 100 app
docker stats --no-stream
docker inspect "$(dc ps -q app)" --format '{{.Config.Image}} {{.State.Health.Status}} {{.State.OOMKilled}}'
docker image inspect "$APP_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
docker volume ls --filter label=com.docker.compose.project=phoskywiki
```

## 隔离验证

本地原有 `.env` 中的站点库不再允许直接跑测试。专用测试服务无生产卷，连接参数：

```sh
docker compose -f compose.test.yml up -d --wait
export DATABASE_URL=postgres://phosky:phosky@127.0.0.1:55435/phoskywiki_test
export BETTER_AUTH_SECRET=isolated-test-secret-0123456789abcdef0123456789
export SEARCH_CONTRACT_HOST=http://127.0.0.1:57735
export MEILI_MASTER_KEY=isolated-test-meili-master-key
pnpm db:migrate
pnpm exec vitest run tests/integration/bootstrap.test.ts
pnpm test
```

PowerShell 使用 `$env:变量='值'`。数据库名必须以 `_test` 结束；初始化契约在其中再创建随机命名测试库并于结束后删除。测试设置清除应用 R2 凭据；真实 R2 契约单独要求 `R2_CONTRACT_*`、不同于应用的 `*-test` 桶。无真实 R2 配置仍明确跳过，不计为供应商验收。搜索契约用专用 `pages-contract-test`，网站测试用 `pages-test`；建议始终使用本票专属测试 Meilisearch 服务。

`pnpm test:containers` 从当前源码构建真实镜像，生成随机 Compose 项目和秘密卷，启动 PG、Meilisearch、应用、Caddy；验证错误目标被拒、迁移、生产初始化、管理员浏览器登录、网站 HTTP 创建首条带正文词条、直编修订、搜索重建、并发重试、应用重启和替换后账号/正文/图片元数据保留及健康检查。退出只清理本次生成的项目及卷，不接受外部数据库或对象存储目标；凭据不写入仓库。报告写入 `artifacts/operations/d01-containers.json`，包含源码/镜像标识、是否脏工作区、cgroup 峰值与限制。

图片检查使用真实上传 API 生成元数据，尚不上传字节，不替代真实 R2 测试。容器报告也不替代 Vultr 宿主峰值和大陆网络验收。常规 CI 对同一镜像执行容器与浏览器验收，通过后仅 main 发布该镜像；`Production containers` 保留为手动隔离复验入口。发布流程见 [releases.md](releases.md)。
