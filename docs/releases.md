# 发布与依赖维护

D04（#38）的入口是 Actions **Manual production release**。合并代码不发布生产。
CI 构建一次应用镜像，容器验收和完整 Playwright 使用相同镜像 ID；lint、类型检查、Vitest 和浏览器检查全部通过后，主分支 push 才上传该镜像并记录 digest。上传后按 digest 拉取并再次核对测试过的镜像 ID。`release-<attempt>/release.json` 保存源码 SHA、CI run、attempt、镜像 ID 和 digest。

经典 Docker 存储的 `.Id` 是配置摘要，containerd 存储可能返回 manifest 摘要。主机在后一种情况下要求本地 Id/Descriptor 都等于收据的固定 registry digest，再通过 `docker manifest inspect` 核对该单镜像 manifest 的 config digest 等于 CI 的 imageId，并核对源码标签；不会把 manifest digest 直接当作配置摘要放行。这个只读 registry 查询使用本次发布的临时登录凭据。

## 一次性安装

1. 主分支保护要求 `lint + typecheck + vitest` 和 `playwright + container`，strict=true，绑定 GitHub Actions app，并对管理员生效。发布脚本还独立检查 **指定提交**、main push、仓库、CI workflow、当前 attempt 的三项成功 jobs 和收据；monitor 绿灯、PR 绿灯、旧 attempt 或 mutable tag 均不能发布。不能仅靠手写 commit status 放行。
2. 在 GitHub 建立 `production` environment，部署分支限制为 `main`。设置 environment secrets `PRODUCTION_RELEASE_KEY`、`PRODUCTION_RELEASE_HOSTS` 和 variable `PRODUCTION_RELEASE_TARGET`（`phosky-release@主机`）。HOSTS 必须来自已通过供应商控制台等独立通道核对的 SSH host key；禁止在发布时用未核验的 ssh-keyscan 或关闭 StrictHostKeyChecking。
3. 创建无密码登录的专用 SSH 用户 `phosky-release`，不给 Docker group、不允许写 `/opt/phoskywiki`、配置、脚本或 sudoers。authorized_keys 使用 `restrict,command="sudo -n /usr/local/sbin/phoskywiki-release"`。sudoers 只允许这个 root 拥有且无参数的固定命令；禁止 shell、docker、scp、任意 node 命令和端口转发。运维管理员保留独立恢复入口。
4. 将 `deploy/phoskywiki-release` 安装到上述路径，root:root 0755。安装 Node 24.14.0、gh CLI、Docker 与支持 `!override` 的 Compose；核实 wrapper 中 Node 路径。将本次审查过的 `scripts/release*.mjs`、Compose 文件及 Caddy 配置部署到 root 拥有的 `/opt/phoskywiki`。发布只替换 app 镜像，Compose/代理/数据库/搜索变更须单独审查安装。
5. 将 `deploy/release.example.json` 复制为 `/etc/phoskywiki/release.json`（root 0600），填入实际项目、目标、健康 URL 和 Compose 文件。`deployment.env` 为无引号的 `KEY=value` 数据，至少有固定 digest 的 `APP_IMAGE`、`BACKUP_IMAGE`、绝对路径 `SECRETS_DIR`。不得写 shell 展开。程序不会运行该文件里的 shell 代码。D03 的 backup-config 中 appRevision 和 runtime 必须对应实际运行版本；完整成功发布后自动更新 appRevision。
6. 不在服务器保存本机个人 GitHub 令牌。手动 workflow 将仅有 Contents/Actions/Packages read 的短期 `github.token` 随 SSH stdin 请求发送；主机只在 gh 子进程环境中使用它再次查询证据，随后通过 stdin 登录 GHCR。Docker 凭据放入本次发布独立的 0700 临时目录，正常完成或失败均删除；令牌不进入参数、输出、发布记录或应用容器。强制杀死进程可能留下临时目录，检查孤立进程后清理 `/tmp/phosky-release-auth-*`；GitHub 工作结束也会撤销该临时令牌。SSH 持有人不能提交本地收据或任意镜像。
7. 先完成下述隔离演练，再配置真实站点；缺配置或凭据应失败，不能为获得绿灯绕过校验。D07 复验实际 SSH 限权、公开站点、恢复和 2 GB 资源。

