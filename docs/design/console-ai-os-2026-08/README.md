# 双后台原型 · console-ai-os-2026-08

管理员后台与合作机构后台的设计原型。运行时真源是代码，不是本目录：

- 管理员：`apps/admin/`（路由表 `apps/admin/src/routes/index.tsx`）
- 合作机构：`apps/partner/`（路由表 `apps/partner/src/routes/index.tsx`）

本目录只供对照视觉与信息架构。C0 事实冻结未完成：这里的 `admin/online-platforms.html` 在运行时还没有对应路由。不要把本目录 HTML 当成已经上线的后台。

合作机构后台不做候选人管理、简历筛选、面试邀约。
