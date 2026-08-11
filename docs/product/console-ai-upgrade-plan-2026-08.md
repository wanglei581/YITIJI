# 双后台 AI 化升级改造方案 · Console AI OS

> 立项日期：2026-08-11
> 适用范围：`apps/admin`（管理员后台）、`apps/partner`（合作机构后台）、`services/api`（AI 底座）
> 前台基线：`docs/design/kiosk-ai-os-v3-2026-08/`（V3「AI 神经中枢」，27 页 + AI 覆盖矩阵 30 条）
>
> ⚠️ **基线版本提示（开发前必读）**：AI 覆盖矩阵（`closed-loop-map.md` §六A，30 条）
> 与 §五B 信息架构裁决只存在于 **`/Users/wanglei/YITIJI-v3-round2`（分支 `design/v3-entry-remodel`，端口 5294）** 的版本中，
> `main` / 本 worktree 的同名文件尚未同步（Codex 复核已实证该版本错位）。
> 本方案以 **5294 上的版本为准**；Codex 开发前请先确认 `design/v3-entry-remodel` 已合入或以该分支为参照。
> 上级文档：本方案**不新建标准**（CLAUDE.md §8.1）。IA 减法与商业化分轨仍以
> [console-plan-for-kiosk-proto-2026-07.md](./console-plan-for-kiosk-proto-2026-07.md) §6 为准；
> 合规红线以 [compliance-boundary.md](../compliance/compliance-boundary.md) 为准。
> 本方案补的是那份文档**没有覆盖的新命题**：前台已升级为「AI 操作系统」之后，双后台与服务端 AI 底座如何跟上。
>
> **交付性质：设计方案 + 页面原型。不写生产代码。** 方案定稿后由 Codex 侧执行真实开发。

---

## 第〇部分 · 一句话结论

> 前台已经是 **AI 操作系统**（30 个页面每一页都要回答"这里的 AI 是什么"），
> 后台还是 **表格管理系统**（Admin 34 页 + Partner 14 页里，AI 只占 2 页且管不住全站）。
> 中间缺的不是"AI 中台"这个大架子，而是一层 **AI 内核（ai-core）**——
> 把 `contract-review` 已经验证过的那套编排（脱敏 → 规则 → 模型 → 安全闸 → 落库 → 保留期）
> 从单个业务里抽出来，变成全站 30 个 AI 点共用的地基。
>
> 地基铺完，Admin 才有东西可管（能力注册表 / Prompt 版本 / 成本闸 / 质量抽检），
> Partner 才有东西可卖（效果数据 / 内容质检 / AI 助手 / 账单）。
> **顺序不能反：先内核，后控制台，再商业化。**

---

## 第一部分 · 诊断

### 1.1 三端范式已经错位

| 维度 | Kiosk 前台（V3 基线） | Admin 现状 | Partner 现状 |
| --- | --- | --- | --- |
| 组织方式 | 8 磁贴 → 6 域首屏 → 子功能，**按用户处境组织** | 34 页 / 5 组平铺，**按数据表组织** | 13 页 / 4 组平铺，**按数据表组织** |
| AI 定位 | 每页要么有 AI，要么有"为什么没有"的明文理由（`closed-loop-map.md` §六A，30 条） | AI 只是 2 个页面（`/ai-config` 配模型、`/ai-services` 看日志） | **完全没有 AI** |
| 状态模型 | 四态同版面（默认 / 首次 / AI 不可用 / 设备离线）+ 收银 7 态 + 任务 6 态 | 加载 / 错误 / 空态三件套 | 同 Admin |
| 证据纪律 | E1/E2/E3 分级，E3 必须标注"AI 判断，仅供参考" | 无对应治理面 | 无 |
| 降级契约 | 明确定义每种故障的降级路径与"绝不能做" | 无统一开关，无降级演练面 | 无 |
| 差异化 | 按机构 `sceneTemplate` + `allowedModules` 控制终端能力 | — | **5 类机构看到同一套 14 项菜单** |

一句话：**前台在讲"处境 → 建议 → 确认"，后台还在讲"增删改查"。**
这不是审美问题——它导致三个真实后果：

1. 前台上了 30 个 AI 点，后台只能管住其中 5 个（见 §1.2 硬伤 A）。
2. AI 出事时（幻觉、越界、成本失控、供应商挂），运营**没有任何操作台**，只能改代码发版。
3. 合作机构付了钱，看不到自己的内容产生了什么效果，**续费没有理由**（见 §1.3）。

### 1.2 服务端 AI 底座的六个硬伤（全部有代码证据）

#### 硬伤 A：30 个 AI 点，只有 7 个 feature key，其中 1 个被 6 项能力共用

`services/api/src/ai/llm/llm-config.service.ts:29-36` 定义的能力键只有 7 个：
`assistant_chat / mock_interview / resume_diagnosis / resume_generate / resume_optimize / digital_human / poster_generation`（后两个还是 `planned`）。

而 `resume_optimize` 这一个键，被 **6 项用户可见能力** 共用（代码里已自己登记警示，见同文件 `:94-108`）：

| 用户看到的能力 | 实际读的配置 | 证据 |
| --- | --- | --- |
| AI 简历优化 | `resume_optimize` | `ai/resume/llm-resume-optimize.service.ts:171,213` |
| 岗位大师 / 岗位匹配 | `resume_optimize` | `ai/resume/llm-job-fit.service.ts:366` |
| 职业规划 | `resume_optimize` | `ai/resume/llm-career-plan.service.ts:231` |
| 招聘会拜访计划 | `resume_optimize` | `ai/resume/llm-fair-visit-plan.service.ts:174` |
| 自我探索 · 倾向参考 | `resume_optimize` | `ai/resume/llm-self-assessment.service.ts:196` |
| 岗位推荐 / 岗位解读 | `resume_optimize` | `job-ai/job-ai-llm.service.ts:145` |

**后果**：运营在 Admin 里关掉"AI简历优化"，前台 6 个功能同时哑火，且各自只显示"未配置"，
没有任何地方说明这层依赖。成本也无法按能力归属——6 项能力的账混在一个键下。

#### 硬伤 B：AI 配置存 JSON 文件，不入库

`llm-config.service.ts:175` → `join(dataDir, 'ai-model-configs.json')`，
读写用 `readFileSync` / `writeFileSync`（`:184,213`）。

**后果**：多实例部署配置不同步；改配置无审计记录、无版本、无回滚；
容器重启若卷未挂载即丢失；灰度发布不可能。

#### 硬伤 C：Prompt 硬编码在 12 个 service 里，改词必须发版

`AI_MODEL_FEATURES` 里 5 个 `active` 能力有 4 个标注 `allowCustomSystemPrompt: false`
（`llm-config.service.ts:84,92,115,123`），理由是"结构化 System Prompt 由服务端强制"。
理由本身正确（防编造契约必须服务端固定），但**实现方式错了**：
prompt 直接写死在各个 `llm-*.service.ts` 里，而不是"服务端受控的、可版本化的模板"。

**后果**：调一句提示词 = 改代码 + 过 CI + 发版 + 重启。
30 个 AI 点全面铺开后，这个成本会直接压死运营迭代。

#### 硬伤 D：AI 日志没有机构维度（orgId），机构侧商业化的地基缺失

`services/api/prisma/schema.prisma:1540` 的 `AiServiceLog` 字段：
`operation / provider / status / latencyMs / errorCode / tokenUsageJson / estimatedCostCny / terminalId / endUserId`
—— **没有 `orgId`**（`grep orgId services/api/src/ai/` 零命中）。

**后果**：无法回答"这家机构的终端上跑了多少 AI、花了多少钱"，
按机构计费、按机构配额、给机构看用量报表，全部做不了。

#### 硬伤 E：AI 日志是 best-effort，不能当账本

`ai-log.service.ts:152` 写入失败只 `.catch()` 打 warn 不阻断，`estimatedCostCny` 是估算值。
`console-plan §6.4` 已裁定：**不得用 `AiServiceLog` 作为计费/退款依据**。

**后果**：现在既没有观测之外的账本，也没有"事前额度闸门"——
`ai.controller.ts:170-200` 的实际时序是**先调 LLM 花钱、后可选核销权益**，
且核销由客户端传参触发。真做商业化必须补一层原子履约账本。

#### 硬伤 F：降级 / 重试 / 预算 / 缓存，每个 service 各写一套

`LlmChatService` 只被 `ai.service.ts` / `providers/llm.provider.ts` 消费；
`resume/` 下 7 个 `llm-*.service.ts` 各自 `getApiKey` + 各自拼请求 + 各自处理失败。
`console-plan §6.3` 曾实证职业规划、招聘会计划、模拟面试没写 AI 日志——⚠️ **该结论已过期**：三者现在都写了（`llm-career-plan.service.ts:230`、`career-plan.service.ts:258`、`mock-interview.service.ts:404`）。**仍然成立的是**：HTTP 调用与失败处理各自为政；
限流 `@Throttle` 覆盖不全（`ai.controller.ts` 11 条路由仅 4 条有）且阈值不统一（5/6/10/12/20/30/60）。

**后果**：前台 V3 要求的"AI 不可用时整块换成『什么不可用、还能做什么』"，
在服务端没有统一的可判定状态可供前端消费——每个能力的不可用表现都不一样。

#### 但是：项目里已经有一个做对了的样板

`services/api/src/contract-review/`（30+ 文件）是**唯一一个完整的 AI 编排实现**：

| 该有的能力 | contract-review 的实现 |
| --- | --- |
| 状态机 | `queued → extracting → rule_checking → ai_analyzing → safety_reviewing`（`contract-review-orchestrator.service.ts:28-30`） |
| 幂等去重 | `extractionFingerprint` + `FINGERPRINT_VERSION`（`:27`） |
| 执行预算 | `EXECUTION_BUDGET_MS = 5 * 60 * 1000`（`:26`） |
| PII 脱敏 | `contract-review-pii-masker.ts`（499 行，独立可测） |
| 规则先行 | `contract-review-rule-engine.ts` — 规则能判的不烧 token |
| 输出安全闸 | `contract-review-safety-gate.service.ts`（337 行） |
| 供应商适配 | `contract-review-provider.service.ts`（418 行） |
| 异步与重试 | `contract-review.queue.ts` / `.processor.ts`（BullMQ） |
| 保留期清理 | `contract-review.cleanup.task.ts` |
| 免责版本 | `disclaimerVersion` / `schemaVersion` 落在任务快照上 |

**这套东西是对的，问题只是它只服务一个业务。**
所以本方案的核心动作不是"新建 AI 中台"，而是**把这套抽出来给全站用**（§2.3）。

### 1.3 Partner 的商业化断点

Partner 13 个页面（侧栏 12 项 + 登录），3 个是诚实的空壳（写法本身合规、不造假，但功能确实缺位）：

| 路由 | 现状 | 证据 |
| --- | --- | --- |
| `/stats` 数据统计 | 空态："统计报表本阶段不开放" | `apps/partner/src/routes/stats/index.tsx`（20 行） |
| `/terminals` 终端数据 | 空态："终端明细暂由平台统一运营" | `apps/partner/src/routes/terminals/index.tsx`（15 行） |
| `/account` 账号权限 | 空态："账号与角色由平台侧统一管理" | `apps/partner/src/routes/account/index.tsx`（15 行） |

**侧栏 12 项里 3 项是死路（25%）。对付费机构是直接的可信度损失。**

更根本的三个断点：

1. **看不到效果。** 机构导入了 500 条岗位，不知道被浏览了多少次、多少人扫码去了来源平台、
   多少人打印了岗位资料。`BrowseLog` / `ExternalJumpLog` 有 `targetType`+`targetId`，
   但**没有 `sourceOrgId` 字段与索引**（`console-plan §6.9`），聚合归因做不了。
2. **5 类机构一套菜单。** `docs/product/partner-permission-matrix.md` 已经定义了
   `school_employment_center / public_employment_service / licensed_hr_agency / fair_organizer / enterprise_source`
   五类 × 六大类能力的完整矩阵，但 Partner 前端**没有实现任何差异化**——
   招聘会主办方看得到"政策公告管理"（矩阵里对它是 ❌），企业来源方看得到"招聘会管理"（❌）。
3. **机构侧零 AI。** 前台求职者用得上 30 个 AI 点，机构上传一批质量参差的岗位却没有任何 AI 辅助：
   字段缺失、薪资异常、疑似歧视表述、重复岗位——全靠管理员人工审核挡。
   而 `JobDataQualitySnapshot` 模型与 `GET /partner/jobs/quality-summary` 端点**已经存在**
   （`services/api/src/jobs/jobs.controller.ts:352`），前端只用了一个 93 行的小面板。

---

## 第二部分 · 架构裁决：要不要「AI 中台」

### 2.1 用户的原问题

> "你认为 AI 中台呢？或者是有什么更好的办法？"

先把"AI 中台"这个词拆开——它在业界通常指三件不同的事，代价差三个数量级：

| 读法 | 具体形态 | 代价 | 对本项目 |
| --- | --- | --- | --- |
| **① AI 中台 = 独立服务** | 新建 `services/ai-hub`，独立部署、独立库、跨服务 RPC，各业务通过网关调 | 新服务 + 新库 + 服务发现 + 分布式事务 + 双份可观测 + 双份部署 | ❌ **反对** |
| **② AI 中台 = 平台化产品** | 做成通用 LLMOps 平台（多租户、可视化编排、插件市场） | 相当于再造一个产品 | ❌ **反对** |
| **③ AI 中台 = 共享内核层** | 同进程内的 `ai-core` 模块：能力注册表 + 统一网关 + Prompt 库 + 脱敏/安全闸 + 计量账本 | 一个目录，零新部署 | ✅ **采用** |

### 2.2 裁决：采用 ③「AI 内核层」，不做 ①②

**理由（按重要性排序）：**

1. **不解决新问题，只增加新问题。** 硬伤 A–F 全部是"缺一层统一抽象"，
   不是"单体扛不住"。拆服务解决不了共用 feature key，只会让它变成跨服务的共用 feature key。
2. **CLAUDE.md §8 明令禁止。** "禁止为了看起来完整继续堆重复入口、占位页面、临时脚本"，
   §8.1 明确"不新增第二套项目标准"、"不把标准化执行变成大范围重写"。
   新建一个服务就是新建一套部署标准、一套配置标准、一套监控标准。
3. **当前上线阻塞项还没清。** `CLAUDE.md §15` 记录真实阶段是 **F1 D2′ 演练收口，`productionF1` 仍为 NO-GO**。
   此时引入新服务 = 把生产就绪的时间线再推后一个季度。
4. **样板已经在单体里跑通了。** `contract-review` 在同一个 NestJS 进程内完成了
   队列 / 状态机 / 脱敏 / 安全闸 / 保留期，证明单体完全扛得住 AI 编排。
5. **拆分的正确时机不是现在。** 当出现以下任一信号时再考虑独立服务：
   AI 调用量把 API 主进程的事件循环拖垮；需要 GPU/本地模型独立扩缩容；
   多产品线复用同一 AI 能力。目前一个都不成立。

> **一句话：中台要的是"统一"，不是"独立"。统一可以在一个进程里做完。**

### 2.3 `ai-core` 内核六件套

新增目录 `services/api/src/ai-core/`（同进程、同数据库、零新部署），
把 `contract-review` 已验证的模式泛化为六个共享组件：

```text
services/api/src/ai-core/
  registry/       ① 能力注册表 —— 一个 AI 能力 = 一条可配置记录
  gateway/        ② 调用网关   —— 全站唯一 LLM 出口
  prompts/        ③ Prompt 版本库 —— 入库、版本、灰度、回滚
  guard/          ④ 脱敏 + 安全闸 —— 进模型前脱敏，出模型后审查
  metering/       ⑤ 计量账本   —— 观测日志 + 不可丢失账本双写
  contract/       ⑥ 证据与降级契约 —— E1/E2/E3 与四态的服务端定义
```

#### ① 能力注册表（Capability Registry）

**替代** `AI_MODEL_FEATURES` 硬编码数组 + JSON 文件配置，改为**数据库表 + 缓存**。

一个 AI 能力一条记录，字段（新模型 `AiCapability`）：

| 字段组 | 字段 | 作用 |
| --- | --- | --- |
| 身份 | `key` / `label` / `domain` / `kioskPageRef` | 与前台 V3 页号（P01–P31）一一对应，可反查"这个能力长在哪个页面" |
| 模型绑定 | `vendor` / `model` / `baseURL` / `apiKeyRef` / `temperature` / `maxTokens` | 每个能力**独立绑定**，终结共用键 |
| Prompt | `promptTemplateId` / `promptVersion` / `canaryVersion` / `canaryPercent` | 指向 ③，支持灰度 |
| 证据 | `evidenceLevel`（E1/E2/E3）/ `requiresDisclaimer` | 服务端定义，前端只渲染，不自己编 |
| 降级 | `degradeStrategy`（`fallback_model` / `rule_only` / `disable`）/ `degradeMessage` | 对应前台"AI 不可用"态的文案来源 |
| 闸门 | `timeoutMs` / `maxRetries` / `dailyBudgetCny` / `perUserDailyLimit` / `perOrgDailyLimit` | 全部可配，不再散落在代码里 |
| 计费 | `billable` / `unitPriceCny` / `billingUnit`（`call`/`1k_token`/`minute`/`char`） | 为商业化预留，默认 `billable=false` |
| 开关 | `enabled` / `enabledScope`（全局 / 按机构 / 按终端 / 按场景模板） | 灰度与分级投放 |

**迁移策略（零行为变更）**：首次启动时把现有 7 个 feature key 的 JSON 配置导入为 7 条记录，
再把共用 `resume_optimize` 的 6 项能力各自**建独立记录、默认继承同一份配置**——
行为完全不变，但从此可以逐个改、逐个关、逐个计费。

#### ② 调用网关（Gateway）

**全站唯一的 LLM 出口。** 所有 `llm-*.service.ts` 不再自己 `getApiKey` + 拼请求，
改为 `aiGateway.invoke({ capabilityKey, input, ctx })`。

网关内部按固定顺序做八件事（借鉴 `contract-review-orchestrator`）：

```text
1. 取能力配置（registry）                  ← 配置错/未启用，此处 fail-closed
2. 额度预检（metering.reserve）            ← 事前闸门，解决硬伤 E
3. 幂等/缓存查询（inputFingerprint）       ← 命中直接返回，明确不重复扣费
4. 入参脱敏（guard.mask）                  ← 解决 PII 送模型问题
5. 规则前置（可选，规则能判的不烧 token）
6. 调模型（超时/重试/熔断/供应商故障切换）
7. 出参安全审查（guard.review）            ← 越界表述拦截
8. 落账（metering.commit）+ 写观测日志 + 返回带证据标注的结果
   失败路径：metering.release + 按 degradeStrategy 返回降级响应
```

**统一响应契约**（前端可直接消费，对应前台四态）：

```jsonc
{
  "ok": true,
  "capability": "resume_diagnosis",
  "evidence": "E3",                    // 前端据此决定是否加"AI 判断，仅供参考"
  "disclaimer": "AI 判断，仅供参考",
  "data": { /* 能力自己的结构化结果 */ },
  "degraded": false,
  "degradeReason": null,               // ai-down 时前端渲染"什么不可用、还能做什么"
  "alternatives": [ /* 降级后还能做什么 */ ],
  "meta": { "promptVersion": "v3", "cached": false, "latencyMs": 1840 }
}
```

