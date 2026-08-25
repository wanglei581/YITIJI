# 解冻发布执行手册（2026-08-17）

> **历史快照警告（2026-08-22）**：本手册正文记录 2026-08-17 当时的 SHA、线上能力和旧部署顺序，不是当前可直接执行的任务书。当前生产事实以 `docs/progress/current-progress.md` 顶部和服务器 provenance 为准；当前候选已经引入 `API_DEPLOY_SOURCE.txt` / `DEPLOY_SOURCE.txt` 分层、PM2 最小环境、三端原子切换回退、backup cleanup 精确保留以及 deploy/cleanup 双层互斥。Batch 2 未 push/未部署前，仍禁止打开 `DEPLOY_API_ENABLED`。本手册后续必须在具名维护窗口按目标 SHA 重新生成，而不是照抄 `db643ab34`。

> **一句话**：生产四端已冻结在同一个 SHA 三天，原因是一个发布授权开关在上次发布后 26 秒被关上。
> 管线没坏、迁移不危险。本手册给出把 `db643ab34`（含全部四个安全/隐私修复）发上去的可执行步骤。
>
> **执行者需要**：GitHub 仓库变量修改权限 + 生产服务器 SSH（用于第 0 步前置检查）。

---

## 0. 现状（2026-08-17 实测）

```
线上 GET /api/v1/health        →  {"success":true,"data":{"status":"ok","db":"postgres",...}}
线上 GET /api/v1/health/ready  →  404          ← 该端点由 8188fcf13 引入，线上没有
```

| 组件 | 线上 SHA | 构建时间 |
|---|---|---|
| API / Kiosk / Admin / Partner | `497722091` | 2026-08-14 12:48 +0800 |

**四端同一个 SHA、同一分钟**——因为 `deploy.yml` 的授权 `if` 在 **job 层**，关掉时四端一起不发。

### 根因

```
deploy.yml   job 级 if：  vars.DEPLOY_API_ENABLED == 'true'
该变量设为 false 的时间：  2026-08-14T04:48:40Z
上次发布健康检查通过：      2026-08-14T04:48:14Z     ← 相差 26 秒
此后最近 200 次 deploy run：97 次 skipped，0 次成功
```

看时间点像是**发布收尾的固定动作**。若确是 SOP，则该设计有一处缺陷：**关掉 API 授权会连前端热修一起关掉**。改进建议见 §6。

---

## 1. 发哪一版：`db643ab34`，不是主干 tip

`db643ab34`（2026-08-17 11:21，PR #659）是**最后一个 CI 全绿的 main 提交**。

**它包含**：

- ✅ 全部四个安全 / 隐私修复
  - 付款码明文回显（27 寸公共屏上显示 18 位一次性支付凭证）
  - 简历原文未脱敏直发第三方 LLM（三处调用点）
  - 顾问三表存用户原话且过期行永不删除
  - S0 四项（PII 脱敏 / provider 可识别 / 拆共用 API key / AIGC 元数据）
- ✅ 几乎全部用户可见修复（Admin 已下架条目的「发布」按钮、小程序 PII 闸门绕过与岗位分页、Kiosk 取件页样式与横屏出口按钮、Redis 挂时后台全 500、Partner `/stats` 常年 400、触屏禁用原因看不见）
- ✅ 全部 4 个迁移（81 → 85，**纯 additive：零 DROP / DELETE / TRUNCATE**）

**它不含**（可接受，下一轮再发）：`3a7457d27`（Redis 挂时后台 500——Redis 正常时无感）、`3a215c912`（AI 成本，见下）、`95e65b1de`（V6 P39）、`ffe8b3259`。

> ⚠️ **不要发主干 tip。** `3a215c912` 把 `costByOperation` 从 `Record<op, number>` 改成 `Record<op, {cny,calls,measuredCalls}>`——
> 旧 Admin + 新 API → `¥NaN`；新 Admin + 旧 API → 全部「未估算」。**前后端必须同发**，而它当前门禁在 CI 上是红的。

---

## 2. 第 0 步：前置检查（不能省）

### 2.1 确认服务器 Redis 在跑

**为什么**：`deploy-api-release.sh` 第 8 步健康检查是 `grep -q '"status":"ok"'`。
而本次发布引入的改动让 `/health` 在 Redis 降级时返回 `"status":"degraded"`。

