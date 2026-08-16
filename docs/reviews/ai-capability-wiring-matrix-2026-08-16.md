# AI 能力 × 页面 接线矩阵与实施方案（2026-08-16）

> **核实基准：`origin/main` @ `6caedd6dcc396c080a2044f87d3d9d882f99c453`**（2026-08-16，`feat(api): 一体机匿名反馈端点（A3 S1）—— 免登录受限提交面 (#612)`）。
> 初稿基准为 `a7ddbc945`（#610）；2026-08-16 复核时 main 已前进 6 个提交至 `6caedd6dc`，本文**已按新 head 重新核验**，逐条影响见 §1.7。
> 仓库当前有 29 个 worktree。本文**所有「存在 / 缺失」结论一律用 `git archive origin/main` 导出的只读快照取值**，不以任何工作区检出为准。快照命令：
> `git archive origin/main docs/design/kiosk-ai-os-v3-2026-08 apps/kiosk/src services/api/src packages/shared/src | tar -x -C <snapshot>`
> 本文**只出方案，不改任何生产代码、不改原型、不碰 `docs/progress/`**。
>
> **前提定调（产品所有者）**：本项目底层是「AI 求职操作系统」，AI 是驱动层不是附加功能，每个页面都要能用 AI 增强使用。
> 实证：`docs/design/kiosk-ai-os-v3-2026-08/01-home-v6.html` 的 `<title>` 即 `P01 首页 · AI 神经中枢 V6 — AI 求职操作系统`；原型已定义接线契约 `data-aitask ——「AI 任务状态绑定，生产必须照此实现」`。

## 0. 本文与既有文档的关系（不重做已有结论）

| 文档 | 位置 | 本文如何使用 |
|---|---|---|
| `console-c0-fact-freeze-2026-08-16.md` §2.2 | 分支 `claude/four-tasks-project-coordination-d39229`（**不在 main**） | **直接复用其 P01–P46 → React 路由映射表**，本文第二部分不重做映射，只在其上叠加 AI 列 |
| `ai-capability-spec.md` | `origin/main:docs/design/kiosk-ai-os-v3-2026-08/ai-capability-spec.md`（67 行） | 原型侧的 **A1–A28 能力承诺清单**。本文用后端真值逐条复核，**发现其「生产落点」列已有 2 处过期**（见 §1.6） |
| `interface-handoff.md` | `origin/main:docs/design/kiosk-ai-os-v3-2026-08/interface-handoff.md` | 四态契约（`default/first/ai-down/device-off`）、证据分级 E1/E2/E3、材料交接 `artifact` 契约、降级契约、§4A AI 输出异常契约。本文第三部分的降级路径直接引用 |
| `closed-loop-map.md` §六 | 同目录 | 「AI 介入的统一面孔」：四要素建议卡（动作/理由/代价/备选）+ E1/E2/E3。本文第二部分④列按此写 |
| `step-reduction.md` | 同目录 | 步骤压缩账（打印 9→5、诊断 6→4、招聘会 6+→3、面试 8→5、政策 8→5）。本文第三部分的「当前步数 / AI 介入后步数」引用此表 |
| `a3-print-fulfillment-gap-spec-2026-08-16.md` | 同分支 | P06/P07/P08/P39/P41 逐控件规格。本文不重复控件级结论 |
| `kiosk-control-integrity-audit-2026-08-16.md` | 同分支 | 705 个 onClick 完整性审计。本文不重复 |

---

## 一、AI 能力清单（后端真值，`origin/main`）

### 1.1 全局架构事实

| 事实 | 证据（`origin/main` 路径:行） |
|---|---|
| API 全局前缀 `/api/v1` | `services/api/src/main.ts:62` |
| AI 相关模块全部已在 `AppModule` 注册（无未挂载模块） | `services/api/src/app.module.ts:98`（MockInterview）`:105`（Materials）`:106`（JobMaterials）`:108`（JobAi）`:109`（Ai）`:141`（ContractReviewHttp） |
| **存在两套并行的 LLM 配置系统**，互不相通 | ①`AI_MODEL_FEATURES` 功能位注册表：`services/api/src/ai/llm/llm-config.service.ts:69`（密钥加密落库，Admin 可配）②合同审查独立 env 配置：`services/api/src/contract-review/contract-review-provider.service.ts:110-133`（`CONTRACT_REVIEW_PROVIDER` 只允许 `deepseek`/`qwen`） |
| 供应商预设 4 家，均走 OpenAI 兼容 Chat Completions | `services/api/src/ai/llm/llm-presets.ts:21-64`（deepseek / qwen / minimax / yuren） |
| 合规护栏（角色范围 + 禁用词 + 输出改写）对**助手对话**恒定生效 | `services/api/src/ai/llm/llm-guard.ts:1-24`（`DEFAULT_ROLE_SCOPE`、`DEFAULT_FORBIDDEN_WORDS` 10 条：一键投递 / 立即投递 / 平台投递 / 投递简历 / 企业收简历 / 候选人管理 / 候选人筛选 / 面试邀约 / Offer管理 / 推荐给企业），`:59` `enforceForbiddenWords` 命中即换兜底话术 |
| AI 用量日志只记元数据，**禁止记简历文本 / 建议正文 / 聊天原文 / 文件名 / fileId** | `services/api/src/ai/ai-log.service.ts:5-13`、`:53-68`、`:298`（`persist()` 落库字段清单） |
| **`AiServiceLog` 是 best-effort 观测数据，不是账单** | `services/api/src/ai/ai-log.service.ts:270-276`（`record()` 故意不阻塞调用方）、`:308` 写库失败只 `logger.warn` 吞掉。另 `NON_TOKEN_BILLED_OPERATIONS`（`:47`）的 `estimatedCostCny` 恒 `undefined`，Admin 侧**不得把 undefined 当 0 显示为「免费」** |
| AI 派生结果有 TTL 硬删 + 审计 | `services/api/src/ai/ai-result.cleanup.task.ts:13-22`（每小时 cron，`AI_RESUME_RESULT_TTL_HOURS` 默认 24h；`AI_SERVICE_LOG_RETENTION_DAYS` 默认 90 天） |

### 1.2 `AI_MODEL_FEATURES` 功能位注册表（8 键：6 active / 2 planned）

`services/api/src/ai/llm/llm-config.service.ts:69-141`。管理端点 `GET/PUT /admin/ai-configs[/:featureKey]`、`POST /admin/ai-configs/:featureKey/test`（`services/api/src/ai/llm/ai-config.controller.ts:79-124`，`JwtAuthGuard + RolesGuard`）。

| featureKey | 标签 | status | 允许自定义 SystemPrompt |
|---|---|---|---|
| `assistant_chat` | AI助手对话 | active | ✅ |
| `resume_diagnosis` | AI简历诊断 | active | ❌（服务端强制结构化 prompt） |
| `resume_generate` | AI简历生成 | active | ❌（防编造契约） |
| `resume_optimize` | AI简历优化 | active | ❌（防编造契约） |
| `mock_interview` | AI模拟面试 | active | ❌ |
| `digital_human` | AI数字人引导 | **planned** | ✅ |
| `poster_generation` | AI海报生成 | **planned** | ✅ |

> ⚠️ **`resume_optimize` 一键共用 7 项能力（不是代码注释里写的 6 项）。**
> `llm-config.service.ts:118-127` 的注释登记了 6 项，**漏了自我探索**。按注释自己规定的权威检索命令 `grep -rn -E "get(ApiKey|Config)\('resume_optimize'\)" services/api/src` 实测命中 7 个消费方：
> 1. `ai/resume/llm-resume-optimize.service.ts:171,213`（本键名义归属：简历优化 + 版式调整）
> 2. `ai/resume/llm-job-fit.service.ts:366-367`（岗位匹配）
> 3. `ai/resume/llm-career-plan.service.ts:231-232`（职业规划）
> 4. `ai/resume/llm-fair-visit-plan.service.ts:174-175`（招聘会拜访计划）
> 5. `ai/resume/llm-self-assessment.service.ts:107,196-197`（**自我探索解读 —— 注释未登记**）
> 6. `job-ai/job-ai-llm.service.ts:145-146`（岗位推荐 `jobRecommend`）
> 7. 同上（岗位解释 `jobExplain`）
>
> **后果**：Admin「AI大模型」里关掉「AI简历优化」或改错凭证，会一并静默停掉 P09 优化、P11 岗位匹配、P22 职业规划、P17/P45 参会计划、P28 自我探索解读、P13/P14 岗位推荐与解释。运行端只表现为「未配置 / 不可用」，不会说明这层依赖。

### 1.3 逐能力清单（端点 · 契约 · 门禁 · 计量 · 降级）

图例：**真实模型** = 走 LLM HTTP 调用；**规则** = 纯确定性逻辑，不调模型；**stub** = 骨架在但默认关闭。

#### A 组：简历链（`AiModule`）

| # | 能力 | 端点 | 输入 | 输出 | 登录 | consent | 计量 | 失败降级 | 类型 |
|---|---|---|---|---|---|---|---|---|---|
| A1 | 简历解析 + 诊断（六维评分） | `POST /resume/parse`<br>`GET /resume/records/:taskId` | `fileId/fileName/fileFormat/source(upload\|scan\|manual)` + 可选 `selectedDimensions[≤6]` + `targetContext{industry,targetJob,experience,scene,major,degree,skipped}`（`ai/dto/resume-parse.dto.ts:59-89`） | `{taskId,status,report{sections[6],suggestions[3-6],riskNotes[0-5],priorities[2-4]}}` | 否（匿名走 `x-resume-access-token`） | 无 | `parseResume` | 未配置 → `AI_PROVIDER_NOT_CONFIGURED`；调用失败 → `status:'failed'` + 明确 `failReason`，**绝不 fallback mock、绝不伪造报告**（`ai/providers/llm.provider.ts:35-38,60-73`） | **真实模型** |
| A2 | 简历优化（防编造） | `GET /resume/records/:taskId/optimize?benefitGrantId=` | 简历原文 + 诊断报告 | `{modules[],optimizedResume}` | 权益核销需登录 | 无 | `optimizeResume` | `AI_OPTIMIZE_INVALID_OUTPUT` → 「优化结果包含无法从原文确认的信息，系统已拦截」；原文已按隐私策略清理 → 提示重新上传（`ai/providers/llm.provider.ts:89-111`） | **真实模型** |
| A3 | 简历版式调整 | `POST /resume/records/:taskId/layout-adjust` | `resume/action/layout` | 调整后简历 | 否 | 无 | `adjustResumeLayout` | 同上 | **真实模型** |
| A4 | 访谈式简历生成 | `POST /resume/generate`<br>`GET /resume/generate/:taskId`<br>`POST /resume/generate/export` | 引导式表单作答 | `{resume, missingHints}`（跳过项进 `missingHints`，**不补**） | 否 | 无 | `generateResume` | 同 A1，只润色不编造（`ai/resume/llm-resume-generate.service.ts:90-98`） | **真实模型** |
| A5 | 简历语音输入转写 | `POST /resume/voice/transcribe` | 音频 buffer（内存中转，不落盘） | 转写文本 | 否 | 无 | `voiceTranscribe`（**按时长计费，不估成本**） | `ASR_PROVIDER=disabled`（默认）→ 诚实返回 `ASR_NOT_CONFIGURED`，前端自动回退文字输入（`asr/asr.service.ts:6-8`） | **真实模型（默认关闭）** |
| A6 | 简历文本提取 + OCR | 内部服务（被 A1 调用） | 文件 | 文本 + 置信度告警 | — | — | — | 置信度低 → `warnings` 追加「文字识别置信度有限，诊断结果仅供参考」（`ai/resume/resume-extraction.service.ts:312`）；`OCR_PROVIDER=disabled` → 诚实失败 | **真实模型（百度/腾讯 provider）** |

#### B 组：定向输出链（全部复用 `resume_optimize` 功能位）

| # | 能力 | 端点 | 输入 | 输出 | 登录 | consent | 计量 | 失败降级 | 类型 |
|---|---|---|---|---|---|---|---|---|---|
| B1 | 岗位匹配参考（Job Fit） | `POST /resume/job-fit`<br>`GET /resume/job-fit/:taskId`<br>`POST /resume/job-fit/:taskId/print`<br>`POST\|GET\|DELETE /resume/job-fit/consent[/:taskId]` | `taskId` + `jobId` 或 `manualJob{title,requirements≤2000字}`（`ai/job-fit.controller.ts:24-33`） | 参考等级三档 + 逐条 match/gap + 关键词命中/缺失 + 行动建议 | 否 | ✅ **有专属 consent 端点** | `jobMatch` | `AI_NOT_CONFIGURED` / `AI_UNAVAILABLE`（`ai/resume/llm-job-fit.service.ts:369`） | **真实模型** |
| B2 | 职业规划建议 | `POST /resume/career-plan/:taskId`<br>`GET`<br>`POST .../print` | `taskId`（简历解析结果） | `{summary,directions[]}` + PDF | 否 | 无 | `careerPlan` | `AI_NOT_CONFIGURED` / `AI_UNAVAILABLE`（`ai/resume/llm-career-plan.service.ts:234,256-271`） | **真实模型** |
| B3 | 自我探索 · 倾向参考 | `POST /resume/self-assessment`<br>`GET /:taskId`<br>`POST /:taskId/print`<br>`POST /:taskId/append`<br>`DELETE /:taskId`（撤回=物理删 payload） | 25 题作答 + `consent{nonSensitive,sensitive}` | 5 维 `strength(0-5)` + 每维 `note` + `summary` | 否 | ✅ **题内敏感项单独勾选同意** | `selfAssessment` | **打分是纯函数不受 AI 影响**（`ai/resume/self-assessment-scoring.ts:1-16`：不读库、不写日志、不调 LLM）；LLM 挂 → `note=null` + `summary=null` + `providerName='llm_unavailable'`，**主流程不阻塞**（`ai/resume/llm-self-assessment.service.ts:111-118`） | **规则打分 + 真实模型解读** |
| B4 | 招聘会拜访计划 | `POST /job-fairs/:fairId/visit-plan/:taskId`<br>`GET`<br>`POST .../print` | `fairId` + 简历 `taskId` | 参会准备单 + PDF | 否 | 无 | `fairVisitPlan` | 同 B2 | **真实模型** |