#### ③ Prompt 版本库（Prompt Registry）

新模型 `AiPromptTemplate` + `AiPromptVersion`：
`templateKey / version / role(system|user) / body / variables[] / status(draft|active|canary|archived) / createdBy / activatedAt`。

- **服务端强制的结构化 prompt 仍然强制**——只是从"硬编码在 .ts 里"变成"入库 + 版本化 + 有审计"。
  `allowCustomSystemPrompt: false` 的语义改为"**管理员不可自由填写，但可以在受控版本之间切换与回滚**"。
- 灰度：`canaryVersion` + `canaryPercent`，按 `endUserId` 哈希稳定分流。
- 回滚：一键切回上一 `active` 版本，秒级生效，不发版。
- **红线不变**：防编造契约（不得编造学历/证书/公司/项目）作为**不可编辑的固定片段**注入每个版本，
  在 Admin UI 里只读展示，改不了。

#### ④ 脱敏 + 安全闸（Guard）

直接**复用并泛化** `contract-review-pii-masker.ts`（499 行，已有测试）与
`contract-review-safety-gate.service.ts`（337 行）。

- **入模型前**：姓名 / 手机号 / 身份证 / 邮箱 / 住址 / 学号占位化，
  出结果后按占位符回填（保证 AI 看不到真实 PII，用户看到的仍是自己的信息）。
- **出模型后**：越界表述拦截。本项目特有的违禁语义至少包括：
  「包过 / 保offer / 保录用 / 内推保证 / 代投简历 / 帮你投递 / 我们推荐给企业」——
  这些一旦从 AI 嘴里说出来就是**合规事故**（CLAUDE.md §2 红线）。
  命中即拦截 + 记录 + 走降级文案，绝不放行。

#### ⑤ 计量账本（Metering）

**双写，职责分离**：

| 表 | 性质 | 用途 | 写入语义 |
| --- | --- | --- | --- |
| `AiServiceLog`（已有，扩 `orgId`/`capabilityKey`） | 观测 | 运维、排障、趋势 | best-effort，失败不阻断（保持现状） |
| `AiUsageLedger`（新增） | 账本 | 配额、计费、对账、退款 | 事务内写，失败即失败，**不可丢** |

`AiUsageLedger` 关键字段：
`id / capabilityKey / orgId / terminalId / endUserId / idempotencyKey /
state(reserved|committed|released) / tokensIn / tokensOut / costCny / cachedHit / createdAt / settledAt`

- **`reserve → invoke → commit / release` 三段式**，解决"先花钱后核销"的时序问题。
- **缓存命中显式不扣费**（`cachedHit=true` 时 `costCny=0`），不依赖幂等键的偶然正确。
- `orgId` 从终端归属反查（`Terminal.orgId`），补齐硬伤 D。

#### ⑥ 证据与降级契约（Contract）

把前台 V3 的三条硬约束**在服务端固化**，前端只做渲染：

- **证据分级**：E1（用户数据事实）/ E2（系统设备来源事实）/ E3（模型判断）。
  E3 强制携带 `disclaimer`；**无 E1/E2 支撑的响应不得使用祈使句**——
  网关在出参审查阶段校验，违反则降级为陈述式表达。
- **四要素建议**：`action / reason / cost / alternatives` 四个字段**缺一即不返回建议块**
  （返回 `advice: null` + `degradeReason`），从根上杜绝"无理由的智能推荐"。
- **降级响应**：`degraded=true` 时必须带 `degradeReason` + `alternatives`，
  让前端能渲染"什么不可用、还能做什么"，而不是一个空的 AI 壳子。

### 2.4 内核落地后，两个后台各自"管什么"

```text
                    ┌─────────────────────────────────┐
                    │      ai-core（新增内核层）        │
                    │  注册表 / 网关 / Prompt / Guard   │
                    │  / 计量账本 / 证据降级契约         │
                    └───────────┬─────────────────────┘
                                │ 同一份配置与账本
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
      ┌────────────┐    ┌──────────────┐   ┌─────────────┐
      │  Kiosk 前台 │    │  Admin 后台   │   │ Partner 后台 │
      │  30 个 AI 点│    │  管"怎么跑"   │   │ 管"我的内容" │
      │  消费能力    │    │  能力/成本/质量│   │ 效果/质检/账单│
      └────────────┘    └──────────────┘   └─────────────┘
```

- **Admin = AI 的运行控制台**：能力开关、模型路由、Prompt 版本与灰度、成本与预算、
  质量抽检、事故降级、合规拦截审计。
- **Partner = 机构的价值控制台**：我的内容效果、AI 内容质检、AI 内容助手、
  资质与合规、账单与用量。**机构永远不碰求职者数据**（红线不变）。

---

## 第三部分 · Admin 升级：从表格后台到 AI 运营控制台

### 3.0 Codex 交叉审查补充的关键实证

以下问题由 Codex（gpt-5.6-sol / xhigh）独立复核发现，本方案的 Admin 设计直接针对它们：

| # | 问题 | 证据 | 严重度 |
| --- | --- | --- | --- |
| X1 | **Admin「连通性测试」会先覆盖线上配置再测试** —— 点一下测试就改了生产 | `apps/admin/src/routes/ai-config/index.tsx:119-150` | 🔴 高 |
| X2 | `getUsage(providerName)` **实际没有按 provider 过滤**，Admin「当前 Provider」统计混合了全部 provider | `services/api/src/ai/ai-log.service.ts:375-384` | 🔴 高（数据错误） |
| X3 | **自我探索在 LLM 不可用时仍返回「完成」状态与确定性分数** —— 违反 CLAUDE.md §9「不伪造能力」 | `services/api/src/ai/resume/llm-self-assessment.service.ts:106-119` | 🔴 高（合规） |
| X4 | 简历诊断主链路**根本不解析上游 usage**，token 与成本完全不可见 | `services/api/src/ai/resume/llm-resume.service.ts:230-239` | 🟠 中 |
| X5 | 合同审查**完全未进入公共计量**；`AiOperation` 枚举也没有合同与海报 | `contract-review-provider.service.ts:88-91`、`ai-log.service.ts:23-41` | 🟠 中 |
| X6 | 成本阈值**只告警不阻断**，没有任何硬闸门 | `services/api/src/ai/ai-log.service.ts:450-480` | 🟠 中 |
| X7 | AI 助手会话只存进程内 `Map`，**重启即丢、不可追溯**，投诉无从查起 | `services/api/src/ai/llm/llm-chat.service.ts:193-239` | 🟠 中 |
| X8 | 模拟面试把简历文本以 `resumeDigest` **明文落库**再发给 LLM | `mock-interview.service.ts:82-110`、`mock-interview-llm.service.ts:129-140` | 🟠 中（隐私） |
| X9 | 助手 HTTP 调用**没有 AbortController / 超时 / 重试**；面试同样无超时 | `llm-chat.service.ts:253-294`、`mock-interview-llm.service.ts:272-311` | 🟠 中 |
| X10 | 岗位匹配每次都新建 session 并扣配额，**相同输入重复烧钱** | `governed-job-fit.service.ts:123-157` | 🟡 低（成本） |

> X1/X2/X3 三条是**当前 Admin 页面就能暴露的真实缺陷**，不需要等 AI 中台，属于本轮必修。

### 3.1 新 IA：7 域，但**不新增导航项**

> ⚠️ **本节已按 Codex 复核结论重写（2026-08-11）**。
> 初稿曾提议「AI 中枢域 6 个新页面 + 服务运营域新增面试训练运营」，
> Codex 复核判定**应新增 0 页**，理由见 §3.2 与 §3.3。现行结论以本节为准。

```text
运营总览    工作台
AI 中枢     AI大模型(/ai-config) / AI服务管理(/ai-services)   ← 只是把这 2 页从「业务管理」移到本域并大幅扩能
服务运营    打印扫描运维 / 招聘会运营 / 求职材料库
内容与来源  内容审核中心(M2) / 数据接入(M3) / 企业展示管理
会员与交易  用户管理 / 订单与计费(M4) / 权益运营(M5) / 会员沟通(M6)
终端运营    设备管理(含外设Tab) / 告警中心 / 宣传屏 / 百宝箱 / 智慧校园
机构与治理  合作机构 / 线下机构 / 文件治理 / 数据权利工单(M1) / 法务文档版本 / 日志审计
```

原计划的 6 个 AI 中枢页面，**全部并入现有两页**：

| 原计划新页 | 实际落点 |
| --- | --- |
| A1 AI 能力注册表 | `/ai-config` 主体（能力清单 + 详情抽屉） |
| A2 Prompt 版本与灰度 | `/ai-config` 详情抽屉的「Prompt 版本」Tab |
| A3 AI 质量抽检 | `/ai-services` Tab 2 |
| A4 AI 成本与预算 | `/ai-services` Tab 1（现有内容升级） |
| A5 AI 事故与降级 | `/ai-services` Tab 3 |
| A6 AI 合规拦截 | `/ai-services` Tab 4 |
| A7 面试训练运营 | `/ai-services` Tab 5（见 §3.3） |

**路由不变**：仍是 `/ai-config` 与 `/ai-services`，无需重定向。

净变化：**25 → 25 项**（导航项数不变，只做分域重排 + 现有 2 页扩能）。

### 3.2 AI 能力治理的 6 块内容详细设计

> 下面 A1–A6 是**内容模块**，不是独立页面。落点见 §3.1 的对照表。

---

#### A1 · AI 能力注册表 `/ai/capabilities`

> **一句话**：全站每一个 AI 点在这里有且只有一行，可开关、可换模型、可换 Prompt 版本、可设预算。

**解决**：硬伤 A（7 个键管 30 个点、6 项能力共用一键）、X1（测试即改线上）。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 顶部概览条 | 已注册能力数 / 启用中 / 降级中 / 今日调用 / 今日成本 / 预算使用率 |
| 域筛选 | 按前台八域筛（打印扫描 / 简历 / 岗位 / 招聘会 / 面试 / 政策 / 我的 / 顾问）+ 状态筛 |
| 能力表格 | 每行：能力名 · **前台页号(P01–P31)** · 域 · 供应商/模型 · Prompt版本(+灰度标) · 证据等级 · 状态 · 今日调用/成本 · 开关 |
| 详情抽屉 | 六个 Tab：**基本信息 / 模型绑定 / Prompt / 闸门与预算 / 降级策略 / 变更历史** |

**详情抽屉关键设计**

- **模型绑定 Tab**：供应商 + 模型 + baseURL + API Key（只写不回显）+ 温度 + maxTokens。
  **「测试连通性」必须走影子调用**：用表单里的临时参数试跑，**不写入线上配置**（修 X1）。
  测试结果展示：延迟 / 返回样例 / token 用量 / 估算单价。
- **Prompt Tab**：当前生效版本 + 版本下拉 + 「查看 diff」+ 「回滚到上一版」。
  **不可编辑的固定片段**（防编造契约、合规禁令）灰底只读展示，标注「服务端强制，不可修改」。
- **闸门与预算 Tab**：超时 / 重试次数 / 熔断阈值 / 日预算(¥) / 单用户日限 / 单机构日限 /
  **超额动作**（继续但告警 / 降级 / 硬拦截）——修 X6。
- **降级策略 Tab**：`fallback_model` / `rule_only` / `disable` 三选一 +
  **降级文案编辑框**（这段文案直接渲染到前台"什么不可用、还能做什么"）+ 备选动作配置。
- **变更历史 Tab**：谁在什么时候改了什么（`AuditLog` 关联），可回滚。

**共用键解绑向导（一次性）**：页面顶部横幅提示"检测到 6 项能力共用 `resume_optimize` 配置"，
点击进入向导：展示 6 项清单 → 一键"拆分为独立配置（继承当前值）" → 拆完横幅消失。
**拆分后行为完全不变**，只是从此可以逐个改。

**数据来源**：`GET/PATCH /admin/ai/capabilities`、`POST /admin/ai/capabilities/:key/test`（影子测试）、
`POST /admin/ai/capabilities/split-shared-key`。

---

#### A2 · Prompt 版本与灰度 `/ai/prompts`

> **一句话**：改一句提示词不用发版，改错能一键回滚，改之前能小流量试。

**解决**：硬伤 C（12 个 service 硬编码 prompt）。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 左栏模板列表 | 按能力分组，显示当前 active 版本号 + 是否有灰度中版本 |
| 右栏版本时间线 | v1 → v2 → v3(active) → v4(canary 10%)，每版：作者 / 时间 / 变更说明 / 状态 |
| 编辑器 | 双栏 diff（左=当前 active，右=编辑中）；变量占位符高亮（`{{resumeText}}` 等）；字符数与预估 token |
| 固定片段区 | 只读灰底：防编造契约 / 合规禁令 / 输出结构约束（服务端强制注入，管理员改不了） |
| 灰度控制 | 流量百分比滑块 + 分流维度（按用户哈希 / 按终端 / 按机构）+ 对照指标 |
| 效果对比 | active vs canary：成功率 / 平均延迟 / 平均 token / 安全闸拦截率 / 人工抽检评分 |

**发布流程（强制）**：`草稿 → 试运行(影子调用，不影响用户) → 灰度(可设 %) → 全量 → 归档`，
每一步落审计。**全量发布需二次确认**，确认框展示 diff 摘要。

**红线**：编辑器**不允许**删除固定片段；提交时服务端校验，缺片段直接 422。

**数据来源**：`GET/POST /admin/ai/prompts`、`POST /admin/ai/prompts/:id/versions`、
`POST /admin/ai/prompts/:id/publish`、`POST /admin/ai/prompts/:id/rollback`。

---

#### A3 · AI 质量抽检 `/ai/quality`

> **一句话**：AI 说了什么，人要抽着看；说错了要有地方记，记完要能变成下一版 Prompt。

**解决**：AI 输出质量目前**零监督**——没有任何人工回路。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 抽检队列 | 按能力/时间/异常信号（超长/超短/安全闸命中/用户重试/用户放弃）自动采样 |
| 评审工作台 | 左=脱敏后的输入摘要，右=AI 输出；评分维度：**准确性 / 有用性 / 越界 / 幻觉 / 语气**（1–5 分 + 标签） |
| 问题标记 | 一键打标：`编造事实` / `越界承诺` / `答非所问` / `格式错误` / `歧视表述` / `其他` |
| 归因 | 标记后自动关联 `promptVersion` + `model`，聚合成"某版本某模型的问题分布" |
| 转化 | 「据此提 Prompt 改进」按钮 → 带着问题样本跳到 A2 新建草稿版本 |

**隐私红线**（对齐 `ai-services` 现有口径 + X8）：
抽检台**只展示脱敏后的输入摘要**（PII 已占位化），绝不展示简历正文原文、聊天原文、文件名、fileId。
访问抽检台必须记审计日志（谁在什么时候看了哪条）。

**数据来源**：`GET /admin/ai/quality/samples`、`POST /admin/ai/quality/samples/:id/review`、
`GET /admin/ai/quality/stats`。

---

#### A4 · AI 成本与预算 `/ai/cost`（由现 `/ai-services` 升级）

> **一句话**：钱花在哪、还剩多少、超了怎么办——三个问题一页答完。

**解决**：硬伤 D/E（无 orgId、无账本、无硬闸）、X2（provider 统计错误）、X4/X5（计量缺口）。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 预算卡片组 | 全站日预算 / 已用 / 剩余 / 预计耗尽时间；红黄绿三态 |
| 多维下钻 | **按能力 / 按机构(orgId) / 按终端 / 按供应商模型 / 按时段** 五个维度切换 |
| 成本趋势 | 折线：调用量 · 成本 · 缓存命中率 · 降级率（四条线同图，能一眼看出"降级省了多少钱"） |
| 异常榜 | 成本突增 Top / 失败率突增 Top / 延迟劣化 Top，每条可一键跳 A1 调闸门 |
| 账本对账 | `AiUsageLedger` 与 `AiServiceLog` 的差异清单（观测 vs 账本不一致要能查） |
| 不可估算标注 | ASR 按时长、TTS 按字符——保持现有诚实口径「按量计费 · 未估算」，**绝不显示 ¥0.0000** |

**必修项**：
- 修 X2：`getUsage` 加真实 provider 过滤，或页面明确标注"全 provider 合计"。
- 修 X4/X5：诊断链路解析 usage；合同与海报进 `AiOperation` 枚举。
- 补 X6：预算超额动作可配（告警 / 降级 / 硬拦截），页面能看到"今天因超额被拦了多少次"。

**数据来源**：`GET /admin/ai/cost/overview`、`GET /admin/ai/cost/breakdown?dim=capability|org|terminal|model`、
`GET /admin/ai/cost/ledger-diff`、`PATCH /admin/ai/budget`。

---

#### A5 · AI 事故与降级 `/ai/incidents`

> **一句话**：AI 挂了，运营要在用户投诉之前知道，并且知道现在前台正在显示什么话。

**解决**：硬伤 F（降级各写各的，无统一可判定状态）、X9（无超时无重试）。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 实时健康墙 | 30 个能力的方块矩阵，绿/黄/红（正常/降级/不可用），悬停看详情 |
| 前台镜像 | **「用户现在看到的是这句话」**——直接渲染当前降级文案，所见即所得 |
| 事故时间线 | 开始时间 / 影响能力 / 影响用户数 / 触发原因 / 自动动作 / 恢复时间 |
| 供应商状态 | 各供应商的成功率/延迟/熔断状态；一键切换备用供应商 |
| 一键演练 | **降级演练开关**：手动把某能力置为 ai-down，验证前台四态是否正确降级（演练不影响真实用户，只对指定终端生效） |
| 手动接管 | 紧急停用某能力 / 全站 AI 熔断（保留"本机打印扫描浏览永远可用"红线） |

**设计要点**：前台 V3 规定"AI 不可用时整块换成『什么不可用、还能做什么』"，
这页就是那句话的**唯一编辑与验证入口**。演练能力是商用产品的必需——
上线前必须能证明 30 个页面在 AI 挂掉时都不会白屏或假装正常。

**数据来源**：`GET /admin/ai/health`、`GET /admin/ai/incidents`、
`POST /admin/ai/capabilities/:key/degrade`、`POST /admin/ai/drill`。

---

#### A6 · AI 合规拦截 `/ai/compliance`

> **一句话**：AI 有没有说过不该说的话——这是本项目最贵的风险，必须有专页。

**解决**：项目最大的合规风险是 AI 从嘴里说出招聘闭环承诺（CLAUDE.md §2 红线），
目前**没有任何拦截记录面**。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 拦截总览 | 今日/本周拦截次数、按规则分布、按能力分布、趋势 |
| 违禁词库 | 分级管理：**红线级**（包过/保offer/保录用/代投简历/帮你投递/推荐给企业）= 硬拦截；**警示级**（一定能/绝对/保证）= 改写；**观察级** = 只记录 |
| 拦截明细 | 时间 / 能力 / 命中规则 / 处置（拦截·改写·放行）/ 用户看到的替代文案；输入输出**只显示脱敏摘要** |
| 误杀复核 | 运营可标记"误杀"，累计误杀率高的规则自动提示调整 |
| 证据分级审计 | E3 输出是否都带了免责声明？**无 E1/E2 支撑却用了祈使句**的响应清单 |
| 规则测试台 | 输入一段文本，实时看命中哪些规则、会被怎么处置 |

