# 项目规范化 P0 工作区盘点

> 生成时间：2026-06-20
> 基线：`codex/project-normalization-p0` 基于 `origin/main` 的隔离 worktree

## 当前策略

本项目继续使用现有 Git 仓库，不新建仓库，不复制一套新项目。P0 治理在独立 worktree 中执行，用于保护主工作区当前的未提交与未跟踪内容。

## 当前主工作区状态摘要

主工作区路径：`/Users/wanglei/AI求职打印服务终端`

状态要点：

- 当前分支：`feature/interview-setup-redesign`
- 与 `main` 分叉，不能直接作为规范化治理基线。
- 相对 `main`：当前分支 `24 ahead / 29 behind`，不能把当前工作树直接当作上线前治理分支。
- 已跟踪修改主要集中在：
  - `docs/progress/current-progress.md`
  - `docs/progress/next-tasks.md`
- 未跟踪内容主要集中在：
  - `.ccg/tasks/`
  - `.ccg/commander/`
  - `.superpowers/`
  - `.product-pm/`
  - `.workbuddy/`
  - `docs/business/`
  - `deliverables/`
  - `opc-doc/`
  - `docs/design/`
  - `docs/superpowers/plans/`

## 2026-06-20 实际盘点结果

盘点命令：

```bash
git status -sb
git ls-files --others --exclude-standard | awk 'BEGIN{FS="/"} {count[$1]++} END{for (k in count) print count[k], k}' | sort -nr
du -sh .ccg .product-pm .superpowers .workbuddy deliverables docs/business docs/design docs/superpowers opc-doc 2>/dev/null | sort -h
```

盘点结论：

