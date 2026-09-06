# 生产服务器盘点与清理方案（120.48.13.190，2026-09-06）

**本次只做只读盘点，没有在服务器上删除、重启或改任何配置。** 下面每一档都附可直接执行的命令，等产品负责人勾选后再执行。

盘点方式：SSH 只读命令（`df` / `du` / `pm2 describe` / `ss` / 读 nginx 配置）。凭据文件只记位置与类型，**没有读取内容**。

## 一、先说结论

盘要求是「30 GB 跑完整项目」。现状是 **40 GB 盘用了 28 GB（75%），剩 9.6 GB**。

但**项目本身只占 1.1 GB**。占掉盘的是三年积攒的历史发布树：`/srv` 一个目录就是 **16 GB**，其中在跑的只有 2 GB，其余 14 GB 是 60 多份旧发布和归档包。

按下面第一档清完，占用从 28 GB 降到约 12 GB，**剩余 28 GB**，30 GB 的目标不仅达得到，还很宽裕。

## 二、什么在跑（内核视角确认，不是靠猜）

| 角色 | 真实路径 | 证据 |
|---|---|---|
| API 进程 | `/srv/ai-job-print/services/api/dist/main.js` | `pm2 describe` + `/proc/94643/cwd` |
| 一体机前台 | `/srv/ai-job-print/apps/kiosk/dist` | nginx `root` |
| 管理员后台 | `/srv/ai-job-print/apps/admin/dist` | nginx `root` |
| 合作机构后台 | `/srv/ai-job-print/apps/partner/dist` | nginx `root` |
| 数据库 | PostgreSQL `ai_job_print`，**48 MB** | `pg_database_size` |
| 缓存 | Redis，7.6 MB | `du /var/lib/redis` |

`/root/YITIJI` 是源码检出（378 MB），**不是运行路径**，进程不读它。

数据库只有 48 MB——数据完全不是空间问题。

## 三、空间去哪了

| 位置 | 占用 | 性质 |
|---|---|---|
| `/srv` | **16 GB** | 其中在跑 2 GB，历史发布树 14 GB |
| `/usr` | 3.7 GB | 系统 |
| `/root/.local/share/pnpm` | 2.6 GB | pnpm 内容寻址仓库 |
| `/root/.npm` | 887 MB | npm 缓存 |
| `/opt` | 876 MB | 云厂商 agent（bcm 295M / heye 236M / mellanox 106M）+ Node 203M |
| `/home/opt` | 810 MB | |
| `/root/.cache` | 722 MB | |
| `/var/log` | 477 MB | 其中 journald 344 MB |
| `/var/cache/apt` | 110 MB | |
| `/root/.pm2/logs` | 108 MB | 见下，这条不只是空间问题 |

`/srv` 里的历史发布：`ai-job-print-prev-*` 与 `ai-job-print-previous-*` 共 35 份、每份约 1 GB，加上 `releases/`（6.2 GB）、`backups/`（4.5 GB）、`rollbacks/`（1.0 GB）、`release-backups/`（1.5 GB），以及 60 多个 `.tar.gz` 归档。最早的是 2026-06-19。

> 计量说明：这些目录的 node_modules 之间存在硬链接共享，**逐个 `du` 相加会严重高估**（相加得 17.6 GB，而 `/srv` 整体只有 16 GB）。因此下面报的是「`/srv` 总量减去保留集」这个下限口径，不是相加值。

## 四、清理方案（按风险分三档）

### 第一档：零风险，不停机，不碰数据 —— 约省 16 GB

删的都是历史构建产物与可再生缓存，**不含数据库、密钥、配置、日志正文**。

**1. 历史发布树与归档包（约 14 GB，最大头）**

先做一次演练，确认要删的里面没有在跑的路径：

```bash
ls -d /srv/ai-job-print-prev-* /srv/ai-job-print-previous-* /srv/ai-job-print-releases /srv/ai-job-print-backups /srv/ai-job-print-rollbacks /srv/ai-job-print-release-backups 2>/dev/null | grep -x /srv/ai-job-print && echo "危险：命中在跑路径，停手" || echo "安全：未命中 /srv/ai-job-print"
```

确认输出「安全」后再执行：

```bash
rm -rf /srv/ai-job-print-prev-* /srv/ai-job-print-previous-* /srv/ai-job-print-releases /srv/ai-job-print-backups /srv/ai-job-print-rollbacks /srv/ai-job-print-release-backups /srv/ai-job-print-candidate-main-api-* /srv/ai-job-print-api-failed-precheck-* /srv/ai-job-print-api-drycheck-* /srv/ai-job-print-release-30d168ce-*
```

