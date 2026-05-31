# 2026-06-01 Claude 今日动手清单(W2 Day 1)

> 日期格式:YYYY-MM-DD。本文件每天覆盖。

## 角色

P0 冲刺 **W2 Day 1**。BE-7 JobFair 数据模型起步(校企合作搭车的底座)。

## 分支

`feat/p0-w2-claude-jobfair-be7`(stacked on `feat/p0-w1-claude-ui-foundation` @ `a22cdc1`)

## 将编辑/新建的文件

**后端 Prisma**:
- `services/api/prisma/schema.prisma`(新增 3 模型:JobFair / FairCompany / FairZone + Organization 反向关系)
- `services/api/prisma/migrations/<timestamp>_add_job_fair/`(新建)
- `services/api/src/prisma/prisma.service.ts`(暴露新 delegates)

**共享契约**:
- `packages/shared/src/types/fair.ts`(新建,JobFair / FairCompany / FairZone 形状)
- `packages/shared/src/index.ts`(导出)

**本地副本**(服务端 commonjs 无法直接 import shared):
- `services/api/src/jobs/fair.types.ts`(新建,本地副本,SSOT 标注)

## 将新增/修改的共享类型契约(packages/shared)

- `Fair`、`FairCompany`、`FairZone` 结构
- `FairTheme` 字面量并集:`'general' | 'campus' | 'campus_corp' | 'industry'`
  - 校企合作 = `'campus_corp'` 主题变体(无需独立模型,catalog Q1 结论)
- `FairStatus`:`'draft' | 'reviewing' | 'approved' | 'rejected' | 'published' | 'archived'`(沿用 Job 的 review + publish 双维)

## 将安装的依赖

无。

## 阻塞 Mavis 的事项

- W2 Day 1 全天:Mavis 不要碰 `services/api/prisma/schema.prisma`(我在加 JobFair),
  也不要在 `packages/shared/src/types/` 下新增其他类型(Day 1 我只加 fair.ts)
- Day 1 EOD 之前 Mavis 不要 `pnpm prisma migrate` 或在 dev.db 上跑 schema 操作

## Mavis 今天可以并行做的事(零冲突)

1. K1 Kiosk 首页卡片墙
2. K3 Kiosk 招聘列表合规横幅
3. A4 Admin 岗位信息源合规横幅
4. P1 Partner 工作台:把占位 SVG 趋势图换成 `TrendLineChart`,8 卡换 `MetricGrid`
5. A3 Admin 文件管理 UI:消费 BE-1 已有接口

## 预计完成时间

UTC+8 EOD。

## 完成清单(下班前更新)

- [ ] schema.prisma 新增 JobFair / FairCompany / FairZone
- [ ] prisma migrate dev 应用迁移
- [ ] PrismaService delegates
- [ ] packages/shared/types/fair.ts(SSOT)
- [ ] services/api/src/jobs/fair.types.ts(本地副本)
- [ ] typecheck 全员通过
- [ ] commit