#### C 组：岗位 AI（`JobAiModule`，治理最完整的一组）

| # | 能力 | 端点 | 输入 | 输出 | 登录 | consent | 计量 | 失败降级 | 类型 |
|---|---|---|---|---|---|---|---|---|---|
| C1 | 岗位推荐（列表收敛排序） | `POST /jobs/ai/recommendations`（限流 6/60s） | `resumeTaskId` + `intent{targetTitle,city,industry,keywords}` + `filters{city,category,skills,sourceOrgId}` + `limit≤10` | `{session,recommendations[{job,rank,fitLevel,summary,matchPoints,gapPoints,actionChecklist}],disclaimer:'仅供参考'}` | 否 | ✅ `job_ai`（`job-ai/job-ai.service.ts:118`） | `jobRecommend` | 结果为空时诚实返回空数组 + `disclaimer`（`job-ai/job-ai.service.ts:71`） | **真实模型** |
| C2 | 岗位解读 | `POST /jobs/:id/ai/explain`（限流 10/60s） | 岗位正文 | `{responsibilities,mustHaveRequirements,niceToHaveRequirements,preparationTips}` | 否 | ✅ `job_ai` | `jobExplain` | 同上 | **真实模型** |
| C3 | 单岗匹配（受治理） | `POST /jobs/:id/ai/match`（限流 6/60s） | `resumeTaskId` | 同 B1 | 否 | ✅ `job_ai`（`job-ai/governed-job-fit.service.ts:77,108`） | `jobMatch` | 同 B1 | **真实模型** |
| C4 | 岗位 AI 会话记录 | `GET /me/job-ai-sessions`<br>`DELETE /me/job-ai-sessions/:id` | — | 会话列表 | ✅ `EndUserAuthGuard` | — | — | — | 规则 |
| C5 | **岗位数据质量分级** | 内部服务 | 岗位行 | `ready\|partial\|insufficient` + 缺失字段（8 必需 + 7 AI-ready）（`job-ai/job-quality.service.ts:4-25`） | — | — | — | 确定性逻辑，AI 挂不影响 | **规则** |
| C6 | **三维日配额** | 内部（member / terminal / ip） | — | `JOB_AI_QUOTA_EXCEEDED` 429 | — | — | — | Redis 挂 → `JOB_AI_QUOTA_UNAVAILABLE` 503，**fail-closed 不放行**（`job-ai/job-ai-quota.service.ts:44-49`） | **规则** |

> 默认配额：会员 20/日、终端 100/日、IP 60/日（env `JOB_AI_MEMBER_DAILY_LIMIT` / `JOB_AI_TERMINAL_DAILY_LIMIT` / `JOB_AI_IP_DAILY_LIMIT`，`job-ai-quota.service.ts:24-27`）。失败会回滚计数（`:52`）。
> **这是全站唯一有配额治理的 AI 能力组**。A 组、B 组、D 组只有 `@Throttle` 分钟级限流，没有日配额。

#### D 组：模拟面试（`MockInterviewModule`，独立 `mock_interview` 功能位）

| # | 能力 | 端点 | 输入 | 输出 | 登录 | consent | 计量 | 失败降级 | 类型 |
|---|---|---|---|---|---|---|---|---|---|
| D1 | 组卷 + 逐题追问 | `POST /mock-interviews`<br>`POST /:id/start`<br>`POST /:id/answer`<br>`POST /:id/end` | `interviewerType(hr\|manager\|tech\|campus\|final)` + `industry` + `position` + `experience(fresh\|lt1\|y1_3\|y3_5\|gt5\|switch)` + `difficulty(easy\|standard\|pressure)` + `durationMin(3\|5\|8)` + 可选 `resumeFileId` + `interactionMode(text\|voice)`（`mock-interview/mock-interview.controller.ts:20-49`） | 逐题问答 | 否（匿名走 `x-interview-access-token`） | 无 | `interviewQuestion` | — | **真实模型** |
| D2 | 练习报告 | `GET /:id/report`<br>`POST /:id/report/print` | 会话 | 报告 + PDF | 否 | 无 | `interviewReport` | — | **真实模型** |
| D3 | 语音转写（回合制） | `POST /:id/transcribe` | 音频 ≤4MB / ≤60s | 转写文本（用户可编辑后确认） | 否 | 无 | `voiceTranscribe` | `GET /mock-interviews/capabilities/voice` 探测 `{asrEnabled,ttsEnabled}`，不可用**自动回退文字输入**（`mock-interview.controller.ts:212-216`） | **真实模型（默认关闭）** |
| D4 | 面试官语音播报 | `POST /:id/turns/:idx/audio` | 已落库的问题文本（不开放任意文本合成） | base64 mp3 | 否 | 无 | `voiceSynthesize` | 失败诚实返回，前端降级浏览器本地 TTS，**绝不阻塞面试主流程**（`mock-interview/asr/tts.service.ts:16`） | **真实模型（默认关闭）** |
| D5 | 面试记录 | `GET /me/mock-interviews`<br>`DELETE /me/mock-interviews/:id` | — | 列表 | ✅ `EndUserAuthGuard` | — | — | — | 规则 |

#### E 组：合同审查（`ContractReviewModule`，**独立 LLM 配置 + 全站最强隐私治理**）

| # | 能力 | 端点 | 输入 | 输出 | 登录 | consent | 计量 | 失败降级 | 类型 |
|---|---|---|---|---|---|---|---|---|---|
| E1 | 合同风险提示 | `POST /contract-reviews`（6/60s）<br>`GET /contract-reviews/consent-scope`<br>`GET /:id`<br>`POST /:id/confirm`<br>`POST /:id/report`（4/60s）<br>`DELETE /reports/:fileId`<br>`DELETE /:id` | 合同文件 + 类型 + `consentScopeHash`（`contract-review/dto/contract-review.dto.ts:29`） | 三档风险 + 原文摘录 + 页码 + 法律依据 + 局限 | 否（匿名走 `x-contract-review-access-token`） | ✅ **`contract_review` scope + 版本化免责声明 + `consentScopeHash` 防篡改** | 走自己的 `aiProvider` 字段，**不进 `AiOperation`** | 缺 `REDIS_URL` 或 `CONTRACT_REVIEW_API_KEY` → **fail-closed，任务不会进入未获准的模型分析**（`contract-review/contract-review-http.module.ts:17-21`）；`OCR_PROVIDER=disabled` → `OCR_NOT_CONFIGURED`（`contract-review-extraction.service.ts:421`） | **真实模型（deepseek/qwen 白名单）** |

> **E1 是全站唯一在喂模型前做 PII 脱敏的链路**：`contract-review/contract-review-pii-masker.ts` 覆盖身份证 18/15 位、手机号、银行卡、邮箱、统一社会信用代码、详细地址、劳动者 / 用人单位姓名共 8 类；`contract-review-orchestrator.service.ts:170` 在调模型前 `maskContractPages()`，`contract-review-provider.service.ts:1` + `contract-review-safety-gate.service.ts:1` 用 `assertNoHighConfidencePii()` 二次断言。
> **该 masker 在 `contract-review/` 之外 0 处引用** —— 简历链（A 组）、定向输出链（B 组）把简历原文**未脱敏**直接送模型。见 §1.5 风险 R2。

#### F 组：打印材料预处理（`MaterialsModule`，**已存在，不是新增**）

| # | 能力 | 端点 | 输入 | 输出 | 登录 | consent | 计量 | 失败降级 | 类型 |
|---|---|---|---|---|---|---|---|---|---|
| F1 | 材料体检 / A4 归一 / 敏感信息扫描 / 遮盖 / 装订渲染 | `POST /materials/tasks`<br>`GET /materials/tasks/:id`<br>`POST /materials/tasks/:id/pii-findings/decisions` | `kind ∈ {inspection, normalize_a4, pii_scan, pii_redact, bundle_render}` + `sourceFileId`（`materials/materials.types.ts:1-7`） | `DocumentProcessTaskView{status,result,piiFindings[{type,label,pageNumber,snippet≤32字符,confidence,action}]}` | 否（匿名 `accessToken` 或 member） | 无 | **不进 `AiOperation`** | **三态返回，绝不把「没扫描」或「扫描失败」伪装成「扫描完成 0 命中」**：`ok` / `degraded` / `unsupported_format`；`truncated=true` 时调用方不得当作完整扫描（`materials/pii-scan.util.ts:66-79`） | **规则（正则）+ OCR（真实模型）** |

> F1 用的 OCR 由 `AiModule` 导出给 `MaterialsModule`（`ai/ai.module.ts:96-97`）。born-digital PDF 走 unpdf 文字层零 OCR 成本，扫描件才逐页 OCR（`PII_SCAN_MAX_OCR_PAGES` 默认 5，上限 10）。
> 高风险 purpose 强制真实扫描：`resume_upload / resume_scan / id_scan / cover_letter`（`materials/pii-scan.util.ts:30`）。

#### G 组：助手 / 管理 / 其它

| # | 能力 | 端点 | 登录 | 类型 | 备注 |
|---|---|---|---|---|---|
| G1 | AI 助手对话（小青） | `POST /assistant/chat` | 否 | **真实模型**（`assistant_chat` 就绪时）**/ mock provider 降级** | `ai/ai.service.ts:761-766`：`isReady('assistant_chat')` 为假时**回落到 `this.provider`**，若部署成 mock provider 会输出预置话术（`ai/providers/mock.provider.ts:154-178`）。⚠️ 这是全站**唯一**有 mock 回落的 AI 路径，见 §1.5 风险 R1 |
| G2 | 求职材料生成（求职信/自我介绍/清单） | `GET /job-materials/templates`<br>`POST /job-materials/generate` | ✅ | **规则（模板渲染）** | `job-materials/job-materials.service.ts:30-56`：`findJobMaterialTemplate` → `pdf.render(template, normalized)`，**全链路无 LLM**。`resume_template` 类型直接 400 引导去简历链 |
| G3 | AI 海报生成 | `GET /admin/ai-posters/status`<br>`POST /admin/ai-posters/generations`<br>`GET /:id`<br>`POST /:id/accept` | ✅ Admin | **stub** | `content/ai-poster.provider.ts:36-48` `DisabledAiPosterProvider`，默认 `AI_IMAGE_PROVIDER=disabled`，调用抛错**不假装成功** |
| G4 | AI 用量 / 日志（Admin） | `GET /admin/ai/usage`<br>`GET /admin/ai/logs?limit=` | ✅ Admin | 规则 | `ai/ai.controller.ts:407-418`。**AI 管理端点只有这两个**（C0 §2.3 已实测：`mapping.html` 写的 `/admin/ai/cost/*` `/quality/*` `/health` `/incidents` `/compliance/*` 全部虚构） |
| G5 | AI 模型配置（Admin） | `GET/PUT /admin/ai-config`（旧，默认 `assistant_chat`）<br>`GET/PUT /admin/ai-configs[/:featureKey]`<br>`POST /admin/ai-configs/:featureKey/test` | ✅ Admin | 规则 | 非法 featureKey 抛 400，**绝不静默回落到 `assistant_chat`**（`ai/llm/llm-config.service.ts:337`） |
| G6 | AI 授权（会员） | `GET /me/ai-consents/status`<br>`POST /me/ai-consents`<br>`POST /me/ai-consents/:scope/revoke` | ✅ `EndUserAuthGuard` | 规则 | **仅 2 个 scope**：`job_ai`（版本 `20260701`）、`contract_review`（版本 `contract-review-consent-v1`）（`member-privacy/member-privacy.service.ts:12-20`） |
| G7 | AI 服务记录（会员） | `GET /me/ai-records`<br>`DELETE /me/ai-records/:id` | ✅ | 规则 | `member-assets/member-assets.controller.ts:66,80` |

### 1.4 计量矩阵：`AiOperation` 17 值 vs 实际能力

`ai/ai-log.service.ts:24-45`。**新增 operation 必须三处同步**（本文件联合类型 + `AdminAiUsage.byOperation` + `apps/admin` 三处），漏了会被 `normalizeOperation` 兜底成 `classifyIntent` 错算到别的能力头上；守卫脚本 `pnpm --filter @ai-job-print/api verify:ai-cost-coverage`。

| 已计量（17） | 未计量（真实模型调用但不进 `AiServiceLog`） |
|---|---|
| `parseResume` `optimizeResume` `adjustResumeLayout` `generateResume` `chatAssistant` `classifyIntent` `jobRecommend` `jobExplain` `jobMatch` `careerPlan` `fairVisitPlan` `interviewQuestion` `interviewReport` `voiceTranscribe` `voiceSynthesize` `selfAssessment` | **合同审查（E1）** —— 走自己的 `aiProvider` 字段（`contract-review-orchestrator.service.ts:268`），Admin AI 用量页看不到它的调用与成本<br>**Materials OCR（F1）** —— 打印材料 PII 扫描的 OCR 调用不落 `AiServiceLog` |

> `NON_TOKEN_BILLED_OPERATIONS = ['voiceTranscribe','voiceSynthesize']`（`:53`）：按时长/字符计费，`tokenUsage` 恒空、`estimatedCostCny` 通常 `undefined`。**Admin 必须如实标注「按时长/字符计费，未估算成本」，不得当 0 展示为「免费」。**

### 1.5 后端侧已识别风险（登记，本文不修）

