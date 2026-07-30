# F1 D3 Single-Owner Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 F1 D3 审批治理包改成真实适配一人公司的单一负责人模式，同时保留未来机构职责分离模式，且不降低 B1–B9 或授权分层门槛。

**Architecture:** 继续以 `f1-d3-managed-topology-inputs.md` 作为唯一技术 SSOT，只在现有 approval package 增加治理模式、单人补偿控制和单一用途变更记录。进度文档只保存结果指针；不新增运行时、API、数据模型或生产配置。

**Tech Stack:** Markdown、Git、现有 release provenance / Genesis 离线验证脚本、Claude 与 Antigravity 只读审查。

---

### Task 1: 冻结修改边界与现有治理合同

**Files:**
- Read: `docs/superpowers/specs/2026-07-30-f1-d3-single-owner-governance-design.md`
- Read: `docs/device/f1-d3-managed-topology-approval-package.md`
- Read: `docs/device/f1-d3-managed-topology-inputs.md`
- Test: Git diff 与文本合同检查

- [ ] **Step 1: 确认工作区基线与文件预算**

Run:

```bash
git status --short --branch
git diff --name-only
```

Expected: 设计规格提交后工作区干净；实施阶段允许修改的正式文件只有 Task 2–3 列出的三个文件。

- [ ] **Step 2: 记录技术 SSOT 基线摘要**

Run:

```bash
git hash-object docs/device/f1-d3-managed-topology-inputs.md
```

Expected: 得到一个 Git blob hash，供实施完成后复核该文件零变化。

- [ ] **Step 3: 核对现有治理包必须保留的合同**

Run:

```bash
rg -n "B1–B9|VERIFIED_READ_ONLY|Genesis lock|Activation lock|D3 输出白名单|硬停止条件" docs/device/f1-d3-managed-topology-approval-package.md
```

Expected: 唯一 SSOT 引用、状态关闭条件、两把锁、输出白名单和硬停止条件全部存在。

### Task 2: 将审批治理包改为双模式

**Files:**
- Modify: `docs/device/f1-d3-managed-topology-approval-package.md`
- Test: `docs/device/f1-d3-managed-topology-inputs.md`

- [ ] **Step 1: 增加显式治理模式**

在治理包顶部和角色章节写清：

```markdown
每条变更记录必须显式选择且只能选择一种治理模式：

- `single-owner`：业主负责人真实承担业务、运维和安全决策责任；禁止虚构独立签批人。
- `institutional`：机构负责人、运维负责人、安全负责人按职责分离签批。
```

两种模式都只引用 managed 输入清单的字段 ID，不复制 B1–B9 值、状态或关闭条件。

- [ ] **Step 2: 增加单一负责人补偿控制**

写入以下六项完整规则：

1. 先记录后执行，记录包含 RFC3339 限时窗口；
2. release provenance、Genesis/activation 和摘要校验失败时 fail-closed；
3. 原件带外保存并备份，仓库只留非秘密索引与 SHA-256；
4. 部署账户与 API 运行账户继续分离；
5. 每阶段先形成脱敏结果，再申请下一动作；
6. AI 和自动门禁只能提供技术意见或触发 NO-GO，不能产生生产 GO。

- [ ] **Step 3: 固定五类单一用途授权**

治理包中必须出现且分别解释：

```text
D3_READONLY_PRECHECK
RESIDUAL_LOCK_DISPOSITION
D4_GENESIS
D5_CUTOVER
D6_ACTIVATION
```

明确上一动作 PASS 不自动授权下一动作；普通聊天中的“可以”“继续”“按推荐”不构成生产授权。

- [ ] **Step 4: 加入最小变更记录索引**

在原审批索引基础上增加治理模式、动作类型、业主负责人、技术复核引用、操作前/后证据引用和原件 SHA-256。完整记录仍在仓库外受保护位置；Git 不保存秘密、环境值、日志正文、PM2 dump、业务数据或个人隐私。

- [ ] **Step 5: 把签批区拆成双模式**

