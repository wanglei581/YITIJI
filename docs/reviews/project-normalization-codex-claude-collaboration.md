# 项目规范化 Codex + Claude 协作报告

> 生成时间：2026-06-20
> 工作区：`codex/project-normalization-p0`
> 目的：明确 Codex、Claude、Antigravity 在项目规范化和渐进式重构中的职责边界、任务分配、审查证据和停手条件。

## 当前结论

可以让 Claude 同步参与解决问题，但不能让 Claude 直接清理主工作区，也不能把主工作区的未跟踪文件整包交给 Claude 自动处置。

推荐模式是：

1. Claude 负责只读分析、文档草案、分类清单、限定文件 diff 草稿。
2. Codex 负责分支创建、文件预算、落盘、显式暂存、验证、提交与集成。
3. Antigravity 与 Claude 共同承担中高风险项的双模型审查。
4. 用户对删除、ignore、大文件归档、主工作区物料迁入等动作做明确确认后，才进入执行。

## 当前仓库事实

- P0 治理 worktree：`/Users/wanglei/.config/superpowers/worktrees/AI求职打印服务终端/project-normalization-p0`
- P0 治理分支：`codex/project-normalization-p0`
- P0 分支基线：`origin/main`
- P0 分支状态：相对 `origin/main` ahead 2，工作树在本报告写入前为 clean。
- 主工作区：`/Users/wanglei/AI求职打印服务终端`
- 主工作区分支：`feature/interview-setup-redesign`
- 主工作区分叉：`main` 独有 29 / 当前分支独有 24。
- 主工作区 tracked 修改：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 主工作区未跟踪内容集中在 `.ccg/tasks/`、`.ccg/commander/`、`.product-pm/`、`.superpowers/`、`.workbuddy/`、`docs/business/`、`deliverables/`、`opc-doc/`、`docs/design/`、`docs/superpowers/plans/`。

## 双模型审查摘要

本节记录的是 2026-06-20 本报告写入前的第一轮只读协作方案审查；本报告自身仍需在提交前再次接受 Claude + Antigravity 复审。

### Claude 审查结论

Claude 结论为 `CHANGES_REQUESTED`，核心理由：

- 治理目标文件和执行 worktree 不完全在同一处。主工作区里的部分 B/D/E 类物料在 P0 worktree 中不存在，不能假装已经可在 P0 分支直接处理。
- 主工作区与 `main` 双向分叉，不能作为治理基线；B 类进度文档只能从 `origin/main` 新开干净分支后手工迁入真实结论，不能 cherry-pick 整个功能分支。
- `.gitignore`、删除、归档属于中高风险动作，必须先取得用户确认并通过 Claude + Antigravity 双模型审查。
- 第一批可以立即推进的只有只读真值对齐和 T1 文档草案；真正落盘执行仍需确认边界。

### Antigravity 审查结论

Antigravity 结论为 `CHANGES_REQUESTED`，核心理由：

- 协作架构可行，Codex 适合作为本地集成者，Claude 适合作为内容整理和清单生成者。
- 第一批任务建议按 B 类进度文档、E 类工具 ignore、C 类任务证据筛选、D 类外部材料索引推进。
- E/C/D 类任务涉及本地工具状态、历史任务取舍、PDF/商业材料处置，必须先由用户确认。
- 最终联合审查报告必须包含文件预算、无运行时代码改动、ignore 生效、无大文件暂存、合规边界扫描等证据。

## 职责边界

| 事项 | Claude | Codex | Antigravity |
| --- | --- | --- | --- |
| 只读盘点和方案 | 主责 | 复核事实 | 复核方案 |
| 文档草案和 diff 草稿 | 主责 | 落盘与验证 | 审查 |
| 分支创建和切换 | 不执行 | 主责 | 不执行 |
| 文件修改 | 仅限被授权任务草案 | 主责 | 不执行 |
| `git add` / commit / push | 不执行 | 主责，且禁止 `git add .` | 不执行 |
| `.gitignore` / 删除 / 归档 | 仅给建议 | 用户确认后执行 | 必须复审 |
| 运行时代码改动 | 默认禁止 | 本 T0-T5 规范化任务一律禁止；独立业务任务另开分支处理 | 必须复审 |
| 最终审查 | 参与 | 汇总裁决 | 参与 |

## 第一批任务分配

