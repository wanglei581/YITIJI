# 文档清理盘点与执行台账（2026-09-02）

> 触发：产品负责人「旧的或没价值的文档可以清理掉，文档要及时更新记录」。
> 范围：只动 `docs/`，且不碰 `docs/design/`（另一条线在用）、`docs/graph/`（自动产物）、
> `docs/delivery/`（今日新建交付包）、`docs/reviews/page-migration-inventory-2026-09-02.md`（另一条线正在写入）。
> 本文件是**执行台账**，不是新的口径来源。现行口径仍按 `CLAUDE.md §7` 指定的六个入口读。

---

## 一、判据（CLAUDE.md §8 删除必须有证据）

一份文档只有**同时**满足下面两组条件才允许删除。任何一条存疑一律保留并标注。

### 第一组：零阻塞引用（机械可复算）

对每份候选取 basename 做全仓 `grep -rI --fixed-strings`（排除 `node_modules/.git/dist/build/coverage/.turbo/test-results`），
把命中按来源分层：

| 层 | 来源 | 是否阻塞删除 |
|---|---|---|
| A · 代码与门禁 | `apps/` `services/` `packages/` `scripts/` `.github/` | **阻塞** |
| B · 正式入口 | `CLAUDE.md` `AGENTS.md` 根 `README.md` `docs/README.md` `docs/project-structure.md` `docs/progress/{current-progress,next-tasks,today-*}.md` `docs/product/feature-scope.md` `docs/compliance/` `.ccg/spec/` | **阻塞** |
| B′ · 其它保留文档 | `docs/` 下不在删除清单里的任何文件 | **阻塞** |
| C · 非阻塞 | `docs/graph/`（自动产物，`pnpm graph` 重跑即刷新）、`docs/progress/archive/`、`.ccg/tasks/archive/`（已被 `.gitignore:78` 排除出跟踪）、删除清单内部互引 | 不阻塞 |

**为什么用 basename 而不是全路径**：`docs/README.md` §四记过一次 basename 误判事故（`01-home.html` 同时命中两个目录）。
本轮先核过 **`docs/` 内 `.md` 的 basename 除 `README.md` 外全局唯一**（`find … -exec basename | uniq -d` 只回 `README.md` 一项），
因此 basename 命中集是全路径命中集的**超集** —— 用它判「零引用」比全路径更严，不会漏。三个 `README.md` 因此一律不进候选池。

补充核查（均已执行）：

- 无任何脚本按目录枚举 `docs/superpowers|reviews|acceptance`；唯一目录级命中是
  `apps/kiosk/scripts/verify-profile-print-orders-inkpaper.mjs:64`，它是把 `docs/superpowers/` **排除**出变更文件清单，删文件反而更安全。
- 全仓无 markdown 链接校验门禁（`scripts/verify-repository-integrity.mjs` 不读 `docs/`，
  `scripts/verify-compliance-copy.mjs` 只扫 `apps/{admin,kiosk,partner}/src`）。
- 删除清单敲定后重跑「保留侧 → 删除侧」互链检查，结果为空（见 §四）。

### 第二组：结论已被覆盖（人工判定）

零引用只证明「没人在读」，不证明「没价值」。所以再加一条：

- **删**：`docs/superpowers/` 里的一次性任务单 / 设计草案（该目录 README 自述「不是当前执行口径」，
  `docs/README.md` §三 记「结论已合入主干」），且不属于任何**尚未关闭的阻塞项族**；
  以及 `docs/reviews/` 里纯时点状态快照（Phase 0/2/6.5/7 封板前的代码审查、单页实现审查、PR/分支盘点）。
- **保留**：面向未来的（backlog / gap spec / 待拍板提案）、治理章程、近两周的综合审查、
  以及任何**工作尚未完成**的族 —— 计划文档里的设计思路对未做完的活仍然有用。

---

## 二、分组统计

| 组 | 总数 | 零阻塞引用 | 判定删 | 判定留 |
|---|---:|---:|---:|---:|
| `superpowers/plans/` | 106 | 73 | **35** | 71 |
| `superpowers/specs/` | 40 | 29 | **17** | 23 |
| `reviews/`（顶层 `.md`） | 77 | 31 | **13** | 64 |
| `acceptance/` | 29 | 2 | **0** | 29 |
| 合计 | 252 | 135 | **65** | 187 |

**与 `docs/README.md` §三旧统计的差异（该段写于 2026-08，本轮已重核）**：

