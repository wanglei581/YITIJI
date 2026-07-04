# 我的页商用闭环第一批 · 预生产干净重部署 + 迁移 + C5-1/P0b/P1 验收 Runbook

> 状态：**草案（待审阅）**。本文件只是可执行说明，**不代表任何部署 / 迁移 / 验收已执行**。
> 每一个写操作（部署、切软链、migrate、重启 PM2、造夹具）都必须先备份、再经用户显式确认后执行。
> 起草日期：2026-07-04 ｜ 依据：本轮只读盘点 + 预生产只读探测（root@120.48.13.190，NODE_ENV=staging）。
> 环境定位：本 runbook 针对**预生产（staging）**，不是正式生产；不接 live 支付、不真机出纸。
> 合规上位：`docs/compliance/compliance-boundary.md` §8.x、`CLAUDE.md` §12；`docs/product/payment-domain-c5-plan-2026-07.md`。

---

## 0. 适用范围与硬边界

- **验收对象**：已合入 `main` 的三块——
  - **C5-1** 打印订单支付字段底座（`Order` 支付列 + `PriceConfig` + `PricingService` + `OrderStatusService`）
  - **P0b** 我的页订单详单 / 电子凭证前端真实化（`apps/kiosk/.../printOrders/`）
  - **P1** 权益核销落库（`RedemptionRecord` + `BenefitRedemptionService` + 简历优化端点可选核销）
- **本轮验收目标仅限 C5-1 / P0b / P1**。C5-2（线上沙箱）、C5-3（Kiosk 收银 UI）**代码均已合入 `main`（非未开发）**；C5-4 起（退款 / Order 抵扣核销）、C5-6（live 微信 / 支付宝）为后续波次。
  - 说明：随同一 `TARGET_COMMIT` 部署时，C5-2 的 `PaymentAttempt` 迁移会一并 `migrate deploy`、C5-2/C5-3 代码也随构建上线（additive、fail-closed、不接 live）。对它们**只做基础健康 / 回归确认（服务起得来、既有 verify 不回退），不作为本 runbook 的验收结论**；C5-2/C5-3 的功能验收另行规划。
- **绝对红线**：`paymentSource` 只允许 `offline / free / manual_confirmed`；`wechat/alipay/benefit/sandbox` 禁写；不接 live 支付网关；无真实资金；不真机出纸；不得据本 runbook 任一步宣称商用上线。

---

## 1. 当前只读盘点结论摘要（2026-07-04）

预生产处于**软链 / PM2 进程 / DB migration / Kiosk dist 四者错位的半部署状态**，当前**不可验收**。实测：

| 维度 | 实测值 | 对应 commit / 结论 |
|---|---|---|
| `/srv/ai-job-print` 软链 | `→ /srv/ai-job-print-releases/6497c5a4-dpgate-b-20260703235125` | **6497c5a4**（PR #137，仅含 C5-1） |
| `DEPLOY_SOURCE.txt` | `base_commit=6497c5a4`（scope=dp-gate-second-pass） | 自报 6497c5a4 |
| **PM2 实跑 API 进程** | cwd/script 在 `…releases/1a2ea75e/services/api/dist/main.js`，online，restarts=2，`NODE_ENV=staging` | **1a2ea75e**（PR #132 登录，**C5 之前**） |
| 运行 release 的 prisma schema | `paymentSource` 计数 = 0、`RedemptionRecord` 模型 = 0 | **运行中 API 是 C5 之前旧代码** |
| DB 已应用支付/核销 migration | 仅 `20260703160000_add_payment_foundation`（C5-1，07-03 23:53 finished） | DB 到 C5-1 |
| `PriceConfig` / `Order` 六支付列 | 存在 | ✅ C5-1 schema 就位 |
| `RedemptionRecord`（P1） | **缺失** | ❌ P1 表不存在 |
| `PaymentAttempt`（C5-2） | **缺失** | ❌ C5-2 表不存在 |
| Kiosk dist 文案 | 含「凭此码现场取件」「暂无支付信息」，但这些串**不在 6497c5a4 源码内** | dist 与软链 release 源码不一致 |
| API health | `http://127.0.0.1:3010/api/v1/health` → `db=postgres`，`status=ok` | 服务在线 |

**四点不一致**：① 软链(6497c5a4) ≠ PM2 实跑(1a2ea75e)；② 运行版比 DB 旧（DB 有 C5-1 列、运行 API 不认）；③ P1/C5-2 表缺失；④ Kiosk dist 来源与软链 release 源码对不上。

