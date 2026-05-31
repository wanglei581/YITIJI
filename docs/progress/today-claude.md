# 2026-05-31 Claude 今日动手清单

> 日期格式:YYYY-MM-DD。本文件每天覆盖。

## 角色

P0 冲刺 W1 Day 2。继续后端基础设施 + UI 组件库扩张。

## 分支

`feat/p0-w1-claude-ui-foundation`(延续 Day 1 同一分支)。

## 将编辑/新建的文件

**后端 BE-2 AuditLog**:
- `services/api/src/audit/audit.module.ts`(新建)
- `services/api/src/audit/audit.service.ts`(新建)— **同步写**(BE-2 核心要求)
- `services/api/src/audit/audit.controller.ts`(新建)— admin 列表 + 过滤
- `services/api/src/audit/audit.types.ts`(新建)— 契约源
- `services/api/src/files/files.controller.ts`(回填 TODO,注入 AuditService)
- `services/api/src/app.module.ts`(注册 AuditModule)
- `packages/shared/src/types/audit.ts`(新建,前端契约)
- `packages/shared/src/index.ts`(导出)

**前端 packages/ui 扩张**:
- `packages/ui/src/components/Stepper.tsx`(W2 K2 AI 简历四步流)
- `packages/ui/src/components/Drawer.tsx`(通用抽屉)
- `packages/ui/src/components/Pagination.tsx`(标准分页器)
- `packages/ui/src/charts/ResumeRadarChart.tsx`(W2 K2c 简历诊断雷达图)
- `packages/ui/src/charts/TrendLineChart.tsx`(Admin/Partner 工作台趋势)
- `packages/ui/src/charts/FunnelCard.tsx`(Partner 漏斗转化)
- `packages/ui/src/charts/MetricGrid.tsx`(8 卡数据面板,Admin/Partner 共用)
- `packages/ui/src/index.ts`(导出)

## 将新增/修改的共享类型契约(packages/shared)

- 新增 `packages/shared/src/types/audit.ts`:
  - `AuditAction`(action 字符串字面量并集)
  - `AuditTargetType`
  - `AuditLogRecord`(单条审计返回)
  - `AuditLogListQuery`(过滤参数)

## 将安装的依赖

无(recharts / lucide-react 已装)。

## 阻塞 Mavis 的事项

- **W1 Day 2 中段**:Mavis 不要碰 `services/api/src/audit/`、`services/api/src/files/files.controller.ts`、`services/api/src/app.module.ts`、`packages/ui/src/components/`、`packages/ui/src/charts/`、`packages/ui/src/index.ts`、`packages/shared/src/types/audit.ts`、`packages/shared/src/index.ts`。
- 若 Mavis 今天想动 admin/audit UI、admin/files UI、admin/dashboard 8 卡 / 趋势图,**等我下班前 commit 完图表组件再动**(否则会 import 不到 MetricGrid / TrendLineChart)。
- 若 Mavis 想跑 Partner D 的真实趋势图(把现有 SVG 替换成 TrendLineChart),也等我今天 commit 后再换。

## Mavis 今天**可以并行做**的事(零冲突)

1. K1 Kiosk 首页卡片墙(`apps/kiosk/src/pages/home/`)— 不依赖任何 W1 D2 新组件,可独立做
2. K3 Kiosk 招聘列表 + 合规横幅(`apps/kiosk/src/pages/jobs/JobsPage.tsx`)— ComplianceBanner 已可用(`b4a6f7d`)
3. A4 Admin 岗位信息源蓝色横幅(`apps/admin/src/routes/job-sources/`)— 同样可用 ComplianceBanner

## 预计完成时间

UTC+8 EOD。

## 完成清单(下班前更新)

- [ ] BE-2 AuditLog 服务 + 控制器 + 同步写入
- [ ] files.controller 回填 audit TODO
- [ ] shared types/audit.ts
- [ ] Stepper / Drawer / Pagination
- [ ] ResumeRadarChart / TrendLineChart / FunnelCard / MetricGrid
- [ ] packages/ui index.ts 全部 export
- [ ] typecheck 全员通过
- [ ] commit 分批
