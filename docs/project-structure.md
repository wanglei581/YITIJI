# 项目目录结构

> 最后更新：2026-06-20
> 当前结论：本项目先做目录索引和治理规则，不做物理目录迁移。

本文件用于解释仓库里每个主要目录的职责。当前 `apps/`、`services/`、`packages/` 是 monorepo 常见结构，不是技术错误；上线前收口阶段优先保持运行链路稳定。

## 正式源码目录

- `apps/kiosk/`：一体机前台，面向 21.5 寸触控终端，同时兼容浏览器访问。
- `apps/admin/`：管理员后台，面向运营、设备、内容和业务数据管理。
- `apps/partner/`：合作机构后台，面向校企、公共就业、招聘会等外部合作机构。
- `apps/terminal-agent/`：Windows 本地 Terminal Agent，负责打印机、扫描仪、U 盘、扫码器、摄像头等硬件交互。
- `services/api/`：后端 API 服务，包含 NestJS 业务模块、Prisma schema、seed、迁移和服务级 `verify:*` 脚本。
- `services/worker/`：打印、AI、同步等异步任务队列预留目录。
- `packages/shared/`：跨端共享类型、协议、常量和工具。
- `packages/ui/`：跨端共享 UI 组件和样式基础。

`packages/` 是项目内部共享包，不是第三方依赖目录。第三方依赖由 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `node_modules/` 管理，不能手动搬运或整理 `node_modules/`。

## 正式文档目录

- `docs/progress/`：当前进度、下一步任务、阶段记录。
- `docs/product/`：产品范围、角色边界、功能矩阵和用户数据流。
- `docs/compliance/`：合规边界、备案、法务和上线审查材料。
- `docs/device/`：Windows 主机、Terminal Agent、打印机、部署和真机验收文档。
- `docs/design/`：视觉规范、动效方案、设计评审。
- `docs/api/`：API 设计、接口适配和服务契约。
- `docs/reviews/`：审查报告、影响评估和只读审计结论。
- `docs/superpowers/`：计划文档和技能流程产物。

## 交付与外部材料

- `deliverables/`：对外交付材料、产品策略输出和可归档成品。
- `docs/business/`：商业计划、路演、评审、竞赛和合作材料。
- `opc-doc/`：OPC 相关材料和输出，按交付物管理，不作为运行时代码。

这些目录可以包含面向外部的文档或 PDF，但不应混入运行时代码、密钥、真实用户数据或临时缓存。

## 协作与任务记录

- `.ccg/`：CCG 任务、规范和多模型协作记录。
- `.superpowers/`：Superpowers 流程工作目录。计划、规格或审查证据需按价值分类；运行状态、临时服务 PID、浏览器缓存等不作为正式项目事实。
- `.mavis/`、`mavis-workspace/`：Mavis 相关规划或历史协作材料。
- `.worktrees/`：本地隔离工作区目录，不作为正式源码。

这些目录用于协作和任务追踪。正式产品事实仍以 `AGENTS.md` / `CLAUDE.md`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、`docs/product/feature-scope.md`、`docs/compliance/compliance-boundary.md` 和本文件为准。

## 临时与生成目录

以下内容默认不进入正式 Git 跟踪范围，除非有明确交付理由：

- `node_modules/`
- `dist/`
- `coverage/`
- `.tmp/`
- `outputs/`
- `.DS_Store`
- 本地 `.env`、密钥备份、数据库备份、真实用户文件

如果需要保留截图、录屏、PDF 导出或验收证据，优先放到交付目录或外部归档；仓库内只保留能证明结论的少量关键文件，并在文档中说明用途。

## 未来物理迁移边界

当前不执行物理目录迁移。若未来确实要把目录改成 `frontend/`、`backend/`、`terminal/`，必须满足：

1. 从干净 `main` 或独立 worktree 开始，不混入业务功能改动。
2. 先完成迁移影响评估。
3. 使用 `git mv` 分阶段迁移，不手动复制目录。
4. 每阶段单独 commit，不使用 `git add .`。
5. 跑完 workspace、CI、前端构建、API verify、PostgreSQL readiness、Terminal Agent 和本地启动验证。
6. 再调用 Claude 与前端模型做双模型审查。