归档包（251 MB）：

```bash
rm -f /srv/*.tar.gz /srv/*.tgz /srv/*.tar
```

**保留不动**：`/srv/ai-job-print`（在跑）、`/srv/ai-job-print-db-backups`、`/srv/db-backups`、`/srv/ai-job-print-secrets`、`/srv/secrets`、`/srv/ai-job-print-env-backups`、`/srv/zhiyida-site`、`/srv/node_modules`。

**2. 可再生缓存（约 1.7 GB）**

```bash
npm cache clean --force
rm -rf /root/.cache/*
apt-get clean
```

**3. 日志收缩（约 250 MB）**

```bash
journalctl --vacuum-size=200M
pm2 flush ai-job-print-api
```

### 第二档：需要短暂停机或有回滚顾虑 —— 另约 3 GB

**1. pnpm 仓库瘦身（2.6 GB 里可回收一部分）**

```bash
pnpm store prune
```

只删没有任何项目引用的包。风险是下次构建要重新下载，**建议在没有待发布版本时做**。

**2. `/root/YITIJI` 源码检出（378 MB）**

不是运行路径，删了不影响服务。但它是服务器上唯一的源码副本，**删之前先确认部署流程不依赖它**（当前部署脚本在 `/srv/deploy-*.sh`，需要读一遍确认）。建议先留着。

### 第三档：涉及数据，本次不建议动

- `/srv/ai-job-print-db-backups`、`/srv/db-backups`（共 54 MB）：数据库备份，占用极小，**不要删**。
- `/srv/ai-job-print-secrets`、`/srv/secrets`：密钥，**不要删**。
- PostgreSQL 数据目录 120 MB：正常。

## 五、比空间更要紧的三件事

### 1. 线上跑的是 19 天前的代码（最高优先，落后 243 个提交）

`/root/YITIJI` 停在 `771d53e2`（2026-08-18），`/srv/ai-job-print` 的构建产物同期。这意味着 8 月 18 日之后合入 main 的所有修复**一行都没上线**。

> **更正（2026-09-06，本节初版写错了，原文如实保留在下面一段）**
>
> 初版写的是「这条能直接解释之前查到的 296,502 次 429 限流：终端级限流
> `TerminalScopedThrottle(30)` 是 `9cdcb9c0d` 引入的，而该提交晚于线上这一版」。
> **这句是错的。** 复核提交时间与祖先关系：
>
> | 提交 | 时间 | 关系 |
> |---|---|---|
> | `9cdcb9c0d` 承压加固（限流按台计数） | 2026-08-18 **03:35** | 是 `771d53e2` 的**祖先** |
> | `771d53e2` 线上部署版本 | 2026-08-18 **18:41** | — |
>
> 也就是说线上那一版**已经包含**终端级限流：`git show 771d53e2:services/api/src/common/throttler/terminal-throttle.ts`
> 有文件，`ai.controller.ts` / `materials.controller.ts` / `print-jobs.controller.ts` 里都有
> `TerminalScopedThrottle` 装饰器的使用。初版只对比了两个提交的日期就下了结论，
> 没有验祖先关系，同一天里把先后看反了。
>
> **因此 429 的成因目前仍未查明**，不能归到版本落后上。需要另查：真实触发的是哪个端点、
> 哪一档限流、是否单机集中触发。在查清之前，不要把「重新部署」当成解决 429 的手段。
>
> 版本落后本身仍然成立且仍要处理——线上落后 main **243 个提交**，8 月 18 日之后合入的
> 修复确实一行都没上线。只是它和 429 没有已证实的因果关系。

重新部署仍然值得优先做——243 个提交里包含本轮体检修掉的全部资损与合规项，不上线等于没修。但它必须在清盘之后（当前 9.6 GB 余量不够安全地放一份新构建），且需要产品负责人指定发布窗口。

（初版在这里写的是「最大的杠杆不是清盘，是重新部署」，那句话建立在上面已更正的 429 因果上。去掉那个因果之后，重新部署的理由仍然成立，但强度没有原来说的那么绝对。）

### 2. PM2 日志无轮转，会再次把盘写满

`/root/.pm2/logs/ai-job-print-api-out.log` 单文件 **110 MB**，从 7 月 13 日写到现在没有切过。这不只是占空间——它会无上限增长。清完之后如果不装轮转，几个月后同样的问题会再来一次。

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

这条建议和第一档一起做，否则清理只是把时钟拨回去。