| 项 | README §三旧值 | 2026-09-02 实测 | 说明 |
|---|---|---|---|
| `superpowers/` 任务单总数 | 146 | **146** | 一致 |
| 其中「未被任何代码或 CI 引用」 | 130 | **102** | 旧值口径更松（只看代码/CI）。本轮把 `docs/` 内部互链和 `progress/` 提及也算阻塞，故更严 |
| `reviews/` 总数 | 69 | **77**（顶层 `.md`；含子目录共 90 个文件） | 8 月下旬以来新增 8 份 |
| `patent/` + `business/` | 11 | **11** | 一致 |

---

## 三、删除清单（65 份 · 已执行）

引用检查结果：**全部为零阻塞引用**（A=0、B=0、B′=0）。执行方式：`rm`，分 3 批。

### 批次 1 · `superpowers/plans/`（35 份）· 状态：**已执行，35/35 删除成功**，`plans/` 由 106 → 71

一次性实施计划，对应能力均已合入主干且无门禁引用。

| 文件 | 行数 |
|---|---:|
| `superpowers/plans/2026-06-18-benefit-activities-real-validation.md` | 158L |
| `superpowers/plans/2026-06-18-profile-commercial-closure-p0.md` | 168L |
| `superpowers/plans/2026-06-18-profile-notifications-feedback-p1.md` | 115L |
| `superpowers/plans/2026-06-20-project-normalization-p0.md` | 163L |
| `superpowers/plans/2026-06-22-admin-file-lifecycle-view.md` | 156L |
| `superpowers/plans/2026-06-22-cos-lifecycle-privacy-acceptance.md` | 159L |
| `superpowers/plans/2026-06-22-file-assets-gate2-readiness-recheck.md` | 214L |
| `superpowers/plans/2026-06-22-file-assets-trial-acceptance.md` | 50L |
| `superpowers/plans/2026-06-26-user-file-upload-flow.md` | 617L |
| `superpowers/plans/2026-06-29-ai-resume-commercial-closure.md` | 658L |
| `superpowers/plans/2026-06-29-ai-resume-diagnosis-config-ui.md` | 196L |
| `superpowers/plans/2026-06-29-ai-resume-diagnosis-context-phase1.md` | 97L |
| `superpowers/plans/2026-06-29-ai-resume-overall-assessment-implementation.md` | 732L |
| `superpowers/plans/2026-06-29-global-seamless-data-refresh.md` | 953L |
| `superpowers/plans/2026-06-29-job-materials-commercial-closure.md` | 91L |
| `superpowers/plans/2026-06-29-resume-phone-qr-upload-closure.md` | 608L |
| `superpowers/plans/2026-07-03-resume-optimize-wave2-layout.md` | 656L |
| `superpowers/plans/2026-07-03-resume-template-fill-wave3.md` | 718L |
| `superpowers/plans/2026-07-03-resume-voice-wave4.md` | 511L |
| `superpowers/plans/2026-07-10-remaining-work-report-and-roadmap.md` | 134L |
| `superpowers/plans/2026-07-12-node20-pdf-renderer-compatibility.md` | 42L |
| `superpowers/plans/2026-07-12-ocr-live-renderer-verify.md` | 30L |
| `superpowers/plans/2026-07-14-assistant-voice-consultation-restore.md` | 435L |
| `superpowers/plans/2026-07-15-admin-billing-description-editor.md` | 282L |
| `superpowers/plans/2026-07-15-admin-credential-recovery-and-auth-verify-safety.md` | 457L |
| `superpowers/plans/2026-07-15-admin-partner-warm-theme-governance.md` | 252L |
| `superpowers/plans/2026-07-16-admin-partner-phone-transfer.md` | 678L |
| `superpowers/plans/2026-07-16-partner-account-member-safe-removal.md` | 563L |
| `superpowers/plans/2026-07-17-dependency-security-remediation-main.md` | 231L |
| `superpowers/plans/2026-07-18-partner-account-dual-auth-removal-implementation.md` | 764L |
| `superpowers/plans/2026-07-25-partner-email-login-alias.md` | 63L |
| `superpowers/plans/2026-07-26-home-job-fairs-print-scan-visual-balance.md` | 388L |
| `superpowers/plans/2026-07-26-partner-account-phone-transfer-ux.md` | 301L |
| `superpowers/plans/2026-07-29-phase0-final-go-no-go.md` | 73L |
| `superpowers/plans/2026-07-30-agent-loop-ci-gates-implementation.md` | 234L |

