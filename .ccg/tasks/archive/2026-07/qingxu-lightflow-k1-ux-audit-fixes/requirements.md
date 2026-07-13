# 青序 LightFlow K1 UX 审查修正要求

## 目标

在不改变 K1 路由、认证、二维码票据、手机上传、待机播放和会话清理逻辑的前提下，修正 2026-07-13 视觉审查发现的可访问性与错误恢复问题，并把“功能排版”纳入静态合同。

## 允许修改

- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/src/layouts/KioskRoot.tsx`
- `apps/kiosk/src/pages/auth/LoginPage.tsx`
- `apps/kiosk/src/pages/auth/styles/login-form.css`
- `apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx`
- `apps/kiosk/src/pages/auth/mobile-qr-service-desk.css`
- `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- `apps/kiosk/src/pages/upload/phone-upload-service-desk.css`
- `docs/superpowers/plans/2026-07-13-qingxu-lightflow-k1-public-entry.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本任务目录

## 禁止修改

- 认证、二维码、上传、屏保 API 和状态机
- `services/api/**`、Prisma、DTO、权限、支付、打印、扫描、AI、TRTC、Terminal Agent
- K1 以外页面和路由
- 4188 演示数据、假登录、假上传、假播放列表

## 功能排版合同

1. 登录页协议选择、协议链接和发送验证码必须是并列的独立交互控件，不允许交互控件嵌套。
2. 同一个错误只由一个 `role=alert` 区域播报。
3. 手机扫码缺票据时，不再同时显示“正在识别”；页面只显示原因与“回到一体机刷新二维码”的唯一恢复动作。
4. 手机上传链接无效时，不显示可操作外观的文件选择器；只显示原因与回到一体机重新扫码的唯一恢复路径。
5. Kiosk 壳层不得把内部状态词 `idle` 直接展示给普通用户。
6. 待机屏有素材状态使用测试证据验证，不向生产代码注入假列表。

## 验证

- 先扩展 `verify:lightflow-k1-public-entry` 并证明 RED。
- 修正后运行 K1 三条静态 verify、Kiosk typecheck、lint、build、`git diff --check`。
- 浏览器覆盖 1080x1920、390x844、390x700；待机屏有素材证据与真实环境等级分开记录。
- 变更完成后执行 Antigravity 与 Claude 双模型审查。