**结论：C5-1 / P0b / P1 均不可在当前预生产验收，必须先做一次干净重部署到统一 commit + 迁移 + PM2 切换。**

---

## 2. 部署目标 commit

- **目标 = 当前 `main` head**（起草时观测为 `8633fc1d`，此前数分钟内经历 `9d867653`→`8633fc1d`，**main 在活跃推进**）。
- **部署前必须重新确认**：
  1. `git fetch origin && git rev-parse origin/main` 取当时最新 head，记为 `TARGET_COMMIT`；
  2. 该 head 的 CI（`build-and-verify` + `postgres-readiness`）**双 job 全绿**（`gh run list --branch main --limit 3`）；
  3. `TARGET_COMMIT` 必须是 **P1 合入点 `f8bd3028` 的后代**（含 C5-1/P0b/P1）：
     `git merge-base --is-ancestor f8bd3028 <TARGET_COMMIT>` 返回真。
- **单一 commit 原则**：API / Kiosk / Admin / Partner / Prisma migration **全部来自同一个 `TARGET_COMMIT`**。
- **`DEPLOY_SOURCE.txt` 必须写入同一 `TARGET_COMMIT`**（`base_commit=<TARGET_COMMIT>`），杜绝再次出现 DEPLOY_SOURCE 与实跑进程不一致。
- 校验三块都在目标 commit：
  ```bash
  git ls-tree -r --name-only <TARGET_COMMIT> services/api/prisma/migrations | grep -E 'payment_foundation|redemption_record'
  git ls-tree -r --name-only <TARGET_COMMIT> services/api/src/benefit-redemption | head
  git ls-tree -r --name-only <TARGET_COMMIT> apps/kiosk/src/pages/profile/me/printOrders | head
  ```

---

## 3. 部署前备份（全部为写前置，必须先做）

> 目的：任一步失败可回滚。备份未确认存在前，禁止进入第 4/5/6 节。

1. **PostgreSQL 全库备份**（在服务器）：
   ```bash
   TS=$(date +%Y%m%d%H%M%S)
   # DATABASE_URL 从 services/api/.env 读，勿打印到日志
   pg_dump "$DATABASE_URL" -Fc -f /srv/ai-job-print-db-backups/pre-c5-p0b-p1-<TARGET_COMMIT>-$TS.dump
   pg_restore -l /srv/ai-job-print-db-backups/pre-c5-p0b-p1-<TARGET_COMMIT>-$TS.dump | head   # 可读性校验
   ```
   记录：备份文件绝对路径 + `pg_restore -l` 可读。
2. **当前 release 与软链留存**（只读快照，勿删旧 release）：
   ```bash
   readlink -f /srv/ai-job-print                                   # 记录当前软链目标（回滚锚点）
   cp /srv/ai-job-print/DEPLOY_SOURCE.txt /srv/ai-job-print-backups/DEPLOY_SOURCE.$TS.txt
   ls -1d /srv/ai-job-print-releases/*                             # 记录现有 release，含 1a2ea75e（回滚候选）
   ```
   记录：**旧软链目标 = `…/6497c5a4-dpgate-b-20260703235125`**；**旧 PM2 实跑 = `…/1a2ea75e`**。
3. **PM2 进程与 env 只读快照**：
   ```bash
   pm2 jlist > /srv/ai-job-print-backups/pm2-jlist.$TS.json      # 含 cwd/script/NODE_ENV/restart_time
   pm2 env 0 > /srv/ai-job-print-backups/pm2-env.$TS.txt 2>/dev/null || true   # ⚠️ 可能含敏感值，存服务器不外传
   cp /srv/ai-job-print/services/api/.env /srv/ai-job-print-env-backups/api.env.$TS.bak   # ⚠️ 含密钥，仅服务器留存
   ```
   记录：进程名 `ai-job-print-api`、当前 cwd、NODE_ENV、restart 计数。
4. **nginx / 静态目录现状只读快照**：
   ```bash
   nginx -T > /srv/ai-job-print-backups/nginx-T.$TS.conf 2>/dev/null    # 全量配置（确认 Kiosk root 指向）
   ls -la /srv/ai-job-print/apps/kiosk/dist/index.html                  # 记录旧 dist mtime
   sha256sum /srv/ai-job-print/apps/kiosk/dist/index.html               # 旧 dist 指纹
   ```
   记录：nginx 实际服务 Kiosk 的 `root` 路径（决定第 4 节 dist 落哪里）。

