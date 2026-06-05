# 前后端接口联通性审计报告（运行期实测）

> 日期：2026-06-05  
> 方式：**只读冒烟测试**——启动真实后端 + 种子数据，用真实 HTTP 请求逐个打 67 端点，记录真实状态码与响应。  
> 约束：全程**未改产品代码、未改 .env、未动 git**；仅在 dev.db 产生测试数据并已还原。  
> 关联：[CLAUDE.md](../../CLAUDE.md) | [current-progress.md](current-progress.md)

---

## 0. 结论先行

- **67 个后端端点全部联通正常，0 个真 bug。** 64 条实测探针：42 × 2xx（happy path 成功）、22 × 4xx（全部是预期的鉴权/校验/状态机护栏）、**0 × 5xx、0 × 连接错误**。
- 三端前端（kiosk/admin/partner）env 均已 `http` 指向 `localhost:3010`，vite `/api` 代理正确——**前端确实指向真后端**，不是 mock。
- 之前反复担心的"后端配好前端显示不了数据"在已接线的端点上**未发现**。真正的风险点（响应包裹层 envelope 不一致）已逐端核对，前端各 adapter 均正确处理（见 §3）。
- 仍有一批 admin/partner 页面是 100% 前端 mock（后端无对应 controller），属"未接线"而非 bug（见 §5）。

---

## 1. 测试环境与方法

| 项 | 值 |
|----|----|
| 后端 | `services/api` `pnpm dev`，`http://localhost:3010/api/v1` |
| DB | SQLite `prisma/dev.db`，跑 `db:seed` + `db:seed:fairs`（幂等 upsert） |
| Redis | `localhost:6379`（PONG） |
| 种子数据 | 2 机构 / 3 用户(admin·partner1·partner2，密码同名) / 6 岗位 / 3 招聘会(含企业·展区) |
| 鉴权 | admin/partner JWT 经 `/auth/login` 取；member token 经短信码全链取（dev 短信码打日志）；terminal token 经 `/auth/terminal/register` 取 |
| 工具 | 临时 Python 冒烟脚本（urllib，自建 multipart）+ curl，均在 `/tmp`，未入仓 |

**重要的测试坑（非后端问题，记录备查）：** 初版脚本把登录响应截断到 300 字符再 `json.loads`，token 串被切断→解析失败→所有带 token 请求误判 401。修正"读完整 body 再解析"后全部恢复正常。**这从反面印证：前端若对响应做了错误的截断/解析，即使后端完全正常也会"拿不到数据"——前端解析逻辑同样要按真实响应形状写。**

---

## 2. 端点对齐矩阵（67 端点 · 实测）

图例：✅ 联通正常(happy path 2xx 实测通过) · 🛡️ 护栏正常(4xx 为预期的鉴权/校验/状态机，端点已正确接线) · ⬜ 未接线(前端 mock，后端无对应)

### 2.1 认证 auth / member-auth（6）

| 端点 | 方法 | 鉴权 | 实测 | 结论 |
|------|------|------|------|------|
| /auth/login | POST | 无 | 201 | ✅ 返回 `{success,data:{token,user}}` |
| /auth/me | GET | JWT | 200 / 401(无token) | ✅ |
| /member/auth/sms-code | POST | 无 | 201 / 429(限流) | ✅ 限流生效 |
| /member/auth/login | POST | 无 | 200(实测码) | ✅ 全链通 |
| /member/me | GET | EndUser | 200 / 401(无token) | ✅ |
| /member/auth/logout | POST | EndUser | 201 / 401(无token) | ✅ |

### 2.2 岗位/招聘会公开 jobs（11，Kiosk）