| ID | 风险 | 证据 | 影响 |
|---|---|---|---|
| **R1** | **助手对话是全站唯一可能回落到 mock 预置话术的 AI 路径** | `ai/ai.service.ts:761-766` `useLlm = isReady('assistant_chat')`，为假时走 `this.provider.chatAssistant()`；`ai/providers/mock.provider.ts:154-178` 有 5 段预置话术 | 若生产误部署成 mock provider，P25/P26 会输出**看起来像 AI 回答**的固定文案，违反 CLAUDE.md §9「不伪造能力」。**接线时必须让前端能区分 `provider` 标签**（`providerLabel` 已在服务端算出：`llm:<vendor>` vs provider 名） |
| **R2** | **简历原文未脱敏直送模型** | PII masker 只在 `contract-review/` 内使用（§1.3 E 组注）；`ai/resume/llm-resume.service.ts` 的 `MAX_DIAGNOSIS_INPUT_CHARS=12000` 只做截断不做脱敏 | 简历含姓名 / 手机 / 身份证 / 住址时原样出境到第三方模型。**合同审查已有的 masker 是现成可复用件** |
| **R3** | **`resume_optimize` 单点故障覆盖 7 项能力** | §1.2 | Admin 一个开关能静默停掉 6 个页面的 AI |
| **R4** | **AI 产物 PDF 无 AIGC 元数据标识** | 实测 6 个 AI PDF 服务：`contract-review-report-pdf.service.ts:52,75,118` **有**（`Subject` + 页眉 + 每页页脚）；其余 5 个只有首页一行免责声明、**PDF metadata 无 AIGC 字段**：`job-fit-pdf.service.ts:91`、`career-plan-pdf.service.ts:84`、`fair-visit-plan-pdf.service.ts:70`、`self-assessment-pdf.service.ts:77,103`、`interview-report-pdf.service.ts:74`。**`resume-pdf.service.ts:148` 只有 `info:{Title}`，完全无标识** | 与 `interface-handoff.md` §3「AIGC 标识：所有 AI 生成内容（含打印件）必须带可见标识与文件元数据标识，每页恰好一次」冲突。简历 PDF 是否加可见标识需产品裁决（用户要拿去投递），但**隐式元数据标识没有理由不加** |
| **R5** | **除岗位 AI 外无日配额** | `JobAiQuotaService` 只被 `JobAiModule` 使用；A/B/D 组只有 `@Throttle` 分钟级限流 | 一体机是公共设备，简历诊断 / 优化 / 面试 / 职业规划可被单人刷成本 |
| **R6** | **`/ai/plan`（P26 顾问作业面）在 main 无任何后端** | 全量 grep `services/api/src` 无 `ai/plan` 路由 | P26 是原型定义的「三种作业型」核心页，后端 0 实现 |

### 1.6 原型 `ai-capability-spec.md` 的过期项（用后端真值复核）

| 原文结论 | 后端真值 | 判定 |
|---|---|---|
| A21「材料体检与参数预设」生产落点 = **新增** | `MaterialsModule` `kind='inspection'` 已在 main（`materials/materials.service.ts:267-286`） | ❌ **已过期**，体检部分已存在；缺的是「6 项参数预设」 |
| A22「敏感信息遮盖」生产落点 = **新增** | `kind='pii_scan'` / `'pii_redact'` + `POST /materials/tasks/:id/pii-findings/decisions` 已在 main | ❌ **已过期**，能力已存在 |
| A20「合同风险提示：已有骨架，**报告端点未开放**」 | `POST /contract-reviews/:id/report` 已在 main（`contract-review.controller.ts:94-96`） | ❌ **已过期**，报告端点已开放 |
| A18「自评陈述式解读」落点 `/self-assessment` | 实际路径 `/api/v1/resume/self-assessment`（`ai/self-assessment.controller.ts:52`） | ⚠️ 路径需更正 |
| A15「政策条件逐条核对」落点 `/policies` + 新增核对 | `policies/policies.controller.ts` 全模块**无任何 LLM / AiLog 引用**（实测 grep） | ✅ 结论正确，核对能力确实全缺 |
| A7「求职信/口述稿生成」= 新增 | `job-materials` 是**模板渲染**，非模型生成（§1.3 G2） | ✅ 结论正确，AI 版确实缺 |

### 1.7 跨文档已过期结论（复核后更正，以 `origin/main` 为准）

复核 main 从 `a7ddbc945` 前进到 `6caedd6dc` 的 6 个提交，并回查配套设计文档，发现 **1 条跨文档结论已过期**、**2 个新提交对本矩阵有影响**。

#### 1.7.1 已过期：`closed-loop-map.md` 关于 `/session-resume` 「假接真」的结论

| 项 | 内容 |
|---|---|
| **哪份文档的哪条** | `origin/main:docs/design/kiosk-ai-os-v3-2026-08/closed-loop-map.md` 中登记 `/session-resume` 调用了一个**并不存在**的 `GET /me/pending-tasks`，据此把该页判为「假接真」 |
| **为什么过期** | 该端点**现在真实存在于 `origin/main`**。后端：`services/api/src/member-print-orders/member-print-orders.controller.ts:69` `@Controller('me/pending-tasks')`。前端已真实消费：`apps/kiosk/src/services/api/pendingTasks.ts:43` `fetch(\`${API_BASE_URL}/me/pending-tasks\`)`，由 `apps/kiosk/src/pages/session-resume/SessionResumePage.tsx:10` `import { getPendingTasks }` 调用 |
| **以什么为准** | 以上述三处 `origin/main` 源码为准。**`/session-resume` 不再是假接真**，`closed-loop-map.md` 该条应作废 |
| **对本矩阵的影响** | 无。P40 会话安全在本矩阵中判为「明确不接 AI」，该判定不因端点存在与否改变 |

> **口径提醒**：这与 §1.6 记录的 `ai-capability-spec.md` 三条过期项（A20 报告端点、A21 体检、A22 遮盖）是同一类问题 —— **设计侧文档的「生产落点」列滞后于 main**。凡引用设计文档判断「后端有没有」，都必须回 `origin/main` 复核，不能直接采信。

#### 1.7.2 新提交 #612：一体机匿名反馈端点（对 P43 红线有直接影响）

`6caedd6dc feat(api): 一体机匿名反馈端点（A3 S1）—— 免登录受限提交面 (#612)`

| 项 | 事实（`origin/main`） |
|---|---|
| 端点 | `POST /api/v1/kiosk/feedback`，**免登录**（`services/api/src/member-feedback/kiosk-feedback.controller.ts:24-32`）。只开「提交」一个动作：无列表、无详情、无追加回复、无关单 |
| 本身是否含 AI | **否**。全模块无 LLM / `AiLogService` / OCR 引用（实测 grep） |
| **对本矩阵的影响（重要）** | **主干上已经为「AI 碰工单」立了红线**，本文 P43 行的口径由「本文建议」升级为「main 上已有先例」 |

`kiosk-feedback.service.ts:85-92` 的原文约束（AI 接入本模块时必须遵守）：

- `category` 是**权威分类**，由服务端从封闭词表机械推出；
- 未来接 AI 归类 / 聚类，**只能新增可空的「AI 建议」字段，不得覆写 `category`**；
- **不得据 AI 结果改 `status`** —— **工单处置权始终在 Admin 侧**；
- 本批次**刻意不预留**该字段：形状（建议值 / 置信度 / 模型与提示词版本 / 聚类 id）尚不确定，日后新增可空列是纯 additive 迁移。

> 这与本文第三部分红线第 2 条「AI 不得自动裁决工单」完全一致，且**更具体**。S3-8（P43 记录盘点 / 聚类 / 工单草稿）实施时必须照此形状设计，不得另起一套。

**另一条值得收进方案的口径 —— 第三种 PII 策略：拒绝，而非脱敏。**

`services/api/src/member-feedback/kiosk-feedback-text.ts:1-15` 明确：匿名面**不收** PII，命中手机号 / 身份证 / 邮箱 / 长数字串一律**拒绝**而不是脱敏，理由是「脱敏等于先接收再处理，原文仍会穿过进程与日志」；匿名工单无账号归属，落进敏感数据后删除与追责都无从下手。检测用 NFKC 折全角数字 + 数字投影二次判定防绕过，入库文本用 NFC 保留全角标点，**任何路径都不打印原文**。

至此全站有**三种** PII 策略，各有适用面，接线时不要混用：

| 策略 | 适用面 | 落点 |
|---|---|---|
| **脱敏**（mask） | 有归属、必须被分析的用户材料 | 合同审查 `contract-review-pii-masker.ts` |
| **拒绝**（reject） | 匿名、无主、且业务上不需要 PII 的自由文本 | 匿名反馈 `kiosk-feedback-text.ts` |
| **无**（原样外发） | ⚠️ 简历链 A 组 / B 组 —— **这是风险 R2，待修** | — |

> R2 的处置不因 #612 改变：简历**必须被接收才能分析**，无法照搬「拒绝」策略，仍应复用合同审查的 masker（S0-2）。

#### 1.7.3 新提交 #613：权益卡只读接入打印确认页（印证 P06 红线）

`b65faa951 feat(kiosk): wire read-only benefit card into print confirm (A3 S2) (#613)`

| 项 | 事实（`origin/main`） |
|---|---|
| 落点 | `apps/kiosk/src/pages/print/PrintConfirmPage.tsx:540`：「权益卡（V6 P06 s4）：**只读**。六态由真实数据判定，核销 CTA 保持可聚焦禁用」 |
| 六态 | `apps/kiosk/src/services/api/benefits.ts:81` `PrintBenefitState`：`price_unavailable` / `loading` / `repriced` / `not_applicable` / `guest` / `error` / `none` / `available`（`:143-234`） |
| 是否含 AI | **否** |
| **对本矩阵的影响** | **印证 P06 / P24 / P41 的「AI 不碰钱」红线**：金额只读后端 `POST /orders/quote`，无 `fileUrl` / 报价失败时**不显示具体金额**（`PrintConfirmPage.tsx:180`）。另外「**核销 CTA 保持可聚焦禁用**」是个好模式，与本文 P37 行的「保留可聚焦 disabled + 原因」同源，建议收进 S1-2 作为统一的禁用态规范 |

#### 1.7.4 P06 参数预填缺失 —— 在新 head 上重新核验（结论不变）

在 `6caedd6dc` 上重跑，结论与初稿一致，**#613 没有引入任何预填**：

| 复核项 | 在 `6caedd6dc` 上的实测结果 |
|---|---|
| `apps/kiosk/src/pages/print/` 全部 **20 个文件** grep `预填｜prefill` | **0 命中** |
| `06-print-workbench.html` 的 `data-aitask` | **0 处** |
| 该页 `小青` | **0 处** |
| 该页 AI 建议卡 | **0 处**（唯一的 AI 概念是 `ai-down×76` 降级态） |
| 原型反推证据 | `06-print-workbench.html:2105` `default/device-off` 态显示「参数已按文件内容预设，可改」+ `hintParams`「黑白 · 自动双面 · 5 份 · 全部 3 页」；`:2106` `ai-down/first` 态显示「预填不可用，四项都需要你自己设」 |
| 生产端参数来源 | `PrintParamsPage.tsx:152-156`：`copies` = `restoredPrintParams?.copies ?? 1`；`colorMode` / `duplex` 直接取常量 `VERIFIED_PRINT_PARAMETER_PROFILE`；`orientation` / `scale` = `'auto'` / `'fit'`。**没有任何来自体检结果的推导** |
| 仅有的 `suggest` 命中 | PII 处置建议：`PrintMaterialCheckPage.tsx:182,278`、`components/MaterialCheckPresentation.tsx:19,194` |

> **判定**：**打印参数的 AI 预填在生产里完全不存在** —— 后端缺（无推导端点）+ 前端缺（0 实现）。这是「AI 是驱动层」在**全站最高频页面**上唯一的体现点，也是 §四 S3-1 被排在「必须先有后端」第一位的原因。

---

## 二、页面 × AI 矩阵（P01–P46 全覆盖）

### 2.0 三条必须先说清的实测事实（推翻两处常见误解）

**事实 1：`data-aitask` 不是全站契约，只在 P01 一页存在。**

实测 46 个原型页的 `data-aitask` 出现次数：`01-home-v6.html` = **22 次**，其余 **45 页全部为 0**（含 `01-home.html` / `01-home-v4.html` / `01-home-v5.html` 三个历史比稿）。

契约本身写在 `docs/design/kiosk-ai-os-v3-2026-08/01-home-v6.html:161-190` 的 `<style>` 注释里，取值四态 `idle / running / done / failed`，五条接线要求（摘要）：

1. 只能由**后端任务状态**驱动（轮询 / SSE / WebSocket），**前端不得用计时器自行推进**；
2. `idle` 时进度日志、扫光、路径粒子、呼吸环全部静止 ——「看起来在算」必须等于「真的在算」；
3. `running` 存续时间由后端决定，**前端不得设「到点变 done」的兜底计时器**；
4. `data-state="ai-down"` 时 `data-aitask` 恒为 `failed`，任何用户输入都不得把它推回 `running`；
5. `failed` 必须停在明确的不可用表现，并保留不依赖 AI 的路径（打印扫描 / 岗位 / 招聘会 / 我的文档）。

原型自己标注了唯一例外：`startAiTask()` 末尾把 `running` 收回 `taskFromState()` 的那段是 `PROTOTYPE-ONLY`，接线时必须删掉改成订阅后端状态。

状态派生表 `TASK_BY_STATE`（`:963-968`）：`default → done` / `first → idle` / `ai-down → failed` / `device-off → done`。
JS 接线钩子：`window.v3SetAiTask = setAiTask`（`:999`）—— 这是原型给生产留的**具名接线点**。`setAiTask()`（`:972-983`）在 `data-state === 'ai-down'` 时硬钳为 `failed`（`:974`）。`running` **在标记里从不出现**，只能经 `startAiTask()` / `v3SetAiTask` 到达。`PROTOTYPE-ONLY` 计时器在 `:1071-1075`，接线时必须删除。

> **结论**：`data-aitask` 是一条**优秀但只落在 P01 的契约**。要让它成为全站契约，需要把它**提升为一个共享的前端 AI 任务状态原语**（见第四部分 S1）。不能宣称「原型已为每页定义了 `data-aitask` 绑定」——那不是 main 上的事实。

**事实 1B：全站真正通用的 AI 契约属性是 `data-when` 里携带的 `ai-down` 令牌，不是 `data-aitask`。**

实测：`data-when` 共 **2003 处**，其中携带 `ai-down` 的变体合计 **818 处**，覆盖全部 46 页；根节点 `.screen` 上的 `data-state` 取值实测 `default`×52 / `ai-down`×47 / `device-off`×12 / `first`×4。**这才是 45 页实际使用的 AI 降级表达方式。**

