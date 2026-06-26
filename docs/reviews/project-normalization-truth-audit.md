# 项目规范化 T0 真值对齐报告

> 生成时间：2026-06-20
> 分支：`codex/normalization-truth-audit`
> 范围：只读核对 P0 治理 worktree 与主工作区差异，不删除、不移动、不 ignore、不迁入任何主工作区文件。

## 结论

当前项目规范化不能把“本地混乱项”视为一个整体处理。真实状态分成三层：

1. P0 治理 worktree 已经有一批治理文档、任务记录、设计/商业材料被 tracked。
2. 主工作区还有两份 tracked 进度文档修改：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
3. 主工作区还有大量 untracked 任务、工具状态、外部材料和预览文件。

因此，下一步不能直接整包同步主工作区，也不能直接清理主工作区。应先从 `origin/main` 或 P0 治理基线开干净分支，按文件预算手工迁入被确认的结论。

## 核验命令

```bash
# P0 worktree
git status -sb
git log --oneline -5
git ls-files <target-paths>
git status --short --untracked-files=all <target-paths>

# 主工作区
git status -sb
git rev-list --left-right --count main...HEAD
git ls-files --others --exclude-standard -z
git diff --stat -- docs/progress/current-progress.md docs/progress/next-tasks.md
du -sh .ccg .product-pm .superpowers .workbuddy deliverables docs/business docs/design docs/superpowers opc-doc

# 风险扫描
git ls-files -z ... | perl -0ne 's/\0\z//; print $_,"\n" if /\.(pdf|png|jpe?g|pptx?|docx|zip)\z/i'
rg --hidden --no-ignore -n -i "(password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|BEGIN PRIVATE KEY|AKIA|TENCENT|BAIDU|OCR|COS_SECRET|DATABASE_URL|REDIS_URL)" ...
```

## 分支状态

| 工作区 | 分支 | 状态 |
| --- | --- | --- |
| P0 治理 worktree | `codex/normalization-truth-audit` | 从 `codex/project-normalization-p0` 切出，基线包含 3 个 P0 治理提交 |
| 主工作区 | `feature/interview-setup-redesign` | `main` 独有 29 / 当前分支独有 24，不能作为治理基线 |

## 目标路径 tracked 对齐

| 路径 | P0 tracked 数 | 主工作区 tracked 数 | 结论 |
| --- | ---: | ---: | --- |
| `.ccg/tasks` | 38 | 26 | 两边都已有 tracked 任务记录，但集合不同，不能按目录覆盖 |
| `docs/business` | 1 | 1 | P0 与主工作区都已有 tracked 商业 PDF，但主工作区另有 untracked 商业材料 |
| `docs/design` | 4 | 3 | P0 已有更多 tracked 设计材料；主工作区还有 untracked 动效/预览文件 |
| `docs/superpowers/plans` | 5 | 1 | P0 已有更多 tracked 计划文件；主工作区还有 untracked 计划 |
| `docs/decisions` | 1 | 1 | 主工作区另有 untracked `2026-06-17-smart-campus-jobfair-delivery-rules.md` |
| `deliverables` | 0 | 0 | 仅主工作区存在 untracked 内容 |
| `opc-doc` | 0 | 0 | 仅主工作区存在 untracked 内容 |
| `.product-pm` | 0 | 0 | 仅主工作区存在 untracked 内容 |
| `.superpowers` | 0 | 0 | 仅主工作区存在 untracked 内容 |
| `.workbuddy` | 0 | 0 | 仅主工作区存在 untracked 内容 |
| `.ccg/commander` | 0 | 0 | 仅主工作区存在 untracked 内容 |

## 主工作区 untracked 摘要

| 顶层路径 | untracked 条目数 | 体积 |
| --- | ---: | ---: |
| `.ccg` | 163 | 3.5M |
| `docs` | 14 | 包含 `docs/business` 1.9M、`docs/design` 188K、`docs/superpowers` 64K |
| `opc-doc` | 4 | 236K |
| `.superpowers` | 3 | 12K |
| `.workbuddy` | 3 | 16K |
| `.product-pm` | 2 | 36K |
| `deliverables` | 1 | 24K |