**后果**：如果重启那一刻 Redis 不可达，健康检查会连续失败 60 秒然后 deploy 报错 ——
**但此时迁移已执行、rsync 已完成、PM2 已重启新代码**。
你会拿到一份「部署失败」的日志，配上一个已经换成新版本的生产环境。

```bash
redis-cli ping        # 期望 PONG
```

### 2.2 确认备份空间

每次发布 +约 1.1GB（PG dump + 运行目录），保留最近 3 组。**2026-08-09 出过根分区被撑满的真实事故。**

```bash
df -h /srv/ai-job-print-backups     # 期望剩余 > 3GB
```

**任一项不满足就停手。** 这两项都是「不满足就会以最坏方式失败」的类型。

---

## 3. 执行步骤

| # | 动作 | 成功判据 |
|---|---|---|
| 1 | 设仓库变量 `DEPLOY_API_ENABLED=true` | `gh variable list` 显示 true |
| 2 | **重跑 `db643ab34` 的 CI**（run `31990880152`），**不是重跑 deploy** | CI 再次全绿 |
| 3 | 等待它自动触发的新 deploy run | 日志出现 `=== 受控发布 API`，且 SHA 为 `db643ab34` |
| 4 | 观察备份两步 | `pg_dump -Fc` + `pg_restore -l` 可读校验通过、`.runtime` 目录备份完成 |
| 5 | 观察迁移 | `85 migrations found`、**`4 migrations applied`**（不是 `No pending migrations`） |
| 6 | 观察健康检查 | `API health OK` |
| 7 | **立刻把 `DEPLOY_API_ENABLED` 设回 `false`** | 与既有运营口径一致 |
| 8 | 公网复验 | 见 §3.1 |

### ⚠️ 第 2 步为什么必须重跑 CI 而不是 deploy

只有一个 CI run 的 `head_sha` 是 `db643ab34`：`31990880152`（03:21:11Z 起、**03:34:30Z 完成**）。

- `31991590600` 创建于 03:34:33Z —— 完成后 3 秒，**那才是绿 CI 触发的那个**
- `31990895286` 创建于 CI 刚开始 18 秒时，它由**另一个更早的 CI** 触发，`workflow_run.head_sha` 可能是别的提交

**直接重跑 deploy run 有发错版本的风险。** 重跑 CI 可以完全绕开这个歧义。

### 3.1 第 8 步：公网复验

```bash
curl -s https://zyidai.cn/api/v1/health          # 期望 status:ok, db:postgres
curl -s -o /dev/null -w '%{http_code}\n' \
     https://zyidai.cn/api/v1/health/ready       # 期望 200（当前是 404）
```

> **`/health/ready` 从 404 变 200，是发布成功最干脆的指纹。**

再检查前端：

```bash
curl -s https://zyidai.cn/ | grep -o 'assets/index-[^"]*\.js'   # 哈希应与 08-14 不同
# kiosk 新 bundle 应含 hid-guard（付款码/误扫防护落地的标志）
curl -s https://admin.zyidai.cn/   -o /dev/null -w '%{http_code}\n'   # 200
curl -s https://partner.zyidai.cn/ -o /dev/null -w '%{http_code}\n'   # 200
```

---

## 4. 出问题怎么退

**回滚的关键判断：代码回滚不需要回滚数据库。**

4 个迁移在 PG 侧统计为 `4 CREATE TABLE / 9 索引 / 7 ALTER TABLE`，**零 DROP、零 DELETE、零 TRUNCATE、零 INSERT/UPDATE**。旧代码看不见新列 / 新表。

| 停在哪一步 | 怎么退 |
|---|---|
| **备份阶段失败** | 生产未被触碰，直接停手 |
| **迁移后失败** | 恢复 `<prefix>.runtime` 目录 + `pm2 restart`。**不要恢复 DB dump** —— 迁移是 additive，旧代码忽略新列；恢复 dump 会丢掉这期间的真实业务数据 |
| **只想退前端** | 从 `<prefix>.runtime` 里把 `apps/{kiosk,admin,partner}/dist` 拷回 nginx 目录。⚠️ `deploy.yml` 对 nginx 目录是 `rm -rf` 后 `cp`，**前端在 nginx 侧没有独立备份，唯一副本在 `.runtime` 里** |

`DEPLOY_SOURCE.txt` 记录本次的 `runtime_backup`（整目录）与 `backup`（PG dump）路径。