**这一页的价值**：出事时这是**唯一能自证"我们做了防控"的证据链**。
对政府项目与招投标是硬性加分项。

**数据来源**：`GET /admin/ai/compliance/rules`、`PATCH /admin/ai/compliance/rules/:id`、
`GET /admin/ai/compliance/hits`、`POST /admin/ai/compliance/test`。

---

### 3.3 A7 · 面试训练运营 → **并入 `/ai-services` 第 5 个 Tab，不新建页**

> ⚠️ **本节已按 Codex 复核结论重写（2026-08-11）**。初稿提议新建 `/interview-ops`，已否决。

**初稿的理由**：`mock-interview.controller.ts` 有 12 条路由，而
`grep -rin "interview" apps/admin/src/` 零命中——「后端有完整能力，后台完全看不见」。

**Codex 复核否掉了这个理由**：那 12 条路由
（`mock-interview.controller.ts:87,241`）**全部是求职者本人的会话与历史接口**，
受会员本人权限保护，**不是 Admin 题库或运营接口**——
Admin 不该复用它们去看个人面试内容。所谓「后端已有能力」并不成立。

**同时**：`ai-services/index.tsx:42` 已把面试出题、面试报告、ASR、TTS 纳入 AI operation 分类，
**运营视角本就该长在那一页**。

**落点**：`/ai-services` 第 5 个 Tab「面试训练」，内容为
会话概览（场次/完成率/中断率）· 成本（含结构校验重试的 token）· 语音能力健康（ASR/TTS）·
异常会话（**只看元数据，不看面试内容**）。

**前置依赖**：先补齐模拟面试的 AI 日志——Codex 实证终端维度固定为空
（`mock-interview.service.ts:404-424`），不补则按终端下钻做不出来。

**何时才值得拆成独立页**：出现独立的题库版本管理、场景模板、发布审批、
会话事故处置流程与专属权限时。目前一个都不成立。

**题库管理去哪了**：初稿写的「题库增删改 + AI 生成候选题」**当前没有后端支撑**
（现有路由里没有题库 CRUD），属于新建能力而非接线，不在本轮范围。
真要做需单独立项，届时再评估是否值得拆页。

### 3.4 现有页面的 AI 增强（不新建页，只加区块）

| 现有页 | 加什么 | 为什么 |
| --- | --- | --- |
| 工作台 `/` | **AI 异常归因卡**：今天最值得看的 3 件事（成本突增/失败率异常/审核积压/设备离线），每条带一句理由 | 运营打开后台第一眼应该看到"要我做什么"，不是 12 个数字 |
| 内容审核中心 | **AI 预审分**：每条待审内容给出风险分 + 命中项（缺字段/薪资异常/疑似歧视词/重复），高分自动排前 | 人工审核是当前最大的人力瓶颈 |
| 告警中心 | **AI 归因与建议处置**：同类告警聚合，给出"可能原因 + 建议动作"（E2 级，基于设备事实） | 告警太多等于没有告警 |
| 设备管理 | **AI 故障预测**（可选，二期）：基于历史卡纸/缺纸/离线模式，提示"这台机器可能要缺纸了" | 一体机运维是重资产运营的成本大头 |
| 用户管理 | **AI 服务使用画像**（聚合，不看个人内容）：哪些能力被高频使用、哪些从没人用 | 决定砍哪些功能、推哪些功能 |
| 日志审计 | **AI 操作检索**：自然语言查审计日志（"上周谁改过打印价目"） | 审计日志现在只能靠筛选器翻 |

### 3.5 Admin 侧接口对齐表（新增端点清单）

> A1–A7 是 `/ai-config` 与 `/ai-services` 两页内的模块，**不是 7 个新页面**。

| 页面 | 端点 | 方法 | 说明 |
| --- | --- | --- | --- |
| A1 | `/admin/ai/capabilities` | GET | 能力列表（含状态、今日用量） |
| A1 | `/admin/ai/capabilities/:key` | GET/PATCH | 单能力详情与更新 |
| A1 | `/admin/ai/capabilities/:key/test` | POST | **影子测试**，不写线上配置 |
| A1 | `/admin/ai/capabilities/split-shared-key` | POST | 共用键解绑向导 |
| A2 | `/admin/ai/prompts` | GET/POST | 模板列表与新建 |
| A2 | `/admin/ai/prompts/:id/versions` | GET/POST | 版本列表与新建草稿 |
| A2 | `/admin/ai/prompts/:id/publish` | POST | 发布（草稿→灰度→全量） |
| A2 | `/admin/ai/prompts/:id/rollback` | POST | 回滚到指定版本 |
| A3 | `/admin/ai/quality/samples` | GET | 抽检样本队列（脱敏） |
| A3 | `/admin/ai/quality/samples/:id/review` | POST | 提交评分与标记 |
| A3 | `/admin/ai/quality/stats` | GET | 质量统计与归因 |
| A4 | `/admin/ai/cost/overview` | GET | 预算与总览 |
| A4 | `/admin/ai/cost/breakdown` | GET | 五维下钻 |
| A4 | `/admin/ai/cost/ledger-diff` | GET | 账本对账差异 |
| A4 | `/admin/ai/budget` | PATCH | 预算与超额动作配置 |
| A5 | `/admin/ai/health` | GET | 30 能力健康墙 |
| A5 | `/admin/ai/incidents` | GET | 事故时间线 |
| A5 | `/admin/ai/capabilities/:key/degrade` | POST | 手动降级/恢复 |
| A5 | `/admin/ai/drill` | POST | 降级演练（限定终端） |
| A6 | `/admin/ai/compliance/rules` | GET/PATCH | 违禁词库分级管理 |
| A6 | `/admin/ai/compliance/hits` | GET | 拦截明细 |
| A6 | `/admin/ai/compliance/test` | POST | 规则测试台 |
| A7 | `/admin/ai/interview/overview` | GET | 面试运营总览（挂 `/ai-services` Tab 5，**不是独立页**） |

---

### 3.6 Admin 的「商用运营」缺口（Codex 复核发现，非 AI 但影响商业完整性）

用户要求"最后的效果一定是完整的一个商业性产品"。Codex 独立盘点后指出：
**Admin 目前是「设备与基础业务管理后台」，还不是「商用一体机运营治理后台」。**
最大缺口不在页面数量，而在五条闭环。按优先级列出（本方案只做设计登记，实施排在 AI 中枢之后）：

| 闭环 | 缺什么 | 证据 | 建议阶段 |
| --- | --- | --- | --- |
| **① 售后与工单** | 告警只实时派生，**无确认/指派/静默/升级/SLA/恢复记录**；反馈无工单、无责任归属、无赔付审批、无回访仲裁 | `alerts/index.tsx:78-80`、`member-feedback/index.tsx:156-157` | P1 |
| **② 远程运维** | ⚠️ **已有**终端生命周期操作（维护/暂停/恢复/退役/紧急吊销，`TerminalLifecycleActions.tsx:42,82`）。**缺的是**：远程重启、Agent OTA、日志采集、屏幕快照、配置批量下发与回滚；智慧校园无终端组与灰度 | `TerminalLifecycleActions.tsx:42,82`、`smart-campus/index.tsx:39-45` | P1 |
| **③ 财务结算** | ⚠️ **已有**真实价目配置 + 本地应收退款对账 + 差异清单（`billing/index.tsx:240`）。**缺的是**：支付渠道/商户号/渠道账单/结算周期/发票税务/财务审批；扫描等非打印服务的价格与阶梯价 | `billing/index.tsx:240`、`print-scan/index.tsx:727` | P1（商业化前置） |
| **④ 租户与项目治理** | `/permissions` 是空壳，**无 RBAC、无租户隔离、无职责分离**；无加盟商合同/授权区域/保证金/续约；无政府项目档案/预算/里程碑/验收 | `permissions/index.tsx:5-12`、`partners/index.tsx:482-483,552-599` | P1（多场景经营前置） |
| **⑤ 隐私与内容治理** | ⚠️ **已有** PII 规则扫描 + 命中落库 + 保留/遮挡决策（`materials/pii-scan.util.ts:164`、`materials.service.ts:216`、Kiosk `PrintMaterialCheckPage.tsx:393`）。**缺的是**：真正生成遮挡文件（当前 `redactedFileId:null`）、Admin 误判复核、恢复授权；**法务文档缺编辑与回滚**（⚠️ 更正：新建 `@Post()` 与激活 `@Patch(:id/activate)` **已存在**，`admin-legal-docs.controller.ts:22,34`）；隐私工单不能真正完成导出删除注销 | `files/index.tsx:143-159`、`admin-legal-docs.controller.ts:16-34`、`privacy-requests/index.tsx:222-237,434-436` | P0（合规） |

另有若干**小而具体的真实缺陷**，建议随本轮一并修：

- `job-materials`：模板内容写死在代码里，后台只能看不能维护（`job-materials/index.tsx:53-55`）。
- `printers`：只读心跳，**没有任何打印机配置操作**（`printers/index.tsx:68-74`）。
- `devices` 的外设 Tab、`/peripherals`：摄像头/扫码枪等**无上报也无配置后端**（`peripherals/index.tsx:4-10`）。
- `account-settings`：手机绑定只能"联系管理员"，无自助闭环（`account-settings/index.tsx:3-138`）。
- 非 HTTP 模式下 `sync-sources` / `printers` / `terminals` / `audit` 会显示 mock 演示数据——
  **上线前必须确认生产环境不会落到该分支**（`sync-sources/index.tsx:79-140` 等）。

---

### 3.6B Codex 终审发现的三条真遗漏（方案与原型双双漏掉）

> 这三条不同于 §3.6——§3.6 是「方案已承认缺失但未展开」，
> 这三条是**我和原型都完全没想到**的。

#### 遗漏 ① 机构资质的 Admin **审核动作** —— ⚠️ **表述已更正（2026-08-11）**

> **初稿写「完全没有设计平台侧怎么核验」——这是错的，部分能力已存在。** 核实后：

| 能力 | 现状 |
| --- | --- |
| 资质列表查询 | ✅ **已有** `GET admin/recruitment-content/organizations/:orgId/qualifications` |
| 资质详情 | ✅ **已有** `GET .../qualifications/:id` |
| 证件原件访问 | ✅ **已有** `GET .../qualifications/:id/evidence-access` |
| **审核动作（通过/驳回/要求补件）** | ❌ **确实没有**——三个端点全是 `@Get` |
| 到期通知与内容恢复 | ❌ 没有 |

**真正缺的只是审核动作与到期联动，不是「整个 Admin 端」。**

**落点更正**：**不要新建 `/admin/qualifications`**——那会与现有
`admin-recruitment-content.controller.ts` 形成第二套语义路由（两套鉴权、DTO、审计入口）。
正确做法是**在现有 controller 上加审核动作**。

**状态取值更正**：`QualificationRecord.status` 的实际取值是
`pending | valid | expired | revoked | rejected`（`recruitment-content-read.service.ts:367` 用 `status === 'valid'` 判定有效），
**不是** `approved`。规格里的状态机需按此改写。

**归属**：仍是 S6 的前置。

#### 遗漏 ② 账号安全能力的**补强** —— ⚠️ **表述已更正（2026-08-11）**

> 初稿写「完全没有账号安全中心」——**过头了**。核实后：

| 能力 | 现状 |
| --- | --- |
| 强密码修改（当前密码校验） | ✅ 已有（`account-settings/index.tsx:125`） |
| 全会话失效 | ✅ 已有（`account-settings/index.tsx:310`，`tokenVersion` 机制） |
| 登录记录 | ✅ 已有 |
| 高风险操作挑战 | ✅ 已有（`partner-account-action.controller.ts:37`） |
| 手机绑定与安全转移 | ✅ 已有（`AdminInitialPhoneBindingCard.tsx:54`） |
| **MFA / 二次验证** | ❌ 缺 |
| **活动会话与设备管理**（逐个撤销） | ❌ 缺（只能全部失效） |
| **异常登录检测与告警** | ❌ 缺 |
| **IP 白名单** | ❌ 缺 |
| **API Token 与密钥轮换审计** | ❌ 缺 |

**归属**：S7，优先级仍高于财务结算，但工作量比初稿判断的小得多。

#### 遗漏 ③ 设备资产的**后半段** —— ⚠️ **表述已更正（2026-08-11）**

> 初稿写「完全没有设备资产管理」——**错了，生命周期是有的**。核实后：

| 能力 | 现状 |
| --- | --- |
| 设备资产预创建 | ✅ 已有（`CreatePlannedTerminalDialog.tsx:28`） |
| 生命周期状态机 | ✅ **已有完整链路**：`planned → commissioning → active → maintenance/suspended → retired`（`TerminalLifecycleActions.tsx:16`） |
| **采购与入库** | ❌ 缺 |
| **序列号与保修期** | ❌ 缺 |
| **巡检与维修记录** | ❌ 缺 |
| **备件库存** | ❌ 缺 |
| **纸张/碳粉库存与补货单** | ❌ 缺（且余量数值本身也读不到，见 §10.4） |

**归属**：S7，与「远程运维」合并考虑。**缺的是资产台账与耗材，不是生命周期。**

---

## 第四部分 · Partner 升级：从数据搬运工到机构增长控制台

> 用户原话："我发现机构段目前的功能是不是太少了"——**是的，而且不只是少，是缺了"机构为什么要续费"的那一层。**

### 4.1 定位重述

Partner 后台现在回答的问题是：**"我怎么把数据传上去？"**
Partner 后台应该回答的问题是：**"我传上去的东西，值不值？"**

四个层次，缺一层机构就留不住：

```text
第 4 层  机构账户  ← 商业关系：资质·账单·子账号·工单        【全缺】
第 3 层  我的助手  ← 降低门槛：AI 质检·AI 映射·提交前预审     【全缺】
第 2 层  我的效果  ← 续费理由：曝光·覆盖·健康度               【全缺】
第 1 层  我的内容  ← 已有：岗位/招聘会/政策/企业/数据源/同步日志【已有】
```

**当前只有第 1 层。** 这就是"功能太少"的准确诊断——不是页面数少，是**价值链只做了最底下一层**。

### 4.1B Codex 复核补充：Partner 的实证缺口

Codex 独立盘点 Partner（gpt-5.6-sol / xhigh）后的判定：
对照 CLAUDE.md §9A 的十个模块，**已实现 5 项、半实现 2 项、缺失 3 项**。
另有以下实证，直接改变本方案的实施优先级：

| # | 发现 | 证据 | 对方案的影响 |
| --- | --- | --- | --- |
| **Y1** | 🔴 **`GET /partner/stats?period=week\|month\|quarter` 后端早就有，前端一行没调** | `services/api/src/orgs/partner-stats.controller.ts:28-35` vs `routes/stats/index.tsx:10-17` | **B1 内容效果页可以立刻起步**，不必等归因改造，先把已有统计接上，再补漏斗与归因 |
| Y2 | 数据源**生命周期不完整**：无编辑、删除、手动同步、凭证轮换、连接测试 | `routes/sources/index.tsx:449-484` | 新增 §4.4B「数据源生命周期补全」 |
| Y3 | 同步失败**无恢复工具**：不能重试失败批次、不能下载错误文件、不能逐条修复回放 | `routes/sync-logs/index.tsx:142-190` | 同上 |
| Y4 | **招聘会现场资料交给管理员**，主办方不能自己维护展位图/参展企业/议程/交通指引 | `routes/fairs/index.tsx:361-362` | 新增 §4.4C「招聘会主办方作战室」——这是 `fair_organizer` 最核心的付费理由 |
| Y5 | **院校迎新内容无 CMS**：报到流程、办事窗口、官方链接均不可录入 | `routes/smart-campus/index.tsx:260-270` | 智慧校园页增强（`school` 专属） |
| Y6 | **无批量运营**：只能单行编辑，不能批量改状态、定时上下架、保存版本 | `routes/jobs/index.tsx:360-376`、`routes/fairs/index.tsx:333-350` | 大型机构的硬需求，列入 §4.4B |
| Y7 | **无自助数据导出**：岗位/招聘会/同步错误/审计凭证都导不出 | `routes/sync-logs/index.tsx:96-157` | 机构内部汇报与留档必需 |
| Y8 | **无消息路由**：审核驳回、同步失败、终端离线、凭证异常只能逐页自己找 | `routes/index.tsx:24-35` | 印证 D4 通知与工单的必要性 |
| Y9 | 账号高风险操作（挑战验证 / 手机换绑 / 账号删除）**后端 9 个端点已存在，但整个 controller 锁死为 `admin` 角色** | `services/api/src/orgs/partner-account-action.controller.ts:27-30,37-134` | D3 落地时需**先决定是否放开机构自助**（安全评估），不是简单接线 |
| Y10 | 岗位管理**无详情路由**，也未展示来源机构名称，未完全满足 CLAUDE.md §10 数据边界要求 | `routes/index.tsx:24-35`、`routes/jobs/index.tsx:318-390` | 内容管理组需补岗位详情页 |

> Codex 同时确认：`jobs.controller.ts` 范围内的 partner 端点（数据源/岗位/招聘会/工作台/同步日志/Excel 六件套）
> **前端全部已接，无遗漏接线**。所以 Partner 的问题不是"接口没接"，而是**能力层级不够**——
> 印证了 §4.1 的四层诊断。

### 4.2 新 IA：5 组 13 项（**导航项数不变**，3 个空壳变真 + 现有页加 Tab）

> ⚠️ **本节已按 Codex 复核结论重写（2026-08-11）**：初稿提议新增 5 项（含 `/tickets`），
> 复核后全部并入现有页——资质合规与账单并入 `/profile` 的 Tab，
> 通知与工单并入 `/account` 的 Tab，内容健康度并入 `/jobs` 的 Tab。**新增 0 页。**

```text
工作台        工作台（AI 每日要点）🔧

内容管理      岗位信息 🔧 / 招聘会管理 🔧 / 政策公告 / 企业展示 / 智慧校园

数据接入      数据源 🔧 / 导入记录 🆕 / 同步日志

效果分析 🆕   内容效果 🆕(替换 /stats 空壳) / 终端覆盖 🆕(替换 /terminals 空壳) / 内容健康度 🆕

机构账户      机构资料 🔧(加资质/账单 Tab) / 账号与日志 🔧(替换 /account 空壳，含通知与支持 Tab)
```

🔧 = 现有页增强（含填充空壳与加 Tab）　**没有全新页**

**并且：侧栏按机构类型投影**（见 §4.6），5 类机构看到的项数不同——
`enterprise_source`（企业来源方）大约只看到 9 项，`public_employment_service`（公共就业服务）看到全部 13 项。

### 4.3 第 2 层「我的效果」——机构续费的唯一理由

#### B1 · 内容效果 `/effect`（替换 `/stats` 空壳）

