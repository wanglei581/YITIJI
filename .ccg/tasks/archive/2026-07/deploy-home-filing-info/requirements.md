# 需求与范围

## 真实闭环

在网站首页最底部展示备案信息与品牌文字，并将经过验证的 Kiosk 静态包部署到 `zyidai.cn`，使线上首页真实可见。

## 展示内容

`鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号 · 职易达AI`

- ICP 备案号链接工信部备案系统。
- 公安备案号链接公安部备案查询。
- `职易达AI` 为普通品牌文字，不新增外链。

## 允许修改

- `apps/kiosk/src/pages/home/HomePage.tsx`
- `apps/kiosk/src/styles/prototype-v1.css`
- `apps/kiosk/scripts/verify-home-prototype-v1.mjs`
- `apps/kiosk/tests/visual/fusion-smoke.spec.ts`
- `docs/progress/current-progress.md`
- `.ccg/tasks/deploy-home-filing-info/**`（完成后归档）

## 禁止修改

- API、数据库、Admin、Partner、Terminal Agent、打印扫描业务逻辑。
- 生产密钥、环境变量值、bridge token、PM2/API 进程。
- 现有首页入口、路由和业务卡片。

## 生产约束

- 仅替换 Kiosk `apps/kiosk/dist`，部署前备份现网目录。
- 构建必须保留现网 `VITE_TERMINAL_AGENT_BRIDGE_TOKEN` 注入状态；不得输出或提交 token。
- 不 reload PM2，不修改 API/Admin/Partner/数据库/Redis。
- 记录回滚路径、bundle 名称与非敏感部署元数据。

## 验证

- 首页 prototype/Fusion/窄屏静态合同。
- Kiosk typecheck、lint、production build config。
- Playwright 1080×1920 与 390×844 双视口 smoke。
- 部署后 HTTPS HTML/bundle、备案文字、`职易达AI`、API health 及 bridge token 注入标记只读复验。