### 批次 2 · `superpowers/specs/`（17 份）· 状态：**已执行，17/17 删除成功**，`specs/` 由 40 → 23

对应批次 1 的设计草案；成对删除，无跨批遗留链接。

| 文件 | 行数 |
|---|---:|
| `superpowers/specs/2026-06-22-cos-lifecycle-privacy-acceptance-design.md` | 44L |
| `superpowers/specs/2026-06-26-user-file-upload-flow-design.md` | 210L |
| `superpowers/specs/2026-06-29-ai-resume-overall-assessment-design.md` | 141L |
| `superpowers/specs/2026-06-29-job-materials-commercial-closure-design.md` | 108L |
| `superpowers/specs/2026-06-29-smart-campus-toolbox-home-design.md` | 224L |
| `superpowers/specs/2026-07-03-resume-optimize-wave2-layout-design.md` | 164L |
| `superpowers/specs/2026-07-03-resume-template-fill-wave3-design.md` | 155L |
| `superpowers/specs/2026-07-03-resume-voice-wave4-design.md` | 176L |
| `superpowers/specs/2026-07-12-node20-pdf-renderer-compatibility-design.md` | 24L |
| `superpowers/specs/2026-07-12-ocr-live-renderer-verify-design.md` | 20L |
| `superpowers/specs/2026-07-14-assistant-voice-consultation-restore-design.md` | 195L |
| `superpowers/specs/2026-07-15-admin-billing-description-editor-design.md` | 82L |
| `superpowers/specs/2026-07-16-admin-partner-phone-transfer-design.md` | 209L |
| `superpowers/specs/2026-07-16-partner-account-member-safe-removal-design.md` | 146L |
| `superpowers/specs/2026-07-18-partner-account-dual-auth-removal-design.md` | 518L |
| `superpowers/specs/2026-07-26-home-job-fairs-print-scan-visual-balance-design.md` | 141L |
| `superpowers/specs/2026-07-26-partner-account-phone-transfer-ux-design.md` | 132L |

### 批次 3 · `reviews/`（13 份）· 状态：**已执行，13/13 删除成功**，`reviews/` 顶层 `.md` 由 77 → 65（含本台账新增 1 份）

只删**纯时点快照**：封板前的阶段代码审查、单页实现审查、PR/分支盘点。所有审计、章程、gap spec、backlog 一律不动。

| 文件 | 行数 | 删除理由 |
|---|---:|---|
| `reviews/claude-agency-phase0-review.md` | 246L | 2026-05-23 Phase 0 代码审查；CLAUDE.md §15 已记 Phase 1–7 全部完成 |
| `reviews/codex-phase0-followup.md` | 32L | 同上，Phase 0 复审 |
| `reviews/agency-phase2-closeout-review.md` | 236L | 2026-05-24 Phase 2 收口复查，已封板 |
| `reviews/agency-project-structure-review.md` | 304L | 2026-05-24 目录体检；目录职责现以 `docs/project-structure.md` 为准 |
| `reviews/phase6.5-data-chain-review.md` | 119L | 2026-05-25 Phase 6.5 封板判定，已封板 |
| `reviews/phase7-service-layer-review.md` | 165L | 2026-05-26 Phase 7.4/7.5 复查，已封板 |
| `reviews/ai-resume-phase0-contract-lock-review.md` | 82L | 2026-06-29 口径锁定；结论已落入 feature-scope / compliance |
| `reviews/ai-resume-commercial-closure-review.md` | 97L | 2026-06-29 多模型审查记录；CLAUDE.md §15 记阶段 2 已完成 |
| `reviews/me-resumes-page.md` | 68L | 2026-06-21 `/me/resumes` 单页实现审查，功能已上线 |
| `reviews/me-resumes-actions-hardening.md` | 41L | 同上，单次动作 hardening 记录 |
| `reviews/my-documents-delete-action.md` | 36L | 2026-06-21 `/me/documents` 删除按钮实现记录 |
| `reviews/profile-print-feedback-link.md` | 64L | 2026-06-21 打印订单→反馈跳转实现记录 |
| `reviews/dev-status-consolidation-2026-07-17.md` | 57L | PR / 分支 / worktree 时点盘点（15 个 PR、119 远程分支、167 worktree），6 周前状态，无一条仍成立 |

