# 生产整合候选与已关闭订单遗留打印任务处置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建不回退线上支付修复的部署候选，并以可审计、可回滚的维护命令收敛已关闭订单遗留的 pending 打印任务。

**Architecture:** 从 `95758fcc` 逐个整合生产独有补丁，再增加不暴露 HTTP 的维护服务。服务通过数据库事务和 CAS 保护任务与订单镜像，维护脚本只负责显式输入校验和调用服务；生产部署沿用候选目录原子切换与已验证备份流程。

**Tech Stack:** pnpm monorepo、NestJS、Prisma PostgreSQL、TypeScript、PM2、PostgreSQL pg_dump/pg_restore。

---

### Task 1: 整合生产独有修复并确认候选差异

**Files:**
- Modify: 由 `git cherry-pick` 引入的原始补丁文件。
- Test: `services/api/scripts/verify-payment-codepay.ts`、既有 Kiosk 上传文件名验证。

- [ ] **Step 1: 逐个 cherry-pick 生产补丁**

```bash
git cherry-pick c859b8e2
git cherry-pick 9f0f46f5
git cherry-pick 6d4c5ae7
```

预期：每个提交都保留原有修复语义；若发生冲突，先阅读双方变更，仅解决冲突块后 `git add <冲突文件>` 与 `git cherry-pick --continue`。

- [ ] **Step 2: 验证整合补丁存在**

```bash
pnpm --filter @ai-job-print/api verify:payment-codepay
pnpm --filter @ai-job-print/kiosk typecheck
```

预期：付款码过期收敛验证与 Kiosk 类型检查通过。

- [ ] **Step 3: 检查候选提交范围**

```bash
git diff --check 95758fcc..HEAD
git log --oneline 95758fcc..HEAD
```

预期：没有空白错误，新增提交只包含三项生产修复。

### Task 2: 为 closed/pending 遗留打印任务写失败验证

**Files:**
- Create: `services/api/scripts/verify-closed-pending-print-task-disposition.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: 写入 verify 场景**

实现一个与既有 `verify-legacy-pending-print-task-disposition.ts` 同风格的验证脚本，构造已启用管理员、匿名未领取 `pending` PrintTask、`closed/pending` Order 与 `expired` PaymentAttempt。断言首次调用将任务和订单镜像关闭，状态日志和审计各一条。

- [ ] **Step 2: 写入拒绝场景**

在同一 verify 中覆盖：`created`/`pending`/`success` PaymentAttempt、已领取、成员任务、已支付订单、订单 taskStatus 非 pending、过长或过短原因、无效管理员，以及审计外键失败必须回滚。

- [ ] **Step 3: 登记并运行失败验证**

```bash
pnpm --filter @ai-job-print/api verify:closed-pending-print-task-disposition
```

预期：在服务尚未实现前失败，错误指向缺失的维护服务或命令。

### Task 3: 实现窄化维护服务和显式命令

**Files:**
- Create: `services/api/src/print-jobs/admin-closed-pending-print-task-disposition.service.ts`
- Create: `services/api/scripts/dispose-closed-pending-print-tasks.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: 实现服务的输入与资格校验**

定义 `dispose({ taskIds, operatorId, reason })`，去重 task IDs，并拒绝空批次、超过 10 条、非管理员和不在 10–500 字符范围内的原因。读取任务、订单与 PaymentAttempt 状态；只接受设计文档中的条件。

- [ ] **Step 2: 实现同事务 CAS 状态迁移**

对 PrintTask 使用 `pending + anonymous + unclaimed` CAS，将它写为 `cancelled` 并设置专用 error code；对 Order 使用 `closed + pending + 无活跃/成功支付尝试` CAS，仅更新 `taskStatus=cancelled`；写一条状态日志及一条 `print_task.closed_pending_disposed` 审计。任意 `count !== 1` 抛冲突，使 transaction 回滚。

- [ ] **Step 3: 实现命令环境门禁**

命令必须要求：

```text
CLOSED_PENDING_PRINT_TASK_DISPOSITION_CONFIRM=DISPOSE_CLOSED_PENDING_TASKS
CLOSED_PENDING_PRINT_TASK_IDS=<comma-separated IDs>
CLOSED_PENDING_PRINT_TASK_OPERATOR_ID=<enabled admin id>
CLOSED_PENDING_PRINT_TASK_REASON=<10-500 character reason>
```

命令只输出处置的任务 ID、数量与幂等任务 ID；不得输出数据库连接、凭据、订单内容或文件 URL。

- [ ] **Step 4: 运行 verify 变绿**

```bash
pnpm --filter @ai-job-print/api verify:closed-pending-print-task-disposition
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
```

预期：全部通过。

### Task 4: 回归、双模型审查和 CI

**Files:**
- Modify: `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`（仅填写真实结果）

- [ ] **Step 1: 运行相关回归**

```bash
pnpm --filter @ai-job-print/api verify:admin-print-scan
pnpm --filter @ai-job-print/api verify:legacy-pending-print-task-disposition
pnpm --filter @ai-job-print/api verify:payment-codepay
pnpm --filter @ai-job-print/kiosk typecheck
git diff --check
```

- [ ] **Step 2: 运行 Antigravity 与 Claude 双模型审查**

审查范围为 `git diff 95758fcc...HEAD`，重点检查支付状态机、CAS、审计原子性、命令输入门禁和密钥泄露。

- [ ] **Step 3: 推送候选并等待 CI**

在用户授权的生产动作范围内推送候选分支；仅在 GitHub 两个 CI job 成功后进入部署。

### Task 5: 生产备份、处置、部署与复核

**Files:**
- Modify: 生产 `/srv` 发布目录、PM2 API 进程与 Admin 静态文件（不修改 nginx、env、schema）。

- [ ] **Step 1: 创建并验证数据库备份**

使用生产 `.env` 的 PostgreSQL URL 生成 mode 600 的 custom dump；记录文件路径、大小、sha256，并以 `pg_restore -l` 验证可读。不要输出 URL。

- [ ] **Step 2: 再读三条任务资格**

确认 KSK-001 仍 disabled；两条任务仍为 `unpaid/pending` 且无支付尝试；异常任务仍为 `closed/pending`、匿名未领取且仅有 `expired/failed` 尝试。

- [ ] **Step 3: 受控关闭三条任务**

对两个 unpaid 任务使用 Admin `close-unpaid` 入口与各自最新 `updatedAt`；对 closed/pending 任务使用新维护命令。逐条复核 PrintTask/Order/StatusLog/AuditLog，任何冲突立即停止。

- [ ] **Step 4: 原子部署候选**

保留上一 `/srv/ai-job-print` 目录，构建并校验候选 API/Admin 产物哈希，写不含秘密的 `DEPLOY_SOURCE.txt`，原子目录交换后 `pm2 restart ai-job-print-api`。

- [ ] **Step 5: 线上复核与交接**

核验本地和公网 health、PM2 online、Admin 静态包含“账号设置”、API 含自助改密路由、支付二维码收敛修复仍在、三条任务皆为 cancelled。随后只把账号设置页面交给用户本人设置新密码。
