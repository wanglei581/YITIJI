# 下一步任务

> 最后更新：2026-06-07（AI求职材料中心 B-2 基础页数识别 + 图片清晰度预检 + PII 四类扫描 + A4 规范化评估 + PII 遮挡评估最小契约已推进，B-1 浏览器链路已手验）
> 关联文档：[current-progress.md](./current-progress.md) | [campus-recruitment-design.md](../product/campus-recruitment-design.md)

---

## 🧭 下一步候选（2026-06-06 阶段收口后）

`main`（`6ac1ac4`）已确认为可开新功能的干净基线（核查见 [current-progress.md](./current-progress.md) §阶段收口基线核查）。三个候选方向，按需取一推进：

### A. 宣传屏真机手验（验证收尾，最轻）

- 自动化已覆盖「上传→存 COS→签名→回源读→删除」字节链路（`verify:cos` 37 + `verify:cos:files` 30）与 Admin 接口 200；**未做**的是浏览器/真机点检。
- 步骤：Admin 登录 → 宣传屏 → 上传图片/视频（落 COS `screensaver/materials/`）→ 配置播放方案 + 绑定终端 → Kiosk 无操作进入 `/screensaver` 看轮播/播放 → 删除素材确认 COS 对象回收 + 卡片消失。
- 产出：手验记录 + 截图；如发现回源/缓存/签名问题再开 fix 分支。

### B. 外部视频直链素材（已在分支，待收口合入）

- 分支 `feature/screensaver-external-video-v2`（基于 `6ac1ac4`，+1 commit `99c3711`），允许管理员登记 HTTPS mp4/webm 直链，Kiosk 直连播放，免重复上传大视频。详见 [current-progress.md](./current-progress.md) §宣传屏支持外部视频直链素材。
- 现状：代码 + URL 安全校验（仅 https、阻断私网/内网/SSRF 面、扩展名白名单）+ `verify:external-video` 纯函数与 service E2E 已绿。
- 待办：人工 review → 真机播一条外链 → FF 合入 main（合入后 A 的手验可一并覆盖外链路径）。

### C. 新功能开发（在干净 main 上起新分支）

- 从 `6ac1ac4` 起新 `feature/*` 分支。优先级参考下方既有 P0/P1：
  - AI求职材料中心 Phase B-1 Kiosk 上传体检 + PII 检查最小闭环（Phase A-2 `materials/document-processing` 后端骨架 + 匿名 token / 过期清理 / params 白名单安全收口已完成）。
  - Excel 字段映射 service 接入收尾（注：T1/W4 已大部完成，剩 CLAUDE.md §16/§18 过时描述校正）。
  - 真实 AI provider 接通（持久化层已就绪，缺外部凭证）。
- 合规红线不变：不做站内投递 / 企业收简历 / 候选人筛选 / 面试邀约 / Offer。

---

## 📌 腾讯云 COS 对象存储接入（2026-06-06，`feature/cos-storage-integration`，已完成代码 + 验证）

详见 [current-progress.md](./current-progress.md) §腾讯云 COS 对象存储接入 与 [docs/api/cos-object-storage.md](../api/cos-object-storage.md)。