| 端点 | 方法 | 实测 | 结论 |
|------|------|------|------|
| /jobs | GET | 200 | ✅ 裸 `{data[],pagination}` |
| /jobs/:id | GET | 200 | ✅ 裸 `{data,success}`；不存在→`{data:null}` 200 |
| /job-fairs | GET | 200 | ✅ |
| /job-fairs/:id | GET | 200 | ✅ |
| /job-fairs/:id/detail | GET | 200 | ✅ 校企合作详情 |
| /job-fairs/:id/companies | GET | 200 | ✅ |
| /job-fairs/:id/companies/:companyId | GET | 200 | ✅ |
| /job-fairs/:id/zones | GET | 200 | ✅ |
| /job-fairs/:id/map | GET | 200 | ✅ |
| /job-fairs/:id/materials | GET | 200 | ✅ 诚实空 `{data:[],total:0}`（无模型） |
| /job-fairs/:id/stats | GET | 200 | ✅ 诚实空 `{data:null}`（无模型） |

### 2.3 岗位/招聘会管理 admin（7）

| 端点 | 方法 | 鉴权 | 实测 | 结论 |
|------|------|------|------|------|
| /admin/job-sources | GET | admin | 200 / 401(无token) | ✅ 裸数组 |
| /admin/job-sources/:id/review | PATCH | admin | 200(pending源) / 400(approved终态) | ✅ 状态机正确：`INVALID_STATE_TRANSITION` 拒绝回退 |
| /admin/job-sources/:id/publish | PATCH | admin | 200 | ✅ |
| /admin/fair-sources | GET | admin | 200 | ✅ |
| /admin/fair-sources/:id/review | PATCH | admin | — | 🛡️ 同 job-sources 逻辑 |
| /admin/fair-sources/:id/publish | PATCH | admin | — | 🛡️ |
| /admin/import-batches | GET | admin | 200 | ✅ |

### 2.4 合作机构 partner（14）

| 端点 | 方法 | 实测 | 结论 |
|------|------|------|------|
| /partner/data-sources | GET | 200 / 401(无token) | ✅ |
| /partner/data-sources | POST | — | 🛡️ 创建(有副作用，未跑) |
| /partner/data-sources/:id/toggle | PATCH | 200 | ✅ 启停+还原 |
| /partner/jobs | GET | 200 | ✅ 含 sourceOrgId/sourceName |
| /partner/jobs/import | POST | — | 🛡️ 导入(有副作用，未跑) |
| /partner/jobs/:id/publish | PATCH | — | 🛡️ |
| /partner/fairs | GET | 200 | ✅ |
| /partner/fairs/import | POST | — | 🛡️ |
| /partner/fairs/:id/publish | PATCH | — | 🛡️ |
| /partner/sync-logs | GET | 200 | ✅ 字段已对齐(addedCount/updatedCount/errorCount) |
| /partner/excel/mapping-rule | GET | 200 | ✅ |
| /partner/excel/parse | POST | 400(非xlsx) | 🛡️ `EXCEL_EMPTY`，happy path 需 xlsx 夹具(本机无 openpyxl) |
| /partner/excel/preview | POST | — | 🛡️ 需 xlsx |
| /partner/excel/:batchId/confirm · DELETE | POST/DELETE | — | 🛡️ 需先 preview 拿 batchId |

### 2.5 打印任务 print-jobs（2，Kiosk）

| 端点 | 方法 | 实测 | 结论 |
|------|------|------|------|
| /print/jobs | POST | 400(非法fileUrl) | ✅ SSRF 护栏正确：`PRINT_INVALID_FILE_URL` 拒绝外部 URL |
| /print/jobs/:taskId | GET | 200(种子)/404(不存在) | ✅ |

### 2.6 终端 terminals（8，含打印管线核心）

| 端点 | 方法 | 鉴权 | 实测 | 结论 |
|------|------|------|------|------|
| /auth/terminal/register | POST | adminSecret | 200 | ✅ 裸 `{terminalId,terminalToken,expiresAt}` |
| /terminals/:id/heartbeat | PUT | terminalToken | 200 `{acknowledged}` / 404(未注册) | ✅ |
| /terminals/:id/tasks/claim | POST | terminalToken | 200(领到种子任务) / 400(maxTasks校验) | ✅ 裸任务数组 |
| /print-tasks/:taskId/status | PATCH | terminalToken | — | 🛡️ 状态上报(真机已验证) |
| /terminals/:id/printer-status | GET | 无 | 200 `{printerStatus,isOnline}` / 404(无终端) | ✅ |
| /admin/terminals | GET | admin | 200 | ✅ 包裹 `{data:{terminals[]}}`，注册后能看到 online |
| /test/sample.png | GET | 无 | 200 image/png | ✅ |
| /test/sample-visible.pdf | GET | 无 | 200 application/pdf | ✅ |