---

## 4. 干净构建与发布步骤

> 原则：**从 clean `origin/main` 构建，新 release 独立目录，一次性切软链；绝不把新 dist 覆盖进旧 release，也不混用旧 dist。**

1. **本地/构建机干净检出**（独立 worktree，避免污染工作区）：
   ```bash
   git fetch origin
   git worktree add /tmp/deploy-<TARGET_COMMIT> <TARGET_COMMIT>
   cd /tmp/deploy-<TARGET_COMMIT>
   git rev-parse HEAD    # 必须 == TARGET_COMMIT
   ```
2. **安装依赖**（frozen lockfile）：
   ```bash
   pnpm install --frozen-lockfile
   ```
3. **生成 Prisma client**（PG 运行时 client，与第 5 节 `db:pg:deploy` 同 `--config prisma.postgres.config.ts`）：
   ```bash
   pnpm --filter @ai-job-print/api run db:pg:generate
   ```
   （对应 `services/api/package.json` 现有脚本 `db:pg:generate` = `prisma generate --config prisma.postgres.config.ts`；如另需默认 / SQLite 类型 client，按仓库当前 build / generate 脚本执行，**勿臆造不存在的脚本名**。）
4. **构建 API + 前端**（前端 env 必须正确，避免又出现 dist/后端不一致）：
   ```bash
   pnpm --filter @ai-job-print/api build
   # Kiosk：绑定预生产 API 与真实终端号
   VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_TERMINAL_ID=KSK-001 \
     pnpm --filter @ai-job-print/kiosk build
   pnpm --filter @ai-job-print/admin build
   pnpm --filter @ai-job-print/partner build
   pnpm --filter @ai-job-print/api run verify:prod-build-config   # 若存在，校验构建 env
   ```
   记录：Kiosk `VITE_TERMINAL_ID` 用真实 enabled 终端号（默认 seed `KSK-001`）。
5. **打包并落新 release 目录**（服务器）：
   ```bash
   REL=/srv/ai-job-print-releases/<TARGET_COMMIT>-c5p0bp1-$TS
   mkdir -p "$REL"
   # 用与既有部署一致的归档方式同步 API dist / node_modules / prisma / 各前端 dist 到 $REL
   printf 'base_commit=%s\nscope=c5-1-p0b-p1-preprod\ncreated_at=%s\nprevious_release=%s\n' \
     "<TARGET_COMMIT>" "$(date -Is)" "$(readlink -f /srv/ai-job-print)" > "$REL/DEPLOY_SOURCE.txt"
   ```
6. **写入新 `.env`**：复制旧 `.env`（第 3.3 步备份）到 `$REL/services/api/.env`，**逐键核对**（DATABASE_URL / REDIS_URL / FILE_STORAGE_DRIVER=cos / 短信 / OCR / AI / `PAYMENT_PROVIDER` 保持 disabled 或不设）。**不引入任何 live 支付密钥**。
7. **切换软链**（原子）：
   ```bash
   ln -sfn "$REL" /srv/ai-job-print
   readlink -f /srv/ai-job-print   # 必须 == $REL
   ```
8. **明确禁止**：不要 `cp 新dist 到 1a2ea75e/6497c5a4 旧 release`；不要保留任何指向旧 release 的运行引用；Kiosk 由 nginx 从 `新 release` 服务（若 nginx root 是固定 `/srv/ai-job-print/...` 软链路径则自动跟随；若 nginx root 写死到某旧 release 绝对路径，需在此步同步更新 nginx 并 `nginx -t && nginx -s reload`，此为本 runbook 唯一允许的 nginx reload，且须先 `nginx -t` 通过）。

---

## 5. DB migration 步骤

> 顺序在第 4 节软链切换之后、第 6 节 PM2 切换之前；确保 migrate 用的是新 release 的 prisma。

1. **迁移前二次确认备份存在**（第 3.1 dump 可读）。
2. **执行 migrate deploy**（只前向、additive）：
   ```bash
   cd /srv/ai-job-print/services/api
   pnpm run db:pg:deploy      # 或 npx prisma migrate deploy，仓库现行脚本
   ```
   预期新应用：`20260704120000_add_redemption_record`（P1）、`20260703210000_add_payment_attempt_online`（C5-2）。C5-1 `add_payment_foundation` 已在库、不重复应用。