| 顺序 | 分支建议 | 任务 | 允许修改文件 | Claude 职责 | Codex 职责 | 停手条件 |
| --- | --- | --- | --- | --- | --- | --- |
| T0 | 无写分支或 `codex/normalization-truth-audit` | 只读真值对齐 | 可新增 `docs/reviews/*truth-audit.md` | 核对 P0 worktree 与主工作区物料差异，列出可迁入和不可迁入清单 | 核验命令输出，决定是否落盘报告 | 发现密钥、真实用户数据、大文件已入库 |
| T1 | `codex/normalization-progress-rollup` | B 类进度文档收口 | `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、必要时 `docs/progress/archive/*.md` | 提供文档重写草案，保留当前阶段、已验证结论、下一步任务池 | 从 `origin/main` 新开干净分支，手工迁入结论并验证 | diff 出现 `apps/`、`services/`、`packages/`、lockfile |
| T2 | `codex/normalization-ignore-proposal` | E 类工具状态 ignore 提案 | 只新增 `docs/reviews/*ignore-proposal.md`，不改 `.gitignore` | 列出 `.ccg/commander/`、`.product-pm/`、`.workbuddy/`、`.superpowers/*/state/` 的 ignore 建议 | 核对事实、落盘提案、等待用户确认 | 未确认本地工具是否仍使用 |
| T3 | `codex/normalization-local-tools-landing` | E 类本地工具落地 | 用户确认后才可改 `.gitignore`；必要时抽取 `docs/product/`、`docs/design/`、`docs/reviews/` | 复核 P0/P1 抽取项是否已沉淀，确认候选 ignore 模式 | 写 `.gitignore`、跑 `git check-ignore -v`，不删除本地文件 | PRD/HTML 预览去向未确认或命中疑似密钥 |
| T4 | `codex/normalization-evidence-triage` | C 类任务证据筛选 | 首轮只新增 `docs/reviews/*evidence-triage.md`；确认后才处理 `.ccg/tasks/**` | 给出保留/归档/不入库清单和理由 | 执行显式路径暂存，扫描 secrets | 清单项缺少依据或发现疑似密钥 |
| T5 | `codex/normalization-external-materials-index` | D 类外部材料索引 | `docs/business/README.md`、`deliverables/README.md`、`opc-doc/README.md`、确认后才改 `.gitignore` | 摘要化商业材料和交付物，区分仓库内摘要与仓库外大文件 | 验证无 PDF/PPT/DOCX/ZIP 暂存 | 未确认大文件是否已有外部备份 |

## 可立即执行与不可立即执行

可以立即执行：

- T0 只读真值对齐。
- T1 的文档收口草案。
- 新增协作报告、审查报告、清单类文档。

不能立即执行：

- 删除主工作区任何文件。
- 移动或归档主工作区未跟踪目录。
- 修改 `.gitignore` 让本地工具目录从状态中消失。
- 整包提交 `.ccg/tasks/`、`docs/business/`、`deliverables/`、`opc-doc/`。
- 让 Claude 直接在主工作区运行写操作。

## 用户确认清单

进入实际清理前，需要用户确认：

1. 是否同意 B 类进度文档从 `origin/main` 新开干净分支收口，主工作区原文件只作为证据来源，不直接在 `feature/interview-setup-redesign` 上提交？
2. `.ccg/commander/`、`.product-pm/`、`.workbuddy/`、`.superpowers/*/state/` 是否仍有本地工具在使用？是否允许后续写入 `.gitignore` 但本地保留？
3. `.ccg/tasks/` 是否同意按“保留 plan/review/verify/deploy/audit 证据，ack/advise/explain 等低价值任务不入库”的原则筛选？
4. `docs/business/`、`deliverables/`、`opc-doc/` 中的 PDF、PPT、DOCX、ZIP 等外部材料是否已有仓库外备份？是否同意仓库只保留 Markdown 摘要索引？
5. 是否确认每一类独立分支、独立提交，且任何中高风险项都走 Claude + Antigravity 双模型审查？

## 最终联合审查证据

每个任务完成后，联合报告必须包含：

- `git status -sb`
- `git log --oneline origin/main..HEAD`
- `git diff --name-only origin/main...HEAD`
- `git diff --check`
- `git diff --name-only origin/main...HEAD | rg '^(apps|services|packages)/' || true`
- 对 `.gitignore` 类任务：`git check-ignore -v` 的命中结果。
- 对 C/D 类任务：`rg -n "(password|secret|token|api[_-]?key|AKIA|BEGIN PRIVATE KEY)"` 的敏感信息扫描结果。
- 对外部材料任务：`git status --short | rg '\\.(pdf|ppt|pptx|docx|zip)$' || true` 的无暂存证明。
- 双模型审查结论：Claude、Antigravity 的 Critical / Warning / Info 与 Codex 裁决。
- 合规口径检查：无“一键投递”“平台投递”“收取简历”“候选人筛选”等越界闭环被新增或恢复。

## 本轮建议

本轮不启动任何清理、删除、ignore 或大文件归档。下一步最稳妥的是执行 T0：只读真值对齐，产出 `docs/reviews/project-normalization-truth-audit.md`，明确哪些主工作区物料实际存在、哪些在 P0 worktree 已入库、哪些缺少迁入证据。

T0 完成后，再进入 T1：从 `origin/main` 新开干净分支，收口 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`。