> **一句话**：我发的岗位/招聘会，有多少人看了、多少人去了来源平台、多少人打印了。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 效果概览卡 | 在架内容数 / 累计曝光 / 详情浏览 / 外部跳转 / 相关打印，均带环比 |
| 转化漏斗 | **列表曝光 → 详情浏览 → 外部跳转（扫码/去来源平台）→ 资料打印**，逐级转化率 |
| 内容排行 | Top 20 / Bottom 20 岗位与招聘会，可按曝光/浏览/跳转排序；Bottom 直接跳"内容健康度"看为什么没人看 |
| 时段与终端分布 | 按小时/星期的热力图 + 按终端点位的聚合分布（不含终端运维信息） |
| 对比 | 本机构 vs 同类机构**匿名分位**（"你的详情浏览率在同类机构中位于前 30%"） |
| 导出 | 导出 PDF 月报（可直接给机构领导汇报——这是**机构真正会用的东西**） |

**合规红线（必须写进实现约束）**：
- 只给**聚合数据**，绝不给求职者行为明细（`compliance-boundary.md` §8.8）。
- **最小样本阈值**：任何分组少于 N（建议 N=5）时显示"样本不足"，不显示数字——防止小样本反推个人。
- 只记录**浏览 / 外部跳转**，**不记录也不展示投递结果**（平台无投递闭环，也不得暗示有）。
- 文案红线：跳转数只能叫"打开来源平台次数"，**不得叫"投递数""意向数""简历数"**。

**可以分两步落地（Codex Y1 实证）**：
- **第一步（无需改 schema，立刻可做）**：接上**后端早已存在但前端一行没调**的
  `GET /partner/stats?period=week|month|quarter`（`services/api/src/orgs/partner-stats.controller.ts:28-35`），
  先把机构已有的统计口径显示出来，`/stats` 空壳当场变真。
- **第二步（需归因改造）**：补漏斗、内容排行与分位对比。

**技术前置（第二步必须先做）**：
`BrowseLog` / `ExternalJumpLog` 缺 `sourceOrgId` 字段与索引（`console-plan §6.9`）。
两条路线选一：
- **推荐**：写入时冗余 `sourceOrgId` 快照列 + 索引，配合**归因快照不可变**原则
  （内容后续换来源机构，历史统计不漂移）。
- 备选：join 回 job/fair/policy 取 `sourceOrgId` —— 大数据量下慢，且有漂移问题。

#### B2 · 终端覆盖 `/coverage`（替换 `/terminals` 空壳）

> **一句话**：我的内容在哪些点位展示、覆盖多大人群——**不是终端运维，是投放视图**。

原空壳的理由是"终端明细暂由平台统一运营"，这个判断**对运维正确、对商业错误**：
机构不需要知道打印机缺不缺纸，但**必须知道自己的内容投在了哪、覆盖多少人**。

**页面结构**：点位地图/列表（城市·场所类型·点位名，**不含 IP/序列号/运维状态**）·
每个点位的内容曝光量与到达人次（聚合）· 覆盖人群规模估算 ·
本机构内容在该点位的展示占比 · 可申请新增投放点位（走工单）。

**合规**：不暴露终端运维数据（在线率/故障/耗材），那是 Admin 的域。

#### B3 · 内容健康度 `/health`（新）

> **一句话**：我这批数据哪里不合格、为什么审核不过、怎么改。

**已有地基**：`JobDataQualitySnapshot` 模型 + `GET /partner/jobs/quality-summary`
（`services/api/src/jobs/jobs.controller.ts:352`）已经存在，前端只用了一个 93 行小面板
（`apps/partner/src/routes/jobs/components/JobQualitySummaryPanel.tsx`）——**能力被严重浪费**。

**页面结构**

| 区块 | 内容 |
| --- | --- |
| 健康分 | 本机构内容总分（0–100）+ 四维拆解：**完整度 / 时效性 / 合规性 / 可读性** |
| 问题清单 | 按问题类型聚合：缺关键字段 / 薪资区间异常 / 已过期未下架 / 疑似重复 / 疑似违规表述 / 描述过短 |
| 逐条处置 | 每个问题给"影响多少条 + 一键筛出 + 批量修改"路径 |
| 驳回归因 | **被管理员驳回的内容 + 驳回理由 + 改法建议**（机构现在完全看不到为什么被驳） |
| 趋势 | 健康分随时间变化；每次批量导入后的分数变化 |

**这一页同时解决 Admin 的人力瓶颈**：机构自己先改好，管理员审核量直接下降。

### 4.4 第 3 层「我的助手」——机构侧 AI（全部在合规内）

> **关键设计原则**：机构侧 AI **只碰机构自己的内容**，永远不碰求职者数据。
> 机构侧 AI 的输出**不进入求职者的推荐/匹配链路**，只用于机构自查与改稿。

| # | AI 能力 | 长在哪 | 做什么 | 证据级 | 为什么合规 |
| --- | --- | --- | --- | --- | --- |
| C1 | **AI 内容质检** | 岗位/招聘会列表页 + 内容健康度 | 逐条给风险分与问题标签：字段缺失、薪资异常、过期、重复、**疑似歧视表述**（性别/年龄/地域/婚育/院校歧视） | E1+E3 | 只读机构自己发布的公开岗位文本 |
| C2 | **提交前 AI 预审** | 导入/编辑的提交按钮前 | "按当前内容，预计 12 条会被驳回，主因是缺薪资区间"——**在提交前就告诉你**，而不是审核后才知道 | E1+E3 | 同上；且降低平台审核成本 |
| C3 | **AI 字段映射建议** | Excel 导入的映射步骤 | 自动把 Excel 列名映射到标准字段（"职位名称"→`title`、"月薪"→`salaryRange`），给置信度，人工确认 | E3 | 只读表头与样例行，不读求职者数据 |
| C4 | **AI 内容优化助手** | 岗位/招聘会编辑器 | 帮机构把岗位描述写清楚：补齐结构、去除歧视表述、改口语化描述。**只优化表达，不编造事实**（同前台简历优化的防编造契约） | E3 | 机构自己的内容，且必须人工采纳才生效 |
| C5 | **AI 重复检测** | 内容健康度 | 跨批次识别重复/近似岗位，避免同一岗位刷屏占位 | E1 | 纯内容比对 |
| C6 | **AI 效果解读** | 内容效果页 | 用一段话解释数据："本周详情浏览率下降 18%，主要来自 3 条已过期未下架的岗位" | E1+E3 | 只解读聚合数据，不涉及个人 |
| C7 | **AI 政策/公告撰写辅助** | 政策公告编辑器（仅限有权限的机构类型） | 结构化生成公告草稿，人工审校后发布 | E3 | 机构自有公告 |
| C8 | **AI 招聘会准备助手** | 招聘会管理（`fair_organizer` / `school`） | 根据参会企业清单生成展位分区建议、参会指引草稿、物料清单 | E3 | 活动组织信息，不涉及候选人 |

**机构侧 AI 的三条硬约束**（写进实现）：

1. **不得对求职者做任何判断。** 不生成"这个人合不合适"、不做候选人评分、不接触简历。
2. **不得生成招聘承诺。** 与 Admin A6 共用同一套违禁词库，机构侧 AI 输出同样过安全闸。
3. **AI 建议必须人工采纳才生效。** 绝不自动改机构内容，绝不自动提交审核。

**计量**：机构侧 AI 调用**全部进 `AiUsageLedger` 并带 `orgId`**——这是 §4.5 账单页的数据来源，
也是硬伤 D 必须先修的原因。

### 4.4B 内容管理与数据接入的补全（Codex Y2/Y3/Y6/Y7/Y10）

这些不是新层，是**第 1 层"我的内容"本身没做完**。列为 S4 同期项：

| 补什么 | 具体 | 对应发现 |
| --- | --- | --- |
| **数据源生命周期** | 编辑 Endpoint / 删除（改归档）/ 手动触发同步 / **凭证轮换** / **连接测试** | Y2 |
| **同步失败恢复** | 失败批次一键重试 / 错误明细导出 CSV / 逐条修复后回放 | Y3 |
| **批量运营** | 批量改状态 / **定时上下架**（招聘会与岗位都需要）/ 变更版本留痕 | Y6 |
| **自助导出** | 岗位、招聘会、同步错误、操作审计四类导出 | Y7 |
| **岗位详情页** | 补详情路由，展示来源机构 / 同步时间 / 外部ID / 外部链接 / 来源说明（CLAUDE.md §10 硬要求） | Y10 |

> 凭证轮换有安全前置：`apiSecret` / `accessToken` **只存服务端**，
> 轮换 UI 只能"写入新值 + 显示已配置"，**绝不回显旧值**（CLAUDE.md §18 类型约束）。

### 4.4C 招聘会主办方作战室（Codex Y4）——`fair_organizer` 的核心付费理由

前台 P17「招聘会作战台」做得很重（场次 → 企业 → 导览 → 准备单 → 打印），
但**后台的现场资料全归管理员管**，主办方自己动不了（`routes/fairs/index.tsx:361-362`）。
这等于：主办方买了系统，办会当天还要打电话找平台改展位图。

**新增 Tab（挂在现有招聘会管理页内，不新建顶级页）**：

| Tab | 内容 | 前台对应 |
| --- | --- | --- |
| 参展企业 | 企业清单增删改、展位号分配、企业资料补全度提示 | P17 参会企业 / P15 企业导览 |
| 展位导览图 | 上传平面图、标注展区与展位、预览前台效果 | P17 展位导览 |
| 议程与指引 | 时间表、交通指引、入场须知 | P17 场次详情 |
| 活动资料 | 可打印物料上传与发布（前台"打印企业资料/岗位清单"的来源） | P17 资料打印 |
| 现场数据 | 签到量、导览查看量、物料打印量（聚合） | P17 checkin / stats |
| **AI 准备助手（C8）** | 按参展企业清单生成展区分区建议、参会指引草稿、物料清单 | — |

**权限**：`fair_organizer` 与 `school_employment_center` / `public_employment_service` 可用；
`hr_agency` / `enterprise_source` 不可见（沿用 `partner-permission-matrix.md` §三）。

### 4.4D 院校迎新内容 CMS（Codex Y5）——`school` 专属

智慧校园页现在只有终端开关，迎新内容明确未开放（`routes/smart-campus/index.tsx:260-270`）。
补：报到流程步骤编辑 / 办事窗口清单（地点·时间·所需材料）/ 官方链接白名单 /
校历与重要时间点 / 前台预览。**内容同样走 pending → approved 审核流**，不绕过平台审核。

### 4.5 第 4 层「机构账户」——商业关系

#### D1 · 资质合规 `/qualification`（新）

**已有地基**：`QualificationRecord` 模型已存在于 schema。

**页面结构**：资质清单（营业执照 / **人力资源服务许可证** / 办学许可 / 授权书）·
每项的有效期与**到期倒计时** · 到期前 30/15/7 天提醒 ·
**过期自动降级**（内容自动转不可见 + 通知机构，不是静默下架）· 变更历史 · 补件上传。

**为什么这页重要**：本项目公司**暂无人力资源服务许可证**（CLAUDE.md §1），
因此对合作机构的资质校验是**合规防线的关键一环**——
平台必须能自证"我们核验了每家机构的资质，且过期即停"。这是招投标与监管检查的必答题。

#### D2 · 账单与用量 `/billing`（新）

**⚠️ 收费口径必须严格照抄 `compliance-boundary.md` §8.8.1 的两类划分。**

> **本表已修正（2026-08-11）**。初稿把「数据接入服务费 / 内容托管服务费 / 招聘会活动服务费」
> 列为可收——**那是错的**：这些收的正是岗位与招聘会内容的接入与展示，属于**第二类许可前置**，
> 合规文档明令「**不得把第二类收费包装成第一类**（例如把岗位置顶费写成 SaaS 增值模块）」。
> Codex 复核指出了这处冲突，此处按合规文档原文重列。

**第一类｜与招聘内容无关，可作为候选计价口径**

| 可收 | 计量方式 | 为什么属第一类 |
| --- | --- | --- |
| 终端服务费 / 场地服务费 | 按终端数 / 点位 / 时长 | 卖的是线下场地与设备位，与内容无关 |
| SaaS 订阅费 | 按账号数 / 功能模块 / 周期 | 卖的是后台工具本身 |
| AI 工具使用量 | 按调用次数 / token / 时长 | 卖的是算力与工具服务 |
| 打印与耗材 | 按页数 / 份数 | 卖的是耗材与出纸 |
| **非招聘类**内容的接入与运维 | 按数据源 / 条数 | 政策公告、机构介绍等**非招聘内容** |

**第二类｜涉及招聘内容，许可前置，未取得许可前一律不得收费**

| ❌ 不得收 | 说明 |
| --- | --- |
| 岗位 / 招聘会 / 校招信息的**接入、发布、展示、置顶、推荐位** | 包括按数据源数量收的「接入服务费」与按在架条数收的「内容托管费」——只要标的是招聘内容就属第二类 |
| 按招聘内容**曝光量**计费 | 展示次数计价 |
| 按**外部跳转次数**计费 | 投递入口跳转计价 |
| 任何以「让更多求职者看到这家企业的岗位」为卖点的付费 | 无论包装成什么名目 |
| 按候选人数 / 投递量 / 面试量 / Offer 量 / 简历数 | 效果付费招聘中介，另一条更硬的红线 |

**技术侧与收费侧分离**：曝光 / 跳转的**计量能力可以先做**（用于运营与对账是允许的），
但**不得在许可结论明确前开启对应收费项**。
本页在许可未确认前，第二类相关 SKU、发票与升级入口**必须以功能开关关闭**，不是"暂不展示"。

**另一条不能混淆的**：合作机构自己持有人力资源服务许可证，**不能替代平台自身的许可**。
资质核验（D1）是必要治理，但**不能据此推导平台可以对招聘内容收费**。

**页面结构**：当前套餐与配额 · 本期用量（分项，含 AI 用量）· 账单历史与发票申请 ·
超额提醒与自助升级 · 用量趋势与预测。

**实现前置**：必须先有 `AiUsageLedger` + `orgId`（§2.3 ⑤），否则 AI 用量无法出账。
**且必须先完成许可边界审查**（`compliance-boundary.md` §8.8.1）——
许可结论未明确前，**不得实施任何按招聘内容计价的收费**（`console-plan §6.8` 明确前置）。

#### D3 · 账号与日志 `/account`（替换空壳）

**已有地基**：`partner-permission-matrix.md` §六已定义各类机构的**子账号配额**
（school 5 / public 20 / hr_agency 10 / fair_organizer 5 / enterprise 3）。

**页面结构**：子账号列表（姓名/手机/角色/最后登录/状态）· 新增子账号（不超配额）·
角色分配（**机构范围内的角色，不是平台 RBAC**：管理员 / 内容编辑 / 只读）·
本机构操作日志（谁在什么时候改了什么内容）· 敏感操作二次验证。

**关键**：`console-plan §6.10` 第 10 条红线——**不得以"隐藏导航"代替权限控制**。
子账号权限必须有服务端 API 与路由校验兜底，前端隐藏只是展示优化。

**⚠️ 落地前置（Codex Y9）**：`partner-account-action.controller.ts` 已实现 **9 个端点**
（挑战创建/验证/取消、操作票据撤销、手机换绑四步、账号删除），
但**整个 controller 被 `admin` 角色守卫锁死**（`:27-30`）。
所以 D3 不是"接线"，而是一次**安全决策**：哪些高风险操作允许机构自助、
需要几重验证（短信 + 操作票据 + 冷静期）、哪些必须继续走平台。
**建议**：子账号增删改与角色分配开放自助；手机换绑与账号删除**保持平台侧**，
机构通过 D4 工单发起，平台执行——这既满足机构诉求，又不放大账号接管风险。

#### D4 · 通知与工单 → **并入 `/account` 的第 3 个 Tab，不新建页**

> ⚠️ **已按 Codex 复核结论重写（2026-08-11）**：初稿提议新建 `/tickets`。
> Codex 判定不该建——`routes/index.tsx:18` 当前没有通知/工单的路由、模型与客户端服务，
> 直接建页**会成为新的空壳**；现有通知接口（`member-notifications.controller.ts:9`）
> 只面向终端会员，不支持机构账号。等真实工单量与 SLA 成立后再评估拆出。

**页面结构**：平台通知（审核结果 / 资质到期 / 系统维护 / 政策变更）· 我提交的工单
（新增投放点位 / 数据源异常 / 审核申诉 / 账单疑问）· 工单状态与 SLA 倒计时 · 历史记录。

**对应 Admin 侧**：Codex 指出 Admin 缺"统一客服案件、投诉升级、赔付审批、回访仲裁留痕"
（`member-feedback/index.tsx:126-146`）——D4 是这条闭环的机构侧入口，两端必须同期建设。

### 4.6 五类机构的能力投影（终结"5 类机构一套菜单"）

**实现顺序（不可颠倒，`console-plan §6.5/6.8` 已裁定）**：
**① 服务端权威 capability 投影 → ② API 与路由双重校验 → ③ 侧栏按投影渲染。**
`ORG_TYPE_MATRIX` 目前是 `admin-orgs.service.ts` 的内部常量，前端拿不到，必须先做投影接口。

| 页面 | school<br/>就业中心 | public<br/>公共就业 | hr_agency<br/>持证HR | fair_organizer<br/>招聘会主办 | enterprise<br/>企业来源 |
| --- | :---: | :---: | :---: | :---: | :---: |
| 工作台 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 岗位信息 | ✅ | ✅ | ✅ | ⚠️仅会内 | ✅仅本企业 |
| 招聘会管理 | ✅ | ✅ | ❌ | ✅ | ❌ |
| 政策公告 | ⚠️仅校内 | ✅ | ❌ | ❌ | ❌ |
| 企业展示 | ✅ | ✅ | ✅ | ⚠️仅参会企业 | ✅仅本企业 |
| 智慧校园 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 数据源 | ✅ | ✅ | ✅ | ✅ | ⚠️仅文件/手工 |
| 导入记录 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 同步日志 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 内容效果 | ✅本机构 | ✅全辖区 | ✅本机构 | ⚠️本机构会次 | ✅本企业 |
| 终端覆盖 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 内容健康度 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 机构资料 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 资质合规 | ✅ | ✅ | ✅**必填HR许可证** | ✅ | ✅ |
| 账单与用量 | ✅ | ⚠️政府项目走合同 | ✅ | ✅ | ✅ |
| 账号与日志 | ✅上限5 | ✅上限20 | ✅上限10 | ✅上限5 | ✅上限3 |
| 通知与工单 | ✅ | ✅ | ✅ | ✅ | ✅ |
| **可见项数** | **12** | **12** | **10** | **10** | **9** |

> 本表**沿用** `partner-permission-matrix.md` 已定的口径，未新增任何权限；
> 新增能力（效果/健康度/资质/账单/工单）按"本机构范围内可见"的既有原则填入。
> `fair_organizer` / `enterprise_source` 的 `allowedModules` 当前是**空数组**——
> `console-plan §6.5` 已登记："上线前需确认是有意（纯数据供给方）还是漏配"，本方案不替它决定。

### 4.7 Partner 侧接口对齐表（新增端点清单）

