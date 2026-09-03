# AI求职打印服务终端 - Codex 项目说明

> 本文件供 Codex 阅读。Claude Code 对应文件：CLAUDE.md

---

## 项目定位

AI求职打印服务终端 = AI简历服务 + 打印扫描 + 求职材料服务 + 第三方岗位信息入口 + 招聘会信息入口 + 线下一体机运营后台。

**不是招聘平台。公司暂无人力资源服务许可证。**

用户主要在 27 寸竖屏触控显示器上使用，兼容手机和桌面浏览器。

---

## 合规红线（每次开发前必读）

以下功能**绝对不能开发**：

1. 平台内一键投递
2. 平台内收取求职者简历给企业
3. 企业端候选人筛选
4. 企业端面试邀约
5. 企业端 Offer 管理
6. 候选人推荐给企业
7. 自营网络招聘闭环
8. 企业自主发布岗位并直接收简历

岗位和招聘会只能作为第三方/官方来源信息入口。

合规按钮文案：去来源平台投递 / 扫码投递 / 去来源平台预约 / 扫码预约  
禁止文案：一键投递 / 立即投递 / 平台投递

**两条 2026-09-02 的更新，动手前先读**：

1. 上面八条在**当前仍全量有效**。产品负责人已定性「招聘闭环拿证后启用」，但未取得人力资源服务许可证前一律不得开发；判据是 `services/api/src/common/recruitment-capability.ts` 的 fail-closed 闸门（当前零调用点）。哪几条属永久边界、哪几条属许可证解锁类，分类**尚待签字**，未签字前不得按分类放宽任何一条。
2. 用户**本人自填**的求职进度**不在**这八条禁止范围内 —— 平台既不收简历也不转交，不构成平台内投递。它已经产品负责人具名授权，但有六条硬边界（不得从第三方回流、不得回传企业、不得按企业聚合等），动它之前必须读 compliance-boundary.md §4.4A，不要只按本页判断。

详见：[docs/compliance/compliance-boundary.md](docs/compliance/compliance-boundary.md)

---

## 技术栈

前端：React + Vite + TypeScript + Tailwind CSS + shadcn/ui + lucide-react  
后端：NestJS 或 FastAPI + PostgreSQL + Redis + BullMQ  
存储：MinIO / 阿里云 OSS / 腾讯 COS  
终端 Agent：Windows 本地 Node.js/.NET/Python

---

## 目录结构

当前物理目录仍采用标准 monorepo 结构；目录职责索引详见：[docs/project-structure.md](docs/project-structure.md)。当前阶段不做物理目录迁移。

```
apps/kiosk/          # 一体机前台
apps/miniapp/        # 原生微信小程序（唯一发布源）
apps/admin/          # 管理员后台
apps/partner/        # 合作机构后台
apps/terminal-agent/ # Windows 本地 Agent
services/api/        # 后端 API
services/worker/     # 打印/AI/同步任务
packages/ui/         # 公共 UI 组件
packages/shared/     # 公共类型和工具
docs/                # 所有文档
```

> `legacy-miaoda/` 已于 81724b73（2026-06-05）移出仓库，仅存于 tag `archive/legacy-miaoda-20260605`。不要按它规划目录或开发。

---

## AI 协作分工

| 角色 | 职责 |
|------|------|
| Claude Code | 主力开发（apps/、services/、packages/） |
| Codex | 方案审查、代码 review、需求整理、UI/UX 审查、关键问题修复、docs/ 维护 |

两者共用同一 Git 仓库，不分叉副本。

详见：[docs/decisions/ai-collaboration-rules.md](docs/decisions/ai-collaboration-rules.md)

---

## 跨模型接力规则

本项目不新增独立的 handoff / 交接记录文件，避免多模型读取时把临时记录误当成正式需求。

任意模型、任意设备接手前，必须先读取以下正式入口文档：

1. `AGENTS.md` 或 `CLAUDE.md`
2. `docs/progress/current-progress.md`
3. `docs/progress/next-tasks.md`
4. `docs/product/feature-scope.md`
5. `docs/compliance/compliance-boundary.md`
6. `.ccg/spec/guides/index.md`（若存在）
7. `docs/README.md`

记录保存规则：