**事实 1C：原型里不存在 `data-aigc` / `data-evidence` / `data-degrade` / `data-fallback` 任何一个属性。**

AIGC 标识与 E1/E2/E3 都是**纯文本 + CSS 类**（`.ev--e1/e2/e3`、`.rp-aigc`），不是数据属性。全站只有两个额外的语义属性：
- `data-ev`（**仅 2 页**）：P09 `09-resume-workbench.html:703,709,710,716,722,1138,1142,1146,1150`（值 `i1..i4`）、P30 `11-jobfit-compare.html:578-634`（值 `r1..r8`）。**它是「证据行 id」，不是 E1/E2/E3 等级**——接线时不要误读。
- `data-consent`（**仅 1 页**）：P28 `28-self-assessment.html:413` `must` / `:418` `opt`。

> **接线含义**：证据分级与 AIGC 标识在原型里**没有机器可读的锚点**。生产要做到「每条结论带 E 级、每页恰好一次 AIGC 标识」，必须**自己定义这套属性**，不能指望从原型 DOM 提取。这是 S1-2 存在的理由。

**事实 2：46 页确实每页都有 AI 元素，但绝大多数只是 `ai-down` 降级态，不是 AI 能力。**

实测每页的 AI 相关标记计数（`ai-down` / `E1|E2|E3` / `仅供参考` / `小青` / `AI` 字样）见 §2.2 表①列。`ai-down` 在 46 页里出现 1000+ 次，说明**降级契约的覆盖度远高于 AI 能力本身的覆盖度**。这是好事（诚实），但不能据此说「40 页有 AI」等于「40 页有 AI 能力」。

**事实 2B：三处原型自身的契约缺口（实测，非推测）。**

| 缺口 | 实测 | 影响 |
|---|---|---|
| **E1/E2/E3 完全缺失的页** | **P03 P05 P18 P20 P22 P35**（grep 计数 0） | P03/P05/P35 是刻意无 AI，可接受。**P20 面试点评与 P22 职业规划都在输出 AI 结论却没有任何 E 级标注** —— P20 靠 AIGC 徽章（`20-interview-pod.html:1752`）补救，**P22 连 `仅供参考` 都没有**，只有 `:606,612` 的软措辞「仅供你自己参考」。这两页接线时必须补 E3 |
| **AIGC 标识覆盖率** | 只有 **11 个文件**带 AIGC 标记（`11-jobfit-compare` 8 处最多、`20-interview-pod` 4、`31-contract-review` 3、`01-home-v6`/`01-home-v5`/`09`/`10`/`21`/`26`/`28`/`35` 各 1）；**35 个编号页没有** | 与 `interface-handoff.md` §3「所有 AI 生成内容（含打印件）必须带可见标识…每页恰好一次」冲突。**原型自身就没做到**，所以不能把「照原型实现」当成合规达标 |
| **六个域首屏用 chip 代替 E 徽章** | P32/P34/P36/P37/P38/P39 用未带 E 级的 `AI · 仅供参考` / `AI · 已降级` chip（如 `32-resume-hub.html:322,327` `39-print-hub.html:601,610`），并在源码注释里**主动论证**给确定性导航贴 E3 会稀释标签（`38-policy-hub.html:215-217`、`39-print-hub.html:94-95`、`36-fairs-hub.html:263-265`） | 这是**有意的设计判断，不是疏漏**。生产应沿用：**确定性逻辑不标 E3**（与 `ai-capability-spec.md` §0「确定性逻辑不得标 E3」一致）。`AI · 已降级` chip 是个好模式，值得收进 S1-2 |

**事实 3A：P30 不是缺页，它就是文件 11。**

`11-jobfit-compare.html` 自己的 `<title>` 是 `P30 岗位大师 · 决策台`；`pages.json`（`generatedAt: 2026-08-11T03:29:49Z`）共 45 条、**没有 `30-*` 文件**。与 C0 §2.2「P30 —（P11 升格别名）… **不是缺页**，不得新增第二文件/入口/模型」完全一致。

**事实 3：P06 打印工作台是最大的定调落差点（已复核，与总调度口径一致）。**

| 复核项 | 实测结果 |
|---|---|
| `06-print-workbench.html` 的 `data-aitask` | **0 处** |
| 该页 `小青` | **0 处** |
| 该页 `ai-down` | **76 处**（全站第二高） |
| 该页唯一的 AI 概念 | 只有降级态 |
| 参数预设的存在证据 | `06-print-workbench.html:2105` `default/device-off` 态显示「参数已按文件内容预设，可改」+ `hintParams`「黑白 · 自动双面 · 5 份 · 全部 3 页」；`:2106` `ai-down/first` 态显示「预填不可用，四项都需要你自己设」——**反推正常态下 AI 应预填四项** |
| 生产端参数预填 | **完全不存在**。`apps/kiosk/src/pages/print/PrintParamsPage.tsx:152-156`：`copies` 默认 `restoredPrintParams?.copies ?? 1`，`colorMode` / `duplex` 直接取常量 `VERIFIED_PRINT_PARAMETER_PROFILE`，`orientation` / `scale` 取 `'auto'` / `'fit'`。**没有任何来自体检结果的推导** |
| 生产端 `预填/prefill/suggest` grep | 只命中 PII 处置建议：`PrintMaterialCheckPage.tsx:182` `suggestionForFinding()`、`:278`、`components/MaterialCheckPresentation.tsx:19,194` |

**但 P06 的材料体检链路本身是真的已接线的**（这一点必须澄清，避免误判为「整条链缺失」）：`apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx:10-17` 从 `services/api/materials` 导入 `createMaterialTask / getMaterialTask / decidePiiFindings`，在 `:319`（`inspection`）`:339`（`normalize_a4`）`:358`（`pii_scan`）`:420`（决策）`:426`（`pii_redact`）真实调用后端 `POST /materials/tasks`。

> 所以 P06 的准确判定是：**体检与遮盖 = 仅缺接线的增强；参数预设 = 后端缺 + 前端缺（0 实现）。**

### 2.1 图例

- **①原型承诺的 AI**：读该页 HTML 实测。格式 `ai-down×N / E×N / 仅供参考×N / 小青×N / "AI"×N`，后接该页 AI 语义要点。
- **②后端已有能力**：对应第一部分能力编号 + `origin/main` 端点。
- **③差距**：`后端缺` / `前端缺` / `仅缺接线`（三者可并列）。
- **④该页 AI 应该怎么驱动**：一句话说清「用户在这一页想做什么 → AI 在哪一步介入 → 介入后用户看到什么」。统一遵守 `closed-loop-map.md` §六：AI 只以**四要素建议卡（动作 / 理由 / 代价 / 备选）+ E1/E2/E3 标注**出现，禁止无理由的「智能推荐」、不可解释的分数、假装在想的空壳动画。

路由列直接引用 `console-c0-fact-freeze-2026-08-16.md` §2.2，不重做。

### 2.2 矩阵

