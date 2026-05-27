# API v1 设计文档

> 版本：v1  
> 基础路径：`/api/v1`  
> 协议：HTTPS  
> 数据格式：JSON  
> 字符集：UTF-8  
> 设计日期：2026-05-25  
> 最后更新：2026-05-26（Phase 7.10：补充岗位/招聘会 14 个真实 API 接口，对齐状态机设计）

---

## 目录

1. [通用约定](#1-通用约定)
2. [认证与权限](#2-认证与权限)
3. [错误码](#3-错误码)
4. [终端设备](#4-终端设备)
5. [打印服务](#5-打印服务)
6. [扫描服务](#6-扫描服务)
7. [AI 简历服务](#7-ai-简历服务)
8. [AI 助手](#8-ai-助手)
9. [AI 服务用量统计](#9-ai-服务用量统计)
10. [岗位信息](#10-岗位信息)
11. [招聘会信息](#11-招聘会信息)
12. [数据源管理](#12-数据源管理)
13. [导入批次](#13-导入批次)
14. [同步日志](#14-同步日志)
15. [合作机构](#15-合作机构)
16. [管理员后台](#16-管理员后台)
17. [文件服务](#17-文件服务)
18. [合规边界](#18-合规边界)

---

## 1. 通用约定

### 请求头

```
Content-Type: application/json
Authorization: Bearer <token>       # 除公开接口外必须携带
X-Terminal-Id: <terminal_id>        # 一体机端请求必须携带
```

### 分页参数（列表接口统一）

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码，从 1 开始 |
| `pageSize` | number | 20 | 每页条数，最大 100 |

### 分页响应体

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### 时间格式

所有时间字段统一使用 ISO 8601：`2026-05-25T10:30:00+08:00`

### 枚举值

所有枚举值使用 snake_case 字符串，与前端 TypeScript 类型一致。

---

## 2. 认证与权限

### 权限级别

| 级别 | 标识 | 说明 |
|------|------|------|
| `public` | — | 无需认证，一体机展示用 |
| `kiosk` | terminal token | 一体机终端 token，Terminal Agent 申请 |
| `partner` | partner JWT | 合作机构账号 JWT |
| `admin` | admin JWT | 管理员 JWT |

### 2.1 认证接口

#### POST /auth/login

登录（partner / admin 账号）。

**请求体**

```json
{
  "email": "admin@example.com",
  "password": "string",
  "role": "admin | partner"
}
```

**响应**

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 3600,
  "user": {
    "id": "u1",
    "email": "admin@example.com",
    "role": "admin",
    "displayName": "管理员"
  }
}
```

#### POST /auth/refresh

刷新 access token。

**请求体**

```json
{ "refreshToken": "eyJ..." }
```

**响应**：同 login 响应，不含 `refreshToken`。

#### POST /auth/logout

**请求头**：需 Bearer token  
**响应**：`204 No Content`

#### POST /auth/terminal/register

Terminal Agent 注册并获取 kiosk token。

**请求体**

```json
{
  "terminalCode": "T-001",
  "deviceFingerprint": "sha256-of-hardware-info",
  "adminSecret": "one-time-setup-secret"
}
```

**响应**

```json
{
  "terminalId": "t1",
  "terminalToken": "eyJ...",
  "expiresAt": "2027-05-25T00:00:00+08:00"
}
```

---

## 3. 错误码

### HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| `200` | 成功 |
| `201` | 创建成功 |
| `204` | 操作成功，无响应体 |
| `400` | 请求参数错误 |
| `401` | 未认证 |
| `403` | 权限不足 |
| `404` | 资源不存在 |
| `409` | 资源冲突（如重复提交） |
| `422` | 业务校验失败 |
| `429` | 请求频率超限 |
| `500` | 服务端错误 |

### 错误响应体

```json
{
  "error": {
    "code": "PRINT_PRINTER_OFFLINE",
    "message": "打印机当前离线，请稍后重试",
    "details": {
      "printerId": "p1",
      "lastOnlineAt": "2026-05-25T09:00:00+08:00"
    }
  }
}
```

### 业务错误码

| 错误码 | 场景 |
|--------|------|
| `AUTH_INVALID_CREDENTIALS` | 用户名或密码错误 |
| `AUTH_TOKEN_EXPIRED` | Token 已过期 |
| `AUTH_FORBIDDEN` | 权限不足 |
| `TERMINAL_NOT_REGISTERED` | 终端未注册 |
| `TERMINAL_OFFLINE` | 终端离线 |
| `PRINT_PRINTER_OFFLINE` | 打印机离线 |
| `PRINT_PAPER_EMPTY` | 打印机缺纸 |
| `PRINT_FILE_TOO_LARGE` | 文件超过大小限制 |
| `PRINT_UNSUPPORTED_FORMAT` | 不支持的文件格式 |
| `PRINT_QUOTA_EXCEEDED` | 打印配额超限 |
| `FILE_NOT_FOUND` | 文件不存在或已过期 |
| `FILE_UPLOAD_FAILED` | 文件上传失败 |
| `SCAN_DEVICE_BUSY` | 扫描仪正在使用中 |
| `AI_SERVICE_UNAVAILABLE` | AI 服务暂不可用 |
| `AI_TASK_NOT_FOUND` | AI 任务 ID 不存在或已过期 |
| `AI_QUOTA_EXCEEDED` | AI 服务调用配额已满（终端级或全局级）|
| `AI_RATE_LIMITED` | AI 服务请求过于频繁，请稍后重试 |
| `SOURCE_REVIEW_PENDING` | 数据源待审核，不可展示 |
| `IMPORT_MAPPING_ERROR` | 字段映射校验失败 |
| `DATA_NOT_APPROVED` | 数据未通过审核 |

---

## 4. 终端设备

### 权限：`kiosk` 或 `admin`

#### GET /terminals

获取终端列表（admin）。

**查询参数**：`page`, `pageSize`, `status` (online|offline|error), `locationId`

**响应**：[TerminalDTO] 分页列表

#### GET /terminals/:id

获取单个终端详情（admin）。

#### PUT /terminals/:id/heartbeat

Terminal Agent 上报心跳与状态。

**权限**：`kiosk`（仅本终端）

**请求体**

```json
{
  "status": "online",
  "printerStatus": "ready | offline | error | low_paper",
  "diskFreeGB": 45.2,
  "cpuPercent": 12.5,
  "memUsedPercent": 38.1,
  "agentVersion": "1.2.0",
  "ipAddress": "192.168.1.100",
  "reportedAt": "2026-05-25T10:00:00+08:00"
}
```

**响应**：`200 { "acknowledged": true }`

#### PUT /terminals/:id

更新终端信息（admin）。

#### DELETE /terminals/:id

注销终端（admin）。

#### POST /terminals/:id/tasks/claim

Terminal Agent 领取待执行的打印/扫描任务（原子操作，防止重复领取）。

**权限**：`kiosk`（仅本终端）

**请求体**

```json
{ "maxTasks": 1 }
```

**响应**

```json
[
  {
    "taskId": "ptask_001",
    "type": "print",
    "fileUrl": "https://oss.example.com/files/f_abc123?token=xxx&expires=...",
    "fileMd5": "d41d8cd98f00b204e9800998ecf8427e",
    "actionToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "claimedBy": "t_abc",
    "claimExpiresAt": "2026-05-26T10:05:00+08:00",
    "params": {
      "copies": 2,
      "colorMode": "black_white",
      "duplex": "duplex_long_edge",
      "paperSize": "A4",
      "orientation": "auto",
      "quality": "standard",
      "scale": "fit",
      "pagesPerSheet": 1
    },
    "createdAt": "2026-05-26T10:00:00+08:00"
  }
]
```

- 后端原子更新 `status=claimed`，写入 `claimedBy` 和 `claimExpiresAt`（now + 5 min）
- 未在 `claimExpiresAt` 前 PATCH 状态 → 任务自动重置为 `pending`，可被重新领取
- Phase 8.1 MVP：一次最多返回 1 个任务

#### PATCH /terminals/:id/tasks/:taskId/status

Agent 上报任务状态变更（幂等）。

**权限**：`kiosk`（仅本终端）

**请求体**

```json
{
  "status": "printing | completed | failed",
  "errorCode": "PRINT_COMMAND_FAILED",
  "errorMessage": "optional detail"
}
```

**响应**：`200 { "acknowledged": true }`

- `completed` / `failed` 为终态，写入后不可再变更
- 重复 PATCH 同一 status 不报错（幂等）

---

## 5. 打印服务

### 5.1 文件上传

#### POST /print/files/upload

上传待打印文件。

**权限**：`kiosk`  
**Content-Type**：`multipart/form-data`

**表单字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | File | PDF/Word/图片，最大 50MB |
| `terminalId` | string | 上传终端 ID |
| `sessionId` | string | 用户会话 ID（匿名） |

**响应**

```json
{
  "fileId": "f_abc123",
  "fileName": "resume.pdf",
  "fileSize": 204800,
  "pageCount": 3,
  "previewUrl": "https://oss.example.com/preview/f_abc123?token=xxx&expires=1716862800",
  "expiresAt": "2026-05-25T12:00:00+08:00"
}
```

> 注：`previewUrl` 为临时签名 URL，有效期 2 小时。

#### GET /print/files/:fileId/preview

获取预览 token（刷新签名 URL）。

**权限**：`kiosk`

### 5.2 打印订单

#### POST /print/orders

创建打印订单。

**权限**：`kiosk`

**请求体**

```json
{
  "fileId": "f_abc123",
  "terminalId": "t1",
  "sessionId": "sess_xyz",
  "copies": 2,
  "colorMode": "bw | color",
  "duplexMode": "single | double",
  "paperSize": "A4",
  "staple": false,
  "pageRange": "1-3"
}
```

**响应**

```json
{
  "orderId": "ord_001",
  "status": "pending",
  "estimatedPages": 6,
  "estimatedCostYuan": 0.60,
  "createdAt": "2026-05-25T10:05:00+08:00"
}
```

#### GET /print/orders

获取打印订单列表。

**权限**：`kiosk`（本终端订单）| `admin`（全部）

**查询参数**：`page`, `pageSize`, `terminalId`, `status`, `dateFrom`, `dateTo`

#### GET /print/orders/:orderId

获取单个订单详情。

#### PUT /print/orders/:orderId/cancel

取消打印订单（仅 `pending` 状态可取消）。

**权限**：`kiosk`（本终端）| `admin`

#### POST /print/callback/pantum

奔图打印机回调（服务端接收，需验签）。

**注意**：此接口为服务端内部接口，仅接受奔图服务器 IP 调用，必须验签，不对前端暴露。

### 5.3 打印任务（Terminal Agent 任务队列）

> **注意**：§5.2 的 `POST /print/orders` 字段名 `colorMode: "bw|color"` 和 `duplexMode: "single|double"` 已过时。  
> Phase 8.1 起统一使用 `PrintJobParams` 命名规范（见下文）。

#### POST /api/v1/print-tasks

Kiosk 创建打印任务，后端生成 `actionToken`，由 Terminal Agent 通过 `/tasks/claim` 领取执行。

**权限**：`kiosk`

**请求体（PrintTaskCreateDto）**

```json
{
  "fileId": "f_abc123",
  "terminalId": "t1",
  "params": {
    "copies": 2,
    "colorMode": "black_white",
    "duplex": "duplex_long_edge",
    "paperSize": "A4",
    "pageRange": "1-3,5",
    "orientation": "auto",
    "quality": "standard",
    "scale": "fit",
    "pagesPerSheet": 1
  }
}
```

**PrintJobParams 字段说明**

| 字段 | 类型 | 值域 | 说明 |
|------|------|------|------|
| copies | number | 1–99 | 打印份数 |
| colorMode | string | `black_white` \| `color` | 色彩模式 |
| duplex | string | `simplex` \| `duplex_long_edge` \| `duplex_short_edge` | 单双面 |
| paperSize | string | `'A4'` | 纸张规格（CM2820ADN 仅支持 A4） |
| pageRange | string? | 如 `1-3,5,7-9` | 缺省 = 全部页面 |
| orientation | string | `auto` \| `portrait` \| `landscape` | 页面方向 |
| quality | string | `draft` \| `standard` \| `high` | 打印质量 |
| scale | string | `fit` \| `actual` | 缩放方式 |
| pagesPerSheet | number | `1` \| `2` \| `4` | 每张页数 |

**响应**

```json
{
  "taskId": "ptask_001",
  "status": "pending",
  "actionToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "createdAt": "2026-05-26T10:00:00+08:00"
}
```

- `actionToken`：HMAC 签名，绑定 `taskId`，有效期 5 分钟，一次性使用
- Kiosk 进入打印进度页后轮询下方 GET 接口查询任务状态

#### GET /api/v1/print-tasks/:taskId

查询打印任务状态（Kiosk 轮询）。

**权限**：`kiosk`（本终端任务）| `admin`

**响应**

```json
{
  "taskId": "ptask_001",
  "status": "pending | claimed | printing | completed | failed | timeout",
  "errorCode": null,
  "errorMessage": null,
  "completedAt": null
}
```

---

## 6. 扫描服务

#### POST /scan/jobs

创建扫描任务（由 Terminal Agent 调用）。

**权限**：`kiosk`

**请求体**

```json
{
  "terminalId": "t1",
  "sessionId": "sess_xyz",
  "scanType": "pdf | jpeg | png",
  "dpi": 300,
  "colorMode": "bw | color | gray",
  "duplexScan": false,
  "adfEnabled": true
}
```

**响应**

```json
{
  "scanJobId": "scan_001",
  "status": "pending",
  "pollInterval": 2000
}
```

#### GET /scan/jobs/:scanJobId

轮询扫描任务状态。

**响应**

```json
{
  "scanJobId": "scan_001",
  "status": "pending | scanning | completed | failed",
  "progress": 60,
  "resultFileId": "f_scan_abc",
  "errorMessage": null
}
```

#### GET /scan/files/:fileId

获取扫描结果文件（签名 URL）。

**权限**：`kiosk`

---

## 7. AI 简历服务

> 合规说明：AI 分析结果仅服务提交简历的求职者本人，不推送给企业，不参与招聘闭环。  
> 所有响应文案必须标注"仅供参考"，不得承诺录用结果。

### 7.1 简历解析

#### POST /resume/parse

提交简历解析任务。  
后端接收后将文件送入 AI Provider（配置选 OpenAI / Claude / 通义 / 本地模型），异步完成。

**权限**：`kiosk`

**请求体**（对应前端 `ResumeParseRequest`）

```json
{
  "fileId": "f_abc123",
  "fileName": "resume.pdf",
  "fileFormat": "pdf",
  "source": "upload | scan | manual",
  "sessionId": "sess_xyz",
  "terminalId": "t1"
}
```

**响应**（对应前端 `ResumeParseResponse`）

```json
{
  "taskId": "rr_001",
  "status": "pending | processing | completed | failed",
  "report": null,
  "failReason": null
}
```

> mock 模式下 status 立即为 `completed`，report 直接填充（无需轮询）。  
> http 模式下 status 可能为 `processing`，前端应轮询 `GET /resume/records/:taskId`。

#### GET /resume/records/:taskId

轮询/查询简历解析结果（刷新后恢复）。

**权限**：`kiosk`

**响应**（对应前端 `ResumeParseResponse`）

```json
{
  "taskId": "rr_001",
  "status": "completed",
  "report": {
    "sections": [
      { "key": "basic", "label": "基础信息完整度", "score": 8, "maxScore": 10 },
      { "key": "education", "label": "教育经历完整度", "score": 9, "maxScore": 10 }
    ],
    "suggestions": [
      "项目描述建议使用动词开头，尽量量化成果",
      "技能模块建议补充岗位相关关键词"
    ]
  },
  "failReason": null
}
```

**错误码**：`AI_TASK_NOT_FOUND`（taskId 不存在或已过期）

### 7.2 简历优化

#### GET /resume/records/:taskId/optimize

获取简历优化建议。  
建议在简历解析完成后由后端同步生成（或在首次请求时懒生成），前端直接 GET 获取。

**权限**：`kiosk`

**响应**（对应前端 `ResumeOptimizeResponse`）

```json
{
  "taskId": "rr_001",
  "status": "completed",
  "modules": [
    {
      "title": "个人简介表达优化",
      "before": "热爱工作，积极向上，有较强的学习能力。",
      "after": "建议改为具体可量化的表达：具有 X 年前端经验，熟练掌握 React…"
    }
  ],
  "failReason": null
}
```

> 合规约束：`after` 字段只优化表达方式，后端 Prompt 中必须明确"不生成虚假工作经历或学历"。

### 7.3 简历记录列表

#### GET /resume/records

获取当前 session 的历史解析记录。

**权限**：`kiosk`（按 `sessionId` 筛选，只返回本 session 数据）

**查询参数**：`page`, `pageSize`, `sessionId`

**响应**：[ResumeParseResponse] 分页列表（不含 report 全文，只含摘要字段）

---

## 8. AI 助手

> 合规说明：AI 助手只做功能引导和政策问答，不做企业岗位推荐、简历投递引导、面试邀约等招聘闭环功能。

### 8.1 对话接口

#### POST /assistant/chat

向 AI 助手发送消息，获取回复与操作建议。

**权限**：`kiosk`（匿名会话）

**请求体**（对应前端 `AssistantChatRequest`）

```json
{
  "message": "我想打印简历，怎么操作？",
  "sessionId": "sess_xyz",
  "context": {
    "currentPage": "/resume/source",
    "terminalId": "t1"
  }
}
```

**响应**（对应前端 `AssistantChatResponse`）

```json
{
  "sessionId": "sess_xyz",
  "reply": "您好！打印简历请点击首页"打印扫描"入口，上传文件后即可完成打印。",
  "intent": "print",
  "actions": [
    { "label": "去打印", "route": "/print/upload" },
    { "label": "查看帮助", "route": "/policy" }
  ]
}
```

**意图分类（`intent`）**

| 值 | 含义 | 允许的 `actions` 跳转 |
|----|------|----------------------|
| `resume` | 简历相关 | /resume/* |
| `print` | 打印扫描 | /print/*、/scan/* |
| `job` | 岗位信息 | /jobs、/jobs/:id |
| `fair` | 招聘会信息 | /job-fairs/* |
| `policy` | 政策服务 | /policy |
| `general` | 通用问答 | 任意展示类页面 |

> 禁止的 intent 值（后端 Prompt 强制屏蔽）：`apply`、`candidate`、`hr`、`interview`、`offer`

**错误码**：`AI_SERVICE_UNAVAILABLE`、`AI_RATE_LIMITED`

### 8.2 会话历史（可选，Phase 7.7+）

#### GET /assistant/sessions/:sessionId/history

获取会话历史消息列表（仅本 session 可读）。

**权限**：`kiosk`

**响应**：消息列表，每条含 `role`（user/assistant）、`content`、`timestamp`

---

## 9. AI 服务用量统计

> 供管理员监控 AI 调用量、成本、失败率，辅助运营决策。

### 9.1 汇总统计

#### GET /admin/ai/usage

获取 AI 服务用量汇总。

**权限**：`admin`

**查询参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `dateFrom` | string | 开始日期 ISO 8601 |
| `dateTo` | string | 结束日期 ISO 8601 |
| `terminalId` | string | 按终端筛选（可选） |
| `service` | string | `resume_parse \| resume_optimize \| assistant_chat` |

**响应**

```json
{
  "data": {
    "totalRequests": 1284,
    "successRequests": 1261,
    "failedRequests": 23,
    "successRate": 98.2,
    "avgLatencyMs": 2340,
    "byService": {
      "resume_parse":    { "requests": 542, "avgLatencyMs": 3200 },
      "resume_optimize": { "requests": 498, "avgLatencyMs": 2100 },
      "assistant_chat":  { "requests": 244, "avgLatencyMs": 1800 }
    },
    "provider": "claude",
    "estimatedCostCNY": 68.50
  },
  "meta": { "dateFrom": "2026-05-01", "dateTo": "2026-05-26" }
}
```

> 注：`estimatedCostCNY` 按汇率换算，仅供参考，以 AI 服务商账单为准。

### 9.2 调用日志

#### GET /admin/ai/logs

获取 AI 调用明细日志（脱敏，不含简历内容）。

**权限**：`admin`

**查询参数**：`page`, `pageSize`, `service`, `status` (success|failed), `terminalId`, `dateFrom`, `dateTo`

**响应**：分页列表，每条含

```json
{
  "logId": "log_001",
  "taskId": "rr_001",
  "service": "resume_parse",
  "terminalId": "t1",
  "status": "success",
  "provider": "claude",
  "latencyMs": 2800,
  "createdAt": "2026-05-26T10:05:00+08:00"
}
```

> 合规：日志中不记录简历原文、AI 回复内容、用户身份信息，只记录任务元数据。

---

## 10. 岗位信息

> 合规说明：所有岗位信息来自外部数据源，系统不接收求职者简历，不参与招聘闭环。

**状态机**：
- 审核流：`pending → reviewing → approved + draft` （approve 只进入 draft，不直接 published）
- 发布流：`draft → published → unpublished`
- 保护：未 approved 时发布操作返回 `PUBLISH_REQUIRES_APPROVAL` 错误

### 10.1 Kiosk 公开接口

#### GET /jobs

获取岗位列表（`reviewStatus=approved` + `publishStatus=published`）。

**权限**：`public`

**查询参数**：`tag`, `city`, `page`(默认1), `pageSize`(默认20)

**响应字段**：id, externalId, title, company, city, salary, tags, sourceOrgId, sourceName, sourceUrl, syncTime, workType, headcount, description, requirements, industry

#### GET /jobs/:id

获取已发布岗位详情。

**权限**：`public`

**响应**：同列表字段（含完整 description/requirements/sourceUrl）

### 10.2 Admin 管理接口

#### GET /admin/job-sources

获取全量岗位列表（含所有审核/发布状态）。

**权限**：`admin`

**响应字段**：完整 JobRecord（含 reviewStatus/publishStatus/sourceOrgId/sourceUrl/tags/description/requirements/industry）

#### PATCH /admin/job-sources/:id/review

审核操作。

**权限**：`admin`

**请求体**

```json
{
  "action": "reviewing | approve | reject",
  "reason": "可选，拒绝时填写原因"
}
```

**效果**：
- `approve` → reviewStatus=approved, publishStatus 保持 draft
- `reject` → reviewStatus=rejected, publishStatus=draft
- `reviewing` → reviewStatus=reviewing

#### PATCH /admin/job-sources/:id/publish

发布/下架操作。

**权限**：`admin`

**请求体**

```json
{
  "action": "publish | unpublish"
}
```

**前置条件**：`reviewStatus` 必须为 `approved`，否则返回 `400 PUBLISH_REQUIRES_APPROVAL`

### 10.3 Partner 合作机构接口

#### GET /partner/jobs

获取本机构岗位列表。

**权限**：`partner`

**查询参数**：`sourceOrgId`（可选，按机构筛选）

#### POST /partner/jobs/import

批量导入岗位（默认 `reviewStatus=pending`，`publishStatus=draft`）。

**权限**：`partner`

**请求体**

```json
{
  "sourceOrgId": "org-001",
  "sourceName": "某招聘平台",
  "items": [
    {
      "externalId": "ext-123",
      "title": "前端工程师",
      "company": "某科技公司",
      "city": "上海",
      "sourceUrl": "https://example.com/jobs/123",
      "salary": "15k-25k",
      "tags": ["React", "TypeScript"],
      "description": "...",
      "requirements": "...",
      "workType": "full_time"
    }
  ]
}
```

**响应**：`{ total, created, skipped, errors }`

#### PATCH /partner/jobs/:id/publish

下架本机构岗位（action 固定为 `unpublish`）。

**权限**：`partner`

---

## 11. 招聘会信息

> 合规说明：系统提供招聘会信息展示和现场服务工具，不参与招聘闭环。

**状态机**：同岗位信息（pending→reviewing→approved+draft；draft→published→unpublished）

### 11.1 Kiosk 公开接口

#### GET /job-fairs

获取招聘会列表（`reviewStatus=approved` + `publishStatus=published`）。

**权限**：`public`

**查询参数**：`status`（upcoming/ongoing/ended），`page`, `pageSize`

**响应字段**：id, externalId, name, organizer, startTime, endTime, venue, sourceOrgId, sourceName, sourceUrl, status, description, boothCount, syncTime

#### GET /job-fairs/:id

获取已发布招聘会详情。

**权限**：`public`

### 11.2 Admin 管理接口

#### GET /admin/fair-sources

获取全量招聘会列表（含所有审核/发布状态）。

**权限**：`admin`

#### PATCH /admin/fair-sources/:id/review

审核操作（同岗位 §10.2 规则）。

**权限**：`admin`

#### PATCH /admin/fair-sources/:id/publish

发布/下架操作（同岗位 §10.2 规则）。

**权限**：`admin`

### 11.3 Partner 合作机构接口

#### GET /partner/fairs

获取本机构招聘会列表。

**权限**：`partner`

#### POST /partner/fairs/import

批量导入招聘会（默认 `reviewStatus=pending`，`publishStatus=draft`）。

**权限**：`partner`

**请求体**：`{ sourceOrgId, sourceName, items: [{ externalId, name, organizer, startTime, endTime, venue, sourceUrl, description?, boothCount? }] }`

#### PATCH /partner/fairs/:id/publish

下架本机构招聘会（action 固定为 `unpublish`）。

**权限**：`partner`

---

## 12. 数据源管理

### 10.1 合作机构接口

#### GET /partner/sources

获取本机构数据源列表。

**权限**：`partner`

**响应**：[DataSourceDTO]（不含 apiSecret 等敏感字段）

#### POST /partner/sources

创建数据源配置。

**权限**：`partner`

**请求体**（示例：API 接入）

```json
{
  "sourceName": "某招聘平台 API",
  "sourceKind": "job_platform",
  "accessMode": "api",
  "baseUrl": "https://api.example.com/jobs",
  "authType": "bearer",
  "apiToken": "<server-only-secret>",
  "syncFrequency": "daily",
  "fieldMappingRules": [
    { "sourceField": "job_title", "targetField": "title" },
    { "sourceField": "company_name", "targetField": "companyName" }
  ]
}
```

> 注：`apiToken` 等凭证字段服务端加密存储，响应中永远不返回。响应只含 `credentialConfigured: true`。

#### PUT /partner/sources/:id

更新数据源配置。

#### DELETE /partner/sources/:id

删除数据源（同时停止同步）。

#### POST /partner/sources/:id/sync

手动触发一次同步。

**响应**：`202 Accepted`，返回 `syncJobId`。

#### GET /partner/sources/:id/sync/status

查询同步任务状态。

### 10.2 管理员接口

#### GET /admin/sources

获取全部数据源（含所有机构）。

#### PUT /admin/sources/:id/approve

审批数据源接入。

---

## 13. 导入批次

#### GET /partner/imports

获取本机构导入批次列表。

**权限**：`partner`

**查询参数**：`page`, `pageSize`, `status`, `sourceId`, `dateFrom`, `dateTo`

**响应**：[ImportBatchDTO] 分页列表

#### GET /partner/imports/:batchId

获取批次详情（含字段映射校验结果）。

#### POST /partner/imports/:batchId/retry

重试失败批次。

#### GET /admin/imports

获取全部导入批次（admin）。

---

## 14. 同步日志

#### GET /partner/sync-logs

获取本机构同步日志。

**权限**：`partner`

**查询参数**：`page`, `pageSize`, `sourceId`, `level` (info|warn|error), `dateFrom`, `dateTo`

**响应**：[SyncLogDTO] 分页列表

#### GET /admin/sync-logs

获取全部同步日志（admin）。

---

## 15. 合作机构

#### GET /partner/profile

获取本机构信息。

**权限**：`partner`

**响应**：PartnerDTO（含 sceneConfig，不含凭证）

#### PUT /partner/profile

更新机构信息（非敏感字段）。

#### GET /admin/partners

获取全部合作机构列表。

**权限**：`admin`

#### GET /admin/partners/:id

获取机构详情。

#### PUT /admin/partners/:id/status

启用/停用机构账号。

---

## 16. 管理员后台

### 14.1 工作台

#### GET /admin/dashboard/stats

获取工作台汇总数据。

**响应**

```json
{
  "terminalOnline": 3,
  "terminalTotal": 5,
  "printOrdersToday": 42,
  "printRevenueToday": 12.60,
  "pendingReviewJobs": 8,
  "pendingReviewFairs": 2,
  "activeAlerts": 1
}
```

### 14.2 告警

#### GET /admin/alerts

获取告警列表。

**查询参数**：`status` (open|acknowledged|resolved), `level` (info|warning|critical), `terminalId`

#### PUT /admin/alerts/:id/acknowledge

确认告警。

#### PUT /admin/alerts/:id/resolve

解决告警。

### 14.3 审计日志

#### GET /admin/audit-logs

获取管理员操作日志。

**查询参数**：`page`, `pageSize`, `operatorId`, `action`, `dateFrom`, `dateTo`

---

## 17. 文件服务

#### POST /files/upload

通用文件上传（支持：PDF、Word、JPG、PNG、TIFF，最大 50MB）。

**权限**：`kiosk` | `partner` | `admin`

#### GET /files/:fileId/url

获取文件临时访问 URL（有效期 2 小时）。

**权限**：根据文件所有权校验

#### DELETE /files/:fileId

删除文件（保留删除日志）。

**权限**：`admin`（敏感文件管理员才能删除）

---

## 18. 合规边界

以下功能**永久禁止**出现在任何 API 端点：

| 禁止功能 | 对应禁止端点模式 |
|----------|-----------------|
| 平台内简历投递 | `POST /jobs/:id/apply`（禁止） |
| 企业查看简历 | `GET /companies/:id/resumes`（禁止） |
| 候选人管理 | `GET /candidates/*`（禁止） |
| 简历筛选 | `POST /resumes/filter`（禁止） |
| 面试邀约 | `POST /interviews`（禁止） |
| Offer 管理 | `POST /offers`（禁止） |
| 企业直接发布岗位收简历 | `POST /enterprise/jobs/publish`（禁止） |

系统只记录以下服务行为（不含求职者个人信息）：

- 页面浏览次数
- 二维码展示次数
- 打印服务调用
- 扫描服务调用
- AI 简历服务调用
- 外部链接跳转记录（不含跳转后行为）
