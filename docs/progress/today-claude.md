# 2026-06-01 Claude 今日动手清单(W2 Day 2)

> 日期格式:YYYY-MM-DD。本文件每天覆盖。

## 角色

P0 冲刺 **W2 Day 2**。JobFair 后端服务 + 审计接入。

## 分支

`feat/p0-w2-claude-jobfair-be7`(延续 Day 1)

## 将编辑/新建的文件

- `services/api/src/jobs/jobs.service.ts`(8 处 fair 方法从 stub 切真 Prisma)
- `services/api/src/jobs/jobs.module.ts`(@Global AuditModule 已注入,无需 import)
- `services/api/src/jobs/dto/import-fairs.dto.ts`(对齐 importJobs 的 DTO 模式,sourceOrgId 走 JWT 不走 body)
- `services/api/src/jobs/dto/review-fair.dto.ts`(若需要 — 看是否复用 ReviewActionDto)
- `services/api/src/jobs/fair.mapper.ts`(新建 — Prisma row → DTO 转换函数)

## fair 端点对照表

| 路由 | 当前 | Day 2 目标 |
|---|---|---|
| GET /job-fairs | 返回空 | 真查 reviewStatus=approved + publishStatus=published |
| GET /job-fairs/:id | 返回空 | 真查 + 嵌入 companies + zones(FairDetailResponse) |
| GET /admin/fair-sources | 返回空 | 真查全集 |
| PATCH /admin/fair-sources/:id/review | 抛 NOT_IMPLEMENTED | 真审核 + audit('fair.review') |
| PATCH /admin/fair-sources/:id/publish | 抛 NOT_IMPLEMENTED | 真发布 + audit('fair.publish') |
| GET /partner/fairs | 返回空 | 真查本机构 |
| POST /partner/fairs/import | 抛 NOT_IMPLEMENTED | 真 upsert + audit('fair.import') |
| PATCH /partner/fairs/:id/publish | 抛 NOT_IMPLEMENTED | 真下架 |

## 将新增/修改的共享类型契约(packages/shared)

无。Day 1 已经把 Fair / FairCompany / FairZone / FairListQuery 等加好。

## 阻塞 Mavis 的事项

- 全天:Mavis 不要碰 `services/api/src/jobs/`(我在改 service + controller)
- 全天:Mavis 不要碰 `services/api/src/jobs/dto/`(我在改 import-fairs.dto)

## Mavis 今天可以并行做的事

1. K1 Kiosk 首页 / K3 招聘列表合规横幅 / A4 Admin 岗位信息源合规横幅
2. P1 Partner 工作台占位 SVG → `TrendLineChart` / `MetricGrid`
3. A3 Admin 文件管理 UI 消费 BE-1
4. **新增**:Mavis 现在可以开始 Kiosk fair 7 页静态 UI 调整(因为 Day 2 EOD 真接口就绪)
   `apps/kiosk/src/pages/job-fairs/*` 全部在 Mavis 独占目录

## 完成清单(下班前更新)

- [ ] importFairs DTO 改为 items[] only(sourceOrgId 走 JWT)
- [ ] FairMapper(Prisma row → Fair / FairCompany / FairZone)
- [ ] JobsService 8 fair 方法切真 Prisma
- [ ] AuditService 注入 + 3 处审计写(fair.review / fair.publish / fair.import)
- [ ] typecheck 全员通过
- [ ] boot + curl 冒烟(至少 GET 一个 fair 列表)
- [ ] commit
