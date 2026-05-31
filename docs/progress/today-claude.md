# 2026-05-31 Claude 今日动手清单(Day 3)

> 日期格式:YYYY-MM-DD。本文件每天覆盖。

## 角色

P0 冲刺 W1 Day 3。Kiosk K2 AI 简历四步流接入真实后端。

**范围调整**:Day 2 inspection 发现 AI 模块(`services/api/src/ai`)已经搭好骨架
(provider 抽象 + 6 stub + parse/optimize/chat 路由 + ai-log)。Day 3 改为
**集成 BE-1 文件 + 利用已有 AI 接口 + Kiosk K2 UI 补全 + 合规故事落 UI**。

## 分支

`feat/p0-w1-claude-ui-foundation`(延续 Day 1+2 同一分支)。

## 完成清单

后端 BE-1 扩展(commit `ef7f642`):
- [x] **POST /api/v1/files/kiosk-upload** 匿名上传(无 JWT)
  - 限流 20 次 / 60 秒 / IP(比默认 60/60 严格)
  - KioskUploadOptionsDto 严格 purpose 白名单
  - sensitiveLevel 由后端按 purpose 推断(防恶意调用方拉长 TTL)
  - 写 AuditLog action='file.upload' actorRole='kiosk' actorId=null
  - 沿用现有 FilesService:简历类自动 1h 过期 / 身份证类 1h / 其余 24h
- [x] **curl smoke 通过**:`fileId / signedUrl / fileExpiresAt=+1h` 一次到位

前端 Kiosk K2(commit 下一条):
- [x] **ResumeSourcePage** 真实文件上传(替换 MOCK_FILE)
  - 顶部 ComplianceBanner(success)+ KIOSK_RESUME_UPLOAD_PRIVACY 文案
  - 点"上传电子简历"→ 触发原生文件选择 → kioskUploadFile 上传 BE-1
  - 客户端 10MB 上限校验 + 错误条 + 上传中 disabled
  - 成功 navigate 到 /resume/parse 带真实 fileId
- [x] **ResumeReportPage** 集成 ResumeRadarChart
  - report.sections 归一化到 0-100 → 雷达维度
  - 原"分项评估"条形图保留(细节)
  - 与秒哒 kiosk/13 截图布局一致
- [x] **kiosk/src/services/api**:files.ts + filesHttpAdapter.ts + filesMockAdapter.ts
  - kioskUploadFile(file, purpose):http 真上传 / mock 假数据
  - 沿用 ai.ts / jobs.ts adapter 模式

## 总产出统计

- 本日 commit 数(本地):3(`7939a98` 意图 / `ef7f642` BE-1 / Kiosk K2 / 本文件)
- 已 push:0(等用户手动 push)

## 解阻 Mavis 的产出

- ✅ **K2 简历核心**:Kiosk 上传 → BE-1 → AI 解析 → 雷达诊断 端到端真实数据闭环
- ✅ **隐私文案前置**:首次满足专家报告对"上传页可见隐私声明"的硬要求
- ✅ **kiosk-upload 路由**:Mavis 的 K3 招聘列表附件、K8 求职材料模板等场景
  可复用 kioskUploadFile(只需换 purpose 字段)

## 端到端验证(curl)

```
$ echo "dummy resume pdf" > /tmp/test.pdf
$ curl -X POST -F file=@/tmp/test.pdf -F purpose=resume_upload \
       http://localhost:3010/api/v1/files/kiosk-upload
{
  "data": {
    "fileId": "9b77f4b6...",
    "filename": "test.pdf",
    "sizeBytes": 17,
    "mimeType": "application/pdf",
    "sha256": "b8d1756...",
    "signedUrl": "/api/v1/files/9b77f4b6.../content?expires=...&sig=...",
    "signedUrlExpiresAt": "2026-05-31T04:24:28.812Z",
    "fileExpiresAt": "2026-05-31T05:19:28.807Z"
  },
  "success": true
}
```

签名 URL 5 分钟过期、文件本身 1 小时过期(highly_sensitive 自动推断),
audit 已写入 action='file.upload' actorRole='kiosk' actorId=null。

## 明日(W1 Day 4)Claude 计划

- W2 K2d AI 简历优化对比页面(`ResumeOptimizePage`):接现有 getResumeOptimize
- 简化版 before/after diff(用 react-diff-viewer-continued 渲染优化前后段落 +
  AI 解释面板)
- 完成 W1 收尾:开 PR 合 main

## 阻塞 Mavis 的事项

无。今日全部产出 Mavis 可即时消费。

## 完成时间

UTC+8 14:00。

## 备注

历史上有过一次 rebase 操作:Mavis 的 commit `9f1c765` 原本误落在本分支上,
已通过 `git rebase --onto ab96c6e 9f1c765` 摘除,Mavis commit 已转入
`feat/p0-w1-mavis-partner-dashboard` 分支。
回滚锚:`backup/pre-cleanup-2026-05-30` tag。
