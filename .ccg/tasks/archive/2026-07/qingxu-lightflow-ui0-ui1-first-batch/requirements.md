# 青序 LightFlow UI-0 / UI-1 第一批需求

## 目标

在不改变路由、API、权限、认证、支付、打印、扫描、AI、TRTC、Terminal Agent 和业务状态机的前提下，建立青序 LightFlow 共享视觉基础，并迁移 Kiosk 首页、Admin 工作台、Partner 岗位管理三个代表页。

## 事实与边界

- 产品与设计名称为「青序 LightFlow」；工程内部保留 `service-desk` 命名。
- 本批最高只能以本地真实 HTTP 和角色浏览器证据达到 UX-2；不宣称预生产、真机或商用上线完成。
- 不修改 `ProfilePage`、任何 `/me/*` 页面或吸收「我的页商用闭环」worktree 改动。
- 不新增或删除入口、底部 Tab、菜单、路由、业务卡片或外部依赖。
- 保留真实数据、加载、空态、错误、重试、权限、禁用、返回路径和现有入口；不引入 4188 假数据或演示登录。

## 文件预算

权威清单为 `docs/superpowers/plans/2026-07-11-service-desk-ui0-ui1-first-batch.md` 第 2 节 Batch A–E。任何超出该清单的运行时、脚本或文档修改都必须停止。

## 验证

- TDD：每批先写静态 verify 并观察预期 RED，再实现 GREEN。
- 工程：UI 包与三端 typecheck、lint、production build、新旧 verify、`git diff --check`。
- 浏览器：Kiosk 1080×1920 / 390×844 / 390×700；Admin/Partner 1440×1024 / 1280×800 / 1024×768。
- 审查：超过 30 行，必须并行调用 Antigravity 和 Claude；无效调用不计为审批。