| 页面 | 端点 | 方法 | 说明 |
| --- | --- | --- | --- |
| 全局 | `/partner/capabilities` | GET | **服务端 capability 投影**（侧栏与路由校验的唯一真相源） |
| B1 | `/partner/effect/overview` | GET | 效果概览与漏斗 |
| B1 | `/partner/effect/contents` | GET | 内容排行（含 Bottom 归因） |
| B1 | `/partner/effect/distribution` | GET | 时段与终端分布（聚合，含最小样本阈值） |
| B1 | `/partner/effect/report` | POST | 生成月报 PDF |
| B2 | `/partner/coverage/points` | GET | 投放点位（不含运维数据） |
| B2 | `/partner/coverage/request` | POST | 申请新增投放点位（转工单） |
| B3 | `/partner/health/score` | GET | 健康分与四维拆解 |
| B3 | `/partner/health/issues` | GET | 问题清单（可筛出对应内容） |
| B3 | `/partner/health/rejections` | GET | 驳回归因与改法建议 |
| C1/C2 | `/partner/ai/content-check` | POST | AI 内容质检 / 提交前预审 |
| C3 | `/partner/ai/mapping-suggest` | POST | AI 字段映射建议 |
| C4 | `/partner/ai/content-polish` | POST | AI 内容优化（需人工采纳） |
| C5 | `/partner/ai/duplicate-check` | POST | AI 重复内容检测（跨批次） |
| C6 | `/partner/ai/effect-insight` | GET | AI 效果解读 |
| C7 | `/partner/ai/policy-draft` | POST | AI 政策公告结构化（只整理不改实质） |
| C8 | `/partner/ai/fair-prep` | POST | AI 招聘会准备助手 |
| D1 | `/partner/qualifications` | GET/POST | 资质清单与补件 |
| D2 | `/partner/billing/usage` | GET | 本期用量（含 AI，按 orgId） |
| D2 | `/partner/billing/invoices` | GET/POST | 账单历史与发票申请 |
| D3 | `/partner/accounts` | GET/POST/PATCH | 子账号（受配额约束） |
| D3 | `/partner/audit-logs` | GET | 本机构操作日志 |
| D4 | `/partner/tickets` | GET/POST | 工单（挂 `/account` Tab 3，**不是独立页**） |
| D4 | `/partner/notifications` | GET | 平台通知 |

---

## 第五部分 · 合规红线复核（逐条自查）

本方案新增的每一项能力，都对照 CLAUDE.md §2 / §10 / §12 与 `compliance-boundary.md` 复核：

| 红线 | 本方案是否触碰 | 说明 |
| --- | :---: | --- |
| 不做平台内一键投递 | ❌ 不触碰 | 改造后的页面全部不涉及投递动作；效果页只统计"打开来源平台次数" |
| 不收求职者简历给企业 | ❌ 不触碰 | Partner 侧 AI 只处理机构自有内容，明令不接触简历 |
| 不做企业端候选人筛选 | ❌ 不触碰 | 机构侧 AI 硬约束第 1 条：不得对求职者做任何判断 |
| 不做面试邀约 / Offer 管理 | ❌ 不触碰 | 无相关页面与端点 |
| 不做候选人推荐给企业 | ❌ 不触碰 | AI 推荐只面向求职者本人（现状不变） |
| 岗位/招聘会只做第三方来源入口 | ✅ 保持 | 效果页文案红线：只能叫"打开来源平台次数" |
| 按钮文案白名单 | ✅ 保持 | 改造后的页面不引入投递/预约类按钮 |
| 不按招聘成果计费 | ✅ 已明文禁止 | §4.5 D2 列出 ❌ 清单 |
| 不记录企业筛选结果 | ✅ 保持 | 效果页只记浏览与跳转 |
| 求职者行为不给机构 | ✅ 已加约束 | 聚合 + 最小样本阈值 N=5 |
| appSecret 只存服务端 | ✅ 保持 | AI 能力注册表的 API Key 只写不回显（沿用现有 `apiKeyConfigured` 模式） |
| 不伪造能力 | ✅ **本方案还修了一处违反** | X3：自我探索在 LLM 不可用时仍返回"完成"与确定性分数，必须改为诚实降级 |
| 管理员访问文件记日志 | ✅ 扩展 | A3 质量抽检台的访问同样记审计 |

**新增的两条红线**（本方案自定，建议写入 `compliance-boundary.md`）：

1. **机构侧 AI 不得越过内容边界**：机构侧 AI 的输入只能是该机构自有的公开内容，
   输出只能用于该机构自查与改稿，**不得进入求职者的推荐/匹配/排序链路**。
2. **AI 输出的招聘承诺零容忍**：「包过 / 保offer / 保录用 / 内推保证 / 代投简历 / 帮你投递 /
   推荐给企业」等表述，**任何 AI 能力任何情况下都不得输出**，命中即硬拦截并记录（A6）。

---

## 第六部分 · 分阶段执行与文件预算

> 严格遵守 `console-plan §6.8` 的裁定：**A/A+ 属上线前收口，B/C 属上线后独立立项。**
> 本方案的阶段编号与之对齐，不另起一套。

### 阶段划分

| 阶段 | 内容 | 依赖 | 定位 |
| --- | --- | --- | --- |
| **S0 · 必修缺陷** | ① 影子测试（测试不改线上）· ② `getUsage` provider 过滤 · ③ 自我探索诚实降级 · ④ 计量补齐 | 无 | **随时可做**，都是现有页面就能暴露的真实缺陷。<br>⚠️ 原列在首位的「企业链断点」**已撤回**——那条判断是错的，功能早已存在（§9.2） |
| **S1 · ai-core 内核** | ①能力注册表（含共用键拆分）· ②调用网关 · **④Guard 脱敏与安全闸**（网关第 4/7 步强制依赖，不能延后）· ⑤计量账本(+orgId) · ⑥证据降级契约 | S0 | **一切的前提**。⚠️ 初稿把 Guard 放 S3 是依赖倒置——网关时序里它是必经步骤，Codex 指出后已前移 |
| **S1.5 · 组件拆分专项** | 只拆不加功能：`ai-services` 634 · `dashboard` 654 · `companies` 631 · `sources` 545 · `jobs` 455 · `fairs` 440 | S1 | **Codex 追加的硬前置**。这些页全部逼近或超过 CLAUDE.md §8 的 500 行阈值，不拆就加会直接撞 800 行红线。单独提交便于回滚 |
| **S2 · Admin AI 治理** | A1 能力注册表（落 `/ai-config`）· A4 成本与预算 · A5 事故与降级（落 `/ai-services` Tab） | S1、S1.5 | 先做"管得住"的三块。**不新建页** |
| **S3 · Prompt 与质量** | ③Prompt 版本库 · A2 Prompt 版本（`/ai-config` 抽屉 Tab）· A3 质量抽检 · A6 合规拦截 · A7 面试训练（均为 `/ai-services` Tab） | S1、S2 | 先做"改得动"再做"看得清"。**不新建页** |
| **S4 · Partner 效果层** | **S4a：接已存在的 `GET /partner/stats`，`/stats` 空壳当场变真（不依赖 S1）** · S4b：`sourceOrgId` 归因改造 + 漏斗 · B2 终端覆盖 · B3 健康度规则档 | **S4a 无依赖**；S4b 依赖 schema 改动 | 机构续费理由。⚠️ 初稿把整个 S4 挂在 S1 之后是错的——第一步根本不用内核（Codex 指出） |
| **S5 · Partner 助手层** | C1–C8 机构侧 AI | S1、S3、S4 | 复用内核，边际成本低 |
| **S6 · Partner 账户层** | D1 资质（`/profile` Tab）· D3 账号与日志 · D4 通知与工单 | S4 + **S7 的 Admin 对应处理端** | ⚠️ **不能先于 Admin 端**：机构提了工单没人接、传了资质没人审，又是一个「看似完整但无人处理的壳」（Codex）。D2 账单**必须等许可结论** |
| **S7 · 商用运营闭环** | §3.6 的五条闭环 + §3.6B 三项新增缺口 | — | 上线后独立立项。⚠️ **「隐私治理」是 P0 合规项，不应留在 S7**——应提到 S0/S1 并行；**资质 Admin 审核端是 S6 的前置**，需提前 |

**顺序红线**：
- S1.5 组件拆分必须先于 S2/S3/S4 的任何页面改动。
- S1 必须先于 S2/S3/S5。
- S4 的 `sourceOrgId` 归因改造必须先于 B1/B2。
- Partner capability 投影（服务端）必须先于侧栏差异化渲染。
- D2 账单必须等 `compliance-boundary.md` §8.8.1 的许可边界审查结论。
- **A/A+/S0–S3 若在最终验收之后进行，会作废已通过的 P0 证据**（`console-plan §6.8`）——
  推荐沿用"方案①：保持当前上线冻结，上线后再做"。若业务要求首发即交付新后台，
  则必须重新执行完整 P0 最终验收。

### 文件预算（CLAUDE.md §8 要求先定预算再写码）

| 阶段 | 新增文件 | 修改文件 | 单文件上限 | 备注 |
| --- | --- | --- | --- | --- |
| S0 | 0 | ≤ 12 | — | 断点接线 + 缺陷修复，**不新增文件** |
| S1 | ≤ 22（`ai-core/` 六个子目录）+ **≥ 4 个 Prisma model**（`AiCapability` / `AiPromptTemplate` / `AiPromptVersion` / `AiUsageLedger`，见附录 D；质量样本、事故、拦截记录三张表按需追加） | ≤ 12（各 `llm-*.service.ts` 改为走网关） | 300 行内为宜 | **禁止一次性重写所有 llm service**，按能力逐个切换、每次可回滚 |
| S1.5 | ≤ 20（各页拆出的子组件） | ≤ 6（各页主文件） | 拆完每个 ≤ 300 行 | **只拆不加功能**，行为零变化，单独提交便于回滚 |
| S2 | ≤ 10（`/ai-config`、`/ai-services` 的新模块 + service + 类型） | ≤ 4（两页主文件 + 侧栏分域） | 500 行触发拆分评估 | 路由不变，无需重定向 |
| S3 | ≤ 12 | ≤ 6 | 同上 | Guard 优先复用 `contract-review-pii-masker`，不重写 |
| S4 | ≤ 10 + 1 次 migration | ≤ 5 | 同上 | 归因改造涉及 schema，需双 CI（SQLite + postgres-readiness） |
| S5 | ≤ 8 | ≤ 6 | 同上 | 8 个能力共用同一网关，不各写一套 |
| S6 | ≤ 10 | ≤ 4 | 同上 | D2 视合规结论决定是否做 |

### 每阶段的验证门禁

| 阶段 | 必跑 |
| --- | --- |
| S0 | `typecheck` + `lint` + 相关 verify + Admin 页面浏览器复验（X1 测试按钮不得改线上） |
| S1 | 全量 `typecheck` + `lint` + **AI 链路回归**（5 个 active 能力逐个验证行为不变）+ 双 CI |
| S2/S3 | 同上 + Admin 三端浏览器复验 + **降级演练**（A5 手动置 ai-down，验证前台 30 页降级正确） |
| S4 | 同上 + migration 双 CI + **最小样本阈值验证**（构造 <5 样本，确认显示"样本不足"） |
| S5 | 同上 + **违禁词拦截验证**（构造招聘承诺输出，确认被 A6 拦截） |
| S6 | 同上 + 权限越权测试（用 A 机构 token 访问 B 机构数据，必须 403） |

### 需要同步的文档

按 CLAUDE.md §7 规则，落地时同步（**不新增 handoff 文件**）：
`docs/progress/current-progress.md`（每阶段完成后）· `docs/progress/next-tasks.md`（阶段任务）·
`docs/product/feature-scope.md`（新增能力入列）· `docs/compliance/compliance-boundary.md`（§5 新增两条红线）·
`docs/product/console-plan-for-kiosk-proto-2026-07.md`（在 §6.8 分轨表中登记 S0–S7 的对应关系）。

---

## 第七部分 · 设计原型交付（已完成）

原型目录：`docs/design/console-ai-os-2026-08/`　本地预览：`python3 -m http.server 5303 --directory docs/design/console-ai-os-2026-08`

**⚠️ 这不是新设计语言。** 样式是对现有 `packages/ui/src/styles/inkpaper.css` 的静态复刻
（墨绿 `#10302b` / 纸色 `#f4f1e8` / 青玉 `#1f9e86` / Noto Serif SC），
侧栏 1:1 复刻现有 `NAV_ITEMS`。落地时不引入原型 CSS，改动直接落在现有组件上。

### 已交付 21 页

| 文件 | 内容 |
| --- | --- |
| `index.html` | 改造总览：0 新建 / 16 改造 / 3 填充 / 1 摘除 + 落地顺序 |
| **`mapping.html`** | **后台 ↔ 前端 功能对应总表（47 页）**——先看这张 |
| `admin/companies.html` | 🔴 **修断点**：接上后端已有的企业审核发布 API |
| `admin/ai-config.html` | AI大模型 → 能力注册表 + 详情抽屉 6 Tab + 共用键拆分向导 + 影子测试 |
| `admin/ai-services.html` | AI服务管理 → 运营中心 5 Tab（用量/质量/事故/合规/面试） |
| `admin/dashboard.html` | 工作台 + AI 每日要点（**15 个「补强」页的统一样板**） |
| `admin/alerts.html` | 告警中心 + AI 归因聚合；处置闭环标为「待服务端就绪」不放假按钮 |
| `admin/job-sources.html` | **演示你点名那组的改法**：页头职责文案 + 数据流四段图 + AI 预审排序 |
| `admin/audit.html` | 日志审计 + 自然语言检索 + AI 治理变更历史统一真相源 |
| `partner/stats.html` | 空壳 → 内容效果（先接已存在的 `/partner/stats`） |
| `partner/terminals.html` | 空壳 → 终端覆盖投放视图（不复制运维后台） |
| `partner/account.html` | 空壳 → 子账号 + 操作日志 + 通知与支持（吸收原拟 `/tickets`） |
| `partner/jobs.html` | 质检列 + 提交前预审 + 内容健康度 Tab + 驳回归因 + 批量操作 |
| `partner/companies.html` | 同岗位一套 + AI 写企业简介（只用你填的事实） |
| `partner/fairs.html` | 主办方作战室 6 Tab（企业/展位图/议程/物料/现场数据/AI 准备助手） |
| `partner/sources.html` | 数据源生命周期 + AI 字段映射建议（只在 Excel 映射步内） |
| `partner/profile.html` | 资质合规（到期降级）+ 账单与用量（含不能收费的红线清单） |
| `partner/policy.html` | 合规预审（申报期已过 E2）+ 撰写辅助（只整理结构不改实质） |
| `partner/sync-logs.html` | AI 失败归因；重试标为做不了（SyncLog 未关联失败行） |
| `partner/smart-campus.html` | 迎新内容 CMS（在已有 OrientationPanel 里填实，不新建入口） |
| `partner/dashboard.html` | 工作台 + AI 每日要点（须先做效果层） |

### 原型口径

- **四态齐全**：每页右上角可切换 默认 / 首次·空数据 / AI 不可用 / 加载失败，**四态同一套版面**。
- **不伪造能力**：没有真实接口的区块标「未接入」「待服务端就绪」，**不放可点击的假按钮**。
- **诚实标注**：「未计量 / 合并计 / 按量·未估算 / 样本不足」是刻意保留的，不是占位符。
- **证据标注**：E1/E2/E3 在原型里就标出来，落地时直接对应服务端契约。
- **注释可辨**：虚线绿框=原型注释，橙色=Codex 复核修正，红色=必修缺陷。落地时全部删除。
- **桌面优先**：1280px 起可用，不套用一体机 56px 触控规格。

## 第八部分 · 后台全页 AI 覆盖矩阵（47 页）

> 产品所有者要求：**「补充一下还得跟前端页面一样，都加入 AI 功能和技术的支持」**。
> 这是把前台 V3 的纪律原样搬到后台：
> **每一页要么有 AI，要么有「为什么没有」的明文理由——没有第三种状态。**
>
> 可视化版本见原型 `docs/design/console-ai-os-2026-08/mapping.html`（含接口列与前台对应列）。

四档定义（与前台一致）：**✅原生**（AI 是这页主要功能）· **☑️支撑**（AI 做辅助判断）·
**🔧补强**（该有但现在没有，进 backlog）· **⛔刻意无**（有明文理由不用 AI）。

### 8.1 「刻意无 AI」的四条理由（不是偷懒，是边界）

| 理由 | 适用页面 |
| --- | --- |
| **① 安全边界** —— AI 不参与身份与授权决策（与前台 P03 身份门同一口径） | Admin 登录 / 账号设置 / 权限管理；Partner 登录 / 账号权限 |
| **② 法律效力** —— 法务正文不得由 AI 生成或改写 | Admin 法务文档版本 |
| **③ 个人权利** —— 数据权利的判定必须人工 | Admin 会员隐私请求 / 数据权利工单 |
| **④ 能力未开放** —— 前台就是锁定态，后台不造 AI 壳子 | Admin 智慧校园 |

### 8.2 Admin 34 页

| 页面 | AI 是什么 | 档 |
| --- | --- | :---: |
| 工作台 | AI 每日要点：今天最该看的 3 件事（成本突增/失败率/审核积压/设备离线），每条带理由 E1+E2 | 🔧 |
| 设备管理 | AI 故障预测（按历史卡纸/缺纸/离线模式）+ 批量运维建议 E2 | 🔧 |
| 宣传屏 | AI 精选排期建议（按时段与点位人流）E2；海报生成仍是二期 stub | 🔧 |
| 百宝箱 | 上架 AI 预检：域名风险、权限申请合理性、描述与实际能力是否一致 E3 | ☑️ |
| 智慧校园 | **刻意无**（前台锁定态） | ⛔ |
| 告警中心 | AI 归因与建议处置（同类聚合 + 可能原因 + 建议动作）E2 | 🔧 |
| 订单管理 | AI 异常订单识别：重复支付 / 已付未出纸 / 退款卡住 E1 | 🔧 |
| 打印扫描运维 | AI 失败模式归因：字体未内嵌 / 幅面 / 加密 / 页数超限（对应前台 checkfail）E1 | 🔧 |
| 计费与对账 | AI 对账差异解释：把 5 类差异码翻成人话 + 建议动作 E1 | 🔧 |
| 文件管理 | AI PII 检测与遮挡建议 E1 规则 + E3 模型（**当前完全没有遮挡规则治理**） | 🔧 |
| 求职材料库 | AI 模板质量与使用建议 E1 | 🔧 |
| **AI服务管理** | **AI 就是全部内容**：用量成本 / 质量抽检 / 事故降级 / 合规拦截 / 面试运营 | ✅ |
| **AI大模型** | **AI 就是全部内容**：能力注册表 / 模型 / Prompt 版本 / 闸门 / 降级 | ✅ |
| 岗位信息源 | AI 预审风险分：字段 E1 / 薪资异常 E1 / 疑似歧视 E3 / 重复 → 高分排前 | ✅ |
| 招聘会信息源 | 同上 + 时间冲突检测（同场地同时段）E1 | ✅ |
| 政策信息源 | 同上 + 时效性检测（已废止 / 申报期已过）E2 | ✅ |
| 招聘会管理 | AI 展位分区建议 + 准备单校验 E3 | ☑️ |
| 企业展示管理 | AI 资料完整度与跨来源一致性冲突检测 E1 | ☑️ |
| Excel 导入记录 | AI 批次风险汇总：这批有多少会被驳回、主因是什么 E1 | ☑️ |
| 数据接入通道 | 来源级 AI 预审：该来源历史内容质量画像 + 字段映射建议 E1 | ☑️ |
| 合作机构管理 | AI 机构内容质量画像 + 资质到期预警 E1 | 🔧 |
| 线下机构 | 到店问题清单质检（管前台 P16 那个 AI 的口径与边界）E3 | ☑️ |
| 用户管理 | AI 能力使用画像（**聚合**，决定砍什么推什么）E1；**不做个人画像** | 🔧 |
| 权益活动 | AI 活动效果解读：领取率、核销率、点位差异 E1 | ☑️ |
| 会员权益 | 同上（与权益活动合并 IA 后共用一套解读） | ☑️ |
| 意见反馈 | AI 反馈聚类与优先级（「同一个问题被 12 个人提过」）E3 | 🔧 |
| 消息通知 | AI 通知文案草稿（**必须人工审核后才发**）E3 | ☑️ |
| 会员隐私请求 | **刻意无**（个人权利必须人工判定） | ⛔ |
| 权限管理 | **刻意无**（授权不得由 AI 决策）+ 真实 RBAC 前从侧栏摘除 | ⛔ |
| 日志审计 | AI 自然语言检索：「上周谁改过打印价目」E1 | 🔧 |
| 法务文档版本 | **刻意无**（法律效力）；可做的只有无判断的版本 diff 高亮 | ⛔ |
| 数据权利工单 | **刻意无**（同隐私请求） | ⛔ |
| 账号设置 | **刻意无**（安全边界）。⚠️ 但**账号安全能力本身是缺口**，见 §3.6B | ⛔ |
| 登录 | **刻意无**（安全边界）。同上 | ⛔ |