- 当前阶段、已完成内容、下一步任务：写入 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`
- Claude 当日开发摘要、协作收尾、demo 链路：写入 `docs/progress/today-claude.md`
- 删除、清理、移除页面或文件：必须写入 `docs/progress/current-progress.md` 的更新记录，并保留 Git commit
- 合规边界、角色边界、长期产品约束：写入 `docs/compliance/` 或 `docs/product/`
- 不把完整聊天记录写入仓库；只沉淀可执行结论、验证结果和关键决策

聊天记录、截图、临时总结只能作为辅助背景，不是项目事实来源。若文档之间存在冲突，以当前 Git 最新提交、`current-progress.md` 的当前阶段、以及实际代码验证结果为准；无法判断时先做审查报告，不直接写功能代码。

---

## 工程规模控制

详见：[.ccg/spec/guides/index.md](.ccg/spec/guides/index.md)

后续开发必须先确认任务范围和文件预算，再做方案审查，审查通过后才写代码。禁止为了“看起来完整”继续堆重复入口、占位页面、假数据闭环、临时脚本和无验证代码。

单文件体积按以下阈值控制：300 行以内为理想状态，500 行以上新增功能前必须评估拆分，800 行以上不得继续堆新功能，1000 行以上进入重构/拆分清单。生成文件、迁移快照和必要静态快照除外。

删除旧代码必须有证据：无路由引用、无 import 引用、无测试/verify 依赖、无当前文档声明、不会被生产部署或硬件链路使用。删除、隐藏、迁移页面或功能后必须同步 `docs/progress/current-progress.md`，并跑最小相关验证。

### 标准化执行口径

项目已经定过标准化结构：当前采用 `apps/`、`services/`、`packages/` 的 monorepo 结构，正式目录职责以 `docs/project-structure.md` 为准，工程规模和反堆砌规则以 `.ccg/spec/guides/index.md` 为准。后续不要另起一套并列标准，也不要因为“重新统一”而从零重写项目。

后续 Claude、Codex 或其他模型推进功能、修复、重构时，默认执行口径是：保留已验证能力，按现有标准渐进式规范化。每个任务开始前必须写清：

- 本任务对应哪个真实功能闭环或上线阻塞。
- 允许修改哪些文件，禁止修改哪些文件。
- 是否新增入口、页面、数据模型、服务或外部依赖；如新增，必须说明为什么现有能力不能复用。
- 是否触碰岗位、招聘会、简历、文件、打印、生产配置、数据库、密钥或硬件链路。
- 需要执行哪些 typecheck、lint、build、verify、浏览器或真机验证。
- 是否需要同步 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、`docs/product/feature-scope.md` 或 `docs/compliance/compliance-boundary.md`。

禁止事项：

- 不新增第二套“项目标准”或临时 handoff 文档来替代正式入口文档。
- 不在当前上线前收口阶段做物理目录迁移；如未来必须迁移，按 `docs/reviews/project-directory-migration-impact.md` 从干净 `main` 或独立 worktree 分阶段执行。
- 不以降低代码量为理由删除已验证闭环、CI/verify 门禁、合规防线或硬件适配代码。
- 不把标准化执行变成大范围重写；只能按业务闭环、文件预算和验证门禁逐步收口。

治理分支启动规则：

- 默认采用从干净 `main` 新建独立分支的方式推进治理、迁移或清理。
- 如旧分支仍有价值，只能在新分支中选择性提取经过复核的提交、文件或文档结论；不得直接复活落后 `main` 很多的旧分叉继续开发。
- 旧 worktree / 旧分支在删除前必须先做只读盘点，确认工作区干净、内容已被 `main` 覆盖或已完成迁移，并明确不触碰受保护的候选功能分支。
- 如果旧分支 tip 已被 `main` 覆盖但对应 worktree 仍有未提交改动，必须把 worktree 视为候选功能资产；未完成迁移或明确废弃前不得 `worktree remove` 或删本地分支。
- 远程分支清理必须区分真实远程 head 与本地 stale remote-tracking ref；未授权前不得用 `git remote prune` 或 `git gc` 作为“顺手清理”。
- 堆叠分支清理只能在证明祖先关系后删除中间分支名；必须保留仍承载独有能力的基础锚点或顶层候选分支，直到对应能力迁移或明确放弃。

---

## 当前进度

本文件不再复制阶段流水，避免与实际代码、远程 `main` 和生产部署状态漂移。接手任务时按以下顺序判断：

- 当前阶段与已完成事项：[docs/progress/current-progress.md](docs/progress/current-progress.md) 顶部活动快照。
- 唯一交付阻塞与下一步：[docs/progress/next-tasks.md](docs/progress/next-tasks.md) 顶部清单。
- 小程序、一体机、管理员后台、合作机构后台的实现 / 开放 / 线上状态：[docs/product/feature-scope.md](docs/product/feature-scope.md) §1.2。
- 代码事实：精确的 `origin/main@SHA`；生产事实：服务器 `DEPLOY_SOURCE.txt`、PM2、nginx Web Root 与健康检查。

禁止把本地候选、CI 通过、历史真机证据或原型页面写成“已部署 / 已上线 / 当前真机已通过”。

---

## 硬件

**打印机：奔图 CM2800/CM2820 系列彩色激光多功能一体机**

- Windows 驱动识别名称（真机确认）：`Pantum CM2800ADN Series`
- **代码中必须通过 `printerName` 配置项指定，禁止硬编码任何型号字符串**
- 硬件支持彩色打印；但奔图开放打印 API 的彩色 mode 取值 **TODO**（待厂家确认，不得假设为 `"color"`）

详见：[docs/device/pantum-cm2820adn.md](docs/device/pantum-cm2820adn.md)  
Agent 设计：[docs/device/windows-terminal-agent-design.md](docs/device/windows-terminal-agent-design.md)  
奔图 API 规范（预留）：[docs/device/pantum-api-design.md](docs/device/pantum-api-design.md)

---

## 重要提醒

- 不要假设打印机支持 A3 或云端远程扫描。
- 每次修改后更新 docs/progress/current-progress.md。