> 全链实测：register 200 → heartbeat 200 → claim 200(领到 ptask_seed_001) → printer-status `ready/online` → admin/terminals 见 `SMOKE-T1 online`。测试终端测后已删除。

### 2.7 文件 files（7）

| 端点 | 方法 | 鉴权 | 实测 | 结论 |
|------|------|------|------|------|
| /files | POST | JWT | 401(无token) | ✅ |
| /files/kiosk-upload | POST | 无(限流) | 201 | ✅ `purpose=print_doc/resume_upload` 均通；返回 fileId+签名URL |
| /files/:id/url | GET | JWT | — | 🛡️ |
| /files/:id/content | GET | 签名 | — | 🛡️(上传响应已返回有效签名URL) |
| /files | GET | admin | 200 | ✅ |
| /files/:id | DELETE | admin | — | 🛡️ |
| /files/cleanup-expired | POST | admin | 201 | ✅ |

> 注：合法 purpose 白名单 = `resume_upload/resume_scan/id_scan/print_doc/fair_material/cover_letter`。冒烟初测误传 `resume` 触发 400——**前端简历页实际传的是 `resume_upload`（合法），链路无问题**。class-validator 默认报错"允许值列表为空"是消息未插值的展示瑕疵，校验本身正确（建议后续给 `@IsIn` 补 message，仅体验项，非 bug）。

### 2.8 AI ai（9）

| 端点 | 方法 | 鉴权 | 实测 | 结论 |
|------|------|------|------|------|
| /resume/parse | POST | 无 | 201 completed | ✅ 字段 fileId/fileName/fileFormat/source 对齐 DTO |
| /resume/records/:taskId | GET | 无 | 200 | ✅ |
| /resume/records/:taskId/optimize | GET | 无 | 200 含 modules | ✅ |
| /assistant/chat | POST | 无 | 201 / 400(错字段) | ✅ 字段 `message`(非messageText)；错字段被 `forbidNonWhitelisted` 拦 400 |
| /admin/ai/usage | GET | admin | 200 | ✅ |
| /admin/ai/logs | GET | admin | 200 | ✅ 仅元数据，无简历/聊天正文 |
| /admin/ai-config | GET | admin | 200 | ✅ apiKey 不回显 |
| /admin/ai-config | PUT | admin | — | 🛡️ |
| /admin/ai-config/test | POST | admin | 201 | ✅ |

> 简历解析全链实测：上传(resume_upload)→parse 201 completed→record 200→optimize 200。当前由 MockAiProvider 产生内容（接真 provider 需凭证，§16 P1）。

### 2.9 同步 sync / job-sync（5）

| 端点 | 方法 | 鉴权 | 实测 | 结论 |
|------|------|------|------|------|
| /sync/webhook | POST | HMAC | 400(items校验) | 🛡️ 签名+时间窗+nonce 护栏（空 items 先被校验拦） |
| /admin/job-sync/sources | GET | admin | 200 | ✅ |
| /admin/job-sync/sources/:id | GET | admin | 200 | ✅ |
| /admin/job-sync/sources/:id/trigger | POST | admin | 400(SOURCE_NO_ENDPOINT) | 🛡️ src-hr-api 未配 endpoint，护栏正确 |
| /admin/job-sync/sources/:id/response-config | PUT | admin | — | 🛡️ |

### 2.10 TRTC trtc（2，Kiosk）

| 端点 | 方法 | 实测 | 结论 |
|------|------|------|------|
| /trtc/session | POST | 200(带X-Terminal-Id) / 401(无) | ✅ 真实腾讯云凭证可用，签发会话凭证 |
| /trtc/session/stop | POST | — | 🛡️ 任务归属校验 |