仓库改名或转移后，通过供应商控制台进入服务器，核对 GitHub 返回的 canonical `full_name`，再同步 root 0600 的 `/etc/phoskywiki/release.json` 中 `repository`。GitHub 的旧仓库 URL 即使重定向，发布门禁仍要求仓库和镜像前缀完全一致；不得通过接受任意重定向目标来绕过该校验。旧的运行镜像与备份版本继续保留其真实摘要，成功发布后才更新。更新发布工具时同时安装所有 `scripts/release*.mjs` 运行模块，并保留 root 所有权。

## 常规发布

1. 每周一审查 Dependabot 的 npm/pnpm 锁文件、Actions 和 Docker 更新 PR；查看发行说明、授权变化和安全公告。所有 PR 运行相同 CI，不自动合并或部署。锁文件必须随依赖一起提交，使用 `pnpm install --frozen-lockfile` 检查。
2. 选定 main 的成功 **CI** run 和其完整 40 位 SHA，保存 release 收据；不要把本地脏工作区的测试记录当作该 SHA 的证明。收据保留 90 天；过期版本须重新运行 CI 生成新的合格产物。
3. 提前经既有读者/编者沟通渠道公告维护开始时间、预计不超过 10 分钟、影响范围及取消/延期通知渠道。发布工具只记录 notice，不替维护者发送消息。暂停其他导入、索引写入和手工数据库操作；系统定时备份可读库，但不要在发布期间修改备份配置或密钥。
4. 在 main 上手动运行 workflow，输入 CI run ID、SHA 和公告记录。Actions 与主机锁分别串行。SSH 断开、Actions 取消不会授权第二次迁移；检查主机证据和锁再处理。平台可能取消多余 pending 请求，未执行的请求须重新手动提交。
5. 主机核验环境、数据库/图片桶、运行中的旧镜像、备份配置和资源；拉取固定新镜像并校验 ID/提交；停 app，D03 create+verify 完整恢复点，运行迁移，启动新 app 并检查源站。默认空闲磁盘至少 3 GiB、总内存至少 1800 MiB；这些是预检阈值，不是 2 GB 容量验收。
6. 查看 `/var/lib/phoskywiki/releases/release-*.json`：前后 SHA/镜像、恢复点、迁移阶段、结果、中断时长及 `maintenanceTargetMet`。备份超过 6 分钟时不开始迁移，尝试恢复旧 app；整个维护实测超过 600 秒必须记录目标失败并优化，不得改报成功。
7. 浏览器核实登录、公开内容、新建/修订和图片，再宣布维护结束。版本记录与主机日志可用于排错；不要复制运行凭据、邀请链接或原始应用日志到公开 issue。

## 取消、失败与恢复

发布入口在读取配置、解析请求或验证 CI 时拒绝，也会向 Actions 输出非空 `release-result.json`，包含 `phase` 和固定白名单错误码，不包含原始异常、请求或凭据。`RELEASE_NOT_QUALIFIED:REPOSITORY_MISMATCH` 表示主机仓库配置与 CI 返回身份不同；`RELEASE_EVIDENCE_FETCH_FAILED` 检查 GitHub 访问和临时令牌权限；`RELEASE_ARTIFACT_UNAVAILABLE` 检查当前 attempt 的收据是否存在且可读。`phase=deployment` 的入口异常将迁移状态标为 `unknown`，必须查看主机记录和锁，不能据此盲目重试。

