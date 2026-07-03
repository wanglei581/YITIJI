# Deploy Data Safety Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 DP-GATE 固化为可执行脚本与 CI 门禁，证明部署前后的低敏 canary 记录不会丢失，并阻止无证据日志的部署验收。

**Architecture:** 新增一个 API 侧脚本 `deploy-data-safety-gate.ts`，提供 `before` 和 `after` 两个模式。`before` 在 `AuditLog` 写入低敏 canary 并输出基线 JSON；`after` 读取基线 JSON，只读验证 canary、核心表计数、基线锚点记录和 `max(createdAt)`。新增 verify 脚本用本地测试库验证成功和失败路径，不触碰预生产。

**Tech Stack:** NestJS monorepo, Prisma, TypeScript, `node -r @swc-node/register`, GitHub Actions CI.

---

## Scope

允许修改：
- `services/api/scripts/deploy-data-safety-gate.ts`
- `services/api/scripts/verify-deploy-data-safety-gate.ts`
- `services/api/package.json`
- `.github/workflows/ci.yml`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

禁止修改：
- Prisma schema / migration（本轮复用既有 `AuditLog`）
- 任何生产/预生产服务器文件
- 任何支付、登录、简历、打印业务逻辑
- `.env` / 密钥 / 部署包

不执行：
- 不部署
- 不 SSH 写业务数据
- 不跑预生产 canary
- 不迁移 / 不重启 / 不改 env

## Tasks

### Task 1: Write Failing Verify

**Files:**
- Create: `services/api/scripts/verify-deploy-data-safety-gate.ts`

- [ ] 新建 verify，导入待实现的 `runGateBefore` / `runGateAfter`。
- [ ] 用临时唯一 batch 写 canary，断言 before 输出 `AuditLog` canary、核心表 count 和 max 时间。
- [ ] 调 `runGateAfter` 断言成功路径通过。
- [ ] 删除 canary 后再次调 `runGateAfter`，断言失败码包含 `DP_GATE_CANARY_MISSING`。
- [ ] 先运行 `pnpm --filter @ai-job-print/api verify:deploy-data-safety-gate`，期望失败，因为脚本尚未实现。

### Task 2: Implement DP-GATE Script

**Files:**
- Create: `services/api/scripts/deploy-data-safety-gate.ts`

- [ ] 实现 `before` 模式：参数 `--batch`、`--out`，写 `AuditLog action='deploy.canary'`，`actorId=null`，`actorRole='system'`，`targetType='deploy_canary'`，`targetId=batch`，`payloadJson` 只含 marker 和 batch。
- [ ] 实现 `after` 模式：参数 `--baseline`，只读验证 canary 仍存在。
- [ ] 核心表：`FileObject`、`AiResumeResult`、`Order`、`EndUser`、`PrintTask`。count 下降默认失败；允许通过 `--allow-count-drop <Table>:<reason>` 显式记录解释后降级通过。
- [ ] `max(createdAt)` 回退为硬失败，错误码 `DP_GATE_MAX_CREATED_AT_ROLLED_BACK`。
- [ ] `before` 为每张核心表记录最新 `createdAt` 行的 id + createdAt 作为基线锚点，`after` 必须确认这些锚点仍存在且 createdAt 未变化；锚点缺失错误码为 `DP_GATE_ANCHOR_MISSING`。
- [ ] 输出脱敏摘要，不输出 payload 全文、token、signedUrl、storageKey、手机号、简历正文。

**Operational note:** DP-GATE 主防“部署把数据库回退到旧快照”以及基线锚点丢失；部署窗口仍应停写或保持低流量。它不是全量行级审计，不能替代操作方的完整 deploy evidence log。

### Task 3: Wire Scripts and CI

**Files:**
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 新增 `deploy:data-safety-gate` 脚本。
- [ ] 新增 `verify:deploy-data-safety-gate` 脚本。
- [ ] 将 verify 接入 CI 的 API verify 串行列表，位置靠近 `verify:production-runtime-gates`。

### Task 4: Progress Docs and Verification

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] 记录 P0 部署数据安全门禁已固化，说明本 PR 未执行预生产 canary。
- [ ] 跑验证：
  - `pnpm --filter @ai-job-print/api verify:deploy-data-safety-gate`
  - `pnpm --filter @ai-job-print/api verify:audit-logs`
  - `pnpm --filter @ai-job-print/api typecheck`
  - `git diff --check`
- [ ] 高风险变更完成后做双模型安全/代码审查。