### 3. 两个凭据文件明文躺在 /root

- `/root/ai-job-print-seed-password-rotate-20260725T205537+0800.txt`（权限 0600）
- `/root/tencent-jobs-preprod-credentials-0701162419.json`（权限 0600）

**本次盘点没有读取这两个文件的内容。** 权限是对的（仅 root 可读），但明文凭据留在家目录不符合本仓 §12「密钥只保存在服务端受控位置」的口径。建议确认是否仍在使用：仍用则移入 `/srv/ai-job-print-secrets` 并轮换，不用则删除。这一步涉及密钥，**必须由产品负责人本人操作或明确授权**。

另注：`docs/progress/current-progress.md` 里已记过「百度 OCR 密钥曾在聊天暴露，上线前须在百度控制台重建应用轮换」，这条待办仍未见完成记录。

## 六、执行顺序建议

1. 第一档 1–3（约省 16 GB，零风险，可立即做）
2. 装 pm2-logrotate（防复发）
3. 确认凭据文件去留
4. **重新部署到最新 main**（需发布窗口；清盘后余量才够）
5. 第二档按需

前三步都不影响在跑服务；第 4 步需要停机窗口。

## 七、执行记录（2026-09-06，产品负责人当面批准「清」后执行）

上面第一档三步 + pm2-logrotate 已执行。**第二、三档没动。**

| 步骤 | 结果 |
|---|---|
| `pm2 install pm2-logrotate`（max_size 50M / retain 7 / compress） | 已装、`pm2 save` 已保存 |
| 删 48 条历史发布树 | 完成，剩 0 |
| 删 51 个归档包 | 完成，剩 0 |
| npm / `/root/.cache` / apt 缓存 | 清 |
| `journalctl --vacuum-size=200M` + `pm2 flush` | 完成（journal 本已在 200M 内，freed 0B） |

**磁盘：28 GB 用 → 13 GB 用，剩余 9.6 GB → 25 GB。** 比第一档预估的「剩 28 GB」少 3 GB，因为估算时用的是「总量减保留集」下限口径，实际硬链接共享比估的少。

删后核验（全部通过）：API `/health` 200；nginx `/`、`/admin/`、`/partner/` 均 200；`/srv/ai-job-print/services/api/dist` 在；`/srv/ai-job-print-db-backups`、`/srv/ai-job-print-secrets` 原样保留。

执行时一处插曲：删发布树时 SSH 被服务端断开一次，但删除已在断开前完成（重连核验：发布树剩 0、API 200）。后续步骤加 `ServerAliveInterval` 后无异常。

**仍未动**：第二档（pnpm store prune、`/root/YITIJI` 源码检出）、第三档（数据库备份、密钥）、两个 `/root` 下的明文凭据文件（去留待产品负责人本人操作）。

## 八、重新部署事故记录（2026-09-06，产品负责人批准「现在就做」后执行）

清盘后按 `deploy-unfreeze-runbook-2026-08-17.md` 走 CI 流水线发布 `35af2263b`（线上原 `771d53e2`，落后 243 个提交）。**发布走完了全部步骤后在最后一步失败，线上 API 中断约 3 小时，最终一行 env 修复，未回滚。**

### 时间线（UTC+8）

| 时刻 | 事件 |
|---|---|
| 11:27 | 预检全过（Redis PONG、备份空间 25 GB、pg_dump 16.14、`ls-remote` 通、API `status:ok`）；设 `DEPLOY_API_ENABLED=true` |
| 11:42 | deploy run `34009244783` 启动：`pg_dump` + `pg_restore -l` 校验、运行目录备份、构建、迁移「All migrations have been successfully applied」 |
| 11:44 | 第 8 步 PM2 重启后健康检查失败，run 报 failure。**此时环境已换成新版**（runbook §2.1 描述的最坏时点） |
| 11:44–14:40 | pm2 崩溃循环 17 次；`/api/v1/health` 无响应；三个前台仍由 nginx 提供**旧版**静态文件（脚本在拷 dist 之前已退出） |
| ~14:40 | 读 `ai-job-print-api-error.log` 定位根因（见下）；往运行目录 `.env` 追加 `PRINT_REQUIRE_PRINTER_ONLINE=true`；`pm2 restart --update-env` |
| 14:45 | `/api/v1/health` 200 `status:ok`；`/health/ready` 200（该端点旧版没有，证明新代码在跑）；pm2 `online`，负载 0；`DEPLOY_SOURCE=35af2263b` |

### 根因

