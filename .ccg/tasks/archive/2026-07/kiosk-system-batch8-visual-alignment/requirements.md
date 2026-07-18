# Batch 8 实施范围

## 功能闭环

按 `docs/design/kiosk-proto-2026-07/` 定稿原型，对齐政策、AI 助手、登录、活动、宣传屏、帮助、法律、二维码登录和语音助手页，并将 Batch 0 的会话超时、断网占位路由实现为可操作页面。

## 允许修改

- `apps/kiosk/src/` 内与 12、13、15、24、57、58、59、60、61、63、73 屏对应的现有页面、路由级组件及必要的同域样式
- `docs/progress/current-progress.md`
- `.ccg/tasks/kiosk-system-batch8-visual-alignment/`

## 禁止修改

- 后端、数据库、共享契约、Terminal Agent、打印扫描硬件链路
- 原型文件
- 计划外 Kiosk 页面与业务流程
- 新增依赖、重复入口或同义卡片

## 行为要求

- 13 屏保留现有 TRTC 真人顾问链路
- 60 屏提供自动退出倒计时与续期按钮
- 61 屏展示网络错误并提供重试按钮
- 其余页面仅做原型 1:1 视觉与文案对齐，保留既有真实功能

## 验证

- `pnpm --filter @ai-job-print/kiosk exec tsc --noEmit`
- `pnpm --filter @ai-job-print/kiosk lint`
- `pnpm --filter @ai-job-print/kiosk build`
- `git diff --check`
