# Batch 7：我的与账号线 11 屏视觉对齐

## 目标

按 `docs/design/kiosk-proto-2026-07/` 中 14、16–23、71–72 号原型，对齐 Kiosk 端对应 11 个页面的视觉表现。

## 范围

- 仅修改既有页面的视觉结构、样式与展示层细节。
- 保留全部 API 调用、状态管理、事件处理和业务逻辑。
- 使用 `shared.css` 的设计 token。
- 所有主要可操作按钮最小高度 56px。
- 以 1080×1920 竖屏终端为主视口，并保持既有响应式能力。
- 不新增依赖，不修改测试，不触碰 `legacy-miaoda/`。

## 文件预算

- `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- `apps/kiosk/src/pages/profile/components/ProfileHeader.tsx`
- `apps/kiosk/src/pages/profile/components/ProfileEntrySection.tsx`
- `apps/kiosk/src/pages/profile/components/ProfileSessionRecords.tsx`
- `apps/kiosk/src/pages/profile/profile-lightflow-shell.css`
- `apps/kiosk/src/pages/profile/profile-lightflow-directory.css`
- `apps/kiosk/src/pages/profile/profile-lightflow-state.css`
- `apps/kiosk/src/pages/profile/me/MeListShell.tsx`
- `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx`
- `apps/kiosk/src/pages/profile/me/JobAiSessionRecords.tsx`
- `apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx`
- `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`
- `apps/kiosk/src/pages/profile/me/MyActivityPage.tsx`
- `apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css`
- `apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx`
- `docs/progress/current-progress.md`
- `.ccg/tasks/kiosk-me-account-batch7-visual-alignment/*`

除上述文件外不修改运行时代码；不改路由、服务适配器、共享类型、后端、数据库、终端 Agent、生产配置或依赖。

## 验收

- 11 个页面逐一对应原型。
- TypeScript、ESLint、Vite build 全部通过。
- 变更范围仅包含计划页面、必要共用视觉文件、进度文档和 CCG 任务记录。