---

## 5. 唯一的真实单向门

**`FeedbackTicket.endUserId DROP NOT NULL`。**

迁移把该列放开为可空，新代码会写入 `endUserId = NULL` 的匿名一体机反馈行。
而**已部署 SHA 的 Prisma schema 里 `endUser` 关系是必填**，且 `member-feedback.service.ts:108` 的
Admin 列表查询**不按 endUserId 过滤**（`where: { status?, category? }` + `include: { endUser }`）。

⇒ **一旦线上产生第一条匿名反馈，再把 API 回滚到 `497722091`，Admin 的反馈列表会在这些行上抛错。**
（会员侧四个查询都带 `endUserId` 作用域，不受影响。）

**当前是安全的**：`POST /kiosk/feedback` 目前**零前端调用方**（Kiosk 与小程序都没接线），短期不会产生这类行。

**但这是一扇会随时间关上的门 —— 不要把回滚当成永久退路。**

### 其它需要知道的不可逆动作

| 动作 | 说明 |
|---|---|
| `rm -rf ${DEPLOY_WEB_ROOT}/*` | 真·不可逆，但 `.runtime` 备份里有副本 |
| 备份自动清理（保留 3 组） | 仅在健康检查**通过后**执行，且永不删本次与最新组。发布失败时全部备份保留 |
| `.env` 被 awk 重写以持久化 `PRINT_REQUIRE_PII_SCAN=true` | 就地改生产 `.env`，无独立备份（`.runtime` 里有旧副本） |

---

## 6. 发布之后

### 6.1 内容录入（发布解决不了这个）

```
线上 GET /api/v1/jobs       →  total: 0
线上 GET /api/v1/job-fairs  →  total: 0
线上 GET /api/v1/policies   →  total: 0
```

**48 个 commit 里没有任何一个会凭空造出内容。**
生产库里有 **219 条岗位，其中 217 条 approved + unpublished、0 条 published**（另一会话查证）。

本次发布恢复的是 **Admin 对已下架条目的「发布」按钮**（#611）——**那是运营的前置条件，不是内容本身**。

⇒ 发布完成后，按 [content-onboarding-runbook.md](../product/content-onboarding-runbook.md) 由人去审阅并发布那批积压。
**只发版不录内容，首页依然是「暂无招聘会」。**

### 6.2 建议改进发布授权的粒度

当前 `DEPLOY_API_ENABLED` 的 `if` 在 **job 层**，关掉时**前端热修也一起被关掉**。

建议拆成两级：**前端始终发 / API 需授权**。这样紧急前端修复（比如付款码明文回显这类）不必等 API 授权窗口。

---

## 7. 本手册未验证的（需要服务器权限）

1. `/srv/ai-job-print/DEPLOY_SOURCE.txt` 的实际内容 —— 运行 SHA 是从 deploy run 日志推断的（证据强：受控发布九步完整走完 + `health/ready` 404 佐证），但没读过该文件
2. 备份目录实际剩余空间与保留组数
3. `NODE_ENV` 的实际取值 —— 决定 `production-runtime-gates` 是否真的在跑
4. `pm2 env COMMIT` 与 PM2 重启计数
5. `DEPLOY_ADMIN_WEB_ROOT` / `DEPLOY_PARTNER_WEB_ROOT` 的实际值
6. **谁在 08-14T04:48:40Z 关掉了 `DEPLOY_API_ENABLED`、是不是既定 SOP**
7. 小程序线上版本（需微信公众平台）

---

## 8. 已被订正的过时说法（不要再引用）

| 出处 | 说法 | 事实 |
|---|---|---|
| `production-deployment-and-windows-host-checklist.md:18` | 「部署流水线只发 Kiosk 前端，API 不在流水线内」 | **过期两层**。自 `48e277e7`（#532, 08-07）起发 Admin/Partner，自 `4a0986f71`（08-07）起有受控 API 发布。真正的卡点是授权变量 |
| 协调者口头 | 「顾问表清理任务合入后 ≤1 小时物理删除，不可逆」 | **虚警**。那三张表由本批迁移新建，发布时是空表，首次 cron 删 0 行 |
| 协调者口头 | 「`REDIS_URL` 现在不设会硬失败，是新增必需变量」 | **不是新增**。已部署 SHA 上就是必需的；本次发布**零新增必需环境变量**（三个新变量全有默认值） |
