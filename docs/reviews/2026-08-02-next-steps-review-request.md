# Self-assessment v1 收口后续推荐审查请求

> 提交人：Cursor / Claude 主开发
> 时间：2026-08-02 15:57 +08
> 审查模型：Codex + Antigravity（独立审查，分别给推荐）

---

## 1. 已完成（事实，不可改）

- **三段 staged PR 已 squash 合 main**：`#473` (`348aefa`) + `#475` (`5ca7ce0`) + `#476` (`5a2c086`)
- **三模型审查的 7 项 Critical fix**：[`#486`](https://github.com/wanglei581/YITIJI/pull/486) squash `03c30bdcd` 已合入 main
  - §1.1 audit 类型去重 + audit 上下文从 req 注入
  - §1.2 PDF purpose 错挂 `print_doc` → `self_assessment_report`
  - §1.3 MyAiRecords 数据流断点（匿名场景也落库）
  - §1.4 taskId 三方一致
  - §1.5 strength typeguard（关闭 `strength=7.5` 注入）
  - §1.6 真网络 Playwright（3 用例 `@kiosk`）
  - §1.7 career-plan summary 跨轮污染 + `stored.payload?.dimensions` schema bug
- **stacked 分支清理已执行**（按 CLAUDE.md §8.1）：
  - 远程已删：`feature/staged-pr1-self-assessment-shared`（系统自动）+ `feature/staged-pr2-self-assessment-server`（手动）+ `feature/staged-pr3-self-assessment-frontend`（手动）+ `fix/self-assessment-staged-cleanup`（手动，#484 已关）
  - 本地已删：上述前三个 + `fix/self-assessment-staged-cleanup`
  - 本地保留：`feature/staged-pr2-self-assessment-server`（被 `.claude/worktrees/staged-pr2-server` 锚定，无法删）+ `feature/self-assessment-20260801`（基础锚点）+ `fix/self-assessment-staged-cleanup-r3`（最简回滚锚点，ahead=8 behind=0）
- **兜底脚本**：`scripts/verify-self-assessment-r3-pick.mjs` 4/4 PASS，独立于主 CI

---

## 2. 当前 main 红源（CI 三 job 全红，与 self-assessment 无关）

[run #30738609689](https://github.com/wanglei581/YITIJI/actions/runs/30738609689)：

| Job | 失败 verify | 根因 |
|---|---|---|
| `build-and-verify` | `verify:offline-agencies-page` — `resolveOfflineListPage is not a function` | [PR #482](https://github.com/wanglei581/YITIJI/pull/482) G1 引入；TS verifier 与 main tip 不同步 |
| `kiosk-browser-smoke` | `verify-fusion-w4.mjs:206` `assert.equal(owned.length, 23)` 实际 24；L272 禁 `/offline-agencies/:id`；L276 禁 `data.stats/jobCount/营业中/今日服务/在招岗位/status === 'open'` | G1 (#482) 业务实现踩了 verify-fusion-w4 的硬约束；#482 合入时即 `0/3 checks passed` |
| `postgres-readiness` | 同 `build-and-verify` 同一 verify 脚本双跑 | 同 |

**主分支自身 CI 已红**，与本次 self-assessment 修复无关。CLAUDE.md §18 明确禁止「修改 verify 让 `在招岗位/营业中/jobCount` 通过」（违反诚实化硬约束）；§8.1 禁止「以降低代码量为理由删已验证闭环」。

---

## 3. 候选下一步（按 CLAUDE.md §16 / §8.1）

1. **P0 上线前阻塞验收**：按 `docs/device/production-deployment-and-windows-host-checklist.md` 跑 服务器 + PostgreSQL 生产实例 + Windows 本地主机 + Terminal Agent + 打印扫描 + 密钥轮换 + 法务合规 + 线上浏览器闭环
2. **修 G1 (#482) verify 漂移**（两条路）：
   - (a) 业务实现收敛到 verify 期望：把 `OfflineAgenciesPage` 的 `StatsBand` / `在招岗位/jobCount/营业中/status === 'open'` 去掉，加 `服务时间以机构公示为准`，详情路由走 `OfflineAgencyDetailPage` 而非 query 拼接
   - (b) verify 期望更新：`owned.length` 23 → 24，允许 `/offline-agencies/:id`，但 metric 禁令 **不能解**（解开 = 把上线前硬约束废掉）
3. **P1 打印任务状态实时追踪 UI**
4. **P1 场馆导览 Partner 配置入口 / 展厅平面图图片**
5. **stacked-pr2 worktree 处理**：`.claude/worktrees/staged-pr2-server` 是否还要保留？该 worktree 顶端 commit `3a593472` 实质内容（`tokenMatches` + `SelfAssessmentDimensionResult[]`）已在 main，worktree 工作区干净无未提交改动

---

## 4. 关键约束（不可破）

- CLAUDE.md §1 不做企业招聘闭环（8 条红线）
- CLAUDE.md §18 严禁修改 verify 让 `在招岗位/营业中/jobCount` 通过
- CLAUDE.md §8.1 禁止以降低代码量为理由删已验证闭环
- 不得擅自合并 G1 (#482) 团队未授权的修复

---

## 5. 请 codex / antigravity 各自独立回答

1. **推荐优先做哪一项？给出理由与执行计划（涉及哪些文件、哪些 verify、预计分支 / worktree 影响）**
2. **G1 (#482) verify 漂移**：选 (a) 业务收敛 还是 (b) verify 适配？或都不动、等别人修？理由
3. **stacked-pr2 worktree**：保留 / 删除 / 还是把内容 cherry-pick 到新分支再说？理由
4. **是否还有未列出的高优先项**（按 CLAUDE.md §16 / §8.1 / §18 视角）
5. **风险预判**：你推荐的路径可能踩什么雷？怎么防御？

---

## 6. 提交方式

两位审查者请把结论写到本文件下方的 **「Codex 审查结论」** 和 **「Antigravity 审查结论」** 两个 H2 标题下：

- 文字 ≤ 400 字 / 模型
- 用 Markdown
- 不要复制粘贴对方的结论
- 必须各自给独立的推荐