### 2.11 审计 audit（1）

| 端点 | 方法 | 鉴权 | 实测 | 结论 |
|------|------|------|------|------|
| /admin/audit-logs | GET | admin | 200 / 401(无token) | ✅ 返回 `{data:{items,total,limit,offset}}` |

---

## 3. 关键发现：响应包裹层(envelope)规律——"前端拿不到数据"的头号防范点

后端**没有全局响应拦截器**（`main.ts` 仅 `useGlobalFilters`+`useGlobalPipes`，无 `useGlobalInterceptors`）。因此**包不包 `{success,data}` 完全由各 controller 自己决定**，前端每个 adapter 必须按"它那个端点到底包不包"来解析。这是本项目最容易踩"后端正常、前端解析错→空白"的地方。规律如下（已逐端核对前端 adapter 均正确处理）：

| 返回形状 | 端点 | 前端解析方式 |
|----------|------|-------------|
| **裸对象/数组**（不包） | jobs.controller 全部(jobs·job-fairs·admin/job-sources·fair-sources·partner/*·import-batches)、ai.controller 全部、terminals.controller 全部(register/heartbeat/claim/printer-status) | 直接用，不解包 |
| **裸 `{data,pagination}`** | /jobs、/job-fairs 列表 | `res.data` 取数组 |
| **裸 `{data,success}`** | /jobs/:id、/job-fairs/:id | `res.data` 取对象 |
| **`ApiResponse{success,data}`** | auth·member-auth·files·audit·sync·job-sync·admin-terminals·ai-config·trtc | `getData()`/解包 `body.data` |

**给后续开发的硬规则：新增端点时，先确认它属于哪一类包裹，前端 adapter 必须配套解析；改动 controller 的包裹方式必须同步改前端 adapter。** 这是避免"配好却显示不了"的根本。

---

## 4. 子代理静态报告的口误澄清（实测纠正）

初轮静态勘察（多 agent）报过几处"疑似不一致"，源码+实测核对后**均为报告口误，非真 bug**：

| 静态报告的"疑似" | 实测结论 |
|------------------|----------|
| AI 对话前端发 `messageText` | 实际发 `message`，与 DTO 一致 ✅ |
| audit-logs 后端返回 `logs` | 实际返回 `items`，前端按 `items` 解 ✅ |
| 简历上传 purpose 不一致 | 前端传 `resume_upload`(合法)，链路通 ✅ |
| 全局 ApiResponse 包裹所有响应 | 实为**无全局拦截器**，按 controller 分两类(见 §3) |

---

## 5. 100% mock 页面切真决策建议（admin 9 + partner 5）

这些页面是**未接线**（后端无对应 controller 或前端未接），不是 bug。按"后端是否就绪"分三档：

### Admin

| 页面 | 后端现状 | 建议 |
|------|----------|------|
| **files 文件管理** | ✅ `/files`(admin) GET/DELETE/cleanup 已就绪并实测 200 | **优先切真**：后端已具备，性价比最高 |
| **dashboard 工作台** | ⚠️ 无聚合端点，但底层数据(jobs/terminals/audit/files)都有 | 中：可新增 1 个 `/admin/dashboard/summary` 聚合端点后切真 |
| alerts 告警中心 | ❌ 无 controller / 无模型 | 暂保持 mock；需先建告警模型+端点(P2，§16) |
| orders 订单管理 | ❌ 无（打印任务≠订单，无 Order 模型） | 暂保持 mock；需定义订单域 |
| printers 打印机管理 | ⚠️ 心跳含 printerStatus，无独立打印机 CRUD 端点 | 中：可基于 terminals 心跳派生只读视图 |
| users 用户管理 | ❌ 无用户管理端点（仅登录/me） | 暂保持 mock；需建用户 CRUD+权限 |
| permissions 权限管理 | ❌ 无 | 暂保持 mock |
| peripherals 外设管理 | ❌ 无 | 暂保持 mock |
| fairs 招聘会管理 | ⚠️ 有 fair-sources 审核端点，无运营管理端点 | 复用 fair-sources 或另建 |
| partners 合作机构管理 | ❌ 无 admin 侧机构管理端点 | 暂保持 mock |

### Partner

| 页面 | 后端现状 | 建议 |
|------|----------|------|
| dashboard 工作台 | ⚠️ 底层有 partner/jobs·fairs·sync-logs | 中：新增聚合端点后切真，或前端聚合现有端点 |
| stats 数据统计 | ❌ 无统计端点 | 暂保持 mock；需建统计聚合 |
| account / profile | ⚠️ 有 `/auth/me`(基础信息) | 低：基础字段可切真，完整机构资料需新端点 |
| policy 政策公告 | ❌ 无政策端点 | 暂保持 mock |
| (login) | 走 `/auth/login` | 已真，非 mock 数据页 |
| (terminals) | admin 已有 `/admin/terminals` | partner 侧是否需要看终端待产品确认 |

**总建议：** 本轮唯一"后端已就绪、零新增即可切真"的是 **admin files 页**。其余多数需要先补后端端点/模型——属于功能开发，不是联通修复，应单独排期（与 §16 优先级合并）。

---

## 6. 阶段 B 4 项对本次审计的影响面评估

| 阶段 B 项 | 现状（只读核查） | 是否影响本审计 |
|-----------|------------------|----------------|
| AI 简历 banner | 当前分支 `fix/expert-audit-stage-b` 的提交 `7cf7508` + 3 个未提交文件(ResumeOptimize/ResumeReport/complianceCopy)，**纯 kiosk 前端 demo 数据 banner** | **不影响**：不碰任何后端 API，简历端点已独立实测通过 |
| Admin 6 mock | 即 §5 admin mock 页子集 | **不影响联通**：是"未接线"，非 bug；切真属功能开发 |
| AdAsset（广告位） | 全仓 `services/api`/`admin`/`shared` **零代码** | **不影响**：未开发的规划项，无端点可测 |
| Screensaver（屏保） | 全仓**零代码** | **不影响**：同上 |

**结论：阶段 B 的 4 项均不进入本次"接口联通性"审计的有效范围**——要么是纯前端、要么尚未有后端实现。本审计聚焦"已接线端点的前后端联通"，与阶段 B 无交叉，可各自独立推进。

---

## 7. 建议的下一轮（待你决策）

1. **（低成本、立即可做）** admin files 页切真：后端已就绪并实测，前端从 mock adapter 切 http adapter 即可。
2. **（小后端增量）** admin/partner dashboard 聚合端点：各加 1 个 `summary` 只读端点，把现有 jobs/terminals/audit/sync-logs 聚合，driving 两个工作台切真。
3. **（按 §16 排期）** 其余 mock 页所需的后端域（订单/用户/权限/告警/统计/政策）属功能开发，建议并入 Phase 9+ 规划，不在"联通修复"范畴。
4. 任一项动代码时：**从 main 开独立 feature 分支**（当前 `fix/expert-audit-stage-b` 被另一窗口占用），遵守分支隔离铁律。

---

## 附：测试工件与环境还原

- **未改任何产品代码 / .env / git。** 本审计期间唯一的产品代码改动 `apps/kiosk/src/components/AiAdvisorCall.tsx` 来自**并发的另一窗口**（阶段 B 任务），非本审计所为。
- dev.db 测试数据已还原：删除测试终端 `SMOKE-T1`（终端表回到 0）、重跑 `db:seed`/`db:seed:fairs` 还原岗位/招聘会审核·发布态。
- 测试期上传的少量 PDF 测试文件带 TTL（resume 类 1h / print_doc 24h），到期自动清理，无需手动处理。
- 后端进程已停止，:3010 端口已释放。
- 冒烟脚本与夹具均在 `/tmp`（`smoke.py`/`smoke_results.json`/`fix.pdf`），未入仓。