---

## 四、互链复核（删除后）

**执行结果：65/65 全部删除成功，无一份失败。**

删除**前**对 65 个 basename 跑「保留侧 → 删除侧」引用检查（保留侧 = `docs/` 下所有非 `graph/`、非 `progress/archive/`、且不在删除清单内的文件），结果为空。
删除**后**再对同样 65 个 basename 跑全仓复查（`docs/` + `apps/` + `services/` + `packages/` + `scripts/` + `.github/` + `CLAUDE.md` + `AGENTS.md` + 根 `README.md`），
**同样为空 —— 无遗留死链，无需修任何链接**。唯二仍有残留提及的是 `docs/graph/`（自动产物，下次 `pnpm graph` 自动刷新）
与 `docs/progress/archive/`（历史归档快照，按定义就该保留当时的文件名）。

> ⚠️ 后续动作提醒：`docs/graph/graph.json` 与 `docs/graph/orphans.md` 现在含 65 条已不存在的路径。
> 这不是错误，是自动产物滞后。本任务禁止改 `docs/graph/`，**请在下次改动路由/端点/模型时顺手跑 `pnpm graph` 重生成**。

过程中命中并因此**从删除清单撤回**的两份（保留文档正文有指向它们的正文链接）：

| 撤回文件 | 谁在引用 |
|---|---|
| `superpowers/plans/2026-07-17-user-center-wave1b-slice2-export-artifact.md` | `superpowers/plans/2026-07-17-user-center-wave1b-reversible-data-rights.md:175`（该文件被 `current-progress.md` 引用，属保留侧） |
| `superpowers/specs/2026-06-18-benefit-activities-mvp-design.md` | `superpowers/plans/2026-06-18-benefit-activities-mvp-implementation.md:1303`（该文件被 `docs/product/miniapp-life-circle-plan-v0.1.md` 引用，属保留侧） |

`.ccg/tasks/archive/` 里有 6 处指向删除清单的链接。该目录已被 `.gitignore:78 /.ccg/tasks/` 整体排除出跟踪，不属于仓库文档，**不构成阻塞**；且本任务只允许改 `docs/`，未去修改它。

---

## 五、明确保留（看着像垃圾，但必须留）

### 5.1 `docs/README.md` / `CLAUDE.md` 已点名，本轮完全未进候选池

- `docs/design/` 整个目录（含 `kiosk-redesign-2026-08/` 51 页上线口径原型、`kiosk-proto-2026-07/` 回归基线、
  `kiosk-proto-2026-07-fusion/sources/`、`kiosk-ai-os-v3-2026-08/`）—— 任务硬性约束禁止触碰
- `docs/graph/` —— `scripts/generate-project-graph.mjs` 的自动产物
- `docs/delivery/` —— 今日新建的 kiosk-redesign-r1 交付治理包
- `CLAUDE.md §7` 的六个正式入口文档
- 三个目录 `README.md`（`superpowers/`、`reviews/`、`reviews/real-file-print-2026-08-17/`）—— 导航与证据索引

### 5.2 零引用但**工作尚未完成**，计划文档仍是唯一设计来源（49 份）

删掉等于把没做完的活的设计思路一起扔掉。按族列：

| 族 | 份数 | 为什么留 |
|---|---:|---|
| `f1-*` / `genesis` / `provenance-manifest` / `terminal-fleet-f0` | 11 | `CLAUDE.md §15`：`productionF1` 仍 NO-GO，**invocation 唯一性与 stale-PID/cleanup 两项闸门未合**；`current-progress.md` 多条记 D2′ cleanup 缺口仍开 |
| `qingxu-lightflow-*` / `service-desk-*` | 8 | **青序流光是今天刚落地的当前主线设计语言**（`apps/kiosk/src/styles/qingxu/{tokens,primitives,shell,index}.css`、`components/qingxu/QxPageFrame.tsx`），51 页迁移正在按它推进 |
| `kiosk-8177-5299-fusion-*` / `kiosk82-visual` / `kiosk-86-proto` | 10 | fusion 是活的 CI 回归门禁族（`apps/kiosk/scripts/verify-fusion-*.mjs`） |
| `payment` / `alipay` / `redemption-settlement` / `print-unpaid-task` / `preprod-test-print-seed` | 7 | 支付与出纸履约链路未经真机验收（`next-tasks.md` B3 未勾） |
| `real-scan` / `material-check` | 4 | 扫描与文件体检真实化绑定 B3 现场验收 |
| `contract-review` / `ai-contract` | 3 | 有 release gate（`docs/compliance/contract-review-release-gate.md`）与 `verify-ai-contract-mirror.mjs`，功能默认关闭未验收 |
| `p0-kiosk-privacy-timeout` / `session-warning` | 3 | 公共终端清场是硬约束；`next-tasks.md` 记 session-warning 证据仍 `PENDING` |
| `isolated-production` / `production-deployment` / `deploy-data-safety` | 3 | 生产部署仍冻结，对应 runbook 仍在用 |