3. **确认表与列存在**（只读）：
   ```bash
   psql "$DATABASE_URL" -At -c "SELECT to_regclass('public.\"PriceConfig\"'), to_regclass('public.\"PaymentAttempt\"'), to_regclass('public.\"RedemptionRecord\"');"
   psql "$DATABASE_URL" -At -c "SELECT string_agg(column_name,',') FROM information_schema.columns WHERE table_name='Order' AND column_name IN ('paymentSource','paidAt','paidBy','pickupCode','billablePages','billingPageSource');"
   psql "$DATABASE_URL" -At -c "SELECT migration_name FROM \"_prisma_migrations\" WHERE migration_name ~ 'payment|redemption|foundation' ORDER BY 1;"
   ```
   预期：`PriceConfig`/`PaymentAttempt`/`RedemptionRecord` 均非空；六支付列齐；三条 migration 均 finished。
4. **schema 漂移守门**：
   ```bash
   pnpm --filter @ai-job-print/api run db:pg:sync:check
   ```
5. **失败回滚策略**：`migrate deploy` 失败时——
   - 若失败发生在应用某 migration 中途：**不要手动 `migrate resolve --rolled-back` 乱标**；先看 `_prisma_migrations` 状态。
   - 首选：**从第 3.1 dump 恢复**到迁移前状态（`pg_restore --clean` 到同库，需停写；预生产可接受短暂停服）。
   - 恢复后回到第 6 节回滚（软链 + PM2 回旧 release），保持系统在旧 C5-1 状态或迁移前状态一致。
   - additive migration 无破坏性 down；**已成功应用的 additive 表/列不单独 down**，靠备份恢复或前向修复。

---

## 6. PM2 切换

> 关键：消除「软链更新但进程没切」的历史错位。

1. **确认 ecosystem 指向新 release**：检查 PM2 启动来源（ecosystem 文件或直接 start 的绝对路径）。若 ecosystem 写死旧 release 绝对路径（如 `…/1a2ea75e/…`），改为新 `$REL` 或改为软链路径 `/srv/ai-job-print/services/api/dist/main.js`（推荐软链路径，后续切软链即生效）。
2. **重启 / reload**：
   ```bash
   pm2 startOrReload <ecosystem.config.js>   # 或 pm2 restart ai-job-print-api --update-env
   ```
3. **确认进程 cwd/script = 新 release**：
   ```bash
   pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>JSON.parse(d).forEach(p=>console.log(p.name,p.pm2_env.status,p.pm2_env.pm_cwd,p.pm2_env.pm_exec_path,p.pm2_env.NODE_ENV)))'
   ```
   预期：`pm_cwd`/`pm_exec_path` 指向 `$REL`（或软链解析到 `$REL`），非任何旧 release。
4. **health 复验**：
   ```bash
   curl -s http://127.0.0.1:3010/api/v1/health   # 期望 success=true / db=postgres
   ```
5. **restart 计数观察**：切换后 `restart_time` 应稳定、无反复重启（`unstable_restarts=0`）；观察数分钟日志无崩溃。

---

## 7. 验收夹具（造数——需用户确认后另行执行，不属本文件写范围）

> seed 当前**不含** EndUser / PriceConfig / BenefitGrant / BenefitActivity（仅有终端 `KSK-001`）。以下夹具须在预生产手工造，**验收后清理**（第 11.4）。造数须走后端正规写路径或受控脚本，不得绕过合规约束。

| 夹具 | 说明 | 备注 |
|---|---|---|
| **EndUser** ≥1 | 手机号会员（如 `139…`），`enabled=true` | 登录用 dev/log 短信码或预生产短信；验收后清理 |
| **PriceConfig** | 打印价目，`active=true`，含**一档 0 元**用于造免费单 | 例：黑白单面 / 彩色单面 / 双面 各价 + 0 元档；`PricingService` 无 active 价目会 fail-closed 拒建单 |
| **Terminal** | `KSK-001`（seed 已有，enabled） | 无需新造 |
| **BenefitActivity + BenefitGrant** | 可核销权益，`serviceType` 覆盖 `resume_optimize`，`benefitType ∈ {coupon, free_quota, package_entitlement}`，`quantityRemaining ≥ 1`，`validFrom/validUntil` 覆盖验收时段 | `subsidy_eligibility_hint` **不可核销**，勿用它验收 |
| **文件样本** | 1 份多页 PDF（如 3 页）+ 1 张图片 | 预生产上传取签名 URL；验收后清理 FileObject / COS 对象 |