| V6 | 路由 | ①原型承诺的 AI | ②后端已有能力 | ③差距 | ④该页 AI 应该怎么驱动 |
|---|---|---|---|---|---|
| **P01** 首页 | `/` | `ai-down×63 / E×13 / 仅供参考×2 / 小青×8 / AI×49`；**全站唯一 22 处 `data-aitask`**；场景快捷 + 办理单 + 处境理解（spec A28） | **无**。无「处境理解 / 办理顺序」端点 | **后端缺**（意图→办理单排序端点）+ **仅缺接线**（`data-aitask` 原语） | 用户站在机器前只知道「我要找工作」。AI 在**用户说一句话或点一个场景后**介入，输出一张办理单：步骤 + 每步依据（E1 我的材料 / E2 系统事实 / E3 AI 建议）。用户看到的是**带理由的办理顺序**，不是一堆并列磁贴。AI 挂时明说「排序不可用，顺序自己选」，八个入口照常可点 |
| **P02** 待机 | `/screensaver` | `ai-down×6 / AI×9`；AI 海报草稿 | G3 `admin/ai-posters`（**stub**，`AI_IMAGE_PROVIDER=disabled`） | **后端缺**（二期文生图）+ **前端缺** | 二期能力。当前正确做法是**保持 stub 诚实报错**，不在待机屏出现任何「AI 生成」字样 |
| **P03** 身份门 | `/login`、`/member/qr-login` | `ai-down×2 / AI×21`（多为文案） | — | — | **明确不接 AI**（`ai-capability-spec.md` §2：只做手机号验证与回跳）。此处加 AI 是纯风险 |
| **P04** 系统态 | `/session-timeout`、`/error-offline`、`/legal/:doc` | `ai-down×1 / 小青×1` | — | **仅缺接线** | 不做 AI 判定。唯一该做的是：`ai-down` 时**如实列出哪些能力不可用**（`ErrorOfflinePage.tsx:73` 已有此文案），以及 AI 挂 ≠ 设备挂的区分 |
| **P05** 手机接力 | `/upload/phone` | `ai-down×5 / AI×5` | — | — | 不接 AI。只做文件中转 |
| **P06** 打印工作台 | `/print/{upload,material-check,preview,params,confirm,cashier,progress,done}` | **整页 `data-aitask` 0 处 / 小青 0 处 / AI 建议卡 0 处**；`ai-down×76 / E×9 / 仅供参考×1 / AI×23`；`:2105-2106` 反推 AI 预填四项 | F1 `POST /materials/tasks`（inspection / normalize_a4 / pii_scan / pii_redact / bundle_render）**已接线**；#613 权益卡只读六态已接线（无 AI） | **体检遮盖=仅缺接线增强**；**参数预设=后端缺+前端缺（在 `6caedd6dc` 上复核仍 0 实现，见 §1.7.4）** | 用户只想把这份文件打出来。AI 在**文件上传完成后**介入一次：读体检结果 → 预填份数/黑白彩色/单双面/N-up 四项 → 用户**只做确认与改动**（`step-reduction.md`：打印 9 步 → 5 步的省步全在这里）。用户看到的是**已填好、可改、每项标了依据的参数表**。红线：**钱只能由支付回执与出纸计数决定，AI 不碰核价、不碰收银、不碰出纸判定**（#613 已印证：金额只读 `POST /orders/quote`，报价失败时不显示具体金额） |
| **P07** 扫描工作台 | `/scan/{start,settings,progress,result}` | `ai-down×52 / E×10 / 仅供参考×2 / AI×34`；OCR 置信度终检（spec A23） | A6 OCR 底座在（`OcrService`），但**扫描链路无置信度终检** | **后端缺**（逐页置信 + 低于阈值页号） | 用户扫完一叠纸想确认「扫清楚了没有」。AI 在**扫描完成后**介入：逐页给置信度，点名低于阈值的页号，**不送 AI 生成结论**。用户看到「第 3、7 页可能没扫清楚，要重扫吗」。AI 挂时跳过终检，扫描件可直接打印存档 |
| **P08** 文件加工台 | `/print-scan/{convert,sign,feature/:key}` | `ai-down×28 / E×6 / 仅供参考×2 / AI×16`；图片排序与落款位建议（A24） | **无**（`print/convert`、`print/sign` 全模块无 AI） | **后端缺** | 用户有一堆手机拍的照片要拼成 PDF。AI 在**图片上传后**按 EXIF 时间与内容给出**顺序建议**；签章时给**落款位建议**。用户看到的是**已排好序、可拖动改**的缩略图条。AI 挂时序号即装订顺序，自己拖 |
| **P09** 简历工作台 | `/resume/{source,parse,report,optimize,export}` | `ai-down×47 / E×31 / 仅供参考×5 / 小青×4 / AI×64`（AI 密度全站前三） | **A1 解析+诊断 / A2 优化 / A3 版式**全在：`POST /resume/parse`、`GET /resume/records/:taskId[/optimize]`、`POST .../layout-adjust` | **仅缺接线** + **建议拆页**（见 §3.3） | 用户想知道「我的简历行不行、怎么改」。AI 在**解析完成后立刻**出诊断（不让用户再点一次进入诊断），在**诊断后逐条**给改写候选，**编不出的项返回「需你自己写」**。用户看到六维评分 + 可改点（带原文定位）+ 逐条候选句。AI 挂时**原文照常可翻看可打印** |
| **P10** 访谈式生成 | `/resume/generate[/preview]` | `ai-down×25 / E×8 / 仅供参考×3 / 小青×13 / AI×34` | A4 `POST /resume/generate`、`GET /resume/generate/:taskId`、`POST /resume/generate/export` | **仅缺接线** | 没有简历的人靠对话把简历说出来。AI 逐题提问 → 成文，**跳过的题标空不补，不编造学历/证书/公司/项目**。用户看到边答边成型的一页简历。AI 挂时停止提问、已答保留，给「打印空白表格」路径 |
| **P11** 岗位匹配 | `/resume/job-fit` | `ai-down×45 / E×38`（**E 标注全站最高**）`/ 仅供参考×2 / AI×58` | B1 `POST /resume/job-fit` + 专属 consent 四端点 + `/print` | **仅缺接线** + **建议拆页**（见 §3.5） | 用户想知道「我跟这个岗差在哪」。AI 在**选定 1 个岗位后**逐条比对：三档参考等级 + 逐条证据 + 关键词命中/缺失 + 差距行动。用户看到的是**逐条可追溯到简历原文的比对表**。红线：**禁百分比、录用概率、通过率、打分排名**（服务端已双层拦截）。共同要求提取是计数逻辑（A6），不受 AI 影响 |
| **P12** 材料工厂 | `/resume/materials` | `ai-down×33 / E×6 / 小青×1 / AI×38` | G2 `POST /job-materials/generate` 是**模板渲染，无 LLM** | **后端缺**（求职信/口述稿的 AI 生成） | 用户要一封求职信。AI 在**选定简历+目标岗位+参数（语气/长度/是否写短板/场合）后**生成正文，**事实池只取简历，任何组合都不新增经历**。用户看到可改的正文 + 「哪句来自简历哪一行」。AI 挂时给空白格式纸/结构卡打印路径 |
| **P13** 岗位情报台 | `/jobs` | `ai-down×3 / E×7 / AI×9`（AI 密度反常地低） | C1 `POST /jobs/ai/recommendations`（consent `job_ai` + 三维配额） | **仅缺接线**（A9 空结果放宽建议前端可算，**前端缺**） | 用户面对一屏岗位不知从哪看起。AI 在**已有简历时**对列表**收敛排序**（只排序，不新增不隐藏岗位），每条给一句理由。用户看到的是**排过序且每条有理由**的列表。红线：**AI 只排序/解释，不得代替用户投递**；按钮文案仍是「去来源平台投递 / 扫码投递」。AI 挂时按同步时间倒序，筛选照常 |
| **P14** 岗位详情 | `/jobs/:id` | `ai-down×5 / E×2 / 仅供参考×2 / AI×6` | C2 `POST /jobs/:id/ai/explain`；C3 `POST /jobs/:id/ai/match` | **部分后端缺**（到店问题清单 A10） | 用户读不懂 JD。AI 给 **3 条解读**（职责/硬门槛/加分项）+ **4 条中性核实问句**（到现场问什么）。用户看到的是**拆开的 JD + 可打印的问题清单**。红线：解读不得改写岗位原文，不得推测薪资 |
| **P15** 企业导览 | `/companies`、`/companies/:id` | `ai-down×5 / E×4 / 仅供参考×1 / AI×20` | C3 可复用（本企业在招岗位逐岗匹配 A11） | **前端缺**（`CompanyDetailPage.tsx:408` 只有 disclaimer，无 AI 调用） | 用户在看一家企业的全部在招岗位。AI 对**该企业岗位列表**逐岗给三档 + 一句理由（复用 B1/C3）。AI 挂时不给档位，岗位列表照常 |
| **P16** 线下机构 | `/offline-agencies[/:id]`、`/jobs/:id/offline` | `ai-down×7 / E×7 / 仅供参考×2 / AI×11` | **无** | **后端缺 + 前端缺** | 同 P14 的到店问题清单（A10）：AI 给去这家机构该问什么。优先级低 |
| **P17** 招聘会作战台 | `/job-fairs[/:id]` + 子资源 | `ai-down×33 / E×1 / AI×21` | B4 `POST /job-fairs/:fairId/visit-plan/:taskId` + `/print` | **仅缺接线**（展位顺序需扩展 payload） | 用户要去招聘会但不知先逛哪。AI 在**给了城市+日期范围+岗位方向后**（`interface-handoff.md` §1 硬约束：**不使用 GPS**，一体机无定位权限）输出场次三档 + 展位顺序 + 覆盖率说明。用户看到一张**可打印的参会作战单**。AI 挂时按展区编号顺序，**明写「不猜先后」** |
| **P18** 校园招聘 | `/campus`、`/campus/{welcome,freshman-insights}` | `ai-down×23 / AI×22 / 建议卡×19` | **无** | **后端缺** | 用户是应届生，不知道自己在校招节奏的哪一段。AI 按**毕业年份+简历**给节奏定位 + 逐场门槛提示。AI 挂时给公开日历，**明写「未结合你的情况」** |
| **P19** 智慧校园 | `/smart-campus` + 子路由 | `ai-down×6 / E×8 / 仅供参考×1 / AI×13` | **无**（`SmartCampusGuard`，默认 `enabled=false`） | **deferred** | 能力开关未真值化前不接 AI。校园数据是只读事实，**无数据时诚实空态，不编分布** |
| **P20** 面试舱 | `/interview/{setup,session,report,reports,tips}` | `ai-down×55 / AI×45 / 建议卡×7` | **D 组全在**：`POST /mock-interviews` + `/start` `/answer` `/end` `/report` `/report/print` `/transcribe` `/turns/:idx/audio` `capabilities/voice` | **仅缺接线** + **建议拆页**（见 §3.6） | 用户想练一次面试。AI 按**岗位方向+难度(easy/standard/pressure)+时长(3/5/8分钟)**组卷，逐题点评（**说清了没有，不评对错**）。用户看到逐题问答 + 可打印复盘单。AI 挂时强制通用卷；点评撤下但**答案原文保留**，纸面改名「题目与答案单」 |
| **P21** 政策服务 | `/renshi` | `ai-down×18 / E×1 / 仅供参考×3 / AI×9` | **无**（`policies/` 全模块无任何 LLM / AiLog 引用，实测 grep） | **后端缺（全站最大缺口）** | 用户想知道「我能领哪些补贴」。AI 在**给了城市+9 项问答（允许「不确定」）后**逐条核对：满足 / 卡住 / 待确认 + 逐条依据。用户看到的是**标出「卡在哪一条」的政策清单**（`step-reduction.md`：政策 8 步 → 5 步全靠这个）。**红线：法条原文一字不改**。AI 挂时只列政策与原文，纸面标「本单未做条件核对」 |
| **P22** 职业规划 | `/resume/career-plan` | `ai-down×43 / AI×31 / 建议卡×1` | B2 `POST /resume/career-plan/:taskId` + `/print` | **仅缺接线** | 用户不知道自己该往哪个方向走。AI 从简历抽能力（**带原文引用**）+ 给四方向缺口（**硬门槛与简历漏写分开**）。AI 挂时只给岗位要求计数表，纸面列「本单没有的东西」 |
| **P23** 我的 | `/profile` + `/me/*` | `ai-down×40 / E×5 / 仅供参考×2 / AI×24` | G7 `GET/DELETE /me/ai-records`；G6 `/me/ai-consents` | **仅缺接线** | 枢纽页。AI 只做**进入时的一句话盘点**（如「3 份敏感件 7 天后删除」），不做别的。`step-reduction.md`：文档到期查询 4 步 → 3 步 |
| **P24** 权益 | `/activities[/:id]`、`/me/benefits` | `ai-down×5 / E×21 / AI×27` | — | — | **明确不接 AI**（钱只能由支付回执与出纸计数决定）。C0 已标本页高危：`POST /orders/:id/redeem` 的 `discountCents = order.amountCents` 整单免，**接真前必须先堵**，与 AI 无关但不能忽略 |
| **P25** AI 顾问 | `/assistant` | `ai-down×29 / E×8 / 仅供参考×1 / 小青×11 / AI×29` | G1 `POST /assistant/chat`（`assistant_chat` 功能位 + `llm-guard` 恒定护栏） | **仅缺接线**（⚠️ 须处理风险 R1 mock 回落） | 用户不知道该用哪个功能，直接问。AI 回答 + 证据分级 + **可钉到托盘的要点**。答不了就明说，**不用编出来的回答顶上**。⚠️ 接线时必须让前端能区分真实模型与 mock provider（服务端已算出 `providerLabel`：`llm:<vendor>` vs provider 名，`ai/ai.service.ts:762`） |
| **P26** 顾问作业面 | `/ai/plan` | `ai-down×8 / E×6 / 仅供参考×4 / 小青×3 / AI×23` | **无**（全量 grep `services/api/src` 无 `ai/plan` 路由，风险 R6） | **后端缺（前端页面已存在）** | 前端 `pages/ai-plan/AiPlanPage.tsx` 已在路由（`routes/index.tsx:265-268`），**后端 0 实现**。三种作业型（问答 / 生成 / 核对）需要 skill + session + 输入槽 + 继续回答的服务端模型 |
| **P27** 工具箱 | `/toolbox` | `ai-down×8 / E×1 / 仅供参考×1 / AI×21` | — | **前端缺**（`ToolboxZonePage.tsx` 实测 0 处 AI 关键词） | 优先级低。可做的是：AI 顾问已能读 toolbox intent（`AssistantPage.tsx:411-413,491,715`），把「问小青该用哪个工具」做成本页的一个入口即可，**不要在本页再造一套 AI** |
| **P28** 自我探索 | `/resume/self-assessment/*` | `ai-down×23 / E×11 / 仅供参考×2 / AI×37 / 建议卡×1` | B3 `POST /resume/self-assessment` + `/:taskId` `/print` `/append` `DELETE` | **仅缺接线** | 用户想了解自己的倾向。**打分是纯函数（固定权重），不是 AI**；AI 只做 5 段**陈述式解读**。红线：**无分数排名、无适合/不适合、不复用 MBTI/大五/DISC/霍兰德等任何量表标签**。AI 挂时作答与记分照常，解读不出（后端已实现优雅降级 `note=null`） |
| **P29** 证件照 | `/print-scan/feature/id-photo` | `ai-down×18 / E×10 / AI×28` | **无任务模型**（`PrintScanFeatureInfoPage.tsx` 只是 `:key` 参数页，0 处 AI） | **后端缺 + 前端缺** | 用户要一张合规证件照。AI 做**四项规格体检**（E1 实测值 vs E2 标准）+ 换底。AI 挂时蓝红底置灰并**退回白底 = 不换底用原图，可继续** |
| **P31** 合同审查 | `/contract-review[/processing,/result]` | `ai-down×8 / E×13 / AI×25` | **E1 全在**：7 个端点 + 版本化 consent + PII masker + fail-closed | **仅缺接线 / 开关**（`VITE_ENABLE_CONTRACT_REVIEW`，关时 `<Navigate to="/">`） | 用户签合同前想知道有没有坑。AI 给三档风险（原文摘录 + 页码 + 说明 + 法律依据 + **局限** + 追问）。**红线：合同原文一字不改；五项知情同意未全勾必须门控**。本链路是全站隐私治理标杆（脱敏 + 二次断言 + 2 小时留存 + fail-closed），**其它 AI 链路应向它对齐** |
| **P32** 简历 Hub | `/resume-service` | `ai-down×14 / E×5 / 仅供参考×8 / 小青×3 / AI×61` | 域首屏，无独立 AI 能力 | **仅缺接线**（⚠️ 待裁决项） | 域首屏应给**一条带理由的 AI 建议**（四要素）。⚠️ `interface-handoff.md` §5 待裁决第 1 条：生产 `ResumeServiceHubPage` 用 `useApiReadiness` 一挂全挂（`:191-192,204`），与设计口径「非 AI 能力不因 AI 中断而失效」冲突，**接线前必须先拍板** |
| **P33** 简历模板 | `/resume/templates` | `ai-down×11 / E×4 / 仅供参考×2 / AI×24` | **无模板 API** | **后端缺** | AI 可按简历内容推荐版式，但优先级低于模板 API 本身 |
| **P34** 岗位 Hub | `/jobs-service` | `ai-down×6 / E×1 / 仅供参考×2 / AI×22` | 同 P32 | **仅缺接线** | 同 P32 |
| **P35** 线上平台 | `/jobs/online-platforms` | `ai-down×4 / AI×15` | — | — | **明确不接 AI**（四家平台不排名、不比较）。C0 已标：`PLATFORMS` 是 4 条硬编码常量，治理与投影端点全部 new，但那与 AI 无关 |
| **P36** 招聘会 Hub | `/fairs-service` | `ai-down×24 / E×4 / 仅供参考×7 / AI×58` | 同 P32 | **仅缺接线** | 同 P32 |
| **P37** 面试 Hub | `/interview-service` | `ai-down×25 / E×6 / 仅供参考×5 / AI×48` | 同 P32 | **仅缺接线** | 同 P32。缺目标时保留**可聚焦的 disabled + 原因**，不静默禁用 |
| **P38** 政策 Hub | `/policy-service` | `ai-down×19 / E×3 / 仅供参考×5 / AI×56` | 同 P32 | **仅缺接线** | 同 P32 |
| **P39** 打印 Hub | `/print-scan` | `ai-down×43 / E×7 / 仅供参考×25`（**全站最高**）`/ 小青×7 / AI×113`（**全站最高**） | 域首屏，无独立 AI 能力 | **后端缺**（能力投影）+ **仅缺接线** | 本页 AI 密度全站第一但后端 0 支撑。域首屏该做的是：AI 读**设备能力探测结果**给一句「现在能做什么、不能做什么」。**能力探测必须 fail-closed**：读不到能力配置时显示「服务状态无法确认 · 暂不开放任务 · 重新检测」，**不得默认设备正常** |
| **P40** 会话安全 | `/session-resume`、`/session-timeout`、`/me/privacy-requests` | `ai-down×4 / E×1 / AI×11` | — | — | **明确不接 AI**（超时、锁屏、接管、清空是安全判定，模型判断有害） |
| **P41** 履约八态 | `/print/{progress,done,pickup-claim}` | `ai-down×4 / E×5 / AI×12` | — | — | **明确不接 AI**（金额、页数、支付状态、取件码是订单原文，不做加工） |
| **P42** 我的资产 | `/me/{documents,resumes,favorites}` | `ai-down×55 / E×10 / 仅供参考×2 / AI×23` | **无**（版本差异 / 到期归类 A25 均缺） | **后端缺** | 用户想知道「哪些文件快到期了、两版简历差在哪」。AI 在**进入时**给到期件点名 + 版本差异摘要。AI 挂时撤下摘要，**到期日仍写在每一行**（E1 不依赖 AI） |
| **P43** 我的记录 | `/me/{activity,notifications,feedback,ai-records}` | `ai-down×46 / E×15 / 仅供参考×4 / AI×37` | G7 `/me/ai-records` 在；**#612** `POST /kiosk/feedback` 匿名提交面在（无 AI）；**盘点/聚类/画像/工单起草（A26）全缺** | **后端缺** | AI 做记录盘点 + 收藏聚类 + 足迹画像（**仅本人可见不外传**）+ 工单草稿（**不自动提交**）。红线（**#612 已在 main 上写死，见 §1.7.2**）：AI 归类/聚类**只能新增可空的「AI 建议」字段，不得覆写权威 `category`、不得据此改 `status`；工单处置权始终在 Admin 侧**。下线标记来自来源方，不受 AI 影响 |
| **P44** 岗位详情(线下) | `/jobs/:id/offline` | `ai-down×6 / E×5 / 仅供参考×2 / AI×5` | 同 P14 | **部分后端缺** | 同 P14 |
| **P45** 招聘会现场 | `/job-fairs/:id/*`、`/job-fairs/checkin` | `ai-down×15 / E×1 / 仅供参考×1 / AI×14` | B4 同 P17 | **仅缺接线** | 同 P17 的展位顺序阶段。**现场数据是只读事实，无数据时诚实空态，不编分布** |
| **P46** 校园服务 | `/smart-campus/service/:key` | `ai-down×13 / E×1 / 仅供参考×1 / AI×10` | **无** | **后端缺**（deferred） | 报到材料差分（A27）：AI 拿用户勾选的已带项 × 校方清单 → 「还缺」列表 + 本机能补的项。AI 挂时给校方全量清单，**明写「不给还差什么」** |