| 结果/阶段 | 处理 |
| --- | --- |
| 预检拒绝 | 旧应用保持运行；补齐目标、空间、收据或凭据后重新手动发布 |
| 停写后备份失败 | 不迁移，尝试恢复旧应用；调查完整恢复点失败原因 |
| 新应用不健康、迁移集合完全一致 | 自动切回旧镜像，并核验健康；数据库不回退，新增内容保留；发布仍标失败 |
| 迁移失败/超时、迁移集合不同或持久配置失败 | 保持停写、保留 release.lock，结果为 manual-recovery-required；禁止盲目重跑或切回 |
| SSH 断开、进程被杀、主机重启 | 锁文件保留；检查记录、Docker app/ops 状态和数据库迁移表，确认无残留迁移容器仍在运行后人工处理 |

发布预检要求迁移历史只能追加，原 SQL 和 journal 条目不能改变，并核对数据库已应用的哈希/时间戳与实际旧镜像一致；倒退、分叉或库外迁移漂移在停写前拒绝。自动切回只允许两个镜像的完整 SQL 和迁移 journal 相同。即便维护者认为新增列兼容，也须在恢复副本验证旧应用可用后，通过受控运维入口显式切回；不在普通发布输入里提供“强制兼容”开关。

唯一历史编码兼容项是 `scripts/release-migrations.mjs` 列出的 13 组明确 SQL 文件哈希：初始 Windows 镜像的 CRLF 字节与已逐文件审查的 LF 字节等价，差异均在引号外。镜像历史只允许已列出的 CRLF→LF 过渡，不做全局换行归一化，不接受新增别名或反向变化。数据库实际由 Linux/Windows 镜像先后迁移，因此账本核验独立允许同一准确哈希对的任一成员，时间戳和行数仍须完整匹配，绝不改写账本。该规则也适用于后续 LF 镜像，其他 SQL 继续严格核对字节，Git 属性固定迁移文件为 LF。安装发布入口时必须同时安装受审查的 `release-migrations.mjs`。

有破坏性变更时先安排单独维护：公告并停写，完整备份，克隆到独立空数据库/图片前缀，运行升级与真实浏览器验收，同时测试旧应用兼容性。若不能切回，提前准备修复升级路线及数据恢复方案。实际失败后保存当前数据库/图片证据（包括备份后新写入），使用 D03 恢复到**新的**空目标，核对/迁移增量内容、账号和图片，重建搜索并验证后再切换目标。不得向原库自动导入旧 dump 来“恢复绿灯”。由维护者确认目标和数据处理后清理锁；不删除证据。页面历史修订回滚不是部署或灾难恢复。

## 高危补丁与大版本

高危补丁先依据官方公告确认本站是否受影响；暴露且可利用的情况立即限制相关入口并安排当日补丁 PR/维护。紧急也要经过同一产物检查、备份和手动发布；不能直接在生产 `pnpm update`。

Node、PostgreSQL 和 Meilisearch 大版本分别建演练任务：固定新版本与 digest，检查上游升级要求；在从完整恢复点得到的独立副本执行迁移，运行完整测试和浏览器/图片/搜索验收，记录时间和资源。PG 跨大版本采用上游支持的升级/导出导入方式，不能把旧数据卷直接挂给新大版本；搜索可从 PG 重建，但先验证 API/索引设置兼容。数据库升级后的旧容器能否运行不能由应用发布程序推断。此处不执行无关升级。

## 隔离验证

`node --test scripts/release-gate.test.mjs` 验证资格证据边界。`TEST_APP_IMAGE=<已构建镜像ID> pnpm test:containers` 验证实际生产应用容器。额外设置 `RELEASE_CONTRACT_CONFIG=<D03 专用 *-test 桶配置文件>`、`TEST_BACKUP_IMAGE=<D03 备份镜像>` 时，同一容器测试运行真实发布子进程和 R2 create/verify，覆盖错误目标、资源不足、缺备份配置、并发、正常发布、不健康切回和迁移失败。测试仅清理随机项目与桶内随机 `d04/` 前缀。结果在 `artifacts/operations/d01-containers.json`，真实生产复验归 D07。

依据：[GitHub 部署环境](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[Dependabot 配置](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)。实际生效与待办见 D04 实施报告。
