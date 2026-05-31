# 2026-05-31 Claude 今日动手清单(Day 3)

> 日期格式:YYYY-MM-DD。本文件每天覆盖。

## 角色

P0 冲刺 W1 Day 3。Kiosk K2 AI 简历四步流接入真实后端。

**范围调整**:Day 2 inspection 发现 AI 模块(`services/api/src/ai`)已经搭好骨架
(provider 抽象 + mock/openai/claude/local/qwen/zhipu 6 stub + parse/optimize/chat 路由
+ ai-log)。Day 3 不需要新建 AI 网关,改为**集成 BE-1 文件 + AI 已有接口 + Kiosk K2 UI 补全**。

## 分支

`feat/p0-w1-claude-ui-foundation`(延续 Day 1+2 同一分支)。

## 将编辑/新建的文件

**后端**(BE-1 扩展 — 匿名 Kiosk 上传):
- `services/api/src/files/files.controller.ts`(新增 `POST /files/kiosk-upload` 路由)
- `services/api/src/files/dto/kiosk-upload-options.dto.ts`(新建,限制 purpose 白名单)

**前端 Kiosk**:
- `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`(真实文件上传 + ComplianceBanner 隐私横幅 + 接 BE-1)
- `apps/kiosk/src/pages/resume/ResumeReportPage.tsx`(集成 ResumeRadarChart 替换条形评分图)
- `apps/kiosk/src/services/api/files.ts`(新建 — `kioskUploadFile()` 封装,mock + http 双模式)
- `apps/kiosk/src/services/api/filesHttpAdapter.ts`(新建)
- `apps/kiosk/src/services/api/filesMockAdapter.ts`(新建)
- `apps/kiosk/src/services/api/index.ts`(导出 files)

## 将新增/修改的共享类型契约(packages/shared)

无。Kiosk 上传走 file.ts 已有的 FileUploadResponse 形状。

## 将安装的依赖

无。

## 阻塞 Mavis 的事项

- **W1 Day 3 中段**:Mavis 不要碰 `services/api/src/files/`(在加 kiosk-upload 路由)、
  `apps/kiosk/src/pages/resume/`(Claude 独占区,owners.md §1)、
  `apps/kiosk/src/services/api/`(改 index.ts + 加 files.ts)。

## Mavis 今天可以并行做的事(零冲突)

1. K1 Kiosk 首页卡片墙(`apps/kiosk/src/pages/home/`)— 完全独立
2. K3 Kiosk 招聘列表 + 合规横幅(`apps/kiosk/src/pages/jobs/JobsPage.tsx`)— ComplianceBanner 已可用
3. A4 Admin 岗位信息源蓝色横幅(`apps/admin/src/routes/job-sources/`)
4. P1 Partner 工作台:把昨日做的占位 SVG 趋势图换成 `TrendLineChart`,把内联 8 卡换成 `MetricGrid`

## 预计完成时间

UTC+8 EOD。

## 完成清单(下班前更新)

- [ ] BE-1 新增 POST /files/kiosk-upload(匿名,purpose 白名单)
- [ ] Kiosk filesHttpAdapter + filesMockAdapter + files.ts 暴露 `kioskUploadFile`
- [ ] ResumeSourcePage 真实上传 + ComplianceBanner 隐私横幅
- [ ] ResumeReportPage 集成 ResumeRadarChart
- [ ] typecheck 全员通过
- [ ] boot + 端到端冒烟(mock + http 至少一遍)
- [ ] commit 分批
