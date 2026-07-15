# 实施计划

## 1. 先建立 Admin 安全状态机与契约

文件：新 `admin-initial-phone-bind.service.ts`、OTP 常量、AuditAction 两份类型、AuthModule、AuthController、DTO（只在 main 缺字段时）、隔离 API verifier。

- 从 main 当前通用 `InitialPhoneBindService` 保留 Partner 行为。
- 新服务只处理 Admin，使用 300 秒 ticket 与 tokenVersion CAS。
- 新 Admin 路由由 Admin 页面调用。
- 通用 `/auth/phone/initial-bind/*` 按 Guard 注入的 JWT 当前角色分派：Admin 委派严格服务，Partner 保持原服务，未知角色拒绝；不接受 body 角色字段，消除 Admin 绕过。
- 先在 existing verifier 添加 Admin 安全、TTL、并发、旧通用路径 Admin 委派的 RED 断言，再实现。

## 2. 再分流 Admin 与 Partner 页面

文件：Admin auth adapter、账号设置入口页、新 Admin 卡片、静态 UI verifier；必要时仅更改现有 Partner/通用卡片的导出/props，不改其业务流程。

- Admin 调 `/auth/admin/phone/initial-bind/*`，使用独立 local-only state 和所有已验证恢复语义。
- `AccountSettingsPage` 只在已加载的 Admin 未绑定状态显示 Admin 卡片；现有 Admin app 无 Partner 会话入口，Partner 后端能力不改且不新增 UI。
- 对 Admin 通用 adapter 路径不提供 UI，删除 Admin 页面上的 `PhoneBindingCard` 导入与入口，避免重复入口。
- 先扩展 static verifier RED，再实现。

## 3. 验收、复审与进度同步

- 分别运行 API isolated verifier/typecheck/lint 与 Admin verifier/typecheck/lint/build。
- 复审全 diff，确认 Partner main 能力未被删改、Admin 通用路由无绕过、文件范围与文档一致。
- 在正式进度文档写明本地证明与未做的外部/生产验收。
- 不推送、不开 PR、不部署；等待后续明确授权。