---

## 8. C5-1 / P0b 验收步骤

前置：第 4–6 完成、health `db=postgres`、第 7 夹具就位。链路：Kiosk 会员登录 → 上传文件 → 打印参数 → 建单。

1. **付费单 → unpaid**：选非 0 元价目文件建单，核对
   - 建单响应 `amountCents > 0`、`payStatus=unpaid`、`priceLines` 与 `billablePages` 由**后端**给（前端传错金额应被忽略/以后端为准）。
2. **免费单 → paid+free+pickupCode**：走 0 元价目（或免费条件）建单，核对
   - `amountCents=0`、`payStatus=paid`、`paymentSource=free`、返回 `pickupCode`。
3. **/me/print-orders 展示**（Kiosk 我的页详单）：
   - 卡片/详单展示：**金额**（整数分）、**支付来源**文案（线下收款/免费/人工确认）、**计费页数** + 来源说明、**取件码**面板。
   - 只读安全：响应**不含**文件原文 / 签名 URL / `errorCode` / `errorMessage` / `endUserId` / `terminalId`。
4. **退款后取件码不显示**：对一张 paid 单走 Admin `refund`（`paymentSource` 仍受白名单约束）→ `/me/print-orders` 该单 `pickupCode` 转为 **null / 不渲染**（门控：仅 `paid && 未退款 && 非终态` 可见）。
5. **历史无 Order 显示「暂无支付信息」**：查一条 C5-1 之前的历史 `PrintTask`（无关联 Order）→ 我的页显示「暂无支付信息」，不显示金额 0、不推断。
6. **门禁回归**（服务器 or 构建机，只读验证逻辑）：`verify:order` / `verify:pricing` / `verify:member-print-orders` / Kiosk `verify:member-print-orders-ui` 全 PASS。

---

## 9. P1 验收步骤

> **前端阻塞提示**：Kiosk 简历优化页当前**不传 `benefitGrantId`**（`apps/kiosk/src` 内该参数零引用，`getResumeOptimize()` 不带此参）。因此：
> - **若未先补前端接线** → P1 **只能 API 级验收**（直接调后端端点），**不能经 Kiosk UI 端到端**；验收报告须如实标注「API 级、无 UI 端到端」。
> - 若已补前端接线 → 可加做 UI 端到端（领权益 → 优化 → 核销 → AI 服务记录可见）。

**API 级验收**（端点 `GET /api/v1/resume/records/:taskId/optimize?benefitGrantId=<id>`，需会员鉴权）：

1. **正常核销**：先对某简历产出真实 `taskId` 完成优化（`status=completed`），带本人 `benefitGrantId` 调用 →
   - `BenefitGrant.quantityRemaining` **扣减 1**；
   - `RedemptionRecord` **落库**（`serviceType=resume_optimize`、`serviceRefId=taskId`、`orderId=null`、`amountCents=0`）；
   - 审计记录生成。
2. **幂等重放不二次扣**：同 `benefitGrantId + taskId` 再调 → 返回既有核销（幂等），`quantityRemaining` **不再减**，`RedemptionRecord` 不新增。
3. **`subsidy_eligibility_hint` 拒核销**：用 `benefitType=subsidy_eligibility_hint` 的 grant 调用 → 返回 `BENEFIT_NOT_REDEEMABLE`（不在可核销白名单）。
4. **跨用户拒绝**：用 A 会员 token 传 B 会员的 `benefitGrantId` → 拒绝（越权保护），不泄露他人核销。
5. **匿名拒绝**：未登录带 `benefitGrantId` → `REDEEM_REQUIRES_LOGIN`。
6. **额度用尽**：`quantityRemaining=0` 再核不同产物 → 拒（`USED_UP` 类）；一产物一核销约束（`@@unique([serviceType,serviceRefId])`）命中 `BENEFIT_OUTPUT_ALREADY_REDEEMED`。
7. **门禁回归**：`verify:benefit-redemption`（18 PASS）+ `verify:benefit-activities` / `verify:member-benefits-admin` PASS。
8. **响应头**：端点返回 `Cache-Control: no-store`。

---

## 10. 不得宣称完成项

