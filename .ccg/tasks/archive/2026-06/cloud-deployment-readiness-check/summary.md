# Cloud Deployment Readiness Check

日期：2026-06-15

## 判断

可以先部署线上服务器，定位为预生产 / 线上联调环境。硬件未到不阻塞服务器、PostgreSQL、Redis、COS、API、三端前端、AI/OCR 等服务端链路部署。

不得宣称正式生产上线完成；Windows 真机、Terminal Agent、打印出纸、扫描、U 盘、断网恢复仍必须等硬件到位后验收。

## 当前可先上云

- `services/api` 后端 API。
- Kiosk / Admin / Partner 三端前端静态资源。
- PostgreSQL 生产库：`db:pg:generate`、`db:pg:deploy`、`db:pg:sync:check`、seed、核心 verify。
- Redis 生产连接。
- COS 私有桶与签名 URL。
- 百度 OCR、AI 大模型、TRTC/ASR/TTS 服务端 env 与 live 冒烟。
- nginx / HTTPS / PM2 或 systemd / 日志轮转 / 健康检查。
- 线上浏览器闭环：登录、AI 简历、模拟面试、岗位/招聘会/政策浏览收藏跳转、我的文档、打印订单记录等非硬件链路。

## 必须等硬件

- Terminal Agent 在 Windows 主机安装与服务自启。
- `printerName` 用 Windows 实际识别名填写。
- 奔图真机真实出纸。
- 扫描链路、U 盘导入。
- 断网、重启、失败回传、现场小范围试运营。

## 部署关键约束

- 部署版本应从干净 `main` 或确认后的上线分支开始，不混入未确认 UI/UX 改动。
- 三端生产构建必须注入 `VITE_API_MODE=http` 和 `VITE_API_BASE_URL=/api/v1`。
- API 生产必须 `DATABASE_URL=postgresql://...`，不能连 SQLite。
- `FILE_STORAGE_DRIVER=cos`，否则文件会落本机磁盘。
- `REDIS_URL` 生产必配。
- 短信审核未通过前不要把会员短信登录作为正式能力对外开放；若 `NODE_ENV=production`，`SMS_PROVIDER=log` 会被代码拒绝。
- 当前 Kiosk 扫描在 http 模式会诚实提示“真机扫描待接入”，不会假装闭环。

## 主要参考

- `docs/device/production-deployment-runbook.md`
- `docs/device/production-deployment-and-windows-host-checklist.md`
- `docs/device/postgres-operations.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