## 二进制/大文件风险

P0 worktree 当时已 tracked；2026-06-26 已在后续 docs 清理中移出 Git 并仓库外归档：

- `docs/business/AI求职打印服务终端-B2G-B2B2C线下就业服务终端解决方案.pdf`，约 20K，原件归档到 `其他文档/商业材料/PDF归档/`。

主工作区 untracked：

- `.ccg/tasks/archive/2026-06/campus-high-fidelity-ui/*.png`，7 个截图。
- `.ccg/tasks/archive/2026-06/campus-screenshot-faithful-redesign/*.png`，5 个截图。
- `docs/business/AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.pdf`
- `docs/business/职易达AI求职服务终端商业计划书.pdf`

处理建议：

- P0 已 tracked 的小 PDF 需要在 D 类外部材料任务中决定是否保留，不能在 T0 中删除。
- 主工作区 untracked PNG/PDF 不应整包入库，后续只允许在用户确认后做“仓库摘要 + 外部归档”。

## 敏感信息扫描结果

扫描命中了大量 `token`、`OCR`、`DATABASE_URL`、`JWT_SECRET` 等关键词。人工判断当前命中主要分为三类：

1. 文档术语或技术说明，例如 motion/design token、OCR 能力说明、成本中的 LLM Token。
2. API/session 设计说明，例如 `handoffToken`、`getToken()`、URL 会话 token。
3. 本地或示例环境变量，例如 `DATABASE_URL="postgresql://..."`、`REDIS_URL="redis://..."`、`JWT_SECRET="benefit-validation-***"`。

风险判断：

- 未在本轮证明存在真实生产密钥，但存在“示例 secret / URL / token 设计片段”被误判或误提交扩散的风险。
- C 类任务证据筛选和 D 类外部材料索引前，必须继续运行敏感词扫描，并对命中项做人工确认。
- `.ccg/tasks/*` 不能整包提交或整包删除。

## 进度文档状态

主工作区 tracked 修改：

- `docs/progress/current-progress.md`：新增约 314 行。
- `docs/progress/next-tasks.md`：新增约 48 行、删除约 6 行。

行数：

- P0 worktree：`current-progress.md` 4290 行，`next-tasks.md` 1600 行。
- 主工作区：`current-progress.md` 4519 行，`next-tasks.md` 1589 行。

结论：

- B 类进度文档已明显过大，T1 必须做“当前事实摘要 + 历史分卷 + 下一步任务池”，不能继续把完整流水记录堆进主文档。
- 主工作区的新增内容包含 P0 补项、Claude CLI 修复、代码瘦身、设计预览清理、本地缓存清理等高价值结论，应在 T1 手工迁入摘要。
- T1 不应直接复制主工作区整段 diff；应提炼为当前阶段、验证证据、下一步任务和已停手范围。

## 后续执行建议

> 编号注记：T2 提案完成后，后续执行编号已调整为 T3=E 类本地工具落地、T4=C 类任务证据筛选、T5=D 类外部材料索引；以 `docs/progress/next-tasks.md` 为当前执行入口。

1. T1 `codex/normalization-progress-rollup`：从干净基线收口 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`，把主工作区高价值新增结论手工摘要迁入。
2. T2 `codex/normalization-ignore-proposal`：只写 E 类本地工具状态 ignore 提案，不直接改 `.gitignore`，等待用户确认本地工具状态。
3. T3 `codex/normalization-local-tools-landing`：用户确认后，先抽取 E 类目录中的 P0/P1 价值内容，再写确认后的 ignore 规则。
4. T4 `codex/normalization-evidence-triage`：只写 C 类任务证据筛选清单，优先识别 plan/review/verify/deploy/audit。
5. T5 `codex/normalization-external-materials-index`：处理 PDF/PNG/外部材料前，先确认仓库外归档位置。

## 本轮边界

本报告只新增 T0 事实对齐文档和任务记录。没有删除、移动、ignore、复制主工作区文件，也没有修改运行时代码。