```
[FATAL] API_BOOTSTRAP_FAILED —— 服务未启动，端口未监听。
Error: PRODUCTION_PRINT_PRINTER_ONLINE_REQUIRED: NODE_ENV=production 时
PRINT_REQUIRE_PRINTER_ONLINE 必须显式为 true（打印机离线、缺纸或故障时不得建单收款）
    at assertProductionRuntimeGates (production-runtime-gates.ts:228)
```

#790（硬件链路十项，2026-09-05）给 `production-runtime-gates.ts` 加了这条 fail-closed 闸门——闸门本身正确，是「打印机离线时不得收款」的资损底线。**错在 `deploy-api-release.sh` 的 3b 步骤只持久化 `PRINT_REQUIRE_PII_SCAN` 一个键**，加闸门的 PR 没有同步教会部署脚本；线上 `.env` 缺这一行，新 API 一启动就按设计拒绝。两处清单各自维护、没人比对。

这条是**我（Claude）在 #790 引入的**：加了启动期闸门，没改部署流水线。

### 为什么修前进而不是回滚

- 根因是一行缺失的 env，不是代码缺陷；补上即可，5 秒。
- 迁移全部 additive（发布前逐条扫过，零 DROP/DELETE/TRUNCATE），回滚运行目录后旧代码本可跑，但会丢掉 35 个提交的修复，且修完同一个缺口后还得再发一次。
- 备份锚点（`pre-35af2263b…dump` 3.5 MB + `.runtime`）完好，若修前进失败仍可回退。

### 遗留与后续

- **前端未更新**：脚本在健康检查处退出，未执行「拷 dist + reload nginx」。当前状态 = 新 API + 旧前端。处置：按 runbook 重跑目标提交的 CI 让流水线完整跑一遍（服务器已在目标 SHA 时会跳过拉取；迁移无变化；再备份一次约 1.1 GB）。
- **防复发**：3b 改为按 `REQUIRED_PRODUCTION_GATES` 数组循环持久化；新增 `verify:deploy-gates-in-sync` 门禁在 CI 里比对闸门源码与脚本清单（变异测试：数组删一键 → 红）；runbook §2 补 2.0 前置项。
- **探测教训**：事故中我从本机打公网 `https://120.48.13.190.sslip.io` 全部 `000`，一度误判主机不可达；实为本机 DNS 把 `sslip.io` 解析到 `198.18.1.0`（RFC 2544 基准段）。改走 `http://120.48.13.190/api/v1/health`（:80 按 IP）才拿到真相。公网复验时不要信 sslip 域名，按 IP 打。
- **SSH 断连**：崩溃循环期间 SSH 会话多次被服务端关闭；加 `ServerAliveInterval=5 ServerAliveCountMax=2` 且把命令拆短后稳定。

### 收口：完整重发 `6ee09fcc0`（2026-09-06 15:15–15:37，UTC+8）

按 runbook 重跑目标提交的 CI（run `34010011985` attempt 2）触发 deploy run `34018634556`，**全步骤成功**，无回滚、无手工干预：

| 检查项 | 结果 |
|---|---|
| `DEPLOY_SOURCE.txt` | `origin/main@6ee09fcc0`，`ci_run=34010011985`，`deployed_at=15:36:41` |
| `/api/v1/health`（按 IP :80 与 `https://zyidai.cn` 各打一次） | 200 `status:ok`，`db:postgres`，`degraded:[]` |
| `/api/v1/health/ready` | 200 |
| pm2 `ai-job-print-api` | online；restarts 计数 17→18（仅本次重启一次），复查 79 s 后未再增长 |
| 运行目录 `.env` | `PRINT_REQUIRE_PII_SCAN=true`、`PRINT_REQUIRE_PRINTER_ONLINE=true` 两行齐 |
| 三前台 dist | kiosk/admin/partner 的 `index.html` 均为 15:36:48 重写 |
| 公网 bundle | `zyidai.cn`→`index-CwmmxZK1.js`、`admin.zyidai.cn`→`index-C4MR-GbL.js`、`partner.zyidai.cn`→`index-C2zKlKOe.js`，与各自 dist 一致（**前端不再是旧版**） |
| 磁盘 | 16G 已用 / 22G 可用（42%），本次又落一份 `pre-6ee09fcc0…` 备份 |
| 开关 | deploy 的 SSH 步骤进入 in_progress 后立即置 `DEPLOY_API_ENABLED=false`（步骤 env 已在起步时求值，此后再翻不影响本次发布） |