- 主工作区仍停留在 `feature/interview-setup-redesign`，不是本次 P0 治理提交的工作区。
- 已跟踪修改只有 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`，属于 B 类，应单独做进度文档收口。
- 未跟踪文件数量最多的是 `.ccg/`，约 163 个未跟踪条目，目录体积约 3.5M。
- 外部材料体积主要集中在 `docs/business/`，约 1.9M，包含 Markdown、PDF、评审报告和商业计划书。
- `docs/design/` 约 188K，既有正式设计规范，也有 HTML 动效预览，不能整目录一刀切处理。
- `opc-doc/` 约 236K，包含状态 JSON 和输出材料，更接近外部材料工作台，不应混入源码治理提交。
- `.product-pm/`、`.workbuddy/`、`.ccg/commander/`、`.superpowers/brainstorm/*/state/` 具有明显本地工具或运行状态特征，默认不应入库。

## 当前未跟踪项处理建议

| 路径或目录 | 当前判断 | 建议处理 | 备注 |
| --- | --- | --- | --- |
| `docs/progress/current-progress.md` | B 类，正式项目事实 | 单独收口提交 | 只保留当前阶段、验收结论、关键阻塞；历史长记录后续分卷 |
| `docs/progress/next-tasks.md` | B 类，正式项目事实 | 单独收口提交 | 拆成可执行任务池，避免混入聊天式记录 |
| `.ccg/tasks/` | C 类，任务与审查证据 | 分批筛选归档 | 保留有计划、验证、审查、部署证据的任务；丢弃 ack/advise/explain 等低价值临时任务前需用户确认 |
| `.ccg/commander/` | E 类，本地协作工具状态 | 倾向 ignore 或删除 | 包含 inbox/outbox/heartbeat/bridge 脚本，先确认是否仍被用户使用 |
| `.product-pm/` | E 类，本地产品工具状态 | 倾向仓库外保存或 ignore | 若有 PRD 价值，应抽取摘要进正式 docs，而不是整目录入库 |
| `.superpowers/` | C/E 混合 | 只保留计划或审查证据 | `brainstorm/*/content/*.html` 需按设计价值筛选；`state/server.pid` 等运行状态应删除或 ignore |
| `.workbuddy/` | E 类，本地记忆 | 不入库 | 属个人工具记忆，不应成为项目事实来源 |
| `docs/superpowers/plans/` | C 类，计划证据 | 筛选入库 | 保留与当前路线相关的计划；过期或重复计划归档到外部或删除 |
| `docs/design/visual-design-spec.md` | B/C 类，正式设计依据 | 建议保留 | 属设计系统和页面风格依据 |
| `docs/design/motion-system.md` | B/C 类，正式设计依据 | 建议保留 | 属动效规范依据 |
| `docs/design/*.html` | C/D 类，预览物料 | 单独确认 | 若只是临时预览，不应直接进入主仓库；可归到设计归档 |
| `docs/business/` | D 类，外部商业材料 | 单独外部材料任务 | PDF/商业计划书是否入库需用户确认，源码治理提交不得夹带 |
| `deliverables/` | D 类，外部交付材料 | 单独外部材料任务 | 可保留摘要，避免交付物与运行代码混杂 |
| `opc-doc/` | D/E 混合 | 仓库外归档优先 | `state/*.json` 是工具状态，`outputs/*` 可按交付价值筛选 |

## 第一批执行建议

1. 先处理 B 类进度文档：从 `main` 新开干净分支，只收口 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`，不碰任何未跟踪目录。
2. 再处理 E 类本地工具状态：确认 `.ccg/commander/`、`.product-pm/`、`.workbuddy/`、`.superpowers/*/state/` 是否仍需保留；确认后再写 `.gitignore` 或删除清单。
3. 然后处理 C 类任务证据：从 `.ccg/tasks/` 和 `docs/superpowers/plans/` 中筛选真正有审查/验证/决策价值的内容，按主题归档，不整包提交。
4. 最后处理 D 类外部材料：`docs/business/`、`deliverables/`、`opc-doc/` 单独决策，优先“仓库保留摘要 + 大文件仓库外归档”。

本报告只记录盘点和建议，不删除、不移动、不 ignore 主工作区任何文件。

## 分类规则

### A 类：正式源码与运行链路，默认保留

- `apps/`
- `services/`
- `packages/`
- `.github/workflows/`
- `pnpm-workspace.yaml`
- `package.json`
- `tsconfig.base.json`

这些目录和文件不按“工作区清理”处理。任何改动必须另起业务或工程任务。

### B 类：正式项目事实，按文档收口

- `AGENTS.md`
- `CLAUDE.md`
- `docs/progress/`
- `docs/product/`
- `docs/compliance/`
- `docs/device/`
- `docs/project-structure.md`
- `.ccg/spec/guides/index.md`

这些内容进入仓库，但必须控制体积和职责。`current-progress.md` 应保留当前阶段和高信号结论，历史长记录后续分卷归档。

### C 类：任务与审查证据，按价值归档

- `.ccg/tasks/*`
- `.superpowers/` 中的计划、规格、审查证据
- `docs/superpowers/plans/*`
- `docs/reviews/*`
- `docs/decisions/*`

有审查、计划、验证或长期决策价值的内容可以进仓库；聊天确认、ack、临时 advise、重复任务目录不应混入正式提交。

### D 类：外部材料，单独归档

- `docs/business/`
- `deliverables/`
- `opc-doc/`

这些目录不属于运行时代码。可按对外交付材料保留轻量 Markdown 摘要；PDF、演示稿、竞赛材料是否进仓库需单独确认。

### E 类：本地工具和缓存，倾向 ignore 或删除

- `.product-pm/`
- `.workbuddy/`
- `.ccg/commander/`
- `.superpowers/` 中的运行状态、临时服务 PID、浏览器缓存
- `.tmp/`
- `outputs/`
- `.DS_Store`

这些内容默认不作为项目事实。后续任务先检查是否有用户确认或正式引用，再决定 ignore、外部归档或删除。

## P0 执行顺序

1. 在干净治理分支落地目录索引与工程规范。
2. 输出工作区分类规则，不直接删除主工作区文件。
3. 用户确认后，再按类别处理主工作区未跟踪项。
4. 每一类单独提交，禁止 `git add .`。

## 禁止事项

- 不在当前 P0 分支中迁移源码目录。
- 不将当前主工作区未跟踪项整包复制进新分支。
- 不把商业 PDF、缓存目录、工具状态文件混入源码提交。
- 不触碰生产门禁、auth、DB、crypto、Terminal Agent、打印扫描链路。