- ✅ `StorageService` 抽象 + 本地/COS 双后端,`FILE_STORAGE_DRIVER` 切换;COS 手写预签名 URL(复刻官方算法,独立重算单测)。
- ✅ `FileObject` 扩为统一文件资产表(bucket/region/ownerType/ownerId/visibility/status/createdBy);additive 迁移已 `db execute` 落 dev.db。
- ✅ 5 新端点:upload-intent / :id/raw / :id/complete / :id/download-url / :id/preview-url;下载预览支持 User + 会员双身份;管理员访问用户文件写审计。
- ✅ 现有 Kiosk 上传 / 打印 / Admin 文件管理 / Partner 上传 / 宣传屏素材透明切 COS,前端无需改动。
- ✅ api/shared/kiosk/admin typecheck/lint/build 全绿;`verify:cos`(37)+`verify:cos:files`(30) 全过;启动 + DI + 12 路由 mapped。
- ⏳ **[凭证]** 真实 COS 端到端:用户在 `services/api/.env` 配 `FILE_STORAGE_DRIVER=cos` + `TENCENT_COS_SECRET_ID/SECRET_KEY/BUCKET/REGION`,跑 `pnpm --filter @ai-job-print/api verify:cos:live`(put→head→get→签名下载→delete)。当前无凭证 SKIPPED。
- ⏳ **[择期]** 打印 / 宣传屏内容改 Kiosk/Agent 直连 COS 预签名 URL(当前走 `/content` 代理签名,短 TTL,合规可用,只是多一跳)。
- ⏳ **[择期]** `AdAsset` 加 `bucket/region` 列以支持宣传屏素材跨后端混合环境(当前单 driver 部署足够)。
- ⏳ **[基础设施]** PostgreSQL 迁移时,本迁移随 dev.db drift 一并重生成规范化(与既有 PG 迁移条目合并处理)。
- ✅ **[已合入]** 已通过 [PR #22](https://github.com/wanglei581/YITIJI/pull/22) 合入 main(merge commit `7bafc92`);`feature/cos-storage-integration` 分支已清理(本地 + 远端删除)。

**🚀 生产上线部署清单(COS):**

- [ ] 生产环境显式设置 `FILE_STORAGE_DRIVER=cos`(**漏设会按默认 `local` 静默落本地 FS、不报错、文件不上 COS——上线风险点**)。
- [ ] 生产环境配置 4 个变量:`TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY`、`TENCENT_COS_BUCKET`、`TENCENT_COS_REGION`(密钥仅注入生产 env,**不入仓库、不回显**)。
- [ ] **上线前轮换腾讯云 CAM 子用户密钥**(配置过程中真实密钥曾在终端回显,属已暴露;新密钥只填生产服务器)。
- [ ] 确认生产「上传 / 下载 / 预览」走 COS 临时签名 URL(可看启动日志 `StorageService driver=cos ... cosAvailable=true`,并实际跑一次上传→签名 URL 下载验证)。

---

## 📌 QA P0 真机联调修复（2026-06-06，已完成代码 + 静态验证）

详见 [current-progress.md](./current-progress.md) §QA P0 真机联调修复。

- ✅ `GET /terminals/:terminalId/printer-status` 支持 `terminalCode`，Kiosk `KSK-001` 不再因内部 cuid 查询口径返回 404。
- ✅ 待机屏配置列表/保存/Kiosk 拉取统一使用 `terminalCode`，同时兼容历史内部 `id` 配置。
- ✅ 新增 `GET /admin/printers`，Admin 打印机页移除本地 `MOCK_PRINTERS`，改接真实终端心跳聚合数据；未上报的型号/SN/耗材/纸张字段明确显示「未上报」。
- ✅ `seed.ts` 补 `KSK-001` 终端 + heartbeat，供本地/真机联调默认业务码链路使用。
- ✅ 已实跑 `pnpm --filter @ai-job-print/api db:seed`，当前 dev.db 已有 `KSK-001` 终端与 heartbeat。
- ✅ DTO 同类 `@IsEnum([...])` 文案 bug 已改 `@IsIn([...])`。
- ✅ api/admin `typecheck`、`lint`、`build` 全绿。
- ✅ 临时 API:3011 HTTP 复验通过：`/terminals/KSK-001/printer-status`、`/admin/printers`、`/terminals/KSK-001/screensaver` 均按预期返回。
- ⏳ 现有后台服务（api 3010、admin 5174）仍需重启，才能加载本轮新代码。

## 📌 AI求职材料中心开发路线（2026-06-06，方案已沉淀）

详见 [operation-manual-feature-landing-plan.md](../product/operation-manual-feature-landing-plan.md)、[project-state-audit-2026-06-06.md](./project-state-audit-2026-06-06.md) 与 [current-progress.md](./current-progress.md) §AI求职材料中心开发方向与项目状态审计。

**开发方向：**

- 把截图中的能力收敛成 `AI求职材料中心`，不做应用广场式平铺。
- 第一层能力：简历体检、结构化解析、字段修正、优化建议、模板打印。
- 第二层能力：打印材料包、上传体检、A4 归一化、PII 检查。
- 第三层能力：面试训练、岗位适配参考、职业规划、求职证件照。
- 明确不做：AI 自动招聘机器人、问答式生成职位、企业侧 JD 生成、企业 ATS / 候选人筛选。

**MVP 范围：**

- `Kiosk` 打印前 PII 检查：识别手机号、邮箱、身份证片段、地址等，用户逐项选择保留/遮挡。
- `Kiosk` 上传体检 + 统一 A4 + 打印材料包：加密/超大/格式/清晰度检查，多材料排序后合并进入 A4 打印任务。
- `Kiosk` 简历字段人工修正 + 原文对照：AI 解析后允许逐字段编辑、保存和版本对比。
- `Admin` 异常事件时间线：打印任务、Agent 上报、失败、重试、改派、人工处理串成可追溯事件流。

**推荐执行顺序：**

1. ✅ **Phase A-1 资产归属底座**：`EndUser` 与 `FileObject` / `AiResumeResult` / `PrintTask` 已建立可空关系；Kiosk 登录态上传、AI 解析、打印任务会带内存 token 绑定本人；匿名流程继续可用。详见 [current-progress.md](./current-progress.md) §Phase A-1。
2. ✅ **Phase A-2 材料处理任务骨架 + 安全收口**：已新增 `materials/document-processing` 域，落 `DocumentProcessTask` / `PiiFinding` 基础模型和状态 API；匿名任务必须携带一次性访问 token；过期任务读取拒绝并支持 cleanup；`paramsJson` 按任务 kind 白名单落库；`verify:materials-processing` 已覆盖。详见 [current-progress.md](./current-progress.md) §Phase A-2。
3. ✅ **Phase B-1 Kiosk 最小可用闭环（代码接线 + session 恢复 + 隐私收紧完成，待浏览器/真机验证）**：上传体检 → PII 检查 → 打印参数 → 确认打印；一体机完成“上传 / 检查 / 确认 / 打印”的真实可用链路。
   - Kiosk：在现有 `AI简历服务` / `打印扫描` 流程中插入材料体检页与 PII 检查页，不新增底部 Tab。
   - API：Kiosk 调 `POST /materials/tasks` 创建 `inspection` 与 `pii_scan` 任务；匿名链路保存一次性 `accessToken` 到当前页面态/会话态，不写入长期本地存储。
   - Session：`sessionStorage` 只保存文件必要字段、任务 `id/status/accessToken`、隐私检查摘要和打印参数；不保存原文、`params/result`、`piiFindings[].snippet`。
   - UI：PII 命中项只展示类型、片段和建议动作，用户选择 `保留` / `遮挡`；检查提示必须写明“仅用于本次打印前确认，不向第三方发送”。
   - 验收：会员文件只能本人访问；匿名任务无 token/错 token 拒绝；刷新或返回后能恢复当前任务；打印确认页不出现投递、推荐企业、候选人等招聘闭环语义。
4. 🔄 **Phase B-1 验证收尾（下一步优先）**：浏览器 HTTP 模式和一体机真机触控手验。
   - 当前 `.env` 如为 `FILE_STORAGE_DRIVER=cos`，先切到 local 存储或使用明确的测试 COS 桶/前缀，避免把本地测试文件写入生产 COS。
   - ✅ 2026-06-07 已跑通本地真实 API 链路：`上传 -> 打印前材料检查 -> 打印设置 -> 确认打印 -> 进度页 -> 完成页`；API 使用 local 文件存储，Kiosk 走 http 模式，Terminal Agent claim/status 由本地测试终端 API 模拟完成。
   - ⏳ 仍需 Windows Terminal Agent + 奔图真机出纸验证：真实 Agent 下载文件、SHA-256 校验、调用打印机、回写 `printing/completed/failed`。
   - 确认 `/print/material-check` 不被待机宣传屏打断。
   - 确认真实 API 模式下匿名 `accessToken` 查询 / 决策生效。
   - 手验刷新 / 返回后的当前任务恢复：不得重复创建 `inspection` / `pii_scan`，不得丢失 `fileId` / `accessToken` / 隐私摘要 / 打印参数。
   - 手验提交打印或待机进入宣传屏后，`sessionStorage` 中不得残留上一位用户的材料任务上下文。
   - UI 拥挤 / 预览原因说明已在 `/print/preview` 修复：PDF/图片可嵌入预览，无预览 URL、mock 演示、签名链接过期或 Word 未转换时会解释原因；价格说明和打印须知默认展开，页面改为单一滚动，底部操作区不再覆盖内容；后续真机手验仍需继续观察触控屏文本是否越界。
5. 🔄 **Phase B-2 真实材料处理**：基础页数识别 + 图片清晰度预检 + PII 四类扫描 + 体检摘要 + A4 规范化评估 + PII 遮挡评估最小契约已推进：`inspection` 对图片返回 `pageCount=1` / `canPrint=true`，并可读取 png/jpeg 文件头返回像素尺寸、A4 DPI 估算和低清晰度 warning；PDF 先做轻量 `/Type /Page` 字节扫描；不可读 PDF 源文件会 `canPrint=false` 并在 Kiosk 禁用继续、引导重传；`pii_scan` 当前可从文件名/文本样本识别手机号、邮箱、身份证号和常见中文地址片段，且完整原文仍不落库；`normalize_a4` 已返回 `targetPaperSize=A4` / `canNormalize` / `normalizedFileId=null` 的诚实评估结果，仅对图片或页数明确识别的 PDF 给 `canNormalize=true`，非 A4 参数受控拒绝，不伪造新文件；`pii_redact` 已能基于 PII 决策任务返回遮挡评估 counts、`redactedFileId=null`、`resultFileCreated=false`，Kiosk 会明确提示“当前版本尚未生成遮挡后文件，打印仍使用原文件”；Kiosk 流程为 `inspection → normalize_a4 → pii_scan → pii_redact(确认选择后)`，会把识别页数写回当前打印会话，并展示文件体检、A4 摘要和遮挡评估反馈。后续仍需接入真实 OCR / PDF 渲染级清晰度检查 / 真实 A4 产物 / 真实 PII 遮挡产物 / 材料包合并。AI 只输出结构化 JSON 与建议，最终 DOCX/PDF 由模板渲染链生成。
6. ⏳ **Phase C Admin 运营闭环**：异常事件时间线、粗粒度终端推荐、任务改派、暂停接单、维护备注。
7. ⏳ **Phase D 合规后的简历增强**：按岗位方向优化简历 + 模板库；必须使用“目标岗位方向/意向城市/自荐信”等改造文案，不出现站内投递语义。
8. ⏳ **Phase E 校园支付场景**：学生免费/校园卡/退款/对账；必须先补真实订单域，不能堆在 mock 订单页。

**明确暂缓：**

- 暂缓把“按岗位方向优化简历”放进第一批 MVP，避免在数据流未收口时滑向招聘闭环。
- 暂缓学生免费/校园卡，直到 `Order` / `PaymentAttempt` / `Refund` / `BenefitGrant` 等订单支付域就绪。
- 暂缓精细耗材最优调度，直到 Terminal Agent 真实上报耗材、纸盒、SN 等字段。
- 不做 Kiosk 首页 KPI、大表格、多维运营筛选。

## 📌 PR-E Admin 工作台真实 KPI 接入（2026-06-05，`feature/admin-dashboard-real-kpi-clean`，待验证 / PR）

详见 [current-progress.md](./current-progress.md) §PR-E。

- ✅ 基于当前 main service shape 重写工作台，不 cherry-pick 旧 `501e5ac`。
- ✅ 工作台只展示已有真实后端来源的数据：终端在线、待审核岗位/招聘会、近 100 条内待清理文件、AI 调用、最近审计操作。
- ✅ 移除今日订单、今日收入、待处理告警、打印任务实时数等无真实端点支撑的编造指标；后续端点完成后再接入。
- ⏳ 待验证：admin typecheck/lint/build、合规禁词扫描、mock/http/error 三态截图或 Playwright。

## 📌 PR-D 诚实化/合规 UI（2026-06-05，`feature/honesty-compliance-ui-clean`，待 GitHub review）

详见 [current-progress.md](./current-progress.md) §PR-D。

- ✅ 从 `feature/kiosk-honesty-admin-dashboard` 精取 `9a82957`（简历诚实文案）+ `b7896c3`（禁用假写按钮 + mock 横幅），共 12 文件。
- 🚫 已剔除 terminals（main 已接真后端）、旧文档 hunk；范围不含 files 接真 / W0 / 工作台 KPI / LLM guard / TRTC。
- ✅ **后续单独 PR**：PR-E 工作台 KPI 接真已进入 `feature/admin-dashboard-real-kpi-clean`；`e1c0a8b` 是否纳入待单独判断。

## 📌 T1 Excel 字段映射规则持久化与复用（2026-06-04，`claude/t1-excel-field-mapping`，已完成代码 + 三绿 + 运行期断言）

详见 [current-progress.md](./current-progress.md) §〇。

- ✅ **澄清事实差异**：CLAUDE.md §16 / §18 把「Excel 字段映射 service 接入 + 后端落 ImportBatch」列为 P0 待办，**实际已由 W4 完成**。本轮只补真正未做的增量 `FieldMappingRule`（schema 此前无 model，映射每次手工重做）。
- ✅ 新增 `model FieldMappingRule`（`@@unique([sourceId,dataType])`）+ 非破坏性 migration（dev.db 有 drift，沿用 `db execute` 先例，未跑破坏性 reset）。
- ✅ 后端 `getMappingRule` / `confirmExcelImport` 落地映射；`GET /partner/excel/mapping-rule`。
- ✅ Partner 向导导入时自动回填上次映射 + 「已套用」提示；http/mock 双 adapter 接入。
- ✅ shared/api/partner typecheck + api/partner lint/build 三绿；运行期断言 5 项全过；禁词 0 命中。
- ✅ **[已完成 2026-06-04，Q1 复核] HTTP 端到端联调**：真实 API:3010 + partner JWT 走通 parse→preview→confirm→GET mapping-rule 读回 + 跨机构 404 + 非法 dataType 400，`pnpm verify:field-mapping:http` → ALL PASS（自清理 dev.db）。详见 [current-progress.md §〇·Q1](./current-progress.md)。复核确认敏感列拦截 / `fieldMapping` 字段名等后端护栏均生效，Q1 范围内无 bug。
- ⏳ **[待办] CLAUDE.md §16/§18 过时描述校正**：本窗口无权改 CLAUDE.md（不在 T1 允许目录），需在有权限的窗口把「Excel 字段映射 service 接入」标为已完成。
- ⚠️ **[基础设施依赖] PostgreSQL 迁移时**：本轮 `FieldMappingRule` 迁移随 dev.db drift 一并需在 PG 迁移时重生成规范化（与下方 PostgreSQL 迁移条目合并处理）。
## 📌 T2 BullMQ API 拉取 worker 验证（2026-06-04，`claude/t2-api-pull-worker`，基于干净 main `fc0018a`）

详见 [current-progress.md](./current-progress.md) §〇。

- ✅ **验证优先，0 运行代码改动**：以干净 main 为基线复验 W8 已实现的 BullMQ API 拉取 worker。
- ✅ 真实 Redis（`redis://localhost:6379`，PONG）+ BullMQ 路径：`pnpm verify:job-sync` → **ALL PASS**。
- ✅ 走真实 worker 确认：`enqueue()` 返回 `jobId=<sourceId>_manual`（队列 jobId），非 inline fallback；`JobSyncProcessor` 从队列 claim 并执行 `pullApiSource`。
- ✅ 成功路径：2 条岗位落库 + `SyncLog.result=success` + `reviewStatus=pending/publishStatus=draft`（合规）。
- ✅ 失败路径：HTTP 503 → `SyncLog.result=failed` + `errorDetail=HTTP_503` + 0 脏数据。
- ✅ api typecheck / lint / build 三绿。
- ⏳ **[待办] 生产 REDIS_URL 必配**：inline fallback 仅供 dev；生产须挂真实 Redis 才有 BullMQ 持久化/重试语义。
- ⏳ **[待办] 真源 API 联调**：本验证用本地 mock HTTP 源；接一个真实外部岗位 API 端到端验证 responseConfig auto-detect + 字段映射，留待后续。
- ⏳ **[待办] FF merge**：验证通过，待人工确认后将 worker 能力相关分支 FF 合入 main（本窗口不 push、不 merge）。

---

## 📌 当前状态（P0 Bug 修复 + 后端接线，已完成代码 + 三绿 + 6 路审查）

**fix/p0-bugs-and-backend-wiring（2026-06-04，基于 feat/kiosk-campus-zone-on-main）：** 详见 [current-progress.md](./current-progress.md) 同名段。已修 HIGH-1~6 + 一批 MEDIUM/LOW；typecheck/lint/build 全量三绿；6 路对抗审查通过；招聘会 companies/zones wire→DTO 字段对齐回归已修。

**本轮遗留 / 后续待办（按优先级）：**

- 🟢 **[新功能] 待机宣传屏（广告位）一期（2026-06-04，`feature/kiosk-screensaver-ads`，基于 `main`）**：一体机闲时全屏轮播宣传海报/视频，触摸唤醒。后端 4 表 + `ContentModule`（素材上传含 MIME+魔数+大小+时长校验 / 播放方案 CRUD / 终端配置 / Kiosk 拉取 / HMAC 签名内容流 / 审计）；Kiosk `useIdleTimer`+忙碌态豁免（打印/扫描/AI/上传）+ `/screensaver` 全屏页（视频 muted+autoplay，失败跳过，Cache Storage 缓存）；Admin「宣传屏」模块（素材库/播放方案/终端配置）。AI 文生图为**二期 stub**（`AI_IMAGE_PROVIDER=disabled` → `400 AI_POSTER_NOT_ENABLED`，零外部费用）。api/kiosk/admin typecheck/lint/build 全绿。**二期待办**：接真实文生图 provider（通义万相/CogView）+ 内容安全 + 草稿确认入库；曝光/唤醒埋点报表；机构端上传 + 审核流。详见 [current-progress.md](./current-progress.md) 同名段。
- ✅ **[合规] `AiResumeResult` 留存治理（2026-06-04，`fix/ai-resume-result-retention`）**：已加 `expiresAt` 列（migration `20260604120000_add_ai_resume_result_expires_at`）+ `@@index([expiresAt])`；`persistResult` 写入 `expiresAt = now + AI_RESUME_RESULT_TTL_HOURS`（默认 24h，env 可调）；`loadResult` 把已过期行视为不存在（读取路径也不返回简历派生内容）；`AiResultCleanupTask` 每小时 cron 调 `cleanupExpiredResults('cron')` 硬删过期行并写 `ai_resume_result.cleanup_expired` system 审计（仅数量/按 kind 摘要，无 taskId/payload）。接真 provider 后无需再改留存逻辑，仅按需调小 TTL。typecheck/lint/build 三绿；dev.db 运行期三项断言通过（过期视为不存在 / cleanup 只选过期 / 删过期留新鲜）。
- ⏳ **[基础设施] PostgreSQL 迁移**：上线前硬阻塞；dev.db 现存 `feat/end-user-account` 分支 drift，迁移需重生成 + SQLite 特定查询回归。
- ⏳ **[凭证] 真实 AI provider 接通**：openai/claude/qwen/zhipu/local 仍为 NotImplemented stub，需外部凭证（持久化层已就绪，接通即可用）。
- ⏳ **[硬件] 扫描真机链路**：TWAIN/WIA 或扫描到 SMB/U盘 + Agent 中转（当前 Kiosk 扫描全程模拟）。
- ⏳ **[择期] 打印过期 URL 错误细分**：可把"签名非法"与"已过期"区分为 `PRINT_FILE_URL_EXPIRED` 引导重传（TTL 已延至 30min，实际触发已大幅降低）。
- ⏳ **[择期] admin orders/files/alerts 真实后端**：当前为本地演示态（已加诚实「演示数据」提示），需后端端点。
- ⏳ **[择期] 招聘会 materials/stats/展位** 需补 Prisma 模型后接真（当前诚实返回空）。

---

## 📌 历史状态（校园招聘专区 P0，已完成代码 + 静态验证）

**feat/kiosk-campus-zone-on-main（2026-06-03，cherry-pick `42ebd9c` 到干净 main `603be2a` 之上）：** 方案见 [campus-recruitment-design.md](../product/campus-recruitment-design.md)（方案 A，纯前端聚合，复用现有 API，无 schema 改动）。

- ✅ `/campus` 聚合页：① 季节横幅卡（按当前月份给秋招/春招/实习季阶段提示，纯展示）+ 校园招聘会（复用 `getJobFairs`，关键词过滤校招）+ 校招岗位（复用 `getJobs({category:'campus'})`）+ 求职材料服务（AI 简历 `/resume`、打印 `/print-scan`）+ 合规说明条（ComplianceBanner）
- ✅ 入口：首页 `CampusEntryBar` + 招聘会页顶部「校园招聘专区」引导卡 → `/campus`
- ✅ 招聘会列表卡片做厚（**仅用真实字段**）：主办方 `organizer`、参展/已录入企业数（`boothCount` 或 `managedCompanyCount`+`managedMaterialCount`）、`dataSourceNote`、来源+同步；按钮统一「查看招聘会」
- ✅ 合规：仅「查看岗位 / 查看招聘会」，无一键投递/收简历/候选人；禁词扫描过；typecheck / lint / build 全绿
- ⏳ **P1 待补（需加 DTO 字段，禁止硬造 mock）**：岗位数 `jobCount`、届别 `audienceType`（应届/实习/社招）；校招时间线② 交互组件
- ⏳ **依赖补强（P1）**：校招岗位 P0 用 `getJobs()` + 前端关键词过滤（不依赖 jobs board）；server-side `getJobs({ category, pageSize })` 属 jobs board 能力，待其合入 main 后切回 server-side 精确筛选
- ⏳ 待 review
> 最后更新：2026-06-03（Kiosk 岗位信息板块完整收口，feat/kiosk-jobs-complete）
> 关联文档：[current-progress.md](./current-progress.md)

---

## 📌 当前状态（Kiosk 岗位信息板块完整收口，已完成代码 + Mac 真实后端 http 验证）

**feat/kiosk-jobs-complete（2026-06-03，分支自 main `603be2a`，独立 git worktree 开发不混改其它任务）：**
- ✅ 后端 `GET /jobs` 真实 Prisma + 多维筛选（keyword/city/industry/category/workType 别名/sourceOrgId/tag/分页），只放出 approved+published
- ✅ 后端 `GET /jobs/:id` 未审核/未发布不暴露（返回 null）
- ✅ 前端 `/jobs` 关键词搜索 + 城市/行业/类型/来源筛选（与后端 query 对齐，http 走真实接口）+ 收藏(localStorage) + 可操作错误态
- ✅ 前端 `/jobs/:id` 去来源平台投递/扫码投递 = 真实 sourceUrl 二维码（qrcode.react），sourceUrl 校验
- ✅ 行业无 schema 改动，用 `行业:` 前缀 tag 承载（与 data-session-baseline 的未提交 schema 改动解耦）
- ✅ seed 扩充 13 条；typecheck/lint/build 全绿；带参 HTTP + vite proxy http 全链路实测通过
- ⏳ 待 review 后 FF merge 到 main（worktree 路径 `/Users/wanglei/ai-job-kiosk-jobs-wt`）

**本板块未做 / 后续可选（不阻塞验收）：**
- 岗位 `industry` 升级为独立 Prisma 列（当前用 `行业:` tag 承载；切 Postgres 或与 data-session-baseline 合流后再做 migration）
- 列表分页"加载更多"UI（后端 page/pageSize 已支持，前端当前一次取 pageSize=100 facet + 带参查询）
- 来源机构卡片计数随城市/行业/类型联动（当前计数取全量 facet，稳定但不随筛选收缩）
- 岗位收藏跨设备同步（当前仅本机 localStorage，符合"不形成招聘闭环"边界）
- ⚠️ 协作提醒：多会话并行时各自使用独立 git worktree，避免在共享工作区互相 `git reset/clean` 清空对方未提交改动（本任务曾因此丢失一次未提交工作，已用 worktree 重建）

---

## 📌 历史状态（真实打印能力收口版，已完成代码 + Mac 验证，待 Windows 真机）

**feat/kiosk-print-real-capability-hardening（2026-06-02，分支自 main `5e612b3`）：**
- ✅ 修复致命 hash 不一致：Agent 改用 SHA-256 校验（方案②保留 `fileMd5` 字段名，内容实为 sha256）；seed 任务同步改 sha256
- ✅ 前端隐藏 quality/pagesPerSheet（Agent 暂不生效）；彩色加诚实提示
- ✅ 后端 `PrintJobParamsDto` 强校验（非法值/未知字段 → 400）
- ✅ Agent 打印前预检（PRINTER_NOT_FOUND/OFFLINE/PAPER_EMPTY/ERROR）；PrintProgressPage 错误码 → 中文提示
- ✅ fileName 落 paramsJson（无 migration）
- ✅ 三端 typecheck/build 全过；后端运行时 DTO 验证通过
- ⏳ **待 Windows 真机验证**（见下），通过后再 review / FF 合入 main

**仍需 Windows 真机验证（Pantum CM2800ADN Series）：**
- 份数=2/双面长边/方向横向/缩放 fit·actual/页码范围"1-2"/黑白 → 真实出纸一致
- 彩色 PDF + colorMode=color → 是否真彩（验证或否定，决定彩色文案/开关）
- 真实 kiosk 上传 PDF → claim → SHA-256 校验 PASS → 出纸（补此前缺口：seed 之外的真实上传路径）
- 打印机断电/缺纸/名称错 → 预检快速 PRINTER_OFFLINE/PAPER_EMPTY/PRINTER_NOT_FOUND（非 5min 超时）
- hash 篡改 → DOWNLOAD_HASH_MISMATCH 负向；打印中重启 Agent → 不重打（幂等）

**后续（择期）：** `fileSha256` 命名清理（含 Prisma 列名 migration）；quality/pagesPerSheet 真机可控后再开放；PrintTask 增 `fileName` 列。

---

## 📌 历史状态（打印扫描服务中心 第一阶段，已完成）

**feat/kiosk-print-scan-service-center（2026-06-02，分支自 main `c7f6191`）：**
- ✅ 新增 `/print-scan`（服务中心首页，6 能力九宫格 + 敏感文件提示 + 非 CA 电子签声明）、`/print-scan/feature/:key`（证件照/格式转换/签名盖章「即将上线」说明页，未知 key 容错不白屏）
- ✅ 首页「打印扫描」主卡指向 `/print-scan`；routes 注册两条新路由
- ✅ 文档打印/照片打印接真实打印链路 `/print/upload`；材料扫描接 `/scan/start` 并加「流程演示」诚实说明（真机需 Terminal Agent）
- ✅ `complianceCopy.ts`：强化 `KIOSK_PRINT_SCAN_ESIGN_NOTICE`（非 CA 电子签补强版）+ 新增 `KIOSK_SCAN_DEMO_NOTICE`
- ✅ typecheck/lint/build ✅；合规禁词扫描 ✅；证件照/格式转换/签名盖章无「已完成/成功」假能力文案
- ⏳ 待 review 后决定是否 commit / FF merge 到 main

**第一阶段未做（按本轮范围约定，后续单独排期）：**
- 真实证件照排版 / 真实格式转换 / 真实签章合成（当前仅 MVP 说明页 + 备选打印路径）
- 真实扫描 Agent（TWAIN / 扫描到 SMB，属 Phase 8.2，当前 `/scan/*` 为流程演示）
- 不做 CA 电子签 / 电子认证 / 电子合同签署（合规红线，永不做）

---

## 📌 历史已完成状态（AI 简历服务中心封板第一阶段，已完成）

**feat/kiosk-ai-resume-service-center（2026-06-02，分支自 main `0f41dd1`）：**
- ✅ 新增 `/resume`（服务中心首页，4 大入口 + 四步流程 + 最近记录空态 + 隐私合规）、`/resume/target`（目标方向）、`/resume/templates`（素材库 MVP）
- ✅ 首页/AI助手入口改指 `/resume`；`/resume` 入助手路由白名单
- ✅ 来源页下一步改走 `/resume/target`；报告页死路改友好恢复页 + 目标摘要 + 优先修改项；优化页加"生成优化版"主按钮；导出页区分 原简历/优化版/诊断报告
- ✅ shared 新增 `ResumeTargetContext` + 3 条简历合规文案
- ✅ typecheck/lint/build（kiosk + 全 8 项目）全绿；合规扫描仅注释命中
- ⏳ 待 review 后 FF merge 到 main

**第一阶段未做（按本轮范围约定，后续单独排期）：**
- 面试准备（仅占位"即将上线"，未做完整模拟面试）
- `targetContext` 接入后端 `ResumeParseRequest` + DTO（当前仅前端 state 传递）
- 素材库真实素材 service 接入（当前本地占位）
- 优化版简历真实生成文件（当前 `optimizedGenerated` 标记 + 占位文件名，不伪造后端）

---

## 📌 历史已完成状态（P0 安全改进 Round 3）

**P0 安全改进 Round 3（2026-06-02，commit 待提交）：**
- ✅ H-11：`AiAdvisorCall` 改为 `lazy(() => import(...))` + `<Suspense>`；独立 11.7KB chunk；主包减少约 11KB；`trtc-sdk-v5` 仅在用户发起通话时加载
- ✅ H-9：`POST /api/v1/trtc/session` 增加 `AbortController + setTimeout(30s)`；超时提示"连接超时（30s），请检查网络后重试"
- ✅ H-5：`ProfilePage` 硬编码假数据清空；`MOCK_RESUMES` / `MOCK_ORDERS` / `MOCK_AI` 改为空数组；`location.state` 流程传入数据保留
- ✅ H-6/H-7：新增 `GET /job-fairs/:id/companies`

**P0 安全改进 Round 2（2026-06-02，已完成）：**
- ✅ H-12：xlsx@0.18.5（CVE-2023-30533 CRITICAL RCE）→ exceljs；保持字段校验/去重/事务回滚不变
- ✅ C-3：AliAvatar 后端接口未实现问题 → VITE_USE_ALI_AVATAR 门控，默认不调用任何后端
- ✅ H-1：AliAvatar useImperativeHandle 闭包过期 → stateRef 同步读取
- ✅ H-4：PrintPreviewPage 硬编码 `Pantum CM2800ADN Series` → VITE_TERMINAL_ID + API 动态读取
- ✅ `GET /api/v1/terminals/:id/printer-status` 新端点（无需 auth）
- ✅ 全量 typecheck/lint/build ✅；pnpm audit: xlsx CVE 已消除

---

## 📌 历史已完成状态（Phase 9.3 AI 助手快捷操作增强）

**Phase 9.3 feat/phase9-assistant-actions（2026-06-01，已完成，待合入 main）：**
- ✅ 7 个常驻快捷入口（始终可见）：简历诊断 / 打印文件 / 扫描材料 / 查看岗位 / 查看招聘会 / AI 在青岛 / 人社专区
- ✅ `KEYWORD_ROUTES` 关键词实时高亮：输入匹配关键词 → 相关快捷按钮高亮，无需 AI 响应
- ✅ AI 上下文建议区（带"AI 建议"标签）：仅 AI 返回 actions 时出现
- ✅ `/qingdao` 加入 `ALLOWED_ROUTE_PREFIXES` 白名单
- ✅ `isAllowedRoute` 白名单保留（line 152），合规声明保留，无招聘闭环词
- ✅ typecheck ✅ / lint ✅ / build ✅（915KB/272KB gzip）/ 合规扫描 ✅
- ⏳ 待 FF merge 到 main

**Phase 9.2 feat/phase9-digital-human（2026-06-01，✅ 已合入 main `f79b4d8`）：**
- ✅ `DigitalHuman.tsx`：纯 SVG + CSS 动画，idle/talking/greeting 三状态，无 WebGL/VRM
- ✅ AssistantPage 两区布局（上：数字人+气泡，下：对话历史）

**Phase 9.1 feat/phase9-kiosk-ui-polish（2026-06-01，✅ 已合入 main `b60fd8f`）：**
- ✅ KioskLayout Tab 激活背景高亮
- ✅ HomePage section 标题可读性、次级卡片差异化图标、AI助手触控按钮
- ✅ JobsPage/JobFairsPage 共享 LoadingState/ErrorState/EmptyState + retry + filter pill 高度
- ✅ 7个详情/子页面内联状态替换为共享组件
- ✅ typecheck ✅ / lint ✅ / build ✅ / 合规禁词扫描 ✅

**W8-P1 feat/w8-redis-e2e-verification（2026-06-01，✅ 完成 → 合入 main）：**
- ✅ 修复：`services/api/.env.example` 补全 `REDIS_URL`
- ✅ 修复：`JobSyncModule` 缺 `AuthModule` import → `JwtAuthGuard`/`RolesGuard` 无法解析
- ✅ 修复：BullMQ jobId 不允许冒号 → `${sourceId}:manual` → `${sourceId}_manual`
- ✅ 修复：ts-node pnpm store 损坏 → 改 `@swc-node/register` + `node -r` 方式（支持 emitDecoratorMetadata）
- ✅ 修复：`pnpm-workspace.yaml` `@swc/core: true`
- ✅ 真实 Redis E2E `pnpm verify:job-sync` → ✅ ALL PASS
- ✅ 全 monorepo `pnpm typecheck` ✅

**W8 feat/w8-bullmq-api-worker 已完成（2026-06-01）**：
- ✅ `@nestjs/bullmq` + `bullmq` + `ioredis` 安装；REDIS_URL 缺失时 inline fallback，API 正常启动
- ✅ Prisma JobSource 新增 `responseConfig String?`（migration applied）
- ✅ `src/job-sync/` 模块：service/processor/scheduler/controller/module 5 文件
- ✅ `POST /admin/job-sync/sources/:id/trigger`（Admin only，JWT+Roles，Throttle 10/min）
- ✅ `GET /admin/job-sync/sources`（Admin only，列出 API 模式源 + 同步状态）
- ✅ Admin `/sync-sources` 页面：列表 + "立即同步"按钮
- ✅ Cron 每 30 min 调度 due sources（hourly/daily/weekly）
- ✅ BullMQ jobId 去重（非 manual 用 sourceId）；$transaction 整批保证原子性
- ✅ 失败区分：CREDENTIAL_DECRYPT_FAILED / HTTP_4xx / REQUEST_TIMEOUT / NETWORK_ERROR
- ✅ SyncLog 写入（api syncMode）：Partner 可在同步日志页看到
- ✅ 凭证只在服务端解密；审核/发布状态更新时不覆写

**fix/w4-excel-import-integrity 已完成（2026-06-01）**：
- ✅ Fix 1：rawDataJson 不再存整行原始数据（固定 `'{}'`）+ 一次性清理脚本
- ✅ Fix 2：敏感列后端强校验（手机/邮箱/简历/候选人/面试/Offer 等），parseExcel + preview 双层拦截
- ✅ Fix 3：confirmExcelImport 整批事务化，失败 → batch.status='failed'，数据回滚
- ✅ Fix 4：previewExcelImport 批内 externalId 去重（seenInBatch set）
- ✅ Fix 5：同步日志显示数据源名称；Admin ImportBatch→审核跳转改用 sourceId/sourceOrgId；job/fair-sources 支持 URL 参数过滤 + 来源 banner

**W7 之前已完成（见 current-progress.md）**：
- W7：Kiosk 真实文件上传 + print 链路（A2 桌面验证模式，B1 30-min re-sign）
- W7 设计备忘：A2 → 生产切 A1；B1 → 长期切 B2

---

## 🔜 下一步优先级

**W7 已完成（2026-06-01，`feat/w7-kiosk-file-upload`）**：
- ✅ Terminal Agent `print.ts`：`params` 真实传给 `printWithPdfToPrinter`（不再 eslint-disable unused-vars）
- ✅ Terminal Agent `print-with-pdf-to-printer.ts`：`mapParams()` — PrintJobParams → SumatraPDF PrintOptions（copies/colorMode/duplex/orientation/scale/pageRange）；超时改为 `Promise.race` 真实 guard
- ✅ 后端 `print-jobs.service.ts`：B1 re-sign signedUrl with 30-min TTL（防 Agent claim 延迟 URL 过期）
- ✅ 后端 `print-jobs.controller.ts`：`POST /print/jobs` 新增 `@Throttle(10/min)`
- ✅ Kiosk `services/files/filesApi.ts`（新建）：`kioskUploadFile()` → `POST /api/v1/files/kiosk-upload`
- ✅ Kiosk `PrintUploadPage`：A2 桌面验证模式真实上传，loading/error 显示，A2 banner
- ✅ Kiosk `PrintPreviewPage`：`fileMd5?` 字段透传；直接访问 URL 时显示"重新上传"引导
- ✅ Kiosk `PrintConfirmPage`：`fileMd5` 传给 createPrintJob；API 失败显示 error banner（不再静默降级）
- ✅ Kiosk `PrintProgressPage`：real 模式 5 分钟超时保护（显示超时页 + 任务编号 + 返回首页）
- tsc / eslint / build / 合规禁词 全部 ✅

**W7 设计备忘：**
- A2 只是桌面 Chrome/Edge 验证路径；生产 Kiosk 后续切 A1（Terminal Agent 文件中转）
- B1 是 30-min signedUrl 过渡方案；长期可切 B2（Agent 内网 token 下载，不依赖 URL TTL）

---

## 🔜 下一步优先级

### P0（立即）

**安全改进 Round 3 已完成（本次）。剩余 P0 安全项：暂无。**

**业务 P0：**
1. **未提交的 TRTC/LLM 新功能定批**（合入 main 前必做）：工作区有 Round 3 之外的未跟踪新功能 —— `services/api/src/trtc/*`、`services/api/src/ai/llm/*`、`apps/admin/src/routes/ai-config/*`，且 `app.module.ts` 已 import `TrtcModule`（源文件未提交）。必须将依赖文件与 import 同批提交，否则 main 构建缺文件。决定：随 Round 3 一起合，还是独立 feature commit。
2. **feat/phase9-assistant-actions FF 合入 main**（含 Round 1 + Round 2 + Round 3 安全修复）
3. **Excel 字段映射 service 层接入**（FieldMappingRule / ImportBatch / ImportRecord 已在 partner adapter re-export）
4. **BullMQ API 拉取 worker 验证**：`pnpm verify:job-sync` 通过后 FF merge

### P1（择期）
**安全后续：**
- **H-5 ProfilePage 真实 API 接入**：当前已去除硬编码假数据，后续接简历/订单/AI 服务记录真实 API
- **M-5 chatWithAssistant AbortController**：给 AI 聊天请求补客户端超时/取消机制
- **M-6 LLM 会话 Redis 持久化**：把 LLM 会话状态从内存升级到 Redis，支持重启恢复和横向扩展
- **JobFair 子资源端点落真**：当前 6 个 `/job-fairs/:id/*` 为返回空数据的 stub。Fair 模型落 Prisma 后，必须补 `publishStatus=published` 过滤 + 来源合规字段（source_org_id/external_id/source_url/sync_time），并校验父招聘会已发布，再返回真实数据，避免暴露未发布/未审核内容
- **TRTC `/session` 匿名计费防护增强**：当前仅靠每 IP 5 次/min 限流保护这个会触发腾讯云计费的匿名端点；后续可加设备指纹/一体机白名单/验证码等二次约束

**W8 后续 TODO（BullMQ API worker 落地后）：**
- **生产环境 REDIS_URL 必配**：无 Redis 的 inline fallback 仅供 dev 验证；生产部署时必须提供 Redis，否则 Cron 调度仍然工作但缺少 BullMQ 持久化/重试语义
- **responseConfig 可视化配置**：当前需直接改 DB JSON；Partner 后台应提供字段映射规则 UI（rootPath / fields 编辑器），避免需要技术人员操作
- **API 拉取字段映射校验增强**：目前缺字段仅 warn 日志；可加 validateBeforeUpsert 选项，缺必填字段整条跳过并入 error 计数
- **API 同步 E2E 真源联调**：对接一个真实的外部岗位 API 端点，端到端验证 responseConfig auto-detect 和字段映射流程
- **JobFair 增加 `sourceId`/`importBatchId` 字段**：当前招聘会批次跳转只能按 `sourceOrgId` 粗粒度过滤，无法精确回溯单批次。需在 `JobFair` Prisma model 添加 `sourceId String?`，才能支持 fair-sources 页精确 batchId 过滤（与岗位侧对齐）
- 生产 Kiosk 文件选择切 A1（Terminal Agent 文件中转）
- signedUrl 长期方案切 B2（Agent 内网 token）
- 文件自动清理调度
- 打印任务状态实时追踪 UI 优化

### P2
- **`pnpm audit` 2 项 moderate 传递依赖**（非运行时直连，不阻塞合入）：
  - `exceljs > uuid <11.1.1`（GHSA-w5hq-g745-h8pq，v3/v5/v6 提供 buf 时缺边界检查；exceljs 实际用 v4 random，影响有限）→ 待 exceljs 升级或 pnpm overrides 锁 uuid≥11.1.1
  - `prisma(dev) > @hono/node-server <1.19.13`（GHSA-92pp-h63x-v22m，仅 Prisma 开发期工具链，不进生产运行时）→ 随 Prisma 升级消除
- 企业宣传视频播放支持（当前为渐变封面占位）
- FairStatsPage 数据接真实展会统计
- 招聘会详情页增强：展位导览图点击弹出企业预览
- 奔图开放打印 API 彩色 mode（待厂家确认）

**已合入 main 的历史分支**：W1 / W2 / W3 / W4 / W5 / W6 / AI在青岛 / Kiosk 触控优化 均已合入 main。

---

## ✅ 已完成阶段

### Phase 0 - 项目初始化（已封板）

| 验收项 | 状态 |
|--------|------|
| pnpm lint | ✅ 通过（零报错） |
| pnpm typecheck | ✅ 通过（零错误） |
| pnpm build | ✅ 三端均通过（Vite 6.4.2） |
| pnpm audit | ✅ No known vulnerabilities found |
| .gitattributes（LF 统一） | ✅ 已补全 |
| .DS_Store / zip 已移出 git 索引 | ✅ 已清理 |
| 合规边界干净（无禁用文案/密钥泄漏） | ✅ 审查通过 |
| 三端 app 引用 ui/shared 公共包 | ✅ 已验证 |

### Phase 1 - 设计系统基建（已完成）

| 交付项 | 状态 |
|--------|------|
| tokens.css（@theme 变量） | ✅ |
| cn 工具（clsx + twMerge） | ✅ |
| Button/Card/StatusBadge/PageHeader cva 重构 | ✅ |
| Spinner/EmptyState/LoadingState/ErrorState | ✅ |
| KioskLayout/AdminLayout/PartnerLayout | ✅ |
| 三端 `@source` 样式扫描修复 | ✅ |
| pnpm lint/typecheck/build/audit 复核通过 | ✅ |

### Phase 2 - 页面框架与导航接线（已完成 2026-05-24）

| 交付项 | 状态 |
|--------|------|
| 三端路由骨架（React Router v7） | ✅ |
| KioskLayout 底部导航联动 | ✅ |
| AdminLayout 14 路由侧栏联动 | ✅ |
| PartnerLayout 10 路由菜单联动 | ✅ |
| Fast Refresh warning 修复 | ✅ |
| Playwright 截图验收 | ✅ |

### Phase 3 - 一体机前台 MVP（已封板 2026-05-25）

| 模块 | 页面 | 状态 |
|------|------|------|
| 打印流程 | 5页（upload→preview→confirm→progress→done） | ✅ |
| 扫描流程 | 4页（start→settings→progress→result） | ✅ |
| AI简历服务 | 5页（source→parse→report→optimize→export） | ✅ |
| 我的记录 | 1页（profile，整合三流程承接） | ✅ |
| P1 白屏修复 | ResumeReportPage ErrorState | ✅ |

**数据状态**：全部 mock + location.state，不接后端  
**合规**：禁用文案审查通过，DEV 失败按钮隔离 ✅  
**构建**：lint/typecheck/build 全通过 ✅

### Phase 4 - 岗位和招聘会信息（已完成 2026-05-25）

| 模块 | 页面 | 状态 |
|------|------|------|
| 岗位列表 | JobsPage（5条mock岗位，标签筛选） | ✅ |
| 岗位详情 | JobDetailPage（完整信息+来源+合规说明） | ✅ |
| 招聘会列表 | JobFairsPage（3条mock招聘会，状态筛选） | ✅ |
| 招聘会详情 | JobFairDetailPage（详情+来源+合规+打印资料） | ✅ |

**类型**：`ExternalJob`、`ExternalJobFair`、`JobFairStatus` 已加入 packages/shared  
**合规**：去来源平台投递/扫码投递/扫码预约，无一键投递/候选人等禁用文案 ✅  
**构建**：lint/typecheck/build 全通过 ✅

---

## 🚧 Phase 5 - 管理员后台（P0/P1核心页面完成，P2/P3待填充）

当前状态：14路由骨架完成，7个核心页面已填充（Dashboard / Terminals / Orders / Printers / JobSources / FairSources / Partners）。

### 已完成页面

| 优先级 | 页面 | 状态 |
|--------|------|------|
| P0 | 工作台（Dashboard） | ✅ 9指标卡 + 最新告警 |
| P0 | 终端管理 | ✅ 10台终端 + 状态筛选 + 标记维护 |
| P0 | 订单管理 | ✅ 类型筛选 + 退款操作 |
| P0 | 打印机管理 | ✅ 碳粉余量 + 纸张状态 + 故障信息 |
| P1 | 岗位信息源 | ✅ 第三方岗位数据审核/发布 |
| P1 | 招聘会信息源 | ✅ 招聘会数据审核/发布/打印 |
| P1 | 合作机构管理 | ✅ 机构类型 + 启用停用 + 绑定终端 |

### 已完成 P1 页面

| 优先级 | 页面 | 状态 |
|--------|------|------|
| P1 | 告警中心 | ✅ 9类告警 + 级别/状态双维度筛选 + 标记处理中/已解决 |
| P1 | 文件管理 | ✅ 5类文件 + 三维度筛选 + 高敏感风险提示 + 合规说明 |

### 待填充页面（P2/P3，Phase 5 后期或视需求填充）

| 优先级 | 页面 | 说明 |
|--------|------|------|
| P2 | AI服务管理 | ✅ 已完成（Phase 7.8/7.9：指标卡+日志表+service layer+后端接口） |
| P2 | 日志审计 | 操作日志列表、筛选 |
| P3 | 权限管理 | 角色/用户管理 |

---

## ✅ 招聘会服务数字化模块（已完成 2026-05-25）

**Kiosk 新增 5 页（现场服务子路由）：**
- `/job-fairs/:id/companies` — 参会企业列表（展区筛选 + 全文搜索 + 签到状态）
- `/job-fairs/:id/companies/:companyId` — 企业详情（岗位信息展示 + 扫码二维码，合规：不接收简历）
- `/job-fairs/:id/map` — 展馆导览（展区概览卡 + 展位格子，点击查看详情/跳转企业）
- `/job-fairs/:id/materials` — 活动资料（按类型展示，免费打印接入打印流程）
- `/job-fairs/:id/stats` — 现场数据（企业签到进度 + 服务行为统计，无求职者个人数据）

**JobFairDetailPage 新增"现场服务"区块：** 4 个快捷入口按钮（有 managed 数据时显示）

**Admin 新增"招聘会管理"（`/fairs`）：**
- 招聘会选择器（卡片式，3 场招聘会可切换）
- 标签页：参会企业（签到状态筛选 + Excel 导入入口）/ 展位管理（展区分组 + 展位格子）/ 活动资料（发布/下架）/ 数据统计（指标卡 + 签到进度 + 展区分布）

**合规边界全程保持：**
- 系统不接收简历，不提供候选人管理、企业查看简历、一键投递
- 所有投递/预约均以二维码形式跳转来源平台
- 统计数据只记录服务行为（浏览/扫码/打印/签到），不记录求职者个人信息

---

## ✅ Phase 6.5+ - 统一合作机构类型系统（已完成 2026-05-25）

**新增 `packages/shared/src/types/partner.ts`：**
- `PartnerType`（5值）× `SceneTemplate`（3值）× `EnabledModule`（9值）统一权限配置模型
- `PROHIBITED_MODULES`（永久禁用5项）：`in_platform_apply`、`candidate_management`、`resume_delivery_to_enterprise`、`interview_invitation`、`offer_management`
- `SCENE_DEFAULT_MODULES`：每个 SceneTemplate 的默认启用模块集合
- `PartnerSceneConfig`：含 public_employment_service 专用字段（jurisdictionArea/serviceLevel/govOrgCode）
- 全部标签常量：`PARTNER_TYPE_LABELS`、`SCENE_TEMPLATE_LABELS`、`MODULE_LABELS`、`PUBLIC_SERVICE_LEVEL_LABELS`

**已升级页面：**
- `admin/partners`：使用共享类型，双维度筛选（合作状态+机构类型），表格新增机构类型/场景模板/启用模块列
- `partner/profile`：mock 改为 public_employment_service，新增"场景与模块配置"卡片（启用模块 chips + 永久禁用合规说明）

---

## ✅ Phase 6 - 合作机构后台 P0（已完成 2026-05-25）

| 页面 | 状态 |
|------|------|
| Dashboard（工作台） | ✅ 8指标卡 + 最近同步记录 |
| Profile（机构资料） | ✅ 基本信息 + 场景配置 + 永久禁用合规说明 + 绑定终端（已升级共享类型） |
| Jobs（岗位信息管理） | ✅ 类型/审核双筛选 + 外部编号/来源链接 + 下架/二维码 |
| Fairs（招聘会信息管理） | ✅ 状态筛选 + 预约链接 + 打印/二维码/下架 |
| Sources（数据源管理） | ✅ Excel/API/Webhook + 启用停用 + 测试连接 + Excel 导入 4 步向导 MVP |
| SyncLogs（同步日志） | ✅ 成功/失败/重复/异常字段/失败原因 + 重试 |

**合规边界**：所有页面底部含合规说明；Jobs/Fairs 无简历收集、无候选人管理 ✅  
**类型体系**：packages/shared 外部数据源类型已完整收口（SourceKind×AccessMode 双维度，ImportBatch/ImportRecord/FieldMappingRule，敏感字段服务端隔离）✅

### 待填充页面（P1/P2）

| 优先级 | 页面 | 说明 |
|--------|------|------|
| P1 | 数据统计 | 展示量、跳转量、打印次数 |
| P2 | 账号权限 | 子账号管理、操作日志 |

---

## ✅ Phase 7.6 - 后端 AI Provider 骨架完成（2026-05-26）

> **状态**：后端 AI Provider 骨架完成，暂不接真实数据库和真实 AI Provider。

### 7.6 已完成

| 项 | 文件 | 状态 |
|----|------|------|
| NestJS AI 模块骨架（`services/api/src/ai/`） | ai.module.ts | ✅ |
| `AiProvider` 接口 + 全部类型 | interfaces/ai-provider.interface.ts | ✅ |
| `MockAiProvider`（完整实现） | providers/mock.provider.ts | ✅ |
| OpenAI / Claude / Local / Qwen / Zhipu stub（NotImplementedException） | providers/*.stub.ts | ✅ |
| `POST /resume/parse` | ai.controller.ts | ✅ |
| `GET /resume/records/:taskId` | ai.controller.ts | ✅ |
| `GET /resume/records/:taskId/optimize` | ai.controller.ts | ✅ |
| `POST /assistant/chat` | ai.controller.ts | ✅ |
| AI 元数据日志（taskId/provider/latency/tokenUsage/cost/status，禁记简历内容） | ai-log.service.ts | ✅ |
| 未知 AI_PROVIDER 启动时抛异常（不 fallback mock） | ai.service.ts | ✅ |
| qwen/zhipu 未实现时 NotImplementedException（不 fallback mock） | ai.service.ts | ✅ |
| task 不存在返回 AI_TASK_NOT_FOUND（NotFoundException） | ai.service.ts | ✅ |
| DTO 校验：@IsNotEmpty + @MaxLength | dto/*.dto.ts | ✅ |

### 7.6 未完成（后续阶段实现）

| 项 | 说明 |
|----|------|
| 真实 Claude / OpenAI Provider | 需配置 API Key，替换 stub |
| 真实 Qwen / Zhipu Provider | 需配置 API Key，替换 stub |
| Prisma AiTask 持久化 | In-memory store → DB（重启后 task 消失） |
| `GET /admin/ai/usage` | ✅ Phase 7.9 已完成（聚合统计，仅元数据） |
| `GET /admin/ai/logs` | ✅ Phase 7.9 已完成（元数据列表，limit≤500） |
| Provider 配置管理页面 | ✅ Phase 7.8 已完成（Admin AI 服务管理页） |
| 限流、配额、成本控制 | 生产级保障 |
| 生产级鉴权（JWT Guard） | Auth stub 当前直通 |

### 7.6 参考文档

- [AI 服务提供商接入指南](../product/ai-provider-integration.md)
- [后端骨架架构设计](../api/backend-architecture-phase7.md)

---

## ✅ Phase 7.7 - AI 助手页面接 service（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| AssistantPage 完整重写（chat UI + loading + 错误态） | kiosk/pages/assistant/AssistantPage.tsx | ✅ |
| `chatWithAssistant()` 接入，mock/http adapter 均支持 | services/api.ts | ✅ |
| sessionId localStorage 持久化（kiosk restricted mode 容错） | AssistantPage.tsx | ✅ |
| http 失败显示"AI 服务暂不可用"，不 fallback | AssistantPage.tsx | ✅ |
| 路由白名单过滤 actions（`/resume/ /print/ /scan/ /jobs /job-fairs /policy`） | AssistantPage.tsx | ✅ |
| 所有 AI 回复标注"内容仅供参考" | AssistantPage.tsx | ✅ |
| 底部免责文案：AI 回复内容仅供参考，**不构成正式建议** | AssistantPage.tsx | ✅ |
| cancelledRef 防 unmount 后 setState | AssistantPage.tsx | ✅ |
| 合规：无一键投递/候选人/HR查看等禁用词 | 全文审查 | ✅ |

**数据状态**：mock adapter（`VITE_API_MODE=mock`）正常；http adapter 失败→错误气泡  
**构建**：lint/typecheck/build 全通过 ✅

---

## ✅ Phase 7.8 - Admin AI 服务管理页（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| AI 服务管理页（`/ai-services`） | admin/routes/ai-services/index.tsx | ✅ |
| 8个指标卡（调用量/成功率/平均延迟/parseResume/optimizeResume/chatAssistant/失败数/估算费用） | index.tsx | ✅ |
| 失败原因统计（TIMEOUT + NotImplementedException 带红色徽章） | index.tsx | ✅ |
| 操作类型 + 状态双维度筛选日志表 | index.tsx | ✅ |
| 日志列：taskId(截断)/服务类型/Provider(紫色徽章)/状态/响应时间/时间戳 | index.tsx | ✅ |
| mock 数据只含元数据（无简历内容/聊天原文/文件名） | index.tsx | ✅ |
| 底部合规说明卡："AI 日志仅记录元数据，不保存完整简历内容和聊天原文" | index.tsx | ✅ |
| 显式声明后端 `/admin/ai/logs` API 待实现 | index.tsx | ✅ |

## ✅ Phase 7.9 - Admin AI 接口闭环（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| 后端 `GET /admin/ai/usage`（聚合统计，仅元数据） | ai.controller.ts + ai-log.service.ts | ✅ |
| 后端 `GET /admin/ai/logs`（列表，limit≤500，仅元数据） | ai.controller.ts + ai-log.service.ts | ✅ |
| `AiLogService.record()` 自动写入 `createdAt` ISO string | ai-log.service.ts | ✅ |
| `AiLogService.getUsage()` + `getLogs()` 方法 | ai-log.service.ts | ✅ |
| `AiService.getProviderName()` 方法 | ai.service.ts | ✅ |
| 前端 `adminAiMockAdapter` | admin/services/api/adminAiMockAdapter.ts | ✅ |
| 前端 `adminAiHttpAdapter` | admin/services/api/adminAiHttpAdapter.ts | ✅ |
| 前端 `aiUsage` service layer（mock/http 切换） | admin/services/api/aiUsage.ts | ✅ |
| Admin AI 服务页改为 `useEffect + service layer` | admin/routes/ai-services/index.tsx | ✅ |
| API 文档 `sk-...` → `<server-only-secret>` | docs/api/api-v1-design.md | ✅ |
| 合规说明简化（移除"后端接口待实现"声明） | admin/routes/ai-services/index.tsx | ✅ |

**数据合规**：返回字段只含 taskId/provider/operation/status/latencyMs/errorCode/createdAt，无简历内容/聊天原文/文件名/fileId  
**构建**：lint/typecheck/build 全通过 ✅

### 7.9 未完成（后续阶段实现）

| 项 | 说明 |
|----|------|
| Prisma AiTask 持久化 | in-memory store → DB，重启后日志消失 |
| 真实 Provider（OpenAI/Claude/Qwen/Zhipu） | 配置 API Key 后替换 stub |
| Provider 切换 UI | Admin 界面配置，不含 Key 明文 |
| 用量告警配置 | 日调用量超限触发告警 |
| `pnpm audit` 补跑 | ✅ 已完成，0 vulnerabilities |

---

---

## ✅ Phase 7.10 - 后端岗位/招聘会真实 API（已完成 2026-05-26）

| 项 | 文件 | 状态 |
|----|------|------|
| 后端 JobsModule：DTOs（ReviewAction/PublishAction/ImportJobs/ImportFairs） | services/api/src/jobs/dto/*.dto.ts | ✅ |
| 后端 JobsService（in-memory store + 种子数据 8岗位 5招聘会） | services/api/src/jobs/jobs.service.ts | ✅ |
| 后端 JobsController（14 个接口，Kiosk 4/Admin 6/Partner 6） | services/api/src/jobs/jobs.controller.ts | ✅ |
| 后端 JobsModule 注册到 app.module.ts | services/api/src/app.module.ts | ✅ |
| Admin 类型 R1 补全（sourceUrl/sourceOrgId/tags/description/requirements） | apps/admin/src/services/api/types.ts | ✅ |
| Admin review-types.ts（ReviewAction/PublishAction） | apps/admin/src/services/api/review-types.ts | ✅ |
| Admin mockAdapter / httpAdapter 对齐新接口 | adminMockAdapter.ts / adminHttpAdapter.ts | ✅ |
| Admin wrapper 方法保持兼容（approveJobSource/rejectJobSource/publishJobSource/unpublishJobSource） | apps/admin/src/services/api/sources.ts | ✅ |
| Partner R2 sourceName 补全（PartnerJobRecord/PartnerFairRecord） | apps/partner/src/services/api/types.ts | ✅ |
| Partner R3 字段重命名（addedCount/errorCount/status/errorDetail） | apps/partner/src/services/api/types.ts | ✅ |
| Partner sync-logs 页面字段对齐（l.status / l.addedCount / l.errorCount / l.errorDetail） | apps/partner/src/routes/sync-logs/index.tsx | ✅ |
| Partner importPartnerJobs / importPartnerFairs 方法 | partnerMockAdapter.ts / partnerHttpAdapter.ts / partnerContent.ts | ✅ |

**状态机**：`pending→reviewing→approved+draft`（审核），`draft→published→unpublished`（发布），approve ≠ publish  
**合规**：Kiosk 只展示 approved+published；Partner 导入默认 pending+draft；PUBLISH_REQUIRES_APPROVAL 保护  
**R4 延期**：partner/sources DisplaySource 对齐 DataSourceConfig → Phase 7.11  
**构建**：lint 0 warnings / typecheck 0 errors / build ✅（admin 387KB / partner 338KB / kiosk 418KB）

---

## ✅ Phase 8.1B 已完成（2026-05-27）

| 项 | 状态 |
|----|------|
| 后端 TerminalsModule（4 接口 + sample-visible.pdf）| ✅ |
| Windows 真机端到端联调（670ms 打印，Pantum CM2800ADN Series） | ✅ |

## ✅ Phase 8.1C 已完成（2026-05-27，Windows 真机 V8.1C-1/2 通过）

| 能力 | 文件 | 状态 |
|------|------|------|
| DPAPI 加密 agentToken（PowerShell stdin，LocalMachine scope） | dpapi.ts | ✅ |
| SQLite 任务幂等（restart 不重打；markTaskDone before PATCH） | db.ts | ✅ |
| 单实例 PID 锁（ESRCH 僵尸锁接管，DUPLICATE_INSTANCE exit 1） | instance-lock.ts | ✅ |
| 断网 PATCH 重试队列（60s 轮询，指数退避，max 10，4xx 放弃） | offline-queue.ts | ✅ |
| Windows 服务（install-service / uninstall-service 子命令） | index.ts | ✅ |
| adminSecret 注册后清除；Phase 8.1B token 自动迁移 | config-manager.ts | ✅ |
| typecheck 0 errors / build 通过 / macOS 冒烟验证 | — | ✅ |
| **Windows 真机 V8.1C-1（DPAPI）+ V8.1C-2（SQLite 幂等）通过** | — | ✅ |

> V8.1C-3（断网重试）留待 Prisma 后端部署后专项验收。  
> **V8.1C-4（单实例双进程）✅ 2026-05-28 通过**：发现并修复 Windows EPERM Bug（tasklist 替代 mtime 阈值）。  
> **V8.1C-5（服务安装）✅ 2026-05-28 通过**：发现并修复 node-windows args→scriptOptions Bug。  
> - instance-lock.ts：EPERM 分支改用 `tasklist /FO CSV` 可靠检测存活进程，5分钟mtime阈值已废弃  
> - index.ts：`args:['agent']` 改为 `scriptOptions:'agent'`，服务正确以 agent 子命令启动  
> - 心跳 404（TERMINAL_NOT_REGISTERED）因 in-memory 后端重启丢失注册 → Prisma 后端部署后解决

## ✅ Phase 8.1D — Windows 真机 E2E 全部通过（2026-05-28）

| 验收项 | 结果 |
|--------|:----:|
| 注册（DPAPI 加密，agentToken 不落 config.json） | ✅ |
| 心跳（30s，持续确认） | ✅ |
| Claim ptask_seed_001（5 min 过期自动重置后 Agent 重新 claim） | ✅ |
| 文件下载（proxy:false，8ms，0.9 KB） | ✅ |
| MD5 校验 | ✅ |
| PATCH status=printing | ✅ |
| PDF Method B 打印（783ms） | ✅ |
| PATCH status=completed | ✅ |
| 临时文件删除 | ✅ |
| SQLite 写入 completed（pending_patches=[]） | ✅ |
| **Pantum CM2800ADN Series 真实出纸** | ✅ |

**关键修复（本阶段发现）：**  
- `api-client.ts` + `task-runner.ts` 新增 `proxy: false` — Windows `http_proxy` 环境变量（Clash/v2ray）劫持 axios 请求  
- `task-runner.ts` 新增 `resolveFileUrl()` — 处理 backend 返回相对 fileUrl

---

## ✅ Phase 8.2A — Prisma 持久化任务闭环（代码完成 + 跨机真机验证通过 2026-05-29）

代码由 Codex 完成（2026-05-28），已合并 main。Mac 真实后端跨机 E2E 验证通过（2026-05-29）。

| 要点 | 状态 |
|------|------|
| Prisma schema（4张表：Terminal/PrintTask/TerminalHeartbeat/PrintTaskStatusLog） | ✅ |
| `prisma.$transaction` claim 原子性 | ✅ |
| 终态不可覆盖（completed/failed 幂等） | ✅ |
| `prisma.printTask.upsert` 种子任务（API 重启不重复插入） | ✅ |
| TerminalsService 全部 Map → Prisma 查询 | ✅ |
| PrismaService NestJS DI（@prisma/adapter-libsql，SQLite dev） | ✅ |
| 迁移文件（20260528032954_init_terminals + 20260528_add_agent_token_unique） | ✅ |
| typecheck + build 通过 | ✅ |

**真机验证结果（2026-05-29，Windows → Mac 192.168.1.164:3000）：**
- ✅ 后端部署 Mac，`prisma migrate deploy` 全部迁移应用，API 启动正常
- ✅ Agent 注册成功：terminalId=t_f77d716786118f78，DPAPI 加密 agentToken，adminSecret 自动清除
- ✅ Mac API 重启后 terminal 不丢失，心跳持续 200（Prisma 持久化确认）
- ✅ ptask_seed_001 持久化，重启后 Agent claim 正常（restart-idempotency 跳过）

---

## ✅ Phase 8.2B — WMI 真实状态查询（代码完成 + Windows 真机验证通过 2026-05-28）

代码由 Codex 完成（2026-05-28），已合并 main。

| 能力 | 状态 |
|------|------|
| wmi.ts：Win32_Printer WMI 查询（printerStatus） | ✅ |
| wmi.ts：Get-PSDrive 查磁盘（diskFreeGB） | ✅ |
| heartbeat.ts 接入 WMI 查询（Promise.all 并行） | ✅ |
| macOS 降级（返回 'unknown' / -1） | ✅ |

**真机验证结果（2026-05-28）：**
- ✅ Windows 真机心跳包含真实 printerStatus=ready，diskFreeGB=158.98
- 📋 缺纸/断电时 WMI 状态变化验证（待物理触发，非阻塞后续）

---

## ✅ Phase 8.2C — 安全加固（代码已完成）+ V8.1C-4/5 通过

| 能力 | 状态 |
|------|------|
| **V8.1C-4 单实例锁 Windows EPERM Bug 修复** | ✅ 2026-05-28 验证通过 |
| **V8.1C-5 服务安装 scriptOptions Bug 修复** | ✅ 2026-05-28 验证通过 |
| instance-lock：tasklist 替代 mtime 5分钟阈值 | ✅ |
| install-service：args→scriptOptions 修复 | ✅ |
| **V8.1C-3 断网重试** | ✅ 2026-05-28 通过（pending_patches 注入 → 60s 自动重试 → 清空） |
| **Windows 服务 reboot 自启动** | ✅ 2026-05-28 通过（重启后 STATE:4 RUNNING，心跳恢复，SQLite 幂等跳过已完成任务） |
| actionToken HMAC | 后端 claim 响应 HMAC 签发已实现；local-api-server 消费校验后续实现 |
| lease 续租 | 代码待实现；当前打印主链路未阻塞，长任务/扫描任务前补齐 |

---

## ✅ Phase 8 全部封板（2026-05-29）

**当前状态：Phase 8 所有主线任务完成，可进入 Phase 9。**

| 选项 | 内容 | 状态 |
|------|------|------|
| ~~A — Prisma 后端部署验证~~ | ~~将 Prisma 后端部署，验证心跳/claim 持久化~~ | ✅ 已完成（2026-05-29，Mac 跨机验证通过） |
| **B — Phase 9 UI Polish** | Kiosk/Admin/Partner 视觉收口 + AI数字人 | 🚧 进行中：AI 数字人语音通话 + 文字对话**已完成**（`/assistant`，见下）；视觉收口待推进 |
| **C — Phase 7.11** | Partner Sources R4 对齐（DisplaySource → DataSourceConfig） | 📋 可与 Phase 9 并行 |

## 🚧 Phase 9 — UI Polish + AI数字人（AI数字人已完成，视觉收口进行中）

> **AI 数字人现状校正（2026-06-04，T3B）**：AI 数字人语音通话（TRTC 真人照片顾问「小青」）+ 文字对话**均已完成并接入** Kiosk「AI助手」Tab → `/assistant`（`apps/kiosk/src/pages/assistant/AssistantPage.tsx` + `components/AiAdvisorCall.tsx`）。早期「轻量 3D / SVG 引导员」非当前主方案，SVG `DigitalHuman.tsx` 与 `SpeechBubble` 已成**待清理死代码**（本任务不删除）。**后续不再重做 AI 数字人功能。** 详见 [current-progress.md §〇·B](./current-progress.md)。

详细规划见：[current-progress.md §Phase 9](./current-progress.md)

**Phase 9.1 静态 3D 引导员（首个交付）：**
- AvatarGuide 组件、Three.js/VRM 模型加载
- idle 动画、文字气泡
- 关闭/静音、WebGL 降级

**Phase 9 Kiosk 视觉升级范围：**
- 首页业务入口层级增强
- 打印/扫描/AI简历流程步骤进度感
- 岗位/招聘会卡片信息层级
- 二维码弹层美化
- 失败态/空状态引导升级

---

## 📋 Phase 7.10 后：下一步方向

| 选项 | 内容 | 说明 |
|------|------|------|
| **A — Phase 7.11** | Partner Sources R4 对齐 | DisplaySource → DataSourceConfig；Partner 数据源页面重写 |
| **B — Phase 5/6 填充** | Admin/Partner 剩余页面补齐 | Admin：日志审计、权限管理；Partner：数据统计、账号权限 |

### pnpm audit 补跑（网络可用时）

```bash
pnpm audit   # ✅ 已完成，0 vulnerabilities
```

---

## 决策待定项（Phase 7 前确定）

| 待定事项 | 说明 |
|---------|------|
| 后端语言 | ✅ 确定：NestJS + Prisma（TypeScript 全栈，与前端共享类型更顺畅） |
| 部署方案 | 云服务器还是本地 |
| 文件存储 | MinIO / 阿里云 OSS / 腾讯 COS |

---

---

## 📋 后续特色功能规划（Phase 8.1B 已完成，可进入排期）

> **Phase 8.1B 已完成（2026-05-27）**：后端 4 接口全部实现，Agent + 后端冒烟联调通过。下一步：Windows 真机端到端联调（`pnpm --filter terminal-agent agent`），然后根据结果决定是否进入特色功能排期。  
> 合规边界：所有功能均不得新增招聘闭环功能（一键投递、候选人管理、企业查看简历、面试邀约、Offer 管理）。  
> 详细需求定义见：[feature-scope.md §六](../product/feature-scope.md)

| 功能 | 优先级 | 前置依赖 | 当前状态 |
|------|--------|---------|---------|
| 打印材料包 | P1 | Phase 8.1B + Phase 7 AI | 📋 规划中，未开发 |
| 求职打印套餐 | P1 | Phase 8.1B | 📋 规划中，未开发 |
| 招聘会现场模式增强 | P2 | Phase 8.1B + 现有 `/job-fairs/:id/*` 页面 | 📋 规划中，未开发 |
| 面试练习轻量版 | P2 | Phase 7 AI（非数字人） | 📋 规划中，未开发 |
| AI求职路线规划 | P3 | 用户画像 + 推荐规则 | 📋 规划中，未开发 |

**命名约束**：打印相关功能文案使用"打印材料包"，**禁止使用"一键打印材料包"**（避免与"一键投递"等合规禁用表达混淆）。

---

## 📋 Phase 9 - UI Polish / Kiosk 视觉升级（Phase 8 完成后启动）

> **触发条件**：Phase 5 Admin、Phase 6 Partner、Phase 7 API、Phase 8 设备联调全部完成后，统一升级 Kiosk 前台视觉质感。  
> **不提前做**：当前页面功能完整、合规边界清晰，视觉打磨属于锦上添花，不阻塞核心流程交付。

### 升级目标

参考秒哒成熟页面质感，不照抄，在现有设计系统基础上提升层级感和专业度。

### 升级范围

| 模块 | 当前状态 | 升级方向 |
|------|---------|---------|
| **首页** | 功能卡片平铺，层级单一 | 强化业务入口视觉层级；图标质感升级；主入口卡片与次入口卡片区分更明确 |
| **打印/扫描/AI简历流程页** | 基础布局，空白区域多 | 增强步骤进度感（步骤条或分段指示器）；状态反馈更丰富；减少空旷感 |
| **岗位/招聘会列表与详情** | 信息卡片层级偏平 | 岗位卡片主次信息层级更清晰；薪资/标签/来源信息排版升级；状态徽章更专业 |
| **我的记录（ProfilePage）** | 四个 section 平铺 | 文件/订单/AI记录分区视觉更像真实产品；空状态高度压缩；卡片信息密度提升 |
| **二维码弹层** | 基础占位框 | 统一弹层美化；QR 区域视觉优化；操作说明排版升级 |
| **失败态 / 空状态** | 基础 ErrorState/EmptyState | 插画/图标升级；文案更具引导性；操作按钮更突出 |

### AI数字人引导员（Phase 9.1 起）

> 详细需求见：[AI数字人引导员需求规划](../product/ai-avatar-guide.md)

定位：数字人是 Kiosk 前台的“AI就业服务引导员”，用于首页、AI助手、简历服务、打印扫描、招聘会导览等场景的操作引导，不进入 Admin/Partner 后台。

> ⚠️ **此表为早期规划，已被实际实现取代（2026-06-04 校正）。** 实际落地走的是 **TRTC 真人照片顾问「小青」+ 文字对话**路线，而非下表的轻量 3D / SVG 引导员。下表保留作历史规划参考；语音/文字对话已完成，**不再按此表重做**。

第一阶段不追求真人级视频数字人，优先做轻量 3D 方案：

| 阶段 | 目标 | 交付 | 现状（2026-06 校正） |
|------|------|------|------|
| Phase 9.1 | 静态 3D 引导员 | AvatarGuide 组件、3D 模型加载、idle 动画、文字气泡、关闭/静音、WebGL 降级 | 改走真人照片方案，3D/SVG 未采用为主方案 |
| Phase 9.2 | 语音与嘴型 | TTS 播报、简单嘴型同步、重播提示、页面欢迎语 | 由 TRTC 实时语音取代；SVG `DigitalHuman.tsx` 已成死代码 |
| Phase 9.3 | 功能引导 | 快捷问题、intent router、跳转简历/打印/招聘会/政策页面 | ✅ 已实现（AssistantPage 快捷入口 + 路由白名单） |
| Phase 9.4 | AI助手融合 | 用户提问、AI回答、回答转语音、意图跳转 | ✅ 已实现（语音通话 + 文字对话） |
| ⚠️ Phase 9.5 | AI模拟面试官 | 根据简历/岗位方向生成问题、训练问答、报告保存与打印 | 📋 未开发。**编号与 current-progress.md 已完成的「Phase 9.5 AI数字人语音通话修复」冲突**，后续需重命名/重新编号 |

必须遵守：

- 默认不启用摄像头。
- 默认不启用麦克风。
- 不做人脸识别、情绪识别。
- 不保存用户音频或视频。
- 面试训练报告只给求职者本人。
- 不把简历、面试报告、训练结果推送给企业。
- 不新增一键投递、候选人筛选、面试邀约、Offer 管理等招聘闭环功能。

### 执行约束

- 保持所有合规边界，**不新增**招聘闭环、一键投递、候选人管理等功能
- 不破坏现有 location.state 数据流，只改样式不改逻辑
- 升级后必须通过 lint/typecheck/build 全量验证
- 视觉升级参考秒哒风格，但所有代码重新编写，不复制旧代码

---

## ✅ Phase 8 - Windows Terminal Agent（设计文档 + API/文档对齐 + 设备名称/Provider分层修正 已完成 2026-05-27）

> 完整设计文档：[windows-terminal-agent-design.md](../device/windows-terminal-agent-design.md)  
> 本地打印 Spike：[local-print-spike.md](../device/local-print-spike.md)  
> Pantum API 设计：[pantum-api-design.md](../device/pantum-api-design.md)

✅ **API/文档对齐已完成（2026-05-27）**：PrintJobParams 字段统一（pageRange?）、PrintTaskCreate DTO、/tasks/claim 完整 9 字段 params、§5.1 打印机状态检测、V12–V15 WMI 状态检测验证项

✅ **设备名称/Provider分层修正（2026-05-27）**：
- 打印机名称统一为 `Pantum CM2800ADN Series`（Windows 真机确认），禁止在代码中硬编码具体型号字符串，必须通过 `printerName` 配置项传入
- `PrintJobParams` 新增可选字段 `collate?` / `paperType?` / `feeder?`（开放 API 预留，驱动待验证）
- `colorMode: 'color'` 的 Pantum 开放 API `mode` 取值标注 TODO（待厂家确认）
- `windows-terminal-agent-design.md` 新增 **§12 Provider/Executor 分层**（LocalAgentDispatchProvider / PantumCloudDispatchProvider / 三种本地 Executor）
- 新建 `docs/device/pantum-api-design.md`（签名算法/PrintJobParams 映射/预留接口/7项未解决问题清单）

### Phase 8.0 技术验证（先于编码，在真机完成）

| # | 验证项 | 优先级 | 来源 |
|---|--------|--------|------|
| V01 | TWAIN 在 LocalSystem 服务账号下是否可用 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V02 | TWAIN 在 User Session Helper 下可用 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V03 | Named Pipe + ACL 跨进程通信（Service ↔ Helper） | ⚠️ 必验 | windows-terminal-agent-design.md |
| V04 | localAuthToken / actionToken（HMAC+nonce+expires）校验 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V05 | Claim lease 超时重新领取 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V06 | node-printer 调用奔图打印机 | ⚠️ 必验 | local-print-spike.md |
| V07 | PowerShell 打印备用方案 | 备用 | local-print-spike.md |
| V08 | Windows 服务开机自启 + 崩溃重启 | ⚠️ 必验 | windows-terminal-agent-design.md |
| V09 | CreateProcessAsUser 启动 Helper | ⚠️ 必验 | windows-terminal-agent-design.md |
| V10 | 打包方案对比（pkg / nexe / electron-builder / .NET wrapper） | ⚠️ 必验 | windows-terminal-agent-design.md |
| V11 | DPAPI 加密（原机解密成功，换机失败） | ⚠️ 必验 | windows-terminal-agent-design.md |
| V12 | **Get-PrintJob 活动任务可见（WMI）** | ⚠️ 必验 | local-print-spike.md §5.1 |
| V13 | **Win32_Printer 离线状态可识别（WMI）** | ⚠️ 必验 | local-print-spike.md §5.1 |
| V14 | **Win32_Printer 缺纸状态可识别（WMI）** | ⚠️ 必验 | local-print-spike.md §5.1 |
| V15 | **不可识别状态 → UNKNOWN_PRINTER_STATUS** | ⚠️ 必验 | local-print-spike.md §5.1 |

### Phase 8.1 子阶段拆分

| 子阶段 | 名称 | 状态 | 核心内容 |
|--------|------|------|---------|
| Phase 8.1A | Local Print MVP | ✅ **已完成（2026-05-27）** | 统一 `print(file, printerName, params)`；image-to-pdf(pdfkit)；临时 PDF 清理；printerName 配置化 |
| Phase 8.1B | Agent 全链路 + 后端 4 接口 | ✅ **已完成（2026-05-27）** | 注册/心跳/claim/下载/MD5/print()/状态上报；Windows 真机 670ms 出纸 |
| Phase 8.1C | 现场长期运行加固 | ✅ **已完成（2026-05-28 Windows 真机 V8.1C-1/2 通过）** | DPAPI 加密/SQLite 幂等/PID 单实例/断网重试/Windows 服务安装 |
| Phase 8.1D | **Windows 真机 E2E 验证** | ✅ **已完成（2026-05-28，Pantum 真实出纸）** | 完整链路 783ms；proxy:false 修复；resolveFileUrl；出纸确认 |

#### Phase 8.1A 详细能力（已完成 2026-05-27）

| 能力 | 说明 | 状态 |
|------|------|------|
| 统一 `print()` 函数 | `print(file, printerName, params)` 路由 PDF / 图片 | ✅ |
| PDF 打印 | `.pdf` → Method B（pdf-to-printer/SumatraPDF）直接打印 | ✅ |
| 图片打印（JPG/PNG）| pdfkit 生成临时 PDF → Method B → 打印后删除临时文件 | ✅ |
| 图片打印（BMP/TIFF）| Phase 8.2+（需 sharp 预处理）| 📋 |
| printerName 配置化 | 从 `DEFAULT_PRINTER`（config.ts）读取，不硬编码 | ✅ |
| 临时文件清理 | 打印后立即删除；启动时清理超过 1 小时的残留 | ✅ |

#### Phase 8.1B 详细能力（已完成 2026-05-27）

| 能力 | 说明 | 状态 |
|------|------|------|
| 终端注册 | `POST /auth/terminal/register`，设备指纹，持久化 terminalId | ✅ |
| 心跳上报 | 每 30s（`PUT /terminals/:id/heartbeat`） | ✅ |
| 打印任务 Claim | `POST /terminals/:id/tasks/claim`，5s 轮询，5 分钟 lease | ✅ |
| 打印任务执行 | 下载 → MD5 校验 → 统一 print() → 状态回传 | ✅ |
| 临时文件 try/finally 清理 | 任务结束立即删除临时 PDF | ✅ |

#### Phase 8.1C 详细能力（2026-05-28 Windows 真机 V8.1C-1/2 通过）

| 能力 | 说明 | 状态 |
|------|------|------|
| DPAPI 加密 | agentToken PowerShell stdin LocalMachine scope，base64 存 agent.token | ✅ Windows 真机通过 |
| SQLite 重启幂等 | `print_tasks` 表，markTaskDone before PATCH，防重复打印 | ✅ Windows 真机通过 |
| PID 文件单实例锁 | ESRCH 僵尸锁检测，DUPLICATE_INSTANCE exit 1 | ✅ 代码完成（Phase 8.2 双进程测试） |
| 断网 PATCH 重试 | `pending_patches` 队列，60s 轮询，指数退避，max 10，4xx 放弃 | ✅ 代码完成（Phase 8.2 断网测试） |
| Windows 服务安装 | install-service / uninstall-service（node-windows） | ✅ 代码完成（Phase 8.2 服务安装测试） |
| adminSecret 注册后清除 | 注册成功后从 config.json 移除 adminSecret | ✅ Windows 真机通过 |

### Phase 8.2 扩展（Phase 8.1D 真机验收通过后）

| 能力 | 说明 |
|------|------|
| 扫描任务执行 | Named Pipe 触发 Helper → TWAIN → PDF 合并 → 上传 → 回传（原 Phase 8.1D 设计） |
| SMB 扫描备用方案 | TWAIN 不可用时监听 SMB 共享目录 |
| BMP/TIFF 打印 | sharp 预处理 → pdfkit → Method B |
| U 盘监听 | USB 存储挂载检测，文件列表推送 Kiosk |
| 设备事件告警 | 缺纸、墨粉不足、卡纸主动上报 |
| Prisma 持久化 | 服务端打印任务状态落库（PostgreSQL） |

### Phase 8.3 扩展（更后期）

| 能力 | 说明 |
|------|------|
| 摄像头 | Helper 进程 DirectShow 采集，证件照上传 |
| 扫码器 | Helper 进程 node-hid 输入拦截 |
| Agent 自动更新 | 后端下发版本，自动下载替换 |

### 关键风险（见设计文档 §10）

- **R2（高）**：TWAIN 在 LocalSystem 下可能不可用 → 双进程架构已针对此设计；V01/V02 必验
- **R3（高）**：node-printer 兼容性 → V06/V07 提前验证，PowerShell 备用就位
- **R11（高）**：Named Pipe 在特殊策略下失败 → V03 验证，localhost:9528 降级备用
- **R12（高）**：CreateProcessAsUser 受限 → V09 验证，任务计划程序备用

---

## Phase 9.1 UI Polish 收尾(carry-over)

Phase 9.1 Admin 后台 Polish 已主体完成(commit 见 feat/ui-polish-9.1-fix),以下条目延后单独补:

| # | 条目 | 来源 | 备注 |
|---|------|------|------|
| 1 | **Partner 后台 Polish** | Mavis | worker 交付问题未跑完;同 DataTable.tsx 模式复制即可 |
| 2 | **Kiosk 视觉打磨** | Mavis | 同上 |
| 3 | **printers Tab 漏补分页/搜索/EmptyState** | 0a Verifier | `apps/admin/src/routes/printers/index.tsx` 219 行表格页与 terminals 同等规模,Mavis 漏算(误以为已废弃,实为 /devices?tab=printers 的 Tab 内容) |
| 4 | **Tab + URL 状态冲突** | 0a Verifier | `/devices?tab=X` 与 `useTableState` 共用 URL search params。在终端 Tab 翻页/搜索后切到打印机 Tab,page/search 会被带过去。修法:Tab 切换时清掉 page/pageSize/search,或给 `useTableState` 加 keyPrefix |
| 5 | **DataTable.tsx 自身 gray-* 残留** | 0a Verifier | 文件位于 `apps/admin/src/routes/components/`,Mavis 自己新建,但内部 14 处 gray-* 未走 neutral token;不在 line 358 的 "packages/ui 内" 范围,故 Verifier 未报。建议下次 Polish 一起换 |

**优先级**:这 5 条都属于 UI 微调,不阻塞 0b/#5 后端真数据接入。等后端真数据进来,admin 这些页本来也要回去改字段映射,届时顺手处理。

---

## 空壳页清单（Phase 9+ 待做 / 规划中）

> 来源：2026-06-05 仓库卫生清理（分支 `codex/cleanup-repo-hygiene`）盘点。
> 以下页面**已有路由和占位 UI，但无业务逻辑**，统一登记为 Phase 9+ 待做，便于跨窗口/跨模型协作时区分"待做"与"废弃"。
> 本次清理**不改动这些页面的逻辑**，仅做状态登记。

### Admin 后台（3 个空壳）

| 路由 | 页面 | 当前形态 | 占位文案 | 计划 |
|------|------|----------|----------|------|
| `apps/admin/src/routes/peripherals/` | 外设管理 | EmptyState（12 行） | "暂无外设数据 / 连接终端外设后将显示设备列表" | Phase 9+ 待接外设上报 |
| `apps/admin/src/routes/permissions/` | 权限管理 | 骨架屏（40 行） | "角色权限模型设计中,后续将提供超级管理员/运营/只读等预置角色" | Phase 9+ 规划中（权限模型） |
| `apps/admin/src/routes/users/` | 用户管理 | 骨架屏（40 行） | "用户数据接入中,接入后将显示真实记录" | Phase 9+ 待接用户数据 |

### Partner 合作机构后台（4 个空壳）

| 路由 | 页面 | 当前形态 | 占位文案 | 计划 |
|------|------|----------|----------|------|
| `apps/partner/src/routes/account/` | 账号权限 | EmptyState（15 行） | "暂无账号配置 / 添加子账号后将在此处显示" | Phase 9+ 待做（子账号） |
| `apps/partner/src/routes/policy/` | 政策公告 | EmptyState（15 行） | "暂无政策公告 / 发布就业政策和补贴申请指南" | Phase 9+ 待做 |
| `apps/partner/src/routes/stats/` | 数据统计 | EmptyState（15 行） | "暂无统计数据 / 数据积累后自动展示统计报表" | Phase 9+ 待做（依赖数据积累） |
| `apps/partner/src/routes/terminals/` | 终端数据 | EmptyState（15 行） | "暂无终端数据 / 关联终端后将显示使用统计" | Phase 9+ 待做 |

> 说明：Admin / Partner 其余路由（orders / files / alerts / audit / job-sources / fair-sources / sync-sources / printers / partners / fairs / sources / jobs / sync-logs / dashboard / profile 等）均为已实现页面；其中用到的 `EmptyState` 是**数据为空时的正常空状态**，不属于空壳页。
> 处置建议（待 owner 拍板）：完成实现，或在确认不在路线图内后删除——**不要长期留作无说明的占位**。

---

## 近期不做

- 后端数据库 / Prisma schema 迁移（Phase 7.6 第一步先出骨架和 stub）
- **Kiosk 视觉打磨（第 9 阶段）** ← Phase 7/8 全部完成前不启动
- **AI数字人互动（第 9 阶段）** ← Phase 8 完成前不启动；需求规划已在 [ai-avatar-guide.md](../product/ai-avatar-guide.md)，当前阶段不写任何实现代码
- **底部 Tab 扩展** ← 底部导航固定为"首页 / AI助手 / 我的"三项，不增加第四个 Tab
- **打印材料包 / 求职打印套餐 / 面试练习 / AI求职路线** ← Phase 8.1B 完成前不启动，不并行开发
- 企业招聘端（已确认删除，永不开发）
- 平台内一键投递、候选人管理、企业查看简历、面试邀约、Offer 管理（永不开发）
