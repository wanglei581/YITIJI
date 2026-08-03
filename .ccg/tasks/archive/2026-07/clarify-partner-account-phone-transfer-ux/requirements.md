# 需求说明

## 真实问题

管理员只有一个手机号，该手机号当前属于机构账号，因后台把“删除机构账号”“普通换绑手机号”“从机构账号安全转移手机号”拆在不同位置，用户误走删除流程后同时遇到：

- 目标账号密码验证按钮因密码证明状态不合格而禁用，但页面不解释原因；
- 旧手机号验证码验证成功只授权当前删除或换绑操作，不会把号码绑定给管理员；
- 普通换绑要求另一个未被占用的新手机号，不能解决同一号码跨账号转移；
- 唯一启用机构账号最终不能删除，但限制直到长流程末端才暴露。

## 目标

在不修改后端安全规则、数据库约束和现有业务入口的前提下，让用户在机构账号管理页即可理解三种操作的区别，并能直接前往既有管理员账号设置中的安全转移入口。

## 允许修改

- `apps/admin/src/routes/partners/PartnerAccountManager.tsx`
- `apps/admin/src/routes/partners/PartnerAccountActionDialog.tsx`
- `apps/admin/src/routes/partners/partner-account-action-steps/ActionCredentialSteps.tsx`
- `apps/admin/src/routes/partners/partner-account-action-steps/PhoneRebindSteps.tsx`
- `apps/admin/src/routes/partners/partner-account-action-steps/PartnerAccountDeleteConfirmationDialog.tsx`
- `apps/admin/scripts/verify-partner-account-action-ui.mjs`
- 必要的同目录纯函数或单元测试（仅在能降低页面复杂度时新增）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`（仅在本任务产生新的剩余项时修改）
- 本任务 `.ccg/tasks/` 记录与已批准设计/计划文档

## 禁止修改

- 后端删除、换绑、手机号转移接口和状态机
- Prisma schema、migration、手机号唯一约束
- Admin 登录、短信服务、真实账号数据和生产配置
- Partner、Kiosk、Worker、Terminal Agent、支付、打印扫描
- 新增页面、菜单、数据模型、服务或外部依赖

## 验收标准

1. 机构账号区域明确提示单手机号场景应使用“安全转移”，并能到达既有 `/account-settings`。
2. 最后一个启用机构账号的删除按钮提前不可用，页面说明必须先创建并启用接替账号。
3. 密码方式不可用时仍可看见入口语义，但同时显示不可用原因和可执行替代路径。
4. 删除授权明确说明不会自动绑定管理员手机号。
5. 普通换绑明确说明新手机号必须未被任何账号占用；同号码转给管理员应走安全转移。
6. 最终删除确认再次说明删除与手机号转移的差异。
7. 不放宽现有安全验证或手机号唯一性约束。
8. Admin 专项 UI 门禁、typecheck、lint、production build 通过。
