# 青序 LightFlow 最新主线整合需求

## 目标

从最新 `origin/main` 创建独立本地整合候选，迁入 `codex/qingxu-lightflow-k2-20260713` 已完成的 K1/K2 青序 LightFlow 成果，并重新完成工程与浏览器验收。

## 允许范围

- Kiosk K1 公共入口、首页与登录弹窗、AI 助手及语音咨询、岗位匹配、职业规划、AI 简历九页、面试五页、`/profile` 主入口的候选文件。
- 上述范围对应的静态 verify、Kiosk package scripts、CI 接线和 LightFlow CSS/组件。
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 与本任务 CCG 记录。

## 禁止范围

- 不修改 `/me/*` 明细页的认证、订单、资产、支付和业务逻辑。
- 不修改 Admin、Partner、API、Prisma、Worker、Terminal Agent、支付、打印或扫描运行时。
- 不新增入口、路由、假数据、演示登录、平台投递或招聘闭环。
- 不 push、不创建 PR、不部署、不触发真实短信、TRTC、支付、打印或真机动作。

## 验收

- 合并只解决真实冲突，不覆盖最新主线功能。
- K1、Home、K2a、K2b、K2c、4188 布局、Profile、登录与 TRTC 静态门禁通过。
- Kiosk typecheck、lint、production build 与 `git diff --check` 通过。
- 1080×1920、390×844、390×700 浏览器矩阵覆盖首页、AI 助手、语音弹层和我的主入口。
- Antigravity 与 Claude 分析、终审均取得有效结论；Critical 必须清零。