### 2.3 差距汇总

| 分类 | 页数 | 页号 |
|---|---|---|
| **仅缺接线**（后端能力齐、前端页面在，接上就能用） | **17** | P04 P09 P10 P11 P13 P17 P20 P22 P23 P25 P28 P31 P32 P34 P36 P37 P38（P06 体检部分、P45 亦属此类） |
| **后端缺**（须先建服务端能力） | **15** | P01 P02 P07 P08 P12 P18 P21 P26 P29 P33 P39 P42 P43 P46（P06 参数预设、P14/P44 问题清单为部分缺） |
| **前端缺**（后端在、前端无 AI 调用） | **3** | P15 P27（+P13 的空结果放宽建议） |
| **明确不接 AI**（写进方案，接线时不要加） | **7** | P03 P05 P24 P35 P40 P41（+P19 deferred） |

**这个分布本身就是实施顺序的依据**：17 个「仅缺接线」页的后端已经付过成本了，接上即产出价值，风险最低；15 个「后端缺」里只有 P21 政策、P06 参数预设、P26 顾问作业面三项属于「用户高频且步骤压缩收益大」。

### 2.4 前端侧已识别问题（登记，本文不修）

| ID | 问题 | 证据（`origin/main`） |
|---|---|---|
| **F1** | **无共享 AI 免责声明组件**，21+ 个页面各写各的文案 | `ComplianceBanner`（来自 `@ai-job-print/ui`）只在 7 个文件使用；其余为内联硬编码。全站 **`AI 判断` / `AI判断` 字样 0 处** |
| **F2** | **三套互不相通的 consent 机制** | ①`/me/ai-consents` scope `job_ai`（`services/api/jobAiHttpAdapter.ts:15,118`）②匿名 job-fit 专属 consent（`services/api/jobFit.ts:29-33`）③合同审查 `consentScopeHash`（`services/api/contractReview.ts:44-46`）。后果：**登录用户在 `/resume/job-fit` 页无法就地授权**，被 `MemberJobFitConsentCard.tsx:12-13` 打发去 `/jobs/:id` 授权 |
| **F3** | **AI 功能页不受就绪门控保护** | `useApiReadiness` 只接在 5 个 Hub 页（`ResumeServiceHubPage.tsx:191`、`InterviewServiceHubPage.tsx:147`、`JobsServiceHubPage.tsx:180`、`FairsServiceHubPage.tsx:148`、`PolicyServiceHubPage.tsx:151`）。**深链直达 `/resume/job-fit` 等页会绕过门控** |
| **F4** | **孤儿 AI 组件**（定义了从未被引用） | `pages/jobs/components/JobAiEntryPanel.tsx`（0 引用）、`JobListInsights.tsx`（0 引用）、`JobFilterAssistant.tsx`（只被 `JobsPage.tsx:478` 的**注释**提到，未 import） |
| **F5** | **静默失败的 AI 调用** | `MyAiRecordsPage.tsx:117,169,189` 裸 `.catch(() => …)` 无可见提示；`MySettingsPage.tsx:263` 吞掉 consent 加载失败；`ResumeOptimizePage.tsx:130`、`JobFitPage.tsx:106` `.catch(() => setX([]))` 把失败渲染成空态 —— 违反 `interface-handoff.md` §4A 硬线「不得把『没生成出来』渲染成『生成完了但内容为空』」 |
| **F6** | **mock 模式下合同审查返回假数据而非拒绝** | `services/api/contractReview.ts:97,108,135,150,169,182,206` 返回 mock 任务数据；`aiMockAdapter.ts:31,48` 有 `MOCK_REPORT` / `MOCK_OPTIMIZE_MODULES`。其余 AI 服务（jobFit / careerPlan / selfAssessment / fairVisitPlan / jobAi）都是**诚实拒绝**。此处不一致 |

---

## 三、交互流程设计（8 条主干功能）

### 3.0 通用规则（每条流程都适用）

**AI 应该做什么**：排序、解释、比对、抽取、预填、盘点、组卷、点评、转写。
**AI 不应该做什么（红线，写死）**：

1. **不得自动审核发布** —— 岗位/招聘会/政策的 `reviewStatus` 与 `publishStatus` 只能由管理员操作（CLAUDE.md §18）。
2. **不得自动裁决工单** —— P43 的工单只出草稿，**不自动提交**。
3. **不得替用户做投递或预约决定** —— 岗位/招聘会只做第三方来源入口。按钮文案白名单只有：查看岗位 / 去来源平台投递 / 扫码投递 / 查看招聘会 / 去来源平台预约 / 扫码预约（CLAUDE.md §2）。
4. **不碰钱** —— 金额、支付状态、出纸计数、取件码一律由支付回执与设备回报决定。
5. **不改原文** —— 法条、合同、岗位 JD 的原文一字不改。
6. **不出百分比 / 录用概率 / 通过率 / 打分排名 / 薪资预测**（服务端 `llm-resume.service.ts:47-59` 已有 `DIAGNOSIS_GUARD_TERMS` 11 条恒定拦截词，与管理员可配 `forbiddenWords` 叠加）。
7. **不伪造能力** —— 没有真实服务端查询就不得说「帮你查了 / 逐条查库 / 系统实测数据」（CLAUDE.md §9）。

**证据分级（每条结论必须带）**：E1 用户材料事实（给原文摘录 + 位置）/ E2 系统或来源方事实（给来源机构 + 同步时间 + 外部 ID）/ E3 AI 判断（**必须带「仅供参考」**）。**确定性逻辑（计数、排序、映射）不得标 E3。**

**降级总则**（`interface-handoff.md` §4）：AI 结论区撤下后必须补等量真实内容 + 「为什么没有」一句 + **至少一个仍可用的动作**；保留用户自己的东西（原文、已答、已上传）；**打印件也要随之改名与改口径**（不能印着「根据你的简历生成」）。

**关于拆页的判据（产品所有者定调：「并不是页面越少越好」）**：

AI 输出需要空间。**当 AI 产出撑不下母页时，可以且应该提议拆页** —— 典型的五类高信息量 AI 产出：**诊断报告、前后对比、匹配理由、面试评价、规划路径**。

- **鼓励拆**：一页职责过载 → 拆成职责单一；把**对比 / 预览 / 编辑**分到各自的页；AI 产出信息量撑不下母页时独立成页。
- **禁止拆**：重复入口、同义卡片、占位页、假数据闭环、为「看起来完整」加页（CLAUDE.md §8 反堆砌）。
- **唯一判据**：加页必须让用户**每一屏要做的事更少、更清楚**。**多点一次却没换来更清楚，就是堆砌。**
- **每条拆页提议必须写全四项**：职责（这页只做什么）/ 入口（从哪来）/ 返回（回哪去、状态是否保留）/ 判据自检（换来了什么「更清楚」）。本文第三部分的 4 条提议均按此格式给出。
- **已有先例**：`09b-resume-optimize.html` —— 把简历前后对比从 1714 行的 P09 拆出（commit `a19d145f0` *design(v6): split the resume before/after comparison out and lift the type floor*，PR #614）。⚠️ **该提交尚未合入 `origin/main`**（`6caedd6dc` 上只有 `09-resume-workbench.html`，无 `09b-*`），目前只在分支 `worktree-agent-a902db0eb20f99655` 上。本文 §3.3 的 `/resume/optimize/compare` 提议与它同源，**接线时应对齐 09b 的最终形态，不要各拆各的**。
- **现状佐证**：原型 `09-resume-workbench.html` 1714 行、`06-print-workbench.html` 3593 行、`20-interview-pod.html` 2342 行、`11-jobfit-compare.html` 1895 行，都是多阶段挤一页；生产端已有 **14 个 kiosk 页面超过 CLAUDE.md §8 的 500 行阈值**（最大 `AssistantPage.tsx` 758 行、`PrintProgressPage.tsx` 745 行、`PrintCashierPage.tsx` 650 行、`PrintPreviewPage.tsx` 642 行、`PrintUploadPage.tsx` 640 行、`HomePage.tsx` 591 行）。**AI 输出加进去只会更挤，所以拆页不是可选项。**

> **拆文件 ≠ 拆页**。上面 14 个超阈值文件里，`PrintProgressPage` / `PrintCashierPage` / `PrintPreviewPage` / `PrintUploadPage` 属于「同一件事的连续阶段」，应**按组件拆文件、不拆页**（拆页会增加步数，违背判据）。真正该拆页的是「同屏塞了两件不同的事」，见 §3.3 / §3.5 / §3.6 / §3.8 四条提议。

---

### 3.1 打印一份文件（P06，最高频）

| 项 | 内容 |
|---|---|
| 用户目标 | 把手里的文件打出来 |
| 当前步数 | **5**（`step-reduction.md` 已从原型 9 步压到 5：首页 → 打印域首屏 → 选文件 → 参数与核价 → 支付 → 出纸 → 取件） |
| AI 介入点 | **文件上传完成、体检结束的那一刻，介入一次** |
| 介入后步数 | **5 步不变，但第 3 步从「逐项设置四个参数」变成「确认一屏已填好的参数」** |

**AI 做什么**：读 F1 `inspection` 结果（页数、`pageCountSource`、`canPrint`、`imageQuality`）→ 预填**份数 / 黑白彩色 / 单双面 / N-up** 四项，每项标依据（E1 实测页数 → 建议双面；E1 检出彩色像素 → 建议彩色）。用户看到「参数已按文件内容预设，可改」+ 四项已填值。

**AI 不做什么**：不碰核价、不碰收银、不碰出纸判定、不自动开始打印。**预填的四项必须全部可改**，且改动不需要额外确认步骤。

**失败/降级**：`ai-down` 时参数区改为「请确认打印参数 · 预填不可用，四项都需要你自己设」（原型 `:2106` 已有此文案），**四项回到当前生产的默认值，打印全流程不受任何影响**。体检不可用时（原型 `:928-931`「材料体检不可用 / 服务中断，已上报」）遮盖层不出现，用户可选择原样打印。

**consent**：无需。参数预填只读文件自身属性，不涉及个人信息推断。**但 PII 扫描已有的处置决策（`POST /materials/tasks/:id/pii-findings/decisions`）必须保留用户显式决定，AI 不得代选 `redact`。**

**拆页建议**：**不拆页，拆文件。** P06 的七阶段是同一件事的连续推进，拆页反而增加步数，违背判据。该做的是把 `PrintProgressPage.tsx`(745) / `PrintCashierPage.tsx`(650) / `PrintPreviewPage.tsx`(642) / `PrintUploadPage.tsx`(640) 四个超阈值文件**按组件拆分**。#613 已示范这条路径：把权益卡抽成 `services/api/benefits.ts` + 独立样式表，`PrintConfirmPage.tsx` 只增 174 行而不新增页面。

---

### 3.2 扫描原件（P07）

| 项 | 内容 |
|---|---|
| 用户目标 | 把纸质材料扫成 PDF 带走或直接打印 |
| 当前步数 | 4（start → settings → progress → result） |
| AI 介入点 | **扫描完成后，出结果前** |
| 介入后步数 | **4 步不变**，result 页多一块「哪几页可能没扫清楚」 |

**AI 做什么**：逐页 OCR 置信度终检，点名低于阈值的页号。**不送 AI 生成任何结论性文字**。
**AI 不做什么**：不自动重扫、不自动裁切、不判断「这是不是身份证」进而做处置决定。
**失败/降级**：跳过终检，扫描件可直接打印存档，result 页标「本次未做清晰度检查」。
**consent**：无需（OCR 在本机链路内，不外发结论）。**但若扫描件进入简历诊断链，则落入 3.3 的 consent 口径。**
**拆页建议**：不拆。

---

### 3.3 简历诊断与优化（P09，AI 密度全站前三）

| 项 | 内容 |
|---|---|
| 用户目标 | 知道简历行不行、拿到改好的版本 |
| 当前步数 | **4**（`step-reduction.md` 已从 6 压到 4：首页 → AI简历域首屏 → P09 五阶段 → 导出） |
| AI 介入点 | **两次**：①解析完成 → 立刻出诊断（不让用户再点一次）②诊断完成 → 逐条给改写候选 |
| 介入后步数 | **4 步不变** |

**AI 做什么**：六维评分 + 3–6 条可执行建议 + 0–5 条**文本表达风险**提醒 + 2–4 条修改优先级；逐条改写候选（原句 / 候选 / 理由）。
**AI 不做什么**：**不编造简历中不存在的经历、学历、技能或成果**（服务端 `llm-resume.service.ts` 第 7 条 prompt 约束 + `llm-resume-optimize.service.ts` 的防编造校验：事实串必须出现在原文，两次输出仍含无法确认信息则拦截）。风险提醒**严禁涉及年龄、性别、婚育、地域、学历歧视**。编不出的项返回「需你自己写」，不许硬凑。
**失败/降级**：诊断挂 → 不给结论，**原文可翻看、文件可打印可存档**；优化挂 → 撤下候选，**原件完好**；简历原文已按 TTL 清理 → 明确提示重新上传（生产已实现，`llm.provider.ts:91-95`）。
**consent**：**当前无 consent 门禁 —— 这是个缺口。** 简历原文会未脱敏送第三方模型（风险 R2）。建议新增 scope `resume_ai`，文案必须说清三件事：①简历全文会发送给境内第三方大模型服务商做分析；②发送前会遮盖身份证号 / 手机号 / 银行卡 / 邮箱（**前提是先复用合同审查的 masker**）；③解析结果默认保留 24 小时后硬删，可随时撤回。

**拆页建议（本轮重点）**：**建议拆 1 页。**