### 8.3 Partner 13 页

| 页面 | AI 是什么 | 档 |
| --- | --- | :---: |
| 工作台 | AI 每日要点。**前置：现有数据只有内容数量与同步记录，不足以生成可靠归因，必须先有效果数据** | 🔧 |
| 机构资料 | 资质到期预警（规则 E1）；**账单页刻意无 AI**——金额不得由模型估算 | ☑️ |
| **岗位信息管理** | 质检 + 提交前预审 + 内容改写。**E1 规则档与 E3 模型档分开标注** | ✅ |
| **企业资料管理** | 同岗位（Codex 指出我最初漏了这页） | ✅ |
| **招聘会信息管理** | AI 准备助手：展区分区、参会指引草稿、物料清单 E3。不接触求职者数据 | ✅ |
| 智慧校园 | 迎新内容质检（字段完整度、链接可达性）E1。功能未接入前不做生成式 AI | ☑️ |
| **政策公告管理** | 合规预审 + 撰写辅助（结构化草稿，人工审校后发布）E3 | ✅ |
| **数据源管理** | AI 字段映射建议（**只在 Excel 映射步内**，读表头与样例行）E3 | ✅ |
| 同步日志 | 失败原因归因：401 / 超时 / 字段不符 → 一句人话 + 建议动作 E1 | ☑️ |
| 终端数据 | 投放建议：哪类点位对你的内容转化更好 E1 | ☑️ |
| **数据统计** | AI 效果解读：本周最该处理的一件事，带理由与代价 E1+E3 | ✅ |
| 账号权限 | **刻意无**（安全边界） | ⛔ |
| 登录 | **刻意无**（安全边界） | ⛔ |

**合计：AI 原生 11 · 支撑 13 · 补强 14 · 刻意无 9 = 47 页全覆盖。**

> 数字已按逐行重数校正（2026-08-11）。初稿写的 10/12/15/10 是估算，与表格实际行数不符——
> Codex 复核指出并数对了。**这类统计必须可复现**：Admin 34 + Partner 13 = 47，
> 表格行数须与之相等，不得有合并行。

### 8.4 机构侧 AI 的三条硬约束（重申）

1. **不得对求职者做任何判断**——不生成「这个人合不合适」、不做候选人评分、不接触简历。
2. **不得生成招聘承诺**——与 Admin 共用同一套违禁词库，机构侧输出同样过安全闸。
3. **AI 建议必须人工采纳才生效**——绝不自动改机构内容、绝不自动提交审核。

---

## 第九部分 · 后台 ↔ 前端 功能对应表与错配清单

> 产品所有者原话：**「当前的后台有些功能，比如岗位信息和数据内容里面的这些功能应该大概率是不匹配的，
> 也就是功能和接口都是混乱的，不知道哪个应该对接哪个」**、
> **「要让客户知道每个功能是干什么的，对应的是前端用户界面里面的哪些页面哪些功能」**。
>
> 完整对应表（含接口列）见 `docs/design/console-ai-os-2026-08/mapping.html`。本节只记**结论与错配**。

### 9.1 核心对应关系（一句话版）

| 后台页 | 对应前台 |
| --- | --- |
| 岗位信息源 → 审核通过 + 发布 | **P13 岗位情报台 / P14 岗位详情**（`kiosk /jobs`、`/jobs/:id`） |
| 招聘会信息源 → 审核；招聘会管理 → 运营内容 | **P17 作战台 / P18 校园招聘**（`/job-fairs`、`/campus`） |
| 政策信息源 → 审核 | **P21 政策服务**（`/renshi` 四 Tab） |
| 企业展示管理 | **P15 企业导览**（`/companies`、`/companies/:id`） |
| 线下机构 | **P16 线下机构**（`/offline-agencies`） |
| 宣传屏 | **P02 待机屏**（`/screensaver`） |
| 百宝箱 | **P27 百宝箱** |
| 订单管理 / 计费与对账 | **P06 打印工作台第 3–7 站**（核价 → 收银 → 出纸 → 取件） |
| 打印扫描运维 | **P06 任务 6 态 / P07 扫描 / P08 文件加工** |
| 文件管理 | **P06/P07/P08/P09/P12 的全部产物** |
| 求职材料库 | **P12 材料工厂** |
| 权益活动 / 会员权益 | **P24 权益活动 / P23 我的权益** |
| 消息通知 / 隐私请求 | **P23 我的**（通知 / 隐私） |
| 法务文档版本 | **P04 系统态 `/legal/:doc`** + 登录同意快照 |
| AI大模型 / AI服务管理 | **全部 30 个 AI 点** |
| Partner 岗位 / 企业 / 招聘会 / 政策 | 同上对应的前台页（机构填的字段直接显示在那里） |
| Partner 数据统计 | **P13–P18 的浏览与外部跳转埋点** |
| Excel 导入记录 / 数据接入通道 / Partner 数据源 / 同步日志 | **无直接前台页——它们是「内容怎么进来」的通道**，内容最终仍到 P13/P17/P21 |

### 9.2 Codex 逐链复核结论：主链闭合，但有 1 处真断点 + 7 处口径混乱

> Codex（gpt-5.6-sol / xhigh）按「Partner 提交 → Admin 审核 → Admin 发布 → Kiosk 展示」
> 逐端点追了三条链。**总结论：岗位、招聘会、政策三条主链能闭合；
> 混乱的根源是「来源」这个词被同时用在两件完全不同的事上。**

#### ~~🔴 断点：企业资料链没接通~~ —— **已撤回（2026-08-11）**

> **这条判断是错的，企业链早就接通了。** 详细更正见开发规格 §2.1。
>
> - `apps/admin/src/routes/companies/index.tsx` 已是 192 行 + 5 个组件；
>   `components/ReviewPublishSection.tsx` 完整实现通过/拒绝/发布/下架；
>   `components/LinkedJobsSection.tsx` 实现岗位关联；
>   `services/api/companiesAdmin.ts:191-202` 四个方法齐全。
> - 进度文档 `current-progress.md` 有记录：企业页 1116 → 192 行拆分与接线在
>   `codex/normalize-structure-closure` 已完成。
>
> **根因**：我给 Codex 的题目限定了「只看调了哪些 service 方法，不读全文」，
> 它没进 `components/` 目录就报了否定结论；**我未复核即采信**，并据此产出了
> 「最高优先级断点」的判断、一个专门的原型页、S0 第一条任务。
>
> **流程教训**：受限范围审查得出的**否定性断言**（「某功能不存在 / 没接」），
> 在写进方案前必须自己复核一手代码。本方案其余引用已按此重新核对（见 §11.1 更正表）。

**从原断点里筛出、经核实仍成立的**：
- 「批量通过并发布」确实没有后端端点（现有全是单条），要做需先定批量契约 —— 列 backlog，不属 S0。
- 企业相关 AuditLog 现为 `company.review` / `company.publish` 两段式，非四段式 —— 可选优化。

#### 🟠 状态机缺口：`reviewing` **UI 没入口**（不是「没端点」）

> ⚠️ **表述已更正（2026-08-11）**：初稿写「没有任何动作或端点能进入 `reviewing`」——
> **端点是有的**：通用审核端点明确接受 `action: 'reviewing'`
> （`services/api/src/jobs/dto/review.dto.ts:8`、`jobs.controller.ts:258`）。

**真实缺口**：**Admin UI 只做了通过/拒绝两个按钮**（`admin/routes/job-sources/index.tsx:255`），
没有「开始审核 / 认领」的入口，所以 `reviewing` 这个状态在实际使用中永远进不去。

**修法比原判断简单得多**：后端不用改，只需在 Admin 页加一个「认领审核」按钮调
`action:'reviewing'`；或者决定不做多人协作、把 `reviewing` 从 UI 筛选项里移除。

#### 🟠 命名不统一（同一个东西三端三个名字）

| 概念 | Admin | Partner | Kiosk | 后端模型 |
| --- | --- | --- | --- | --- |
| 招聘会 | `fair-sources` + `fairs` | `fairs` | `/job-fairs` | `JobFair`（类型里还有 `FairSource` / `Fair`）|
| 政策 | `policy-sources` | `policy` | `/policy-service` | `Policy` |
| 岗位 | `job-sources` | `jobs` | `/jobs` | `Job` |

**招聘会还有三个「状态」并存**：`status`（即将开始/进行中/已结束，是时间状态）、
`reviewStatus`（审核）、`publishStatus`（发布）——页面上没有区分说明，运营容易看混。

#### 🟠 端点命名与职责不符（3 处）

1. **`/admin/job-sources` 看起来管数据源，实际是审核/发布岗位记录**；
   真正的接入通道是 `/admin/job-sync/sources`（`jobs.controller.ts:244-277` vs `job-sync.controller.ts:34,145`）。
   **这就是产品所有者感觉「混乱」的技术根因**：「来源」一词一词两用。
2. **Partner 手工「新增岗位/招聘会/企业」调用的都是 `/import` 端点**——
   单条创建和批量导入共用 import 语义（`partner/routes/jobs/index.tsx:216` 等）。
3. **`toggle` vs `enabled` 两套口径**：Partner 用 `PATCH /partner/data-sources/:id/toggle`，
   Admin 对同类通道用 `PATCH /admin/job-sync/sources/:id/enabled`（显式布尔）。

#### 🟡 分层不一致 + 孤儿端点

- **Admin `sync-sources` 没有 service 封装**，页面直接 `authFetch` 多个 `/admin/job-sync/...`，
  与其他 6 页的 service 分层不一致（`admin/routes/sync-sources/index.tsx:14,99,110,121`）。
- 后端有 `GET /job-fairs/:id/detail`，但 Kiosk 调的是 `/job-fairs/:id`，
  **`/detail` 端点在限定范围内找不到消费者**（`jobs.controller.ts:133-144`）。

#### ✅ 确认没问题的部分（不要误改）

- `ImportBatch`、`PartnerSyncLog`、数据源连接配置**没有 Kiosk 消费端是合理的**——
  它们是后台过程数据与内容生产通道，不是内容本身。界面上说清即可，不必造前台入口。
- 岗位链完整闭合：Partner `/import` → `pending+draft` → Admin `review` → Admin `publish`
  → Kiosk `getPublishedJobs`。招聘会链同构。
- Partner 编辑已发布岗位会**重新回到待审核**，不是原位更新——这个设计是对的，
  但界面上要写清楚（否则机构会以为改完立即生效）。

> ⚠️ Codex 声明的范围限制：本次未读 Kiosk 页面组件，
> 所以能确认内容到达 `/jobs/:id`，**但没验证二维码按钮是否真的用了 `sourceUrl`**。
> 这一项标「待扩大范围复核」，不能直接判定为通过。

### 9.2B 我最初判断的两处错配（Codex 确认，但定性需修正）

#### 错配 ①：`/fair-sources`（招聘会信息源）↔ `/fairs`（招聘会管理）职责重叠

> Codex 定性修正：不是「重复管理」，而是**边界只能从代码调用推断，界面上没写**。
> `fair-sources` 做审核发布（`:110-131`），`fairs` 只读运营聚合与统计（`:52,66-67`）——
> 分工其实是清晰的，**问题在于两页都展示 `reviewStatus/publishStatus`，
> 而一个叫「来源」一个叫「招聘会」，用户没法从名字判断该去哪。**

两页**读写的是同一批 `JobFair` 记录**，一个叫「信息源」做审核、一个叫「管理」做运营。
名字没有体现这层分工，导致：运营点进「招聘会信息源」以为能改场次内容，
点进「招聘会管理」又找不到审核按钮。

**同样的模式也存在于**：`/job-sources` ↔ Partner `/jobs`、`/policy-sources` ↔ Partner `/policy`
——「源」页做审核，「管理」页做内容，但界面上从不互相说明。

**改法（不合并、只讲清）**：
- 两页页头副标题各写一句职责声明 + 互相跳转（见 §9.4 文案表）。
- 「信息源」类页面统一改副标题为「**本页只做审核**」，并在页内提供「改内容去 →」入口。
- 三类 source 页可按既有规划合并为**内容审核中心**（3 个 type Tab），但
  **只统一入口 / 状态词汇 / SLA 展示，不抽通用后端状态机**——三者校验、发布规则、审计语义不同。

#### 错配 ②：`/import-batches`（Excel 导入记录）↔ `/sync-sources`（数据接入通道）应合并

两页**是同一件事的两半**——都是「内容怎么进来的」。一个只读、一个可操作，
分成两个菜单项，运营要在两处找同一批数据的来路。

**改法**：合并为「**数据接入**」一页三 Tab：数据源 / 文件导入 / 同步记录。
⚠️ `AccessMode` 有 6 个值（`api`/`excel`/`csv`/`json`/`webhook`/`manual`），
**不能只做 Excel + API 两 Tab**。

### 9.3 「找不到消费端」的页面（不是错，但要标注清楚）

以下页面**没有直接的前台对应页**，界面上必须说明它们是**通道或治理**而非内容：

- Admin：Excel 导入记录、数据接入通道、合作机构管理、用户管理、日志审计、权限管理、账号设置
- Partner：数据源管理、同步日志、账号权限

**这不是缺陷**——但如果界面上不说，运营会一直找「我配的这个东西在终端哪里能看到」。

### 9.4 每个后台页的页头副标题文案（直接抄进界面）

> 落地做法：**写在页头副标题位，做常驻文案，不写成帮助文档**。

| 页面 | 页头副标题应该写的话 |
| --- | --- |
| `/job-sources` | 本页只做**审核**。通过并发布后，岗位出现在一体机「岗位信息」列表与详情页。改内容请去合作机构后台或数据接入。 |
| `/fair-sources` | 本页只做**审核**。通过并发布后，招聘会出现在一体机「招聘会」作战台与校园招聘专区。**改场次内容请去「招聘会管理」→** |
| `/fairs` | 本页做招聘会的**运营内容**：参会企业、展区展位、导览图、活动资料，直接显示在一体机的招聘会作战台。**审核状态请去「招聘会信息源」→** |
| `/policy-sources` | 本页只做**审核**。通过并发布后，政策出现在一体机「政策服务」的对应分类下。 |
| `/companies` | 本页管企业展示资料。发布后出现在一体机「找企业」列表与企业详情页；指标是否展示由本页开关控制。 |
| `/sync-sources` | 本页管**内容怎么进来**（API / Webhook / 文件）。进来的内容默认待审核，审核通过后才会出现在终端。 |
| `/import-batches` | 本页是文件导入的**执行记录**，只读。导入的内容去「岗位信息源 / 招聘会信息源」审核。 |
| `/screensaver` | 本页管一体机**无人操作时的待机轮播**：素材、播放方案、按终端排期。 |
| `/toolbox` | 本页管一体机首页「百宝箱」里的受控小工具：上架审核、域名白名单、投放到哪些终端。 |
| `/billing` | 本页改的价目**即时对所有终端生效**，直接影响用户在打印收银台看到的金额。停用某项价目会使对应报价失败（不是免费）。 |
| `/ai-config` | 本页管一体机上**每一个 AI 功能**的开关、模型、提示词版本、预算与降级文案。每条能力都标注了它长在终端的哪一页。 |
| `/ai-services` | 本页看一体机上**所有 AI 功能**的运行情况：调用量与成本、输出质量抽检、故障与降级、合规拦截记录。 |
| Partner `/jobs` | 你在这里填的每个字段，会出现在一体机的**岗位列表与岗位详情页**。求职者从详情页扫码去你填的来源平台链接投递——平台不代收简历。 |
| Partner `/fairs` | 你在这里配的参展企业、展位图、议程与物料，会出现在一体机的**招聘会作战台**；求职者可以现场打印你上传的资料。 |
| Partner `/stats` | 这里统计的是你的内容在一体机上**被看了多少次、多少人点击去了你的来源平台**。不含投递结果——平台没有投递闭环。 |
| Partner `/terminals` | 你的内容正在这些点位的一体机上展示。这里不显示设备运维信息（那由平台负责）。 |

### 9.5 给 Codex 开发的交付口径

1. **每一行的「关键接口」列就是对接清单**（见 `mapping.html`）。
2. **「对应前台哪里」列决定回归验证范围**——改了后台某页，要验证的前台页就是这一列。
3. **页头副标题文案是硬性要求**，不是可选项。
4. **错配 ①② 必须先解决**再往上加 AI 功能，否则是在混乱之上叠加复杂度。

---

---

## 第十部分 · 运营大屏（已立项登记，上线后启动）

> 2026-08-11 产品所有者提出：是否增加数据大屏，做数字孪生那种效果。
> **结论：值得做，但「数字孪生」这个形态现在做不了**；应做「运营大屏」，
> 排期定为**先记进方案、上线后再做**（产品所有者拍板）。
> 使用场景确认为**四个全要**：政务验收/招投标 · 运营中心实时监控 · 销售/加盟商演示 · 机构版。

### 10.1 为什么不能叫「数字孪生」

数字孪生的最低门槛是**空间数据 + 实体映射**。本项目目前：

| 孪生要素 | 现状 |
| --- | --- |
| 终端地理坐标 | ❌ `Terminal` 只有 `locationLabel` 文本，**无经纬度**（`schema.prisma` Terminal 模型） |
| 空间/场景模型 | ❌ 完全没有 |
| 实时数据通道 | ❌ 全仓无 WebSocket / SSE（`grep -rl "WebSocketGateway\|EventSource\|text/event-stream"` 零命中） |
| 设备细粒度遥测 | ❌ 心跳只有 `printerStatus` 字符串，**无纸张/碳粉余量数值**（`TerminalHeartbeat` 模型） |

