# 青序 LightFlow 最新主线整合计划

## Task 1：建立干净基线

- [x] 从最新 `origin/main` 创建独立 worktree 和 `codex/qingxu-lightflow-integration-20260714`。
- [x] 安装工作区依赖并运行 Kiosk typecheck 基线。
- [x] 记录当前主线、候选、merge-base 与双方提交差异。

## Task 2：只读审计与策略冻结

- [x] 由两个子代理分别审计 Git 重叠和产品范围，第三个子代理输出验证矩阵。
- [x] 并行调用 Antigravity 与 Claude 分析整合风险。
- [x] 使用 `git merge-tree` 确认冲突文件和自动合并结果。

## Task 3：迁入本地候选

- [x] 在整合分支合并 `codex/qingxu-lightflow-k2-20260713`，保留候选提交历史。
- [x] 代码冲突以最新主线业务逻辑为底，叠加候选视觉；进度文档保留双方事实并消除过期计数。
- [x] 检查 diff 只包含允许范围，没有 `/me/*` 明细、后台、后端、支付或终端运行时改动。

## Task 4：工程与浏览器验收

- [x] 运行全部 LightFlow/K1/K2/登录/TRTC 静态门禁。
- [x] 运行 Kiosk typecheck、lint、带 TRTC 的 production build 和 `git diff --check`。
- [x] 启动本地预览，完成 1080×1920、390×844、390×700 浏览器矩阵和关键交互截图。

## Task 5：终审与闭环

- [x] 并行调用 Antigravity 与 Claude 审查最终 diff。
- [x] 修复所有 Critical/Warning 后复审。
- [x] 更新进度 SSOT，写入 `review.md`，归档 CCG 任务并创建本地提交。
- [x] 保留分支/worktree，等待用户另行决定是否 push/PR。

## Task 6：执行期间主线漂移收口

- [x] 拉取并合入执行期间从 `e9802596` 前进到 `9d0622e7` 的最新 `origin/main`。
- [x] 确认 25 个新增提交仅涉及 Scan Session B1，和 LightFlow 整合文件无交集。
- [x] 复跑 Kiosk 工程门禁、关键 LightFlow 静态合同、范围检查与浏览器冒烟。
- [x] 复审最终双父合并结果，更新 SSOT、归档任务并创建本地闭环提交。
