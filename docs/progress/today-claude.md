# 2026-05-30 Claude 今日动手清单

> 日期格式:YYYY-MM-DD。本文件每天覆盖。

## 角色

P0 冲刺 W1 Day 1。负责架构基础设施 + 共享组件 + 后端文件通道。

## 将编辑/新建的文件

- `docs/progress/owners.md` ✅ 已完成
- `docs/progress/today-claude.md`(本文件)✅ 已完成
- 暂未启动 W1 Day 1 具体代码工作,等用户与 Mavis 同步分工后开始

## 将编辑/新建的文件(W1 Day 1 计划,待用户 ack 启动)

启动后将分两个分支推进:

**分支 1**:`feat/p0-w1-claude-ui-foundation`
- `packages/ui/src/components/ComplianceBanner.tsx`(新建)
- `packages/ui/src/components/Stepper.tsx`(新建)
- `packages/ui/src/index.ts`(导出新组件)
- 三端 `package.json` 安装 `recharts` 和 `react-diff-viewer-continued`

**分支 2**:`feat/p0-w1-claude-files-be1`
- `services/api/prisma/schema.prisma`(新增 FileObject 模型)
- `services/api/prisma/migrations/<timestamp>_add_file_object/`(新建)
- `services/api/src/files/files.module.ts`(新建)
- `services/api/src/files/files.controller.ts`(新建,/api/v1/files 路由)
- `services/api/src/files/files.service.ts`(新建,HMAC 签名 URL + 清理逻辑)
- `services/api/src/files/dto/`(新建,上传 DTO + 响应 DTO)
- `services/api/src/app.module.ts`(注册 FilesModule)
- `packages/shared/src/types/file.ts`(新建,FileMetadata 等共享类型)
- `packages/shared/src/index.ts`(导出)

## 将新增/修改的共享类型契约(packages/shared)

- 新增 `FileMetadata` 类型(id / filename / size / mime / uploadedAt / expiresAt / sensitiveLevel)
- 新增 `FileUploadResponse`(fileId / signedUrl / expiresAt)
- 新增 `SignedUrlResponse`(url / expiresAt)

## 将安装的依赖

- `pnpm add recharts -F @ai-job-print/kiosk -F @ai-job-print/admin -F @ai-job-print/partner`
- `pnpm add react-diff-viewer-continued -F @ai-job-print/kiosk`
- `pnpm add @types/node -D -F @ai-job-print/api`(可能已有,只确保)

## 阻塞 Mavis 的事项

- **W1 Day 1-2**:Mavis 不要碰 `packages/ui/src/`,我在新增 ComplianceBanner 等
- **W1 Day 1-2**:Mavis 不要碰 `services/api/prisma/schema.prisma`,我在加 FileObject
- **W1 Day 1**:Mavis 在我装完依赖前不要单独 `pnpm install`(锁文件会冲突)
- **W1 全周**:Mavis 不要碰 `services/api/src/files/`、`services/api/src/audit/`、`services/api/src/main.ts`、`services/api/src/app.module.ts`

## Mavis 今天**可以并行做**的事(不冲突)

1. K1 Kiosk 首页卡片墙:`apps/kiosk/src/pages/home/`(完全独立,与我零交集)
2. P1 Partner 工作台 D:`apps/partner/src/routes/dashboard/`(完全独立)
3. A4 Admin 岗位信息源合规横幅:`apps/admin/src/routes/job-sources/`,但**合规横幅文案需等 Claude 提供 ComplianceBanner 组件**;在等的时候可以先用占位 `<div className="...">` 写好布局,后续替换为 `<ComplianceBanner>` 组件
4. K3 Kiosk 招聘列表:同上,可以先布局,等 Day 2 EOD ComplianceBanner 上线后替换

## 预计完成时间

W1 Day 1 EOD UTC+8:
- packages/ui 至少 ComplianceBanner + Stepper 上线
- FileObject Prisma 模型 + migration 完成
- 依赖装完

## 完成清单(下班前更新)

- [x] owners.md 起草 @ commit pending
- [x] today-claude.md 起草 @ commit pending
- [ ] 等用户确认与 Mavis 同步分工后,启动 W1 Day 1 编码工作
