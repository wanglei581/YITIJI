# 当前开发进度

> 最后更新：2026-06-20
> 入口用途：只记录当前阶段、已验证结论、待确认边界和下一步任务入口。历史长记录文本已归档到 `docs/progress/archive/2026-06-20-current-progress-pre-normalization.md`；归档时行尾空格按仓库 whitespace 检查规范化。
> 关联文档：[CLAUDE.md](../../CLAUDE.md) | [feature-scope.md](../product/feature-scope.md) | [project-structure.md](../project-structure.md) | [normalization-truth-audit](../reviews/project-normalization-truth-audit.md)

## 当前阶段

项目进入“上线前收口 + 项目规范化治理 + 渐进式重构准备”阶段。当前不做全量重写，也不在旧结构里继续堆功能；采用现有仓库、干净 worktree、按业务闭环渐进迁移的方式推进。

当前有效原则：

- 一窗口 = 一任务 = 一分支。
- 禁止 `git add .`，所有暂存必须显式列路径。
- `apps/`、`services/`、`packages/` 属运行时代码，规范化任务默认不触碰。
- 删除、ignore、大文件外部归档、主工作区物料迁入前必须先确认并双模型审查。
- 岗位 / 招聘会 / 政策继续只做第三方或官方来源信息入口；项目不是招聘平台。

## 规范化治理已完成

| 日期 | 分支 / 提交 | 结论 |
| --- | --- | --- |
| 2026-06-20 | `codex/project-normalization-p0` / `de212131` | 建立目录治理基线：`docs/project-structure.md`、`.ccg/spec/guides/index.md`、AGENTS/CLAUDE 入口同步。 |
| 2026-06-20 | `codex/project-normalization-p0` / `940e7485` | 输出主工作区分类规则，确认不新建仓库、不整包迁移、不直接清理主工作区。 |
| 2026-06-20 | `codex/project-normalization-p0` / `f54eacd3` | 固化 Codex + Claude + Antigravity 协作模式：Claude 做只读草案，Codex 落盘验证，双模型复审中高风险。 |
| 2026-06-20 | `codex/normalization-truth-audit` / `59d930ad` | 完成 T0 真值对齐，确认 P0 tracked、主工作区 tracked 修改、主工作区 untracked 物料三层并存。 |

## 当前工作区事实

P0 治理 worktree：`/Users/wanglei/.config/superpowers/worktrees/AI求职打印服务终端/project-normalization-p0`。

主工作区：`/Users/wanglei/AI求职打印服务终端`，分支 `feature/interview-setup-redesign`。截至 T0 报告，主工作区相对 `main` 为 `main` 独有 29 / 当前分支独有 24；不能作为规范化治理基线。

主工作区仍有：

- tracked 修改：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- untracked：`.ccg/tasks/`、`.ccg/commander/`、`.product-pm/`、`.superpowers/`、`.workbuddy/`、`docs/business/`、`deliverables/`、`opc-doc/`、`docs/design/`、`docs/superpowers/plans/`。

## 主工作区高价值新增结论（待后续按证据迁入）

T0 已确认主工作区进度文档中新增了若干高价值结论，但这些内容仍属于待收口输入，不代表已经进入当前治理分支的运行时代码：

- 机构类型矩阵后端硬约束：记录为已在独立 worktree 完成，涉及 `Organization.type -> sceneTemplate -> enabledModules`，需按对应分支/PR/验证证据复核后再归入正式完成项。
- Claude CLI 修复与代码瘦身首批清理：记录了 Claude auth 修复、旧入口/旧组件/旧设计预览/本地缓存清理等结论；需区分已入库代码、仅本地清理、仅文档记录。
- Kiosk 生产构建守卫与数字人构建变量：记录 `VITE_USE_TRTC_CALL`、`VITE_TERMINAL_ID`、`build:kiosk:production` 等门禁；正式生产仍需服务器构建与真机验证。
- 百度云预生产核心复验：记录 IP 预生产 HTTP / PostgreSQL / Redis / nginx / PM2 等链路；仍不等于正式生产上线。
- AI 简历上传账号资产须知、工程规模控制规范、代码瘦身最终核验等结论需要在对应任务分支或审查报告中逐条对齐。

## 当前产品与上线边界

已验证和可作为当前产品基础的能力仍以实际代码、CI、verify、浏览器/服务器/真机证据为准。长期边界不变：

- 生产就绪必须是 PostgreSQL + Redis + COS + 真实服务配置 + HTTPS/nginx + 生产运行时门禁。
- Windows 一体机、Terminal Agent、奔图打印/扫描、断网恢复和真实出纸仍需真机验收。
- AI/OCR/SMS/TRTC 等外部服务上线前需要生产密钥、权限、轮换和 live 冒烟。
- 本地 SQLite/browser 成功不能替代硬件或生产验收。

## 近期优先级

1. T1 进度文档收口：完成当前入口文档短版化，保留历史归档。
2. T2 E 类 ignore 提案：只写提案，不直接改 `.gitignore`，等待用户确认本地工具状态。
3. T3 C 类任务证据筛选：只写清单，优先保留 plan / review / verify / deploy / audit。
4. T4 D 类外部材料索引：PDF/PNG/PPT/DOCX/ZIP 先确认仓库外归档位置。
5. 首批业务闭环重构：从“我的页商用闭环”开始，按旧入口、新目录、验证命令、双模型审查、删除旧实现条件推进。

## 历史记录

历史流水文本请查阅：

- [2026-06-20 current-progress 归档](./archive/2026-06-20-current-progress-pre-normalization.md)
- [2026-06-20 next-tasks 归档](./archive/2026-06-20-next-tasks-pre-normalization.md)