**硬做的唯一路径是买模板套假数据**——而大屏是全站最容易被截图传播的界面，
假数据的代价远高于后台页，且直接撞 CLAUDE.md §9「不伪造能力」。
**所以命名为「运营大屏」，不用「数字孪生」**——名字决定预期。

### 10.2 裁决：一个引擎 + 四套视图，不是四块屏

四个场景的诉求互相冲突（政务要规模、运营要异常、销售要叙事、机构要自己的数据），
但**做四块独立屏＝维护四份代码**。裁决：

```text
一个大屏引擎  /screen?profile=<gov|ops|sales|org>
        ↑
Admin「大屏配置」页：管 viewProfile —— 选模块 / 排版 / 轮播节奏 / 数据范围 / 主题
```

- **同一套模块库**，不同 profile 组合出不同的屏。
- **机构版走独立鉴权**：机构大屏 token + `orgId` 强制过滤，不是管理员账号。
- **这是整个方案里唯一建议新建的页面**（`/screen` + Admin 一个配置页）。
  理由：它塞不进任何现有页——分辨率（1920/4K 拼接 vs 1280 桌面）、
  交互（无人值守轮播 vs 点击操作）、鉴权（只读大屏 token vs 管理员账号）、
  刷新（持续推送 vs 按需加载）四件事全不同。

### 10.3 模块矩阵（哪个场景用哪些模块 · 数据是否就绪）

| # | 模块 | 政务 | 运营 | 销售 | 机构 | 数据就绪度 |
| --- | --- | :---: | :---: | :---: | :---: | --- |
| M1 | 点位覆盖地图 | ★核心 | ○ | ★核心 | ○ | ❌ **需补经纬度** |
| M2 | 设备状态墙（在线/离线/故障） | ○ | ★核心 | ○ | — | ✅ 现有心跳 |
| M3 | 实时任务流（打印/扫描进行中） | ○ | ★核心 | ★核心 | — | ✅ `PrintTask`+状态日志 |
| M4 | 今日服务量（份数/会话数） | ★核心 | ✓ | ✓ | — | ✅ 现有 |
| M5 | 累计服务规模（民生价值口径） | ★核心 | — | ★核心 | — | ✅ 现有 |
| M6 | AI 运行看板（调用/成本/降级/拦截） | ✓ | ★核心 | ★核心 | — | ✅ 现有（机构维度需 orgId） |
| M7 | 内容生态（岗位/招聘会/政策 + 来源机构数） | ★核心 | ✓ | ★核心 | ✓ | ✅ 现有 |
| M8 | 审核队列与时效 | ○ | ★核心 | — | ✓ | ✅ 现有（SLA 字段需补） |
| M9 | 告警与处置 | — | ★核心 | — | — | ✅ 现有（无持久状态，见 §3.6） |
| M10 | 求职者旅程漏斗（看见→浏览→去来源→打印） | ✓ | — | ★核心 | ★核心 | ⚠️ **需 `sourceOrgId` 归因** |
| M11 | 机构内容效果（曝光/跳转/打印） | — | — | — | ★核心 | ⚠️ **需 `sourceOrgId`** |
| M12 | 招聘会现场（签到/导览/物料打印） | ✓ | ✓ | ✓ | ★核心 | ✅ 现有 |
| M13 | 耗材与运维预警 | — | ✓ | — | — | ❌ **需 Agent 上报余量数值** |
| M14 | 3D 场景 / 设备孪生体 | — | — | — | — | ❌ **不做**（无空间数据，引入即负债） |

★核心＝该场景的主视觉　✓＝有价值　○＝可选　—＝不放

**读法**：一期只上 ✅ 的模块（M2–M9、M12），已经能撑满政务版与运营版各一屏；
M1/M10/M11/M13 等数据前置补齐后再进。

### 10.4 数据前置清单（谁来补、归属哪个阶段）

| 前置 | 用于 | 做法 | 归属 |
| --- | --- | --- | --- |
| `Terminal` 经纬度 | M1 地图 | 加 `latitude`/`longitude` 或建 `TerminalLocation` 表；**存量点位靠人工维护一次**（数量不大） | 大屏一期前 |
| 实时推送 | M2/M3 实时感 | **优先 SSE 不是 WebSocket**——大屏是单向只读，SSE 更简单、天然自动重连、无需握手协议 | 大屏二期 |
| `AiUsageLedger.orgId` | M6 机构维度 | 已在 §2.3 ⑤ 登记 | S1 内核 |
| `BrowseLog`/`ExternalJumpLog` 的 `sourceOrgId` | M10/M11 | 已在 §4.3 B1 登记 | S4 效果层 |
| 审核 SLA 字段 | M8 时效 | 记录进入待审时间与处理时长 | 大屏一期前 |
| 耗材余量数值 | M13 | **需先验证 Agent 侧 WMI 能否读到纸张/碳粉余量**；读不到就不做这个模块 | 待验证，不承诺 |

> **在推送就绪前，大屏用 HTTP 轮询**：每个模块独立刷新频率
> （设备墙 15s / 任务流 5s / 累计规模 5min），避免整屏高频拉全量把 API 压垮。

### 10.5 合规红线（机构版尤其）

| 红线 | 说明 |
| --- | --- |
| **机构版强制 `orgId` 过滤** | 机构大屏只能看本机构数据，服务端强制，不靠前端筛选 |
| **最小样本阈值** | 沿用 §4.3 的 N=5：任何分组不足即显示「样本不足」 |
| **不显示求职者个人信息** | 任何屏、任何模块，都不出现姓名/手机号/简历内容/头像 |
| **不显示投递类指标** | 只能叫「打开来源平台次数」，**不得叫投递数/意向数/简历数**（CLAUDE.md §2） |
| **服务量口径必须写明** | 政务版的「服务人次」是**会话数**不是**自然人数**——
必须在屏上标注口径。把会话数说成服务人数是政务项目最常见的翻车点 |
| **没数据显示「未接入」** | **绝不显示 0 或编造值**。大屏最容易被截图传播，假数据代价最高 |
| **不放可操作按钮** | 无人值守场景，误触代价不可控。大屏只读；要操作去 Admin |

### 10.6 分期

| 期 | 内容 | 前置 |
| --- | --- | --- |
| **一期** | 引擎 + Admin 配置页 + 政务/运营两套 profile；模块 M2–M9、M12（全部现有数据）+ 轮询刷新 | 上线完成；审核 SLA 字段 + 经纬度（若要 M1） |
| **二期** | SSE 实时推送 + M1 地图 + 销售 profile（含 M10 漏斗） | S1 内核 + S4 效果层（`sourceOrgId`） |
| **三期** | 机构版 profile（M10/M11）+ 机构大屏 token | S4 完成 + 机构侧权限投影 |

**顺序红线**：机构版必须最后做——它依赖 `sourceOrgId` 归因与机构 capability 投影，
提前做会变成「给机构看一屏没有数据的壳子」。

### 10.7 反面清单（大屏绝对不做的事）

1. **不做 3D 数字孪生**——没有空间数据，引入 Three.js 即是纯负债。
2. **不买大屏模板套假数据**——这是本项目最不能碰的一条。
3. **不做无信息动效**——粒子、扫描线、跳动的假数字，只允许表达真实状态的动效（沿用前台 V3 §6.4 动效纪律）。
4. **不放操作按钮**——大屏只读。
5. **不做成第二个 Admin**——大屏回答「现在怎么样」，Admin 回答「我要改什么」。
6. **不为了填满屏幕造指标**——模块不够就留白或加大现有模块，不编新指标。

### 10.8 与本方案其余部分的关系

- 大屏**不是**上线阻塞项，排在 §6 分阶段的 **S7 之后**。
- 大屏的指标口径**必须复用**已有页面的口径，不另立一套——
  这也是大屏的一个副产品价值：**它会逼着把散在各页的指标口径统一**。
- 大屏是「AI 全覆盖矩阵」的例外：它是**纯展示面**，
  AI 在这里的定位是 **☑️支撑**（异常归因文案、口径解释），**不做生成式内容**——
  无人值守的屏上出现模型生成的句子，出错时没人能及时发现。

---

---

## 第十一部分 · 终审结论：这份交付物离开工还差什么

> 2026-08-11 产品所有者问：「两个后台功能是否都已经做好完善、补充和优化？是否已经全部落实到位？」
> **诚实的回答：没有。** 这是一份方向正确、覆盖完整的**方案骨架**，
> 但**还不是可以直接开工的开发规格**。本节记录 Codex 终审的判断、我的回应，以及开工前必须补齐的清单。

### 11.1 已修正的事实错误（本轮）

| # | 错误 | 状态 |
| --- | --- | --- |
| 1 | 正文仍写着新建 `/interview-ops` 与 `/tickets`，与原型「新增 0 页」互斥 | ✅ 已改 |
| 2 | 企业链断点（最高优先级）没进阶段表 | ✅ 已进 S0 |
| 3 | 组件拆分只在原型有，阶段表没有 | ✅ 已加 S1.5 |
| 4 | Admin IA 算术 25→31、Partner 14→18 全是旧的 | ✅ 已改为「导航项数不变」 |
| 5 | AI 档位统计 10/12/15/10 与表格行数不符 | ✅ 已重数为 **11/13/14/9 = 47** |
| 6 | Partner 页数三种口径（14 / 13 / 12） | ✅ 统一为 **13 页 / 侧栏 12 项** |
| 7 | Prisma 模型预算写 3 个，实际 ≥4 个 | ✅ 已改 |
| 8 | 🔴 **D2 收费表把「许可前置」的第二类包装成第一类** | ✅ **已按 `compliance-boundary.md` §8.8.1 原文重写** |
| 9 | Guard 被排到 S3，但网关时序里它是必经步骤（依赖倒置） | ✅ 已前移到 S1 |
| 10 | S4 整体挂在 S1 之后，但第一步根本不用内核 | ✅ 已拆 S4a / S4b |
| 11 | S6 排在 S7 之前，但机构工单需要 Admin 处理端 | ✅ 已改依赖 |
| 12 | C5 重复检测、C7 政策撰写没有端点 | ✅ 已补 |
| 13 | 三条真遗漏（资质 Admin 端 / 账号安全 / 设备资产） | ✅ 已加 §3.6B |
| 14 | `mapping.html` 漏了 Admin `/login`，实际 46 行不是 47 | ✅ 已补 |

第 8 条是**合规错误**，不是笔误——我把「按数据源数量收的接入费」「按在架条数收的托管费」
「按场次收的招聘会服务费」列为可收，而这三项标的都是招聘内容，属**第二类许可前置**。
合规文档明令「不得把第二类包装成第一类」。**这条如果照着做，是真实的法律风险。**

### 11.2 Codex 的反对意见与我的回应

> 以下是 Codex（gpt-5.6-sol / xhigh）对方案**判断层面**的挑战。如实记录，不做辩护式修饰。

| # | Codex 的意见 | 我的回应 |
| --- | --- | --- |
| 1 | **`ai-core` 工作量明显低估**。`contract-review` 是单一异步文本业务，不能证明它能统一同步聊天、结构化简历、ASR/TTS、图片、流式响应和多供应商故障切换；它会成为全站单点与最大爆炸半径 | **部分同意，且这条最该被认真对待。** 方向仍然对——散落的 12 处各写各的必须收敛。但我确实低估了协议差异：**ASR/TTS/图片根本不是 chat completions 协议，不应强行并入**；流式聊天与结构化生成的错误处理也不同。**修正口径**：ai-core 只统一「结构化文本生成」这一类（简历/岗位/政策/面试出题/报告），聊天走网关但保留流式旁路，ASR/TTS/图片**只接计量与配额、不接调用链**。逐能力切流、每次可回滚。 |
| 2 | **文件预算不可信** | **同意。** 已改为 ≥4 模型 + ≤22 文件，但仍是估算。真实预算应在 S1 设计评审后重定。 |
| 3 | **「新增 0 页」只能作为导航减法，不能作为工程事实**。六类 AI 治理任务权限、数据量、操作风险都不同；即使视觉做 Tab，也需要独立子路由、深链、权限和按需加载，硬塞会制造新的 800+ 行巨页 | **完全同意，必须写进口径。** 「新增 0 页」是**导航层面**的承诺（不新增侧栏项、不新增顶级路由），**不是**「塞进一个组件就行」。工程上仍需：子路由 `/ai-config/:capabilityKey`、Tab 深链、按能力的权限校验、按需加载。**S1.5 的组件拆分正是为此**。 |
| 4 | **分期顺序不现实**，效果统计第一步不依赖 ai-core，却被绑在最大基础设施改造之后 | **同意，已修**（S4a 独立）。 |
| 5 | **S6 不能先于 Admin 商业闭环** | **同意，已修**。 |
| 6 | **「每页都加 AI」本身值得反对**。401、超时、字段缺失、过期日期、对账差异首先是确定性规则与自动化，不该为了覆盖率包装成生成式 AI | **强烈同意，这是最重要的一条。** 见 §11.3 的口径修正。 |
| 7 | **N=5 不是完整隐私方案**。多维筛选、时间窗口、重复导出可通过差分推断小样本 | **同意。** 补充要求：维度粗化（低于阈值时合并到上级分类）、查询预算（同一机构单位时间的下钻次数上限）、导出限制（导出走审批 + 水印 + 审计）、跨查询一致性抑制。这些必须在 S4b 一并设计，不能只做一个 N=5。 |
| 8 | **合作机构持证不能替代平台自身许可** | **同意，已写进 D2**。资质核验是治理义务，不是收费依据。 |

### 11.3 口径修正：把「每页都有 AI」改成「每页都有明确的智能化定位」

Codex 第 6 条指出的问题是真实的：我在 §8 建了 47 页 AI 覆盖矩阵，
形式上对齐了前台 V3 的纪律，**但把一批本该是确定性规则的东西写成了「AI 什么什么」**。

**修正后的口径**（§8 全部按此重读）：

| 层 | 是什么 | 该用什么 | 例子 |
| --- | --- | --- | --- |
| **L1 规则** | 确定性判定，结果可复现，零 token | 代码规则 | 字段缺失、薪资区间跨度、截止日已过、401 归因、对账差异码、链接可达性、重复检测 |
| **L2 聚合** | 统计与排序，无语言理解 | SQL / 聚合 | 告警同类聚合、成本突增检测、审核积压排序、效果漏斗 |
| **L3 模型** | **只有需要语言理解或生成时才用** | LLM | 疑似歧视表述判定、内容改写、政策结构化、企业简介生成、自然语言转筛选条件 |

**开发时的硬要求**：
- 每个「AI 能力」在附录 C 登记时**必须标注属于 L1/L2/L3**。
- **L1/L2 不得调用模型**，也不得在界面上标「AI」——标 E1/E2 即可。
- 前台已经用 E1/E2/E3 区分了证据等级，后台沿用同一套，**不要再造「AI 感」**。
- §8 矩阵里标 🔧补强 的 14 页，**大部分应落在 L1/L2**——重读一遍，把不需要模型的降级。

这条修正会让「AI 覆盖」的数字变小，但**产品更诚实、成本更低、故障面更小**。

### 11.4 开工前必须冻结的 10 项 —— **已全部写入开发规格（2026-08-11）**

> ✅ 这 10 项已落成 [`docs/api/console-ai-dev-spec-2026-08.md`](../api/console-ai-dev-spec-2026-08.md)（12 部分，1136 行）。
> 下表保留原始清单作为对照，「落点」列指向规格中的具体章节。

| # | 必须先补 | 落点 |
| --- | --- | --- |
| 1 | **唯一 IA 冻结** | ✅ 规格 §3（Admin/Partner 路由表 + 子路由深链 + Tab 工程要求 + 拆分清单） |
| 2 | **完整 API 契约** | ✅ 规格 §7（通用约定 + Admin 四组 + Partner 全量 + 请求体示例 + 字段级权限） |
| 3 | **数据模型 DDL** | ✅ 规格 §4（7 张新表完整 Prisma + 约束 + 索引 + 4 处加列） |
| 4 | **状态机转移表** | ✅ 规格 §8（8 张转移表，含 `reviewing` 进入路径的 A/B 二选一） |
| 5 | **权限与租户模型** | ✅ 规格 §9（9 个 AI 权限点 + capability 投影 JSON + 三类子角色 + 隔离测试） |
| 6 | **统计口径字典** | ✅ 规格 §10（指标定义 + 时区去重 + **N=5 之外的四条抑制规则** + 归因取值） |
| 7 | **迁移与回滚** | ✅ 规格 §5（六步配置迁移 + 六批逐能力切流 + `sourceOrgId` 回填 + 回滚原则） |
| 8 | **AI 能力协议** | ✅ 规格 §6（网关八步 + 统一响应契约 + 6 个能力 Schema + L1/L2/L3 分层 + Guard 脱敏与词库） |
| 9 | **逐页验收标准** | ✅ 规格 §11（11 条通用清单 + 7 个阶段门禁 + 上线前一次性验收） |
| 10 | **功能开关与合规闸** | ✅ 规格 §12（5 个开关 + `BILLING_CLASS2_ENABLED` 实现要求 + 发布前合规自检清单） |

### 11.5 可以立刻开工的部分

**不必等上述 10 项**，S0 的五件事是独立缺陷修复，随时可做：

1. ~~企业链断点~~ —— **撤回，早已修复**（详见 §9.2 与规格 §2.1 的更正说明）。
2. **影子测试**——`/ai-config` 的连通性测试不再先写线上配置。
3. **`getUsage` provider 过滤**——修掉 Admin「当前 Provider」统计混算的数据错误。
4. **自我探索诚实降级**——LLM 不可用时不得返回「完成」与确定性分数（违反「不伪造能力」）。
5. **计量补齐**——诊断链路解析 usage；`contract_review`、`poster_generation` 补进 `AiOperation` 枚举。

另外两项**属 P0 合规、不应等到 S7**：隐私治理（PII 遮挡规则与命中记录）、
资质 Admin 审核端（§3.6B 遗漏 ①）。

### 11.6 一句话总判断

> **方案骨架可用，开发规格未成。**
> 47 个页面的定位、对应关系、AI 边界、合规红线都已经定清楚了，
> 但**契约、状态机、权限模型、统计口径、验收标准这五样还没有**——
> 缺了它们，Codex 开发时会在每个交叉口自行决策，最后拼出来的东西不会是一个系统。
>
> **建议路径**：先做 §11.5 的 S0（独立、低风险、高价值）→
> 规格已随本轮补齐（[`console-ai-dev-spec-2026-08.md`](../api/console-ai-dev-spec-2026-08.md)）→
> 产品与技术负责人确认规格后即可启动 S1。
>
> **规格里仍有 3 处需要开发确认后回填**（规格附录第 5 条），以及
> **1 处需要产品拍板的 A/B 二选一**（`reviewing` 状态：实现认领动作 还是 从 UI 移除，规格 §8.4）。

---

## 第十二部分 · 2026-08-11 增补：前端新增内容对应的后台页面

> 触发：产品所有者指出前端岗位页已加入**线上招聘平台**与**线下招聘公司**，
> 并就迎新板块做出产品决策。以下三处页面变更均已出原型，可直接交付开发。

### 12.1 迎新板块的产品决策与依据

产品所有者最初提议**迎新功能对接高校 API 系统**，目标是「减少学校老师工作量，业务直接在机器上办完」。