- 现状：原型 `09-resume-workbench.html` **1714 行**把 s1 来源 / s2 解析 / s3 诊断 / s4 逐条优化 / s5 导出挤在一页；生产 `ResumeOptimizePage.tsx` 已 **505 行**。
- 问题：**优化前后对比**是信息量最大的一块（原文 / 候选 / 理由 / 采纳按钮 × N 条），和诊断报告（六维雷达 + 建议 + 优先级）挤在同屏，27 寸竖屏上两块都看不清、按钮都点不准。
- 建议：**把「逐条优化对比」独立成页** `/resume/optimize/compare`。
  - **职责**：只做一件事 —— 逐条看原句 vs 候选，采纳或跳过。
  - **入口**：`/resume/report` 诊断报告页的「开始逐条优化」；`/resume/optimize` 的「查看完整对比」。
  - **返回**：回 `/resume/optimize`（保留已采纳状态）；顶部保留回 `/resume/report` 的次要入口。
  - **判据自检**：多点一次（报告 → 对比页），换来的是**一屏只做一个决定**（这条改不改），而不是一屏同时看评分、读建议、比原文、点采纳。✅ 符合判据。

---

### 3.4 岗位检索与解读（P13 → P14）

| 项 | 内容 |
|---|---|
| 用户目标 | 从一屏岗位里找到值得看的，看懂 JD |
| 当前步数 | 3（首页 → 岗位台 → 详情） |
| AI 介入点 | **两次**：①列表加载后，有简历时收敛排序 ②进详情后解读 JD |
| 介入后步数 | **3 步不变**，但用户不用自己逐条读 |

**AI 做什么**：对**已经过审核发布**的岗位列表做排序（只排序，不新增不隐藏），每条一句理由；详情页给 3 条解读 + 4 条中性核实问句。
**AI 不做什么**：**不得代替用户投递或预约**；不得改写 JD 原文；不得推测薪资；**不得自动审核发布**（`reviewStatus` 只能由管理员改）。空结果放宽建议是**计数逻辑**（每条件放宽后可多出几条），**不标 E3**。
**失败/降级**：按同步时间倒序，筛选照常；详情页换固定问题清单，**照样可打印**。
**consent**：**已有** —— scope `job_ai`（版本 `20260701`）。首次调用推荐/解读/匹配时后端抛 `USER_AI_CONSENT_REQUIRED`，前端弹 `JobAiConsentModal`。文案要说清：简历会被用于岗位比对；**结果只对本人可见，不外传给企业或合作机构**；可随时在「我的 · 设置」撤回。
**配额**：会员 20/日、终端 100/日、IP 60/日，Redis 挂时 **fail-closed 不放行**。用户可见文案必须是「今日岗位 AI 使用次数已达上限」，不能伪装成「暂时不可用」。
**拆页建议**：不拆。

---

### 3.5 岗位匹配（P11，E 标注全站最高）

| 项 | 内容 |
|---|---|
| 用户目标 | 知道自己跟目标岗差在哪、该补什么 |
| 当前步数 | 3（简历域首屏 → 选岗位 → 出比对） |
| AI 介入点 | **选定 1 个岗位后一次** |
| 介入后步数 | 3 步不变 |

**AI 做什么**：三档参考等级 + 综合理由 + **逐条证据（可追溯到简历原文）** + 关键词命中/缺失 + 差距行动。
**AI 不做什么**：**禁百分比、录用概率、通过率、打分排名**（服务端已双层拦截：`llm-job-fit.service.ts` 的 `sanitizeAdvice` + `findViolation`）；不替用户决定投不投。共同要求提取（2–3 岗共同词）是**计数逻辑，不受 AI 影响**。
**失败/降级**：七块结论一块不给，**岗位原文照常显示**，仍可「去来源平台投递」。
**consent**：登录用户走 `job_ai`；匿名用户走**专属 job-fit consent**（`POST /resume/job-fit/consent`）。⚠️ 当前登录用户在本页**无法就地授权**（问题 F2），被打发去 `/jobs/:id` —— 这是接线时必须修的体验断点。
**拆页建议**：**建议拆 1 页。** 原型 `11-jobfit-compare.html` **1895 行**，生产 `JobFitPage.tsx` 已 **526 行**且承载 7 个子组件。把**「差距行动清单」独立成页** `/resume/job-fit/actions`：
- **职责**：只列「要补什么、怎么补、本机能不能补」，并直连打印 / 简历优化 / 材料工厂。
- **入口**：比对结果页的「我要补这些差距」。
- **返回**：回比对结果页。
- **判据自检**：比对页专心做「差在哪」，行动页专心做「怎么办」。✅ 符合判据。

---

### 3.6 模拟面试（P20）

| 项 | 内容 |
|---|---|
| 用户目标 | 练一次面试，把复盘单带走 |
| 当前步数 | **5**（`step-reduction.md` 已从 8 压到 5：首页 → 面试域首屏 → P20 → P06 核价出纸） |
| AI 介入点 | **三次**：①组卷 ②逐题追问 ③结束后出报告 |
| 介入后步数 | **5 步不变** |

**AI 做什么**：按 5 种面试官 × 6 档经验 × 3 档难度 × 3 种时长组卷；逐题点评（**说清了没有，不评对错**）；生成复盘单，**带着载荷直接进打印台**（不用重新选文件）。
**AI 不做什么**：不打分、不排名、不给「通过率」；**不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策**。
**失败/降级**：组卷挂 → 强制通用卷；点评挂 → 撤下点评但**答案原文保留**，**纸面改名「题目与答案单」**（不能印着「AI 点评报告」却没有点评）；ASR 挂 → `fallbackToText()` 自动回退文字输入（生产已实现 `InterviewSessionPage.tsx:192`）；TTS 挂 → 降级浏览器本地 TTS，**不阻塞主流程**。
**consent**：当前无。**面试作答按 `interface-handoff.md` §2B 是「从不保存」**——只记「练过一次」，不留内容。若语音开启，需就「音频只在内存中转发给识别接口，不落盘、不入 FileObject、不写日志」做一次性告知（后端已如此实现，`asr/asr.service.ts:16-19`）。
**拆页建议**：**建议拆 1 页。** 原型 `20-interview-pod.html` **2342 行**五阶段一页。把**「逐题复盘」独立成页** `/interview/review`：
- **职责**：一屏一题，看我答了什么 + 点评说什么 + 参考答法。
- **入口**：`/interview/report` 的「逐题看」。
- **返回**：回 `/interview/report`。
- **判据自检**：报告页给整体，复盘页一次只看一题。✅ 符合判据。

---

### 3.7 职业规划（P22）

| 项 | 内容 |
|---|---|
| 用户目标 | 知道自己该往哪个方向走、缺什么 |
| 当前步数 | 3（简历域首屏 → 规划页 → 打印） |
| AI 介入点 | 有简历后一次 |
| 介入后步数 | 3 步不变 |

**AI 做什么**：从简历抽能力（**带原文引用**）+ 四方向缺口，**硬门槛与「简历漏写」分开**（前者是真缺，后者只是没写）。
**AI 不做什么**：不预测薪资、不承诺「转行成功率」、不推荐具体雇主。
**失败/降级**：只给岗位要求计数表，**纸面列「本单没有的东西」**（明写没做什么，而不是留空）。
**consent**：同 3.3（简历外发），建议并入 `resume_ai`。
**拆页建议**：不拆（`CareerPlanPage.tsx` 未超阈值）。

---

### 3.8 政策条件核对（P21，全站最大后端缺口）

| 项 | 内容 |
|---|---|
| 用户目标 | 知道我能领哪些补贴、卡在哪一条 |
| 当前步数 | **5**（`step-reduction.md` 目标：首页 → 政策域首屏（选身份/参保/城市）→ P21 逐条核对 → 勾选要办的 → P06 出纸）；**但后端 0 实现，当前实际是「自己读法规」** |
| AI 介入点 | **9 项问答填完后一次** |
| 介入后步数 | 5 步 |

**AI 做什么**：每条政策给 **满足 / 卡住 / 待确认** + 逐条依据。允许用户答「不确定」→ 该条结论标「待确认」，**不猜**。
**AI 不做什么**：**法条原文一字不改**（这是硬红线）；不代办、不承诺办得下来、不预测发放金额与时间。
**失败/降级**：只列政策与原文，**纸面标「本单未做条件核对」**（不能印一张看起来像核对结果的清单）。
**consent**：需要。9 项问答含**身份、参保状态、失业登记、社保连续缴费月数、毕业年份**——属于个人信息。文案要说清：这些答案只用于本次条件核对；**不上传给任何政府或第三方系统**；结果只对本人可见；本机不代办、不提交任何申请。
**拆页建议**：**建议拆 1 页。** 把**「9 项问答」独立成页** `/renshi/eligibility`：
- **职责**：只做问答采集，一屏 3 题，允许「不确定」。
- **入口**：`/renshi` 的「核对我能办哪些」。
- **返回**：答完自动进核对结果；中途退出回 `/renshi`，已答保留。
- **判据自检**：政策页专心列政策（这是**不依赖 AI 的 E2 事实**，必须永远可用），问答页专心采集。✅ 符合判据，且顺带把「AI 挂了政策列表还在」的降级边界做实。

---

### 3.9 招聘会备战（P17 → P45）

| 项 | 内容 |
|---|---|
| 用户目标 | 到了现场知道先逛哪几个展位 |
| 当前步数 | **3**（`step-reduction.md` 已从 6+ 压到 3） |
| AI 介入点 | 给了城市 + 日期范围 + 岗位方向后一次 |
| 介入后步数 | 3 步 |

**AI 做什么**：场次三档 + 展位顺序（展位号 + 理由）+ 覆盖率说明，合成一张可打印的参会作战单。
**AI 不做什么**：**不使用 GPS**（一体机无定位权限，`interface-handoff.md` §1 硬约束）；**不代替用户预约**（按钮仍是「去来源平台预约 / 扫码预约」）；现场人数、场次数据是只读事实，**无数据时诚实空态，不编分布**。
**失败/降级**：按展区编号顺序给，**明写「不猜先后」**。
**consent**：简历方向来自简历解析结果 → 同 3.3。
**拆页建议**：不拆。P45 现场页已是独立页，职责清晰。

---

### 3.10 AI 顾问（P25 → P26）

| 项 | 内容 |
|---|---|
| 用户目标 | 不知道该用哪个功能，直接问 |
| 当前步数 | 2（首页 → 顾问） |
| AI 介入点 | 每一轮对话 |
| 介入后步数 | 2 步 |

**AI 做什么**：回答 + 证据分级 + **可钉到托盘的要点**；引导跳转到对应功能页。
**AI 不做什么**：超出角色范围（企业招聘流程、平台内闭环办理、候选人处理、录用决策、医疗、法律、金融投资）必须**简短拒绝并引导回本终端服务范围**（`llm-guard.ts:1-4` 已实现）；10 条禁用词命中即换兜底话术。
**失败/降级**：**明说答不了，不用编出来的回答顶上**。⚠️ **接线关键**：必须让前端能区分「真实模型回答」与「mock provider 预置话术」（风险 R1）。服务端已算出 `providerLabel`，建议在响应里透出，前端在非 `llm:*` 时**不得呈现为 AI 回答**。
**consent**：无（不上传文件时）。若对话中带入简历/岗位上下文，落入 3.3 口径。
**拆页建议**：**建议拆。** `AssistantPage.tsx` **758 行，全站最大**。P26 顾问作业面（`/ai/plan`）页面已存在但**后端 0 实现** —— 正确做法不是再加页，而是**先把 P26 的后端建起来**，把「作业型任务」（生成 / 核对 / 对比）从对话页移到作业页，让对话页回归「问答 + 引导」的单一职责。

---

## 四、实施顺序

排序依据：**依赖关系（后端先于前端） → 用户价值（步骤压缩收益） → 风险（合规与假能力风险优先堵）**。
文件预算为**预计改动文件数**，不含测试与文档。

### S0 · 先堵不能带上线的风险（不新增能力，纯加固）

| # | 项 | 类型 | 文件预算 | 说明 |
|---|---|---|---|---|
| S0-1 | **助手 mock 回落可被识别** | 后端透出 + 前端判定 | **2–3** | 风险 R1。响应透出 `providerLabel`；前端在非 `llm:*` 时不呈现为 AI 回答。**不做这条，P25 就是一个会说话的假 AI** |
| S0-2 | **简历链复用合同审查的 PII masker** | 后端 | **3–5** | 风险 R2。`contract-review-pii-masker.ts` 已是成品，提到 `common/` 后给 A 组、B 组的 LLM 入参加一层。**这是唯一一条「合规必须、成本极低」的项** |
| S0-3 | **`resume_optimize` 单点故障拆键** | 后端 | **6–8** | 风险 R3。为岗位匹配 / 职业规划 / 参会计划 / 自我探索 / 岗位推荐 / 岗位解释各建独立 feature key，**默认继承 `resume_optimize` 配置以保持行为不变**。顺带修 `llm-config.service.ts:118-127` 漏登记自我探索的注释 |
| S0-4 | **AI 产物 PDF 补隐式 AIGC 元数据** | 后端 | **5–6** | 风险 R4。5 个 PDF 服务加 metadata 标识（可见标识是否加到简历 PDF 上需产品裁决）。参照 `contract-review-report-pdf.service.ts:52,75,118` |
| S0-5 | **静默失败改为可见失败** | 前端 | **4–5** | 问题 F5。`MyAiRecordsPage.tsx:117,169,189`、`MySettingsPage.tsx:263`、`ResumeOptimizePage.tsx:130`、`JobFitPage.tsx:106` |
| S0-6 | **mock 模式合同审查改为诚实拒绝** | 前端 | **1–2** | 问题 F6。与其余 5 个 AI 服务对齐 |

> S0 全部是加固，**不新增用户可见功能**，但 S0-1 / S0-2 是「能不能宣称有 AI」的前提。

### S1 · 建立全站 AI 前端原语（一次投入，后面每页都省）

