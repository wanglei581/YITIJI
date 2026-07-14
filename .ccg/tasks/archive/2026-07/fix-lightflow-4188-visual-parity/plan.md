# 4188 三主页面视觉偏差修复计划

## 已确认根因

上一版把首页服务目录的五种共享原语错误扩展到三个主 Tab，只锁了 class 名和最小高度，没有还原 4188 原型真实的页面语法。当前可见证据显示：

- 首页服务区使用完整边框、方形图标、贴边主卡和错误主次语义；原型是 1080px 外壳、980px 内容轨、72px 透明分组头、12px 圆角图标、内缩主入口与行式次入口。
- AI 助手错误插入首页六项分类导航，并变成两块服务面板；原型是任务选择、对话区、输入区组成的单列咨询工作台。
- 我的页面错误插入首页六项导航，并把每组第一项强制放大；原型是开放式身份摘要、信息边界、五区等权双列入口。

## 用户已锁定的例外

- 首页 Hero、真实身份登录卡、继续办理、底部三 Tab 不改功能。
- AI 助手左上角不显示“AI助手”；我的页面左上角不显示“我的”。
- 保留真实 AI API、TRTC、虚拟键盘、登录、统计、会话记录、27 个入口及其真实路由。
- `/me/*` 明细页完全不动。

## Layer 1 并行实施

### A. 首页下半服务区

允许修改：

- `apps/kiosk/src/pages/home/HomePage.tsx`
- `apps/kiosk/src/pages/home/serviceGroups.ts`
- `apps/kiosk/src/pages/home/styles/home-shell.css`
- `apps/kiosk/src/pages/home/styles/home-services.css`
- `apps/kiosk/src/pages/home/styles/home-responsive.css`
- `apps/kiosk/src/components/lightflow/ReferenceServiceNav.tsx`
- `apps/kiosk/src/components/lightflow/reference-service-nav.css`
- `apps/kiosk/src/components/lightflow/reference-layout.css`
- `apps/kiosk/scripts/verify-home-service-desk.mjs`

验收：原型数据驱动主次/分栏；1080/980 轨道；吸顶六项导航；圆角图标；760/520 断点；百宝箱和智慧校园统一为行式扩展服务。

### B. AI 助手

允许修改：

- `apps/kiosk/src/pages/assistant/AssistantPage.tsx`
- `apps/kiosk/src/pages/assistant/assistant-lightflow-shell.css`
- `apps/kiosk/src/pages/assistant/assistant-lightflow-content.css`
- `apps/kiosk/src/pages/assistant/assistant-lightflow-chat.css`
- `apps/kiosk/src/pages/assistant/assistant-lightflow-call.css`
- `apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs`
- `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`

验收：移除首页分类导航和共享服务卡骨架；恢复任务选择、真实对话、输入区的 980px 工作台；保留无可见“AI助手”标题、真实 API/TRTC/键盘/会话隔离。

### C. 我的

允许修改：

- `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- `apps/kiosk/src/pages/profile/profileEntries.ts`
- `apps/kiosk/src/pages/profile/components/ProfileHeader.tsx`
- `apps/kiosk/src/pages/profile/components/ProfileEntrySection.tsx`
- `apps/kiosk/src/pages/profile/components/ProfileSessionRecords.tsx`
- `apps/kiosk/src/pages/profile/profile-lightflow-shell.css`
- `apps/kiosk/src/pages/profile/profile-lightflow-directory.css`
- `apps/kiosk/src/pages/profile/profile-lightflow-state.css`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`

验收：移除首页分类导航；恢复开放式身份摘要、五区边界、等权双列入口；保留无可见“我的”标题、真实登录/统计/会话记录、27 入口及双“权益活动”路由。

## Layer 2 集成

- 更新 `apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs`，把错误的“三页都必须共享首页原语”合同改为页面语法合同。
- 运行三页面静态合同、typecheck、lint、production build。
- 用 Playwright 在 `1032×1280`、`390×844`、`390×700` 抓取三页面，逐页对照原型。
- 写 `design-qa.md`，P0/P1/P2 清零后才通过。
- 完成 Antigravity + Claude 双模型终审。

## 禁止范围

- 不改后端、数据库、终端 Agent、Admin、Partner、`/me/*`。
- 不增加入口、页面、路由、外部依赖或假数据。
- 不改招聘/招聘会合规边界，不新增平台内投递或预约闭环。
