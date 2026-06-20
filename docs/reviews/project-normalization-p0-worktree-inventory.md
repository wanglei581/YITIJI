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