### 5.3 `reviews/` 里零引用但**面向未来**，一份没删

| 文件 | 为什么留 |
|---|---|
| `reviews/operating-charter-2026-08-16.md` | 自述「**本文是执行口径**」，定义了「商用」的四条可判定门槛（不撒谎/有内容/能降级/可运维）。归档在 `reviews/` 只是放错了地方，不是没价值 |
| `reviews/2026-08-18-project-comprehensive-review.md` | 两周前的分层 GO/NO-GO 判定，六条结论逐条仍成立（小程序 NO-GO、Terminal Agent NO-GO、生产内容 NO-GO） |
| `reviews/2026-08-18-expert-panel-review.md` | 五路专家缺陷清单，多条带 `origin/main` 行号，仍未逐条关闭 |
| `reviews/kiosk-page-split-backlog.md` | 自述「**状态：暂缓(deferred)**，待上线后或在专门重构分支执行」—— 明确的未来待办 |
| `reviews/a3-print-fulfillment-gap-spec-2026-08-16.md` | `next-tasks.md` 的 **A3 打印/扫描交易履约仍是未勾选项** |
| `reviews/empty-catalogs-root-cause-2026-08-16.md` | `next-tasks.md` 的 **B2 生产内容录入仍未勾**；且这份文档指出 Admin 缺「重新发布」按钮，是尚未修复的缺陷证据 |
| `reviews/parallel-batch-dispatch-guardrails-2026-08-16.md` | 从真实失败提炼的派单护栏，与 `CLAUDE.md` 引用的 `verification-antipatterns-2026-08-17.md` 同类，面向后续会话 |
| `reviews/partner-account-email-bind-commercial-proposal-2026-07-25.md` | 自述「**状态：待老板拍板（尚未开工）**」—— 未决提案 |
| `reviews/v6-missing-pages-plan-2026-08-16.md` | 11 条缺口含 3 条自我订正的判错记录（原文明写「失误记录比抹平它有用」）；且 `docs/design/kiosk-v6-migration-matrix.md` 仍保留 |
| `reviews/v6-ux-density-audit-2026-08-16.md` | 1080×1920 实测字号/行长/触控量测，对 51 页新稿迁移仍是可直接复用的施工口径 |
| `reviews/f1-d2-prime-cgroup-consistency-root-cause-2026-08-01.md` | F1 D2′ 未关闭 |
| `reviews/global-seamless-data-refresh-design.md` | `packages/refresh/` 已落地（`RefreshProvider.tsx` / `useRefreshable.ts` / `useInteractionLock.ts` / `merge.ts` / `store.ts`），但该包**没有自己的 README**，这份审查是它唯一的设计说明 |
| `reviews/2026-08-01-self-assessment-design-proposal.md` | 同族的 `2026-08-02-self-assessment-v1-three-model-review.md` 与 `self-assessment-v1-review-scope.md` 被 `scripts/verify-self-assessment-r3-pick.mjs` 引用；只删提案会把这一族拆散 |
| `reviews/task-card-x1-n2-n4-admin-fe-split.md` | 依据的 `engineering-scale-normalization-backlog.md` 仍被 `next-tasks.md` 引用，backlog 未关闭 |
| `reviews/project-normalization-{ignore-proposal,local-tools-landing,task-evidence-triage}.md` | 同族的 `project-normalization-codex-claude-collaboration.md` 被 `docs/governance/standards-index.md` 引用；`task-evidence-triage` 的结论「不把 `.ccg/tasks/` 纳入仓库」正对应 `.gitignore:78`，是活约束的来源说明 |
| `reviews/page-migration-inventory-2026-09-02.md` | **另一条线正在写入该文件**，本任务硬性约束禁止触碰 |

### 5.4 `acceptance/` 整目录保留（29 份，一份没删）