**调研结论（两轮公开检索 + 一手代码核查）**：

高校「智慧迎新」的标准功能是**在线信息确认、专业调整、录取材料收集、线上线下缴费、
纸质档案登记、宿舍住宿分配、校园卡办理、军训物资发放**，学生通过微信小程序扫码报到、
系统自动匹配新生数据核验。这些**全部是高校内部核心系统能力**：

| 迎新核心能力 | 数据性质 | 第三方终端能否对接 |
| --- | --- | :---: |
| 身份核验（录取通知书号 + 身份证） | 学籍 | ❌ |
| 信息确认 / 专业调整 | 学籍 | ❌ |
| 在线缴费 | 财务 | ❌ |
| 宿舍分配 | 后勤 | ❌ |
| 校园卡办理 | 一卡通 | ❌ |

高校统一身份认证是**校内系统之间**打通（教务、图书馆、财务），受《个人信息保护法》约束、
权限严格控制，未见任何向校外第三方终端开放这些能力的先例。
且本项目是**校外第三方一体机**，定位为「信息入口，不做闭环」（CLAUDE.md §1/§2）——
做迎新登记等于让第三方终端处理学籍与缴费。

**因此「在这台机器上把迎新业务全部办完」不成立。**

**但「减少老师工作量」成立，只是切入点不同。** 迎新期老师最耗时的三件事是
① 重复回答同样的问题 ② 帮学生找地方打印复印 ③ 材料不齐来回跑——
学校的迎新系统解决了「系统里怎么填」，**完全没解决这三件**。

**最终决策（2026-08-11）：迎新板块只保留「证件与材料复印」一个功能。**

理由是候选功能的**依赖度筛选**：

| 候选功能 | 是否依赖学校先录内容 | 结论 |
| --- | :---: | --- |
| AI 迎新问答 | ✅ 依赖（报到流程、办事窗口） | ❌ 没客户就是空壳 |
| 材料齐全度预检 | ✅ 依赖（材料清单） | ❌ 同上 |
| 办事清单打印 | ✅ 依赖（流程） | ❌ 同上 |
| 办事窗口导航 | ✅ 依赖（窗口信息） | ❌ 同上 |
| 扫码去官方系统 | ✅ 依赖（链接），且学生自有手机 | ❌ 价值低 |
| **证件与材料复印** | **❌ 零依赖** | ✅ **保留** |

**选它等于不赌高校客户**：谈成高校它是迎新利器，谈不成它在人社大厅、园区、
人才市场同样是刚需（办社保、办入职、投简历都要复印证件）。
且它不只在迎新期有用，**全年成立**；又是纯第一类服务（打印复印收费），
不碰招聘内容那条许可证红线。

### 12.2 三处页面变更（均已出原型）

| # | 页面 | 变更 | 原型 |
| --- | --- | --- | --- |
| **12A** | Admin `/job-materials` 求职材料库 | **改造**：加「证件复印预设」「材料包」两个 Tab | `admin/job-materials.html` |
| **12B** | Admin `/online-platforms` 线上平台目录 | **新建页**（本轮唯一确需 Admin 新增的页面） | `admin/online-platforms.html` |
| **12C** | Partner `/profile` 机构资料 | **改造**：加「线下机构档案」「线上平台收录」两个 Tab | `partner/profile.html` |

#### 12A 证件复印预设 —— 为什么并进「求职材料库」而不是新建页

该页现管 5 类内容模板（简历模板 / 求职信 / 感谢信 / 作品集封面 / **材料清单**），
管的就是「用户能打印什么材料」。**复印预设与材料清单本就是一对**：清单告诉用户要带什么，
复印帮他现场补齐。符合本方案一贯的「能并进现有页就不新建页」原则。

**能力边界（一手代码确认，不得越界）**：
当前打印正式契约仅 **A4 / 黑白 / 单面 / 每张一页**（`create-print-job.dto.ts:23-52`）。
硬件支持彩色与双面，但驱动控制仍待真机验证（CLAUDE.md §3 明确区分「硬件能力」与「已验证的驱动控制」）。
→ **预设里不得提供彩色 / 双面选项**；证件照排版继续保持前台 disabled +「即将上线」。

**材料包要等后端**：`PrintMaterialPack` 模型虽存在，但只有占位字段
（无会员归属、无文件条目、无批次任务/订单关系），`bundle_render` 只返回 `skeleton/queued:false`；
且后端契约是**单文件**（一个请求一个 `fileUrl`，前端只读 `files[0]`）。
设计已在 `docs/superpowers/specs/2026-07-12-material-pack-design.md`，需 `MaterialPackTask` + `MaterialPackItem`。
→ 该 Tab 先显示「需后端先落地」，**不放可点的假按钮**。

**单个复印预设则完全在现有单文件契约内**，可先落地。

#### 12B 线上平台目录 —— 为什么必须由平台掌握

`OnlinePlatformDirectory` **全局仅 2 处引用**（Prisma client + 一处只读 service），
**两个后台都没有写入口**，而终端正在展示这份目录。

**不能照「线下机构档案」的方式开放给机构**：这是**平台向求职者推荐第三方平台**，
推荐权属于平台的编辑责任。该表字段本身带治理意图——`operatorLegalName`、
`officialDomainsJson`、`evidenceFileId`、**`neutralDescription`（中立描述）**，
最后一个命名说明设计上就要求平台保持中立。开放自助发布，目录立刻变成竞价位。

→ **Partner 只能申请收录 / 提交更新；收录、排序（`displayOrder`）、上下架、
中立描述定稿只在 Admin。** 曝光位不得按曝光 / 按跳转计费（第二类，须先过许可边界审查）。

#### 12C 线下机构档案 —— 与招聘会子实体同类的权责错配

`OfflineAgencyProfile` + `OfflineAgencyBranch` 模型已有，Admin 有完整管理页，
Kiosk 有展示页，**但 `apps/partner/src` 全局搜不到任何入口**——
机构自己的门店地址、营业时间、服务项目要改，只能找平台管理员。
这与 F2（招聘会参展企业/展区/资料全归 Admin）是**同一类权责错配**。

→ 开放给名下确有 `offlineAgencyProfile` 的机构自助维护，**模型零改动**，
只需补 Partner 侧读写 API 与 `orgId` 归属校验；修改后回落 `pending` 走既有审核语义。

### 12.3 一处应当合并的机制

**域名白名单出现三处需求**，应合并为一套，不要各写一份：

| 出处 | 需求 |
| --- | --- |
| C2 政策「官方入口」 | `externalUrl` 需校验官方域名（现仅校验字符串，Kiosk 只要求 http/https） |
| J2 线上平台目录 | `officialDomainsJson` 官方域名白名单 |
| 百宝箱 | `ToolboxAllowedHost` **已有该机制，可复用** |

三处都决定**用户从终端跳到哪里去**，是同一类风险。

---

## 附录 A · 本方案与既有文档的关系

| 文档 | 关系 |
| --- | --- |
| `console-plan-for-kiosk-proto-2026-07.md` §6 | **上级**。IA 减法（M1–M6）、分轨（A/A+/B/C）、红线（§6.10）全部沿用，本方案不推翻 |
| `partner-permission-matrix.md` | **上级**。§4.6 投影表沿用其口径，未新增权限 |
| `compliance-boundary.md` | **上级**。本方案建议向其 §5 增补两条 AI 红线 |
| `kiosk-ai-os-v3-2026-08/closed-loop-map.md` | **对齐源**。AI 覆盖矩阵 30 条是 Admin A1 能力注册表的初始清单 |
| `docs/progress/current-progress.md` | **落地时同步**，不在本文件维护第二份进度 |

## 附录 B · 审查方法与证据来源

- **Claude 侧**：直接读 `apps/admin`（34 页）、`apps/partner`（14 页）、
  `services/api/src/ai`（含 llm/providers/resume）、`services/api/src/contract-review`（30+ 文件）、
  `prisma/schema.prisma`（87 model）、`docs/product` 既有规划。
- **Codex 侧**（gpt-5.6-sol / xhigh，三题并行独立复核）：
  ① AI 服务端底座是否支撑全站 30 个 AI 点；② Admin 治理完整性；③ Partner 功能缺口。
- **交叉结果**：两侧对硬伤 A–F 的判断一致；Codex 额外发现 X1–X10 十条具体缺陷（§3.0）
  并纠正了 Claude 一处数字（Admin 是 34 页不是 40 页）；
  Codex 同时指出 `closed-loop-map.md` 在 `main` 与 5294 版本之间存在版本错位（见文首提示）。

---

*文档结束。本方案为设计交付，不含生产代码改动。*

---

---

## 附录 C · 能力注册表初始清单（开工必备）

> 补充说明：原型 `ai-config.html` 里写的「已注册能力 31」是示意数字。
> **本附录给出有代码依据的真实清单**——开发按这张表建初始记录，不要照抄原型里的数字。

### C.1 第一批：从现有代码直接迁移（19 条，行为不变）

| # | capabilityKey | 来源 | 现读的配置 | 现有 `AiOperation` | 前台落点 |
| --- | --- | --- | --- | --- | --- |
| 1 | `assistant_chat` | 现有 feature key | 自己 | `chatAssistant` | P25/P26 |
| 2 | `resume_diagnosis` | 现有 feature key | 自己 | `parseResume` | P09 |
| 3 | `resume_generate` | 现有 feature key | 自己 | `generateResume` | P10 |
| 4 | `resume_optimize` | 现有 feature key | 自己 | `optimizeResume` | P09 |
| 5 | `mock_interview` | 现有 feature key | 自己 | `interviewQuestion` | P20 |
| 6 | `interview_report` | 拆自 mock_interview | 继承 5 | `interviewReport` | P20 |
| 7 | `job_fit` | **拆自共用键** | 继承 4 | `jobMatch` | P11/P30 |
| 8 | `career_plan` | **拆自共用键** | 继承 4 | `careerPlan` | P22 |
| 9 | `fair_visit_plan` | **拆自共用键** | 继承 4 | `fairVisitPlan` | P17 |
| 10 | `self_assessment` | **拆自共用键** | 继承 4 | `selfAssessment` | P28 |
| 11 | `job_recommend` | **拆自共用键** | 继承 4 | `jobRecommend` | P13 |
| 12 | `job_explain` | **拆自共用键** | 继承 4 | `jobExplain` | P14 |
| 13 | `resume_layout` | 现有 operation 无 key | 未定 | `adjustResumeLayout` | P09 |
| 14 | `intent_classify` | 现有 operation 无 key | 未定 | `classifyIntent` | P01 |
| 15 | `voice_transcribe` | 现有 operation 无 key | 未定 | `voiceTranscribe` | P20/P25 |
| 16 | `voice_synthesize` | 现有 operation 无 key | 未定 | `voiceSynthesize` | P20/P25 |
| 17 | `contract_review` | 独立实现，**未进计量** | 独立 env | ❌ 枚举里没有 | P31 |
| 18 | `digital_human` | 现有 feature key | 自己 | — | 规划中 |
| 19 | `poster_generation` | 现有 feature key | 自己 | ❌ 枚举里没有 | P02（stub） |

**迁移动作**：
- 第 7–12 条是 §1.2 硬伤 A 的六项共用能力，**建独立记录并默认继承 `resume_optimize` 的值**，行为零变化。
- 第 6 条同理（面试报告与出题当前共用一个 key）。
- 第 13–16 条**有 operation 但没有 feature key**——现在配置从哪来需要开发确认后补齐。
- 第 17、19 条的 `AiOperation` 枚举里**根本没有**（`ai-log.service.ts:23-41`），
  这是 §3.0 X5 登记的缺口，**补枚举是 S0 的活**。

### C.2 第二批：本方案新增的后台侧能力（10 条）

| # | capabilityKey | 落点 | 证据级 | 说明 |
| --- | --- | --- | --- | --- |
| 20 | `console_daily_brief` | Admin 工作台 / Partner 工作台 | E1+E2 | AI 每日要点，两端共用一个能力 |
| 21 | `content_prescreen` | 三个信息源审核页 + Partner 内容页 | E1+E3 | 内容预审风险分，Admin 与 Partner 共用 |
| 22 | `content_polish` | Partner 岗位/企业/政策 | E3 | 内容改写，**必须人工采纳** |
| 23 | `mapping_suggest` | Partner Excel 映射步 | E3 | 字段映射建议 |
| 24 | `effect_insight` | Partner 数据统计 | E1+E3 | 效果解读 |
| 25 | `fair_prep_assist` | Partner 招聘会 | E3 | 准备助手 |
| 26 | `alert_attribution` | Admin 告警中心 | E2 | 告警归因聚合 |
| 27 | `audit_nl_search` | Admin 日志审计 | E1 | **只生成筛选条件，不读日志内容** |
| 28 | `company_consistency` | Admin/Partner 企业页 | E1 | 跨来源资料冲突检测 |
| 29 | `ops_failure_attribution` | Admin 打印扫描运维 / 对账 | E1 | 失败模式与差异归因 |
| 30 | `compliance_guard` | 全站出参 | — | 违禁词库与安全闸（**不是生成能力，但需配置面**） |

**合计 29 条能力 + 1 条守卫**。原型里的「31」应按本表校正为 **30**（29 能力 + 1 守卫）。

### C.3 刻意不建 key 的（避免开发误加）

| 不建 | 理由 |
| --- | --- |
| 大屏相关 | §10 定为纯展示面，AI 只做归因文案，复用 `console_daily_brief` |
| 智慧校园 | 前台锁定态，只做规则质检不调模型（§8.2） |
| 面试题库生成 | **当前无后端题库模型**，属新建能力非接线，不在本轮（§3.3） |
| 法务文档 / 隐私工单 / 权限 / 登录 | §8.1 四条「刻意无 AI」理由 |

---

## 附录 D · 三个新数据模型的字段草案（开工必备）

> §2.3 只给了字段组，开发需要精确定义。以下为草案，**字段名可调，语义不可调**。
> 三个模型都要同时进 SQLite 与 PG 两套 schema，并跑双 CI（§6 验证门禁）。

### D.1 `AiCapability`（能力注册表 —— 替代 JSON 文件配置）

```prisma
model AiCapability {
  id                String   @id @default(cuid())
  key               String   @unique          // C.1/C.2 的 capabilityKey
  label             String
  domain            String                     // print/resume/job/fair/interview/policy/me/advisor/console
  kioskPageRef      String?                    // "P09" 等，可反查这个能力长在哪
  status            String   @default("active") // active | planned | disabled

  // 模型绑定
  vendor            String
  model             String
  baseURL           String
  apiKeyEncrypted   String?                    // 只写不回显，沿用现有加密方式
  temperature       Float    @default(0.7)
  maxTokens         Int      @default(4096)

  // Prompt
  promptTemplateId  String?
  promptVersion     Int?
  canaryVersion     Int?
  canaryPercent     Int      @default(0)

  // 证据与降级
  evidenceLevel     String   @default("E3")    // E1 | E2 | E3
  requiresDisclaimer Boolean @default(true)
  disclaimerText    String   @default("AI 判断，仅供参考")
  degradeStrategy   String   @default("disable") // fallback_model | rule_only | disable
  fallbackVendor    String?
  fallbackModel     String?
  degradeMessage    String                      // 直接渲染到前台的降级文案
  degradeAlternatives String @default("[]")     // JSON：还能做什么

  // 闸门
  timeoutMs         Int      @default(30000)
  maxRetries        Int      @default(2)
  circuitThreshold  Int      @default(5)
  dailyBudgetCny    Float?
  perUserDailyLimit Int?
  perOrgDailyLimit  Int?
  overLimitAction   String   @default("degrade") // block | degrade | warn

  // 计费（默认关，等合规结论）
  billable          Boolean  @default(false)
  unitPriceCny      Float?
  billingUnit       String?                     // call | 1k_token | minute | char

  enabled           Boolean  @default(false)
  enabledScope      String   @default("global")  // global | org | terminal | scene
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([domain, enabled])
  @@index([status])
}
```

**迁移脚本要做的事**：读现有 `ai-model-configs.json` → 建 19 条记录（C.1）→
第 6–12 条的模型绑定字段**复制自 `resume_optimize`** → 校验行为一致后再允许分别修改。

### D.2 `AiPromptTemplate` + `AiPromptVersion`（Prompt 版本库）

```prisma
model AiPromptTemplate {
  id            String   @id @default(cuid())
  templateKey   String   @unique               // 与 capabilityKey 一一对应或多对一
  label         String
  lockedPrefix  String                          // 防编造契约 + 合规禁令，管理员只读改不了
  variables     String   @default("[]")         // JSON：{{resumeText}} 等占位符声明
  createdAt     DateTime @default(now())
  versions      AiPromptVersion[]
}

model AiPromptVersion {
  id            String   @id @default(cuid())
  templateId    String
  template      AiPromptTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  version       Int
  role          String   @default("system")     // system | user
  body          String                          // 可调部分，不含 lockedPrefix
  status        String   @default("draft")      // draft | canary | active | archived
  changeNote    String?
  createdBy     String
  createdAt     DateTime @default(now())
  activatedAt   DateTime?

  @@unique([templateId, version])
  @@index([templateId, status])
}
```

**服务端强制**：拼 prompt 时永远是 `lockedPrefix + body`，
提交时校验 body 不得包含试图覆盖 lockedPrefix 的指令，缺失即 422（§3.2 A2）。

### D.3 `AiUsageLedger`（不可丢的计量账本 —— 区别于 best-effort 的 `AiServiceLog`）

```prisma
model AiUsageLedger {
  id             String   @id @default(cuid())
  capabilityKey  String
  orgId          String?                        // ← 硬伤 D 的解法，从 Terminal.orgId 反查
  terminalId     String?
  endUserId      String?
  idempotencyKey String   @unique               // 防重复扣费
  inputFingerprint String?                      // 缓存与去重
  state          String                          // reserved | committed | released
  tokensIn       Int      @default(0)
  tokensOut      Int      @default(0)
  costCny        Float    @default(0)
  cachedHit      Boolean  @default(false)       // 命中缓存时 costCny 必须为 0
  promptVersion  Int?
  modelName      String?
  providerRequestId String?
  createdAt      DateTime @default(now())
  settledAt      DateTime?

  @@index([orgId, createdAt])
  @@index([capabilityKey, createdAt])
  @@index([state])
}
```

**三段式语义**：`reserve`（事前占额度，失败即拒绝调用）→ 调模型 →
`commit`（写实际用量）或 `release`（回滚额度）。
**与 `AiServiceLog` 的分工**：Ledger 在事务内写、失败即失败；
`AiServiceLog` 保持 best-effort 不阻断（§2.3 ⑤）。

### D.4 开工前还需要开发确认的三件事

| # | 待确认 | 为什么方案里定不了 |
| --- | --- | --- |
| 1 | 第 13–16 条能力（排版/意图/ASR/TTS）**现在的配置从哪来** | 它们有 `AiOperation` 但没有 feature key，需读代码确认 |
| 2 | Agent 侧能否读到打印机**耗材余量数值** | 取决于 WMI 能拿到什么，决定 §10 的 M13 模块做不做 |
| 3 | `contract_review` 并入网关的改造成本 | 它有独立 env、独立 transport、独立 prompt，是否值得并入需实测 |

---