- ❌ 不得称「真机出纸 / 取件验收完成」——未接 Windows Terminal Agent + 奔图真机。
- ❌ 不得称「live 微信 / 支付宝可用」——本轮无 live 渠道（C5-6）；`PAYMENT_PROVIDER` 保持 disabled，sandbox 生产禁用。
- ❌ 不得称「正式生产验收 / 商用上线完成」——本 runbook 仅预生产（staging）。
- ❌ **P1 若未补前端入口，只能称「API 级核销验收通过」，不得称「权益核销端到端可用」**。
- ❌ 不得据本地 verify / 预生产 API 探针宣称线上收银或核销商用完成。
- ❌ 不得据「DB 有列 / 软链是某 commit」推断能力可用——须以**实跑进程 + 真实请求**为准。

---

## 11. 回滚策略

> 任一节失败或验收判负，按下序回滚到已知一致状态。回滚同样须先确认，不盲动。

1. **PM2 回旧 release**：把 ecosystem/启动路径改回回滚锚点（旧实跑 `…/1a2ea75e`，或改回旧软链目标 `…/6497c5a4-dpgate-b`，取决于要回到哪个一致点），`pm2 restart`，确认 `pm_cwd` 回到目标、health `db=postgres`。
2. **软链回旧 release**：`ln -sfn <旧 release 绝对路径> /srv/ai-job-print`，`readlink -f` 复核；如为回到迁移前状态，选与 DB 备份匹配的 release。
3. **DB migration 回滚限制**：
   - **已执行的 additive migration 不直接 `down`**（Prisma 无自动 down；手改有风险）。
   - 需回到迁移前：**从第 3.1 dump `pg_restore --clean` 恢复**（停写窗口内执行），恢复后库回到「仅 C5-1」状态，与旧 release 匹配。
   - 若只是 PM2/软链错位、DB 无需回退：保留新表（additive 无害），只回 PM2/软链即可。
4. **验收夹具清理**：验收后（无论成败）清理造的 EndUser / PriceConfig 测试档 / BenefitActivity / BenefitGrant / RedemptionRecord / Order / PrintTask / FileObject 及对应 COS 对象、AuditLog 中的测试噪声；清理临时脚本；短信 provider 若临时切 `log` 须切回 `tencent` 并复验 health。
5. **一致性收尾**：回滚完成后重跑第 1 节四项只读探测（软链 / PM2 实跑 / DB migration / dist 指纹），确认四者恢复到一个**互相一致**的已知状态，并记录到 `docs/progress/current-progress.md`（不写完整日志，只写可执行结论与验证结果）。

---

## 附录 A：只读探测命令速查（复核 / 回滚后自检用）

```bash
# 软链与 DEPLOY_SOURCE
readlink -f /srv/ai-job-print
cat /srv/ai-job-print/DEPLOY_SOURCE.txt

# PM2 实跑 release
pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>JSON.parse(d).forEach(p=>console.log(p.name,p.pm2_env.status,p.pm2_env.pm_cwd,p.pm2_env.NODE_ENV)))'

# health
curl -s http://127.0.0.1:3010/api/v1/health

# DB 表/列/migration（DATABASE_URL 从 .env 读，勿打印）
psql "$DATABASE_URL" -At -c "SELECT to_regclass('public.\"PriceConfig\"'), to_regclass('public.\"PaymentAttempt\"'), to_regclass('public.\"RedemptionRecord\"');"
psql "$DATABASE_URL" -At -c "SELECT migration_name FROM \"_prisma_migrations\" WHERE migration_name ~ 'payment|redemption|foundation' ORDER BY 1;"

# Kiosk dist 指纹
sha256sum /srv/ai-job-print/apps/kiosk/dist/index.html
```

## 附录 B：本 runbook 未决 / 依赖项

- **前端核销入口**（P1 UI 端到端）：需另开任务补 `MyBenefitsPage` CTA + `ResumeOptimizePage` 读参 + adapter 透传 `benefitGrantId`；属功能开发，不在本 runbook。
- **支付/核销预生产验收执行记录**：本 runbook 执行后应另建 `docs/acceptance/…-execution-record.md` 落证据 ID（证据原文不入仓）。
- **正式生产（非 staging）**：`NODE_ENV=production` 会触发 `assertProductionRuntimeGates`（强制 `FILE_STORAGE_DRIVER=cos`、非 SQLite、`REDIS_URL`、短信 tencent、OCR baidu、AI llm、禁 `PAYMENT_PROVIDER=sandbox`）；转正式生产时须逐项满足，另行规划。