`single-owner` 表只允许真实业主负责人作最终决定，并把 AI 技术核对放在非签批引用区；`institutional` 表保留原机构、运维、安全和 D3 核验人职责。禁止 AI 出现在姓名/工号、批准人、执行人字段。

- [ ] **Step 6: 扩充硬停止条件但不削弱原规则**

新增以下 NO-GO 条件：普通聊天被当生产授权、虚构签批人、AI 被当批准人、单人模式缺补偿控制、动作记录过期或范围不明。保留所有原有秘密、锁、隔离、状态和后续授权硬停止条件。

- [ ] **Step 7: 验证唯一技术 SSOT 未变化**

Run:

```bash
git diff -- docs/device/f1-d3-managed-topology-inputs.md
git hash-object docs/device/f1-d3-managed-topology-inputs.md
```

Expected: 第一条无输出；blob hash 与 Task 1 Step 2 完全一致。

### Task 3: 同步正式进度入口

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 更新当前进度**

在 `current-progress.md` 顶部增加 P0-2C 记录，必须同时说明：

- 当前组织真实采用 `single-owner`；
- 没有虚构三方签批；
- AI 不是审批主体；
- B1–B9 和 D3–D6 分层授权没有降低；
- 本轮未连接生产，production F1 继续 NO-GO。

- [ ] **Step 2: 更新下一步任务**

在 `next-tasks.md` 将下一步写为：由业主负责人先建立单一用途的 D3 只读变更记录，固定 managed 输入和限时窗口，再单独授权 D3。不得把本次文档确认解释为生产授权。

- [ ] **Step 3: 检查进度文案不夸大**

Run:

```bash
rg -n "single-owner|AI.*不.*审批|NO-GO|不.*生产授权" docs/progress/current-progress.md docs/progress/next-tasks.md
```

Expected: 两份进度文档都能直接检索到真实模式、AI 边界和 NO-GO / 非授权结论。

### Task 4: 验证、双模型终审与任务归档

**Files:**
- Create while task is active: `.ccg/tasks/p0-2c-single-owner-governance-20260730/review.md`
- Archive after approval: `.ccg/tasks/archive/2026-07/p0-2c-single-owner-governance-20260730/`
- Test: 以上三个正式文档

- [ ] **Step 1: 运行格式和范围检查**

Run:

```bash
git diff --check
git diff --name-only
```

Expected: 无 whitespace 错误；除规格/计划和 CCG 记录外，正式实施变更仅为 approval package 与两份 progress 文件。

- [ ] **Step 2: 运行秘密与越权特征扫描**

Run:

```bash
rg -n "postgres(ql)?://|redis://|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}" docs/device/f1-d3-managed-topology-approval-package.md docs/progress/current-progress.md docs/progress/next-tasks.md
```

Expected: 无输出。

- [ ] **Step 3: 运行 release 离线门禁**

Run:

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api verify:release-genesis
```

Expected: 两套脚本均 `ALL PASS`；结果只证明文档变更未伴随代码回退，不作为生产证据。

- [ ] **Step 4: Claude 与 Antigravity 并行终审**

两者分别检查：双模式是否真实、AI 是否被误写为审批人、B1–B9 是否仍为唯一 SSOT、五个动作是否独立、是否存在普通聊天自动授权、秘密泄露或 F1 夸大。Critical / High 必须为 0；Warning 必须解决或在任务记录中明确保持 NO-GO。

- [ ] **Step 5: 记录审查结果并归档 CCG 任务**

将双模型结论写入 `review.md`，把 `task.json` 标为 completed，再把任务目录移动到 `.ccg/tasks/archive/2026-07/`。

- [ ] **Step 6: 提交本地候选**

Run:

```bash
git add docs/device/f1-d3-managed-topology-approval-package.md docs/progress/current-progress.md docs/progress/next-tasks.md .ccg/tasks/archive/2026-07/p0-2c-single-owner-governance-20260730
git commit -m "docs: support single-owner F1 governance"
```

Expected: 本地提交成功；不 push、不创建 PR、不部署、不连接生产。
