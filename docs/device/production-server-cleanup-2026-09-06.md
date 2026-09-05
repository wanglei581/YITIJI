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

## 七、本次没做什么

没有执行任何删除、重启、配置修改或数据库写入。以上命令全部待批准后执行。