29 份里 **27 份被 verify 脚本或正式入口直接引用**（`verify-file-assets-trial-acceptance.ts`、
`verify-print-scan-first-release.ts`、`verify-toolbox-*.ts`、`verify-job-info-ai-real-acceptance.ts`、
`verify-profile-*.mjs` 等）。剩下 2 份（`self-assessment-acceptance-package.md`、
`wave1-resume-optimize-preprod-acceptance.md`）虽零引用，但同族的执行记录被引用，拆开会断掉验收证据链，故一并保留。

---

## 六、盘点中发现的「文档说的和代码/现状不符」

这几条比清理本身更值钱，单独列出。**本轮只修了自己有权限改的那两处，其余只记录不擅自改。**

| # | 位置 | 文档怎么说 | 实际是什么 | 处置 |
|---|---|---|---|---|
| 1 | `docs/README.md:54` | `design/kiosk-redesign-2026-08/` 「当前是**工作区 untracked、有意未入库**（负责人未点名提交）…… 禁止 `git add -A` 把这两处顺手带进提交」 | 51 页原型已于今日 `2d9f73c1b` 入库（9.9MB） | ✅ 本轮已改（§七） |
| 2 | `docs/README.md:86-88` | `superpowers/` 146 份「其中 **130 份**未被任何代码或 CI 引用」；`reviews/` **69** 份 | 146 份中零阻塞引用 **102** 份（旧值口径更松）；`reviews/` 顶层 `.md` 已增至 **77** | ✅ 本轮已改（§七） |
| 3 | `docs/README.md:28-32` | 51 页原型「以 51 个宿主页 + 126 个 `?state=` 承接运行时全部 **106** 条路由（S25 React 注册 **106/106**）」 | `6d74c2f17` 修复图谱解析器后，kiosk 真实注册路由是 **107**；`next-tasks.md` 顶部已按 107 重写，`docs/README.md` 仍停在 106 | ✅ 本轮已改（§七） |
| 4 | `docs/README.md:31-32` | 「运行时目前只有 `/` 与 `/print-scan` 是新版」 | 该句描述的是 V6 落地状态。按 `next-tasks.md` 今日基线，**运行时页面 ↔ 新稿 51 页 = 0/51**；同时 `e8a468fca` 已把取件码页迁到青序流光。两处口径不是同一把尺子（V6 vs 青序流光新稿），并排读会误判进度 | ✅ 本轮已改（§七），指向 `next-tasks.md` 为准 |
| 5 | `docs/reviews/a3-print-fulfillment-gap-spec-2026-08-16.md:验证基线表` | 「`docs/reviews/2026-08-12-v6-commercial-product-audit.md` **不在 `origin/main`**，仅存在于 `claude/four-tasks-project-coordination-d39229`」 | 该文件现在既在工作区，也被 `docs/README.md`、`docs/progress/next-tasks.md`、`current-progress.md` 三处正式引用 | 只记录。该行是 2026-08-16 的时点事实，改它等于篡改当时的取证记录；正确读法是「基线已推进」 |
| 6 | `docs/product/role-boundary.md`（`current-progress.md:1004` 已记） | 早前写「DB 层按角色收敛 DELETE 权限」 | 实测 `services/api/src` 有 29 处 Prisma `delete/deleteMany`、28 个 `@Delete()` 端点，单一应用账号 | 已于 2026-08-01 修正为可验证表述，此处仅确认结论仍成立，未再改动 |

---

## 七、本轮同步更新的记录

| 文件 | 改了什么 |
|---|---|
| `docs/progress/current-progress.md` | 追加 2026-09-02 条目：图谱解析器修复（86→107）、取件码虚拟键盘、kiosk-redesign-r1 交付治理包（七闸门 / G2 NO_GO / 总判定 NO_GO）、51 页原型入库、BL-04 关闭、接口声明对齐 90/90、duplex 契约外露、青序流光地基 + `--print-*` 令牌链断裂修复、取件码页迁移，以及本次文档清理 |
| `docs/progress/next-tasks.md` | 「当前主线」勾掉已完成项；新增四条待办：奔图开放 API 三处取值不一致、彩色 mode 取值待厂家确认、mock-only 字段待产品裁决、`/me/summary` 端点缺失 |
| `docs/README.md` | §二修正 51 页原型入库状态与 107 路由口径；§三重算统计并标注复核日期；§五补一条删除记录指向本文件 |