| # | 项 | 类型 | 文件预算 | 说明 |
|---|---|---|---|---|
| S1-1 | **`data-aitask` 提升为共享状态原语** | 前端 | **3–4** | 事实 1。按 `01-home-v6.html:161-190` 的四态五要求实现一个 hook + 一个包装组件；**删掉原型里标了 `PROTOTYPE-ONLY` 的计时器回收逻辑**。这是「进度条不能空转」这条硬要求的唯一落点 |
| S1-2 | **共享 AI 免责/证据分级组件** | 前端 | **2–3** | 问题 F1。E1/E2/E3 徽章 + 「AI 判断 · 仅供参考」统一渲染。当前 21+ 页各写各的，且全站 `AI 判断` 字样 0 处 |
| S1-3 | **统一 consent 入口** | 前端（+少量后端） | **4–6** | 问题 F2。让登录用户能在 `/resume/job-fit` 就地授权，不再被打发去 `/jobs/:id` |
| S1-4 | **AI 功能页接就绪门控** | 前端 | **3–5** | 问题 F3。深链直达绕过门控。⚠️ **须先拍板 `interface-handoff.md` §5 待裁决第 1 条**（AI 挂时打印等非 AI 能力是否仍可用）——**建议裁定为「非 AI 能力保持可用」**，与设计口径一致 |
| S1-5 | **清理孤儿 AI 组件** | 前端 | **3** | 问题 F4。`JobAiEntryPanel.tsx` / `JobListInsights.tsx` / `JobFilterAssistant.tsx` 三个 0 引用文件；按 CLAUDE.md §8 删除需先确认无路由/import/测试/文档依赖 |

### S2 · 接线（后端已齐，接上即产出价值 —— 性价比最高的一批）

按「用户频次 × 步骤压缩收益」排序。**这 17 页的后端成本已经付过了。**

| # | 页 | 文件预算 | 依赖 |
|---|---|---|---|
| S2-1 | **P09 简历诊断/优化** + 拆出 `/resume/optimize/compare` | **5–7** | S1-1 S1-2 S0-2 |
| S2-2 | **P11 岗位匹配** + 拆出 `/resume/job-fit/actions` | **4–6** | S1-3 |
| S2-3 | **P13 + P14 岗位排序与解读** | **3–4** | S1-2 |
| S2-4 | **P20 模拟面试** + 拆出 `/interview/review` | **4–6** | S1-1 |
| S2-5 | **P25 AI 顾问** | **2–3** | **S0-1（硬依赖）** |
| S2-6 | **P22 职业规划** | **2** | — |
| S2-7 | **P28 自我探索** | **2** | — |
| S2-8 | **P17 + P45 招聘会备战** | **3–4** | — |
| S2-9 | **P10 访谈式生成** | **2** | — |
| S2-10 | **P31 合同审查开关与验收** | **1–2** | 只是 `VITE_ENABLE_CONTRACT_REVIEW` + 验收，后端最完备 |
| S2-11 | **P32/P34/P36/P37/P38 五个域首屏建议卡** | **5–6** | S1-4 |
| S2-12 | **P15 企业页复用 C3 逐岗匹配** | **2** | 前端缺，后端现成 |
| S2-13 | **P23 我的 · 一句话盘点** | **1–2** | — |

### S3 · 必须先有后端（按用户价值排序）

| # | 项 | 后端预算 | 前端预算 | 理由 |
|---|---|---|---|---|
| S3-1 | **P06 打印参数 AI 预填** | **2–3** | **2** | **最高频功能 + 步骤压缩收益最大 + 后端体检数据已现成**（只需从 `inspection.result` 推导四项）。这是「AI 是驱动层」在最高频页面上的唯一体现。**已在 `6caedd6dc` 上复核确认 0 实现（§1.7.4）**，#613 没有引入预填 |
| S3-2 | **P21 政策条件核对** + 拆出 `/renshi/eligibility` | **5–8** | **3–4** | 步骤 8→5，全站最大后端缺口，且政策是本终端的差异化价值 |
| S3-3 | **P26 顾问作业面 `/ai/plan`** | **5–8** | **2–3** | 风险 R6：前端页面已在路由但后端 0 实现 —— **这是当前唯一「页面存在但后端完全没有」的 AI 页**，属于假能力风险 |
| S3-4 | **P07 OCR 置信度终检** | **2–3** | **1–2** | OCR 底座现成，只需补终检与阈值 |
| S3-5 | **P42 资产盘点（到期件 + 版本差异）** | **3–4** | **2** | 步骤 4→3，用户高频进「我的」 |
| S3-6 | **P12 求职材料 AI 生成** | **3–4** | **2** | 现有 `job-materials` 是模板渲染，加 AI 版需防编造契约（复用 A2 的事实池校验） |
| S3-7 | **P01 首页处境理解与办理单** | **5–8** | **3–5** | 价值最高但**依赖前面全部能力就位**（办理单要能指向真实可用的域）。放在这里是依赖决定的，不是价值决定的 |
| S3-8 | **P43 记录盘点 / 聚类 / 工单草稿** | **4–6** | **2–3** | 红线：**工单不自动提交**、画像**仅本人可见不外传** |
| S3-9 | **P08 图片排序与落款位建议** | **2–3** | **1–2** | 低频 |
| S3-10 | **P29 证件照规格体检** | **3–5** | **2–3** | 需要先有任务模型；C0 已标 deferred |
| S3-11 | **P18 校招节奏解读** | **3–4** | **2** | 低频 |
| S3-12 | **P46 报到材料差分** | **2–3** | **1–2** | 依赖智慧校园开关真值化（P19 deferred） |
| S3-13 | **P33 简历模板推荐** | **2–3** | **1–2** | 依赖模板 API 本身 |
| S3-14 | **P02 AI 海报（二期）** | — | — | **保持 stub 诚实报错，本轮不做** |

### S4 · 观测与治理（与 S2 并行，不阻塞）

| # | 项 | 文件预算 | 说明 |
|---|---|---|---|
| S4-1 | **合同审查 + Materials OCR 纳入 `AiOperation`** | **3–4** | §1.4：这两条真实模型调用当前完全不进 `AiServiceLog`，Admin 看不到 |
| S4-2 | **A/B/D 组补日配额** | **3–5** | 风险 R5。复用 `JobAiQuotaService`。一体机是公共设备 |
| S4-3 | **Admin AI 用量页如实标注非 token 计费** | **1–2** | `NON_TOKEN_BILLED_OPERATIONS` 的 `undefined` **不得显示为 0 / 免费** |

> **口径提醒**：`AiServiceLog` 是 best-effort 观测数据（写失败只 warn 吞掉，`ai-log.service.ts:308`），**不是账单**。任何对账、结算、成本承诺都不能以它为准。

### 4.1 依赖关系图

```text
S0-1 助手 provider 可识别 ──────────────► S2-5 P25 顾问接线
S0-2 简历链 PII 脱敏 ───────────────────► S2-1 P09 接线
S0-3 feature key 拆分 ─┐
S0-4 AIGC 元数据 ──────┼─► （不阻塞，但上线前必须完成）
S1-1 data-aitask 原语 ─┼─► S2-1 / S2-4 / S3-7
S1-2 证据分级组件 ─────┼─► S2-1 / S2-3 / 全部 S2
S1-3 统一 consent ─────┴─► S2-2 P11 接线
S1-4 就绪门控 ⟵ 需先拍板 interface-handoff §5 待裁决第 1 条 ─► S2-11 域首屏

S3-1 P06 参数预填 ⟵ 已有 materials inspection 数据，无前置依赖（可最早启动）
S3-2 P21 政策核对 ⟵ 无前置依赖（可与 S2 并行）
S3-7 P01 办理单  ⟵ 依赖 S2 大部分完成（办理单必须指向真实可用的域）
```

### 4.2 建议的第一批（若只做一件事）

**S0-1 + S0-2 + S3-1。**

理由：S0-1 决定「我们能不能说这是 AI」；S0-2 决定「简历能不能合规地喂给模型」；S3-1 是最高频页面上 AI 作为驱动层的唯一体现，且后端数据已现成、文件预算最小（约 4–5 个文件）。三项合计约 **9–13 个文件**，不触碰岗位/招聘会数据面、不碰支付、不碰硬件链路。

---

## 五、未验证 / 需拍板项

以下条目**没有在 `origin/main` 上取到确证**，或需要产品裁决，一律不作为结论使用。

### 5.1 未验证（读不到或未读）

| # | 项 | 为什么未验证 |
|---|---|---|
| U1 | `ComplianceBanner` 组件的实际实现与文案 | 来自 `@ai-job-print/ui`，**该包的源码不在本次导出的快照范围内**（只导出了 `packages/shared/src`）。它是否已含 E1/E2/E3 与「AI 判断」语义，未读 |
| U2 | `VERIFIED_PRINT_PARAMETER_PROFILE` 的定义位置与取值 | 在 `PrintParamsPage.tsx:153-154` 被引用，其定义文件未读。「colorMode / duplex 为常量」的判定基于引用处写法，**未读到定义** |
| U3 | Admin / Partner 两个后台的 AI 页面现状 | 本文范围是 Kiosk P01–P46。Admin 的 `/ai-services`、`/ai-configs` 页面实现未读（C0 文档已覆盖其路由，但未覆盖 AI 语义） |
| U4 | 小程序（`apps/miniapp`）的 AI 接线现状 | 不在本次任务范围 |
| U5 | 各 AI 能力的真实调用成功率、时延、成本 | `GET /admin/ai/usage` 是运行期数据，**静态代码读不出**。任何「AI 现在好不好用」的结论都需要真实环境实测 |
| U6 | `01-home-v6.html` 的 22 处 `data-aitask` 中，CSS 选择器与 HTML 属性的确切拆分 | 实测 `grep -no 'data-aitask="[^"]*"'` 命中 11 处（9 处在 CSS 选择器、2 处在 HTML 区域），另 11 处为不带引号值的形态（如注释、脚本引用）。**「22」是 `grep -o 'data-aitask'` 的总计数**，两个数不矛盾但口径不同，接线时应以 CSS 契约段落为准 |
| U7 | `job-quality` 的 `ready/partial/insufficient` 是否已影响岗位 AI 的实际准入 | 读到了服务定义（`job-ai/job-quality.service.ts`），**未追踪其在 `job-ai.service.ts` 中的消费点** |
| U8 | 原型 46 页逐页的 AI 元素语义细节 | ①列的计数为实测，但**逐页 AI 块的具体文案与位置未逐页精读**（46 页 × 平均 1500 行）。计数可信，语义描述部分基于 `ai-capability-spec.md` 的 A1–A28 承诺。**例外：P06 已逐页精读并在 §1.7.4 复核，其结论为实测** |
| U9 | `09b-resume-optimize.html`（PR #614）的具体形态 | 该提交 `a19d145f0` **不在 `origin/main`**（只在分支 `worktree-agent-a902db0eb20f99655`），本文未读其内容。§3.3 的拆页提议**与它同源但未对齐**，合入后须复核二者是否冲突 |
| U10 | main 后续提交 | 本文复核基准为 `6caedd6dc`。此后的提交未核验 |

### 5.2 需产品拍板（工程决定不了）

| # | 项 | 冲突点 |
|---|---|---|
| D1 | **AI 挂时非 AI 能力是否仍可用** | `interface-handoff.md` §5 待裁决第 1 条。生产 `ResumeServiceHubPage` 用 `useApiReadiness` 一挂全挂；设计口径是「非 AI 能力不因 AI 中断而失效」。**本文建议裁定为「保持可用」**，但需拍板。这条决定 S1-4 怎么做 |
| D2 | **AI 生成的简历 PDF 是否要带可见 AIGC 标识** | `interface-handoff.md` §3 要求「所有 AI 生成内容（含打印件）必须带可见标识」；但简历是用户要拿去投递的材料，带可见标识会影响使用。**本文建议：可见标识由产品裁决，隐式元数据标识无理由不加** |
| D3 | **是否新增 `resume_ai` consent scope** | 当前简历链（诊断/优化/生成/规划/自我探索）**无任何 consent 门禁**，但会把简历全文外发第三方模型。新增 scope 会增加一次用户交互 |
| D4 | **四处建议拆页是否采纳** | `/resume/optimize/compare`、`/resume/job-fit/actions`、`/interview/review`、`/renshi/eligibility`（共 4 页）。判据与职责已在第三部分写明。产品所有者已定调「并不是页面越少越好」，且 `09b-resume-optimize.html`（PR #614，**尚未合入 main**）已开此先例 —— **第 1 条与 09b 同源，须对齐其最终形态**，其余 3 条待确认 |
| D5 | **P06 参数预填的四项默认值来源** | 预填需要一套「什么文件配什么参数」的规则。是让模型给，还是写成确定性规则（页数 > N → 双面；检出彩色像素 → 彩色）？**本文倾向确定性规则 + 标 E1，不标 E3** —— 更稳、更便宜、更可解释，且不受 AI 可用性影响 |

---

## 六、本文的边界声明

1. 本文**只出方案**，未改任何生产代码、未改原型、未碰 `docs/progress/`。
2. 所有「存在 / 缺失」结论均来自 `git archive origin/main` 的只读快照，**不以任何工作区检出为准**。初稿基准 `a7ddbc945`，复核基准 `6caedd6dc`（§1.7 为差量核验记录）。
2A. **凡引用设计文档（`ai-capability-spec.md` / `closed-loop-map.md` / `interface-handoff.md`）判断「后端有没有」，必须回 `origin/main` 复核**。已实测到 4 条此类过期结论：§1.6 的 A20/A21/A22 三条，§1.7.1 的 `/session-resume` 一条。设计侧的「生产落点」列滞后于 main 是系统性问题，不是偶发。
3. 本文引用的 4 份配套调研（`a3-print-fulfillment-gap-spec` / `kiosk-control-integrity-audit` / `console-c0-fact-freeze` / `v6-ux-density-audit`）**均不在 `origin/main` 上**，只存在于分支 `claude/four-tasks-project-coordination-d39229`。**若要以本文为实施依据，应连同这 4 份一起并入 main**，否则依据在主干上不可复核。
4. 文件预算是**预计值**，用于排期与范围控制，不是承诺。按 CLAUDE.md §8，每项开工前仍须先写清任务范围与文件预算、通过方案审查后才写代码。
