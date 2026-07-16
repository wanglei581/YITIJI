# Wave 0 开工约束

## 功能归位

- **真实业务闭环：** 让既有 Kiosk 用户中心和登录页面只暴露已经接真的能力，并防止隐私数据请求在未执行导出或分类删除时被伪造为完成。
- **前端：** `apps/kiosk/src/pages/profile/**`、`apps/kiosk/src/pages/auth/**`；只收口既有入口、登录方式和设置页文案，不新增路由、首页卡片或底部 Tab。
- **后端：** `services/api/src/member-privacy/**`；仅收紧 `UserDataRequest` 的现有状态转换，不新增模型、迁移或第二套隐私账本。
- **终端 Agent：** 不涉及。
- **共享类型 / 共享 UI：** 不涉及；Wave 0 不新增跨端契约。
- **文档：** 仅在全部门禁有事实证据后更新用户数据流矩阵、进度和 Wave 0 验收记录。

## 复用与禁止项

- 复用现有 `profileEntries`、登录/扫码实现、`MemberPrivacyService`、`UserDataRequest`、`AuditService`、SQLite/PostgreSQL migration 和 CI 验证结构。
- 不新增重复入口、占位卡、邮箱/OAuth 登录、套餐/支付功能、站内投递、候选人流程、生产配置、密钥或硬件代码。
- 不重放或新建与 `Order.refundedAmountCents`、`RedemptionRecord` 重复的 migration。
- 不在 `legacy-miaoda/**` 中修改代码。

## 文件预算

- Kiosk 运行时与静态 verify：不超过 11 个既有文件 + 1 个 Wave 0 守卫。
- API 运行时与 verify：不超过 4 个既有文件 + 1 个 Wave 0 集成 verify。
- CI：`.github/workflows/ci.yml` 仅增加两个既有验证步骤。
- 文档与 CCG：4 个正式文档/验收文件 + 本任务归档记录。

## 验证门禁

1. Kiosk：`verify:user-center-wave0`、二维码/Profile 相关 verify、`verify:profile-commercial-first-batch`、`verify:member-session-closure`、typecheck。
2. API：`verify:member-data-request-truth`、`verify:job-ai-privacy`、typecheck。
3. 数据库：独立 SQLite 正式 migration 重放、订单/权益/隐私 verify、`db:pg:sync:check`；PostgreSQL readiness 由 CI 出具同提交证据。
4. 质量：`git diff --check origin/main...HEAD`、双模型（Claude + Antigravity）复审；Critical/High 必须修复并复验。
