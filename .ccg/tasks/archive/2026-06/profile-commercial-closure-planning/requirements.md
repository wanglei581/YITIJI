# 我的页商用闭环收口计划与首批执行准入

## 目标

基于当前仓库事实，为「我的页商用闭环」形成一份可执行的渐进式整改计划，明确已完成能力、剩余缺口、首批可执行任务、允许修改文件、验证命令、双模型审查要求和删除旧实现条件。

## 当前仓库事实

- `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md` 已完成 P0 文档与工作区收口 T0-T5，下一阶段指向首个业务闭环。
- `docs/product/user-data-flow-matrix.md` 记录：`/profile` 的权益、通知、反馈、活动已接真实 API 与 Admin 管理；打印订单、文档、收藏、浏览/外部跳转记录已有 `/me/*` 明细页。
- `apps/kiosk/src/pages/profile/ProfilePage.tsx` 当前 595 行，超过 `.ccg/spec/guides/index.md` 的 500 行评估阈值。后续不能继续往该文件堆新功能。
- `apps/kiosk/src/pages/profile/ProfilePage.tsx` 的「AI服务记录」入口当前指向 `/assistant`，但真实 AI 服务记录 API 已存在于 `GET /api/v1/me/ai-records`，Kiosk API client 为 `getMyAiRecords`。当前没有对应 `/me/ai-records` 页面。
- `services/api/src/member-feedback/member-feedback.service.ts` 支持 `relatedPrintTaskId` 并校验打印订单归属；`apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx` 的提交表单尚未从 URL 参数或打印订单入口预填关联打印订单。
- `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx` 当前只读展示打印订单，没有跳转到关联反馈的入口。
- 现有 verify 脚本包括：`verify:member-assets`、`verify:member-favorites-benefits`、`verify:member-benefits-admin`、`verify:benefit-activities`、`verify:feedback-notifications`、`verify:member-print-orders`、`verify:member-assets-c2d`、`verify:activity-logs`。

## 非目标

- 不新建仓库，不把项目物理迁移到新文件夹。
- 不在本任务直接改 runtime 代码。
- 不引入套餐购买、支付、招聘会扫码凭证、自营投递或预约结果记录。
- 不新增重复入口，不恢复「账号资产/资产中心」聚合页。
- 不删除旧实现，除非后续分支能证明无路由、无 import、无测试/verify、无文档声明、不会被生产部署或硬件链路使用。

## 计划产物

- `docs/superpowers/plans/2026-06-21-profile-commercial-closure.md`
- `docs/reviews/profile-commercial-closure-planning.md`
- 同步更新 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`
- 双模型审查结果归档到 `.ccg/tasks/profile-commercial-closure-planning/review.md`
