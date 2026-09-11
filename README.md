# PhoskyWiki

左翼哲学 / 政治经济学 / 历史领域的原子笔记 WIKI：每个词条聚合多个诠释者的视角。

- 领域术语与语言规范：[CONTEXT.md](CONTEXT.md)
- 需求与一期 MVP spec：[REQUIREMENTS.md](REQUIREMENTS.md) · [docs/specs/0001-mvp.md](docs/specs/0001-mvp.md)
- 技术选型与决策记录：[docs/TECH-STACK.md](docs/TECH-STACK.md) · [docs/adr/](docs/adr/)

## 本地开发

```bash
# 1. 起依赖服务（PostgreSQL + Meilisearch）
docker compose up -d

# 2. 准备环境变量（首次）
cp .env.example .env

# 3. 安装依赖并应用数据库迁移
pnpm install
pnpm db:migrate

# 4. 灌入演示内容（词条 / 诠释者 / 视角种子 + 管理员账号，幂等重灌）
pnpm db:seed          # 管理员凭据读 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD，密码留空则随机生成并打印

# 5. 启动应用
pnpm dev            # http://localhost:3000
```

## 测试

先按[隔离验证说明](docs/production.md#隔离验证)启动 `compose.test.yml` 并显式设置以 `_test` 结尾的 `DATABASE_URL`。测试会重灌数据，不使用本地站点库。

```bash
pnpm test           # Vitest：单元 + 集成，连接隔离 PostgreSQL
pnpm test:e2e       # Playwright：启动独立服务器，需先在测试库中 db:seed，不复用已有服务器
pnpm test:containers # 真实生产镜像、随机项目/卷、浏览器与持久性验收
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
```

Playwright 默认下载自带 Chromium；本地若已装 Chrome/Edge，可用系统浏览器跑，跳过下载：

```bash
PW_CHANNEL=chrome pnpm test:e2e
```

CI（GitHub Actions）在每次 push 时跑 lint + typecheck + Vitest + Playwright，全绿才合入。

## 探活

`GET /healthz` 返回 PG 连接状态：`{"status":"ok","checks":{"postgres":"up"}}`（PG 不可达时 `503` + `postgres: "down"`）。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `pnpm db:generate` | 从 `src/db/schema.ts` 生成迁移（drizzle-kit） |
| `pnpm db:migrate` | 应用 `drizzle/` 下的迁移到数据库 |
| `pnpm db:seed` | 清空内容表并重灌演示内容 + upsert 管理员（开发/CI 用，勿在生产跑） |

## 认证与角色（T05）

邮箱 + 密码注册（better-auth，数据库会话，cookie 持久 30 天滚动续期）；未登录即游客，浏览全站不受限。

- 角色枚举 `user_role`：`editor`（注册默认）/ `admin`（受理提交等管理权限，随 T06 落地）/ `trusted`（二期免审编者预留位）；
- 端点挂载在 `/api/auth/*`（better-auth 全套路由）；页头右侧展示登录态与登出按钮；
- 开发演示管理员由 `pnpm db:seed` 灌入；生产使用独立的安全初始化入口，见[生产容器与初始化手册](docs/production.md)。生产禁止运行演示 seed。

## 修订历史与页面恢复（T08）

五种页面均可从「修订历史」进入 `/history/<pageId>`：按时间倒序查看全部快照，选择任意两次修订进行左右对照，删除/新增行及行内改动分别高亮。管理员可回滚到任意历史修订；回滚新增快照并记录来源，原历史不变。

历史页提供软删除操作，页头的「已删除页面」入口用于查看保留的历史与恢复页面。删除后页面及其历史对游客和普通编者不可见；恢复保留原页面 id 和全部修订。回滚、编辑、删除使用同一页面锁协调并发操作。

升级先执行 `pnpm db:migrate`，新增 `revisions.rollback_from_id`。读接口为 `GET /api/pages/<pageId>/history`（可带 `from`、`to`），管理员写接口为 `POST /api/admin/pages/<pageId>`，操作为 `rollback`（带 `revisionId`）、`delete` 或 `restore`。回滚与删除/恢复均更新双链；搜索索引同步与原审核管线一起留待 T10 接入。

## 个人主页与审核通知（T09）

登录后点击页头的编者名称进入 `/profile`：可按待审核、已受理、已驳回筛选自己的提交，并打开提交详情查看差异。历史差异以提交时的起始修订为基准；新建词条或诠释者展示标题与简介的新增内容。

审核受理或驳回（含起始修订过期的自动驳回）后，提交者收到一次站内通知，驳回通知保留理由原文。页头显示未读数量；在个人主页点击「标为已读」清除对应未读提示。浏览页面不会自动标记已读。升级时先执行 `pnpm db:migrate` 创建通知表。

## 读路径（T02 / T04）

游客即可完整浏览，无需登录：

- 词条页 `/<term>/<slug>-<id>`：具名诠释者的视角列表默认露 5 条、可展开全部，右侧信息框；底部反链面板列出引用本词条的视角；
- 视角页 `/<perspective>/<slug>-<id>`：Markdown 渲染，正文双链 + 反链面板；
- 诠释者页 `/<interpreter>/<slug>-<id>`：信息框（生卒年等）+ 全部视角索引；
- 消歧义页 `/<disambiguation>/<slug>-<id>`：同名多义词条分流（如「价值」聚合 价值（政治经济学）/价值（哲学）），成员由括号限定标题派生；指向基准名的 `[[价值]]` 双链落消歧义页，括号限定词条页顶部有反向提示；
- 双链语法：默认 `[[词条名]]` 落词条枢纽；显式 `[[词条名|视角@诠释者]]` 直落「词条 × 诠释者」的视角页（显示 @ 之前的文本，别名中的 `@` 因此是保留字符）；未创建目标渲染为红链；
- 视角列表默认序：站内引用数（links 统计）热度 → 并列时按创建序；读者兴趣将相关诠释者排前；
- URL 只认尾随 id：`/<type>/<id>` 与旧 slug 访问都会 307 到规范路径 `/term/主体性-1`，页面改名不断链。

新词条仅创建导航元数据；解释正文另行提交为具名诠释者视角。
提交需要登录会话：普通编者进入审核队列，管理员提交直接生效。

## 讨论区（T13）

每个词条一个讨论区：`/term/<slug>-<id>/discussion`。编者与管理员可开楼发言并对他楼做一层嵌套回复（纯文本、即时可见、单楼 2000 字上限——富格式仍只留给两票审核的页面内容）；游客全程只读，页面给出登录引导。视角页的「就这个视角发起讨论」跳到讨论区并带 `?perspective=<pageId>` 预填锚点，楼层上的锚点徽标可点击跳回该视角。

版务（管理员）：软删楼层（`DELETE /api/discussion/posts/<postId>`，内容保留、渲染占位、可幂等重删）、锁定/解锁讨论区（`POST`/`DELETE /api/admin/discussion/<termId>/lock`，锁定后任何角色含管理员都不能发言）。发言走 `POST /api/discussion/posts`（游客 401）。

讨论楼层不是页面（ADR-0003：讨论挂在词条上），以 `type: "discussion"` 进入派生搜索索引（ADR-0002）：索引主键用高偏移区段与 pages.id 区隔（见 `lib/search/search-types.ts` 的 `discussionDocId`），发楼/软删/词条软删除与恢复都走增量同步，全量校对一并重灌；搜索命中跳 `/term/<pageKey>/discussion#floor-<id>`。回复通知是二期项，暂不做。升级时先执行 `pnpm db:migrate` 创建讨论表。