04:18Z 那次 deploy run `34011164995` 显示 skipped 曾被误读为流水线异常：查 attempt 1 实为 success，跳过只因当时开关仍为 false。**复验探针注意**：按 IP 打 `/admin/`、`/partner/` 路径拿到的永远是 kiosk（nginx 里三前台分别是 :80 默认、:8081、:8082 与 `*.zyidai.cn` 三个 443 vhost，8081/8082 未对公网开放），要用 `curl --resolve admin.zyidai.cn:443:120.48.13.190` 这种方式按域名打。

防复发两件已合入 main：#829（3b 按 `REQUIRED_PRODUCTION_GATES` 循环持久化 + PM2 重启前 export 全部闸门键 + `verify:deploy-gates-in-sync` 钉进 `REQUIRED_COMMANDS`，deterministic 16→17 + 授权门禁改按数组断言）。

### 第二次发布 `7f826bcb9` 与第二档结果（2026-09-06 17:19–17:37，UTC+8）

产品负责人采纳建议后执行：**不发 main 顶端**（含 #833 可信终端身份 fail-closed 闸门，需与一体机 MSI 同一提交，待 Windows 真机验证），只发到 `7f826bcb9`（含 #828 人工退款、#829 部署防复发、#830 小程序、#832 文档，无数据库迁移）。重跑被并发规则取消的 CI `34021273456` → deploy `34024303135` 全步骤成功——**这是 3b 新循环持久化逻辑的首次真实发布**。

| 检查项 | 结果 |
|---|---|
| `DEPLOY_SOURCE.txt` | `origin/main@7f826bcb9`，`ci_run=34021273456`，17:37:04 |
| health / ready（`--resolve zyidai.cn`） | 200 `ok/postgres`，`degraded:[]` / 200 |
| pm2 | online，restarts 18→19（仅本次），`.env` 两闸门键仍为 2 |
| 三前台 | dist 17:37:10 重写；`zyidai.cn`→`index-BFs79WmT.js`、`admin.zyidai.cn`→`index-DLwlvl1k.js` 均已更新，`partner.zyidai.cn` 无改动故 hash 不变（`C2zKlKOe`） |
| 备份 | `pre-7f826bcb9…-20260906T093532Z.{dump,runtime}` |
| 开关 | SSH 步骤 in_progress 后立即置 false |

**第二档结果**：`pnpm store prune`（store `/root/.local/share/pnpm/store/v11`）前后均 2.7G，**没有可回收的无引用包**；磁盘 17G 已用 / 21G 可用。`/root/YITIJI` 按建议保留。第三档不动。

**取证注意**：`gh run list --workflow=deploy.yml` 显示的 `headSha` 是 main 当时的 tip（workflow_run 事件特性），不是发布目标；本次列表显示 `891492396` 而实际目标是 `7f826bcb9`，以服务器 `ps` 里的 `TARGET_SHA=`、`/root/YITIJI` HEAD 或 `DEPLOY_SOURCE.txt` 为准。

### 第三次发布 `fd2a126b9`（2026-09-06 18:59–19:01，UTC+8）——main 顶端，含 #833 可信终端身份

产品负责人授权「发 main 顶端」后执行。顶端在等待期间被并行会话的 #831 推前一次（并发组取消了 `5bff1bc42` 的 CI），改以 `fd2a126b9` 为目标；已请并行会话在发布起步前暂停合并。deploy `34028530951` 全步骤成功，无迁移。

| 检查项 | 结果 |
|---|---|
| `DEPLOY_SOURCE.txt` | `origin/main@fd2a126b9`，`ci_run=34027057398`，19:01:05 |
| health / ready（`--resolve zyidai.cn`） | 200 `ok/postgres`，`degraded:[]` / 200 |
| #833 新端点 `POST /terminals/session-token` | 空体 400（存在，非 404） |
| pm2 | online，restarts 19→20；`.env` 两闸门键为 2 |
| 三前台 | dist 19:01:26 重写；kiosk `index-CC6VWakW.js`、partner `index-Ks5VjnQ6.js` 已变；admin 未变（#831 未触及） |
| 备份 / 磁盘 | `pre-fd2a126b9…-20260906T105933Z.{dump,runtime}`；17G 用 / 21G 可用 |
| 开关 | SSH 步骤 in_progress 后置 false |

**#833 的可见行为**：无 Agent 的普通浏览器打开一体机前台，打印确认页会显示「终端会话未就绪」——这是 fail-closed 设计，不是故障。Windows 一体机的 Agent / MSI 必须从 `fd2a126b9` 构建，与线上 API 同一提交。

第二、三档与凭据文件仍未动。
