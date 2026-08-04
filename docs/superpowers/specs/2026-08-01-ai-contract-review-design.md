# AI 合同审查专业方案设计

> 状态：待用户书面复核
> 日期：2026-08-01
> 适用产品：职易达 AI-Native 就业服务操作系统
> 功能位置：百宝箱内置候选微应用 `contract-review`
> 设计评审：Codex 主审，Claude / Antigravity / Cursor 只读交叉评审

## 1. 结论

合同审查应建设为百宝箱中的首方、受限、会话级 AI 工作流，面向求职者本人分析劳动合同、实习协议、竞业限制协议和 Offer。它不是律师服务，不提供确定性法律结论，不向企业或合作机构回传合同、审查结果或求职者画像。

技术上采用“复用基础设施、隔离业务领域”的方案：

- 复用 `FileObject`、私有对象存储、短期签名 URL、百度 OCR、AI provider、`AuditLog`、PDF 派生打印和百宝箱治理。
- 新建独立 `contract-review` 后端模块、共享契约和领域任务模型。
- 不把合同审查塞入 `AiResumeResult`、普通助手聊天或现有通用 `DocumentProcessTask.resultJson`。
- 新增合同视觉提取、合同分析和合同安全闸三个逻辑处理层，复用既有 OCR、AI provider、文件与审计基础设施；`VisionAI`、`AdvisorAI.ContractReview` 和 `ContractReviewSafetyGate` 是产品架构映射与领域命名，不是假设代码中已存在统一引擎注册框架。
- P0 原合同和审查结果均按会话级留存，默认最长两小时，不进入“我的文档”长期保存。
- P0 支持会员与匿名一次性会话。会员使用独立 `contract_review` AI 授权 scope；匿名会话把敏感信息单独同意快照绑定到任务，两类会话都不长期保存。
- 当前处于上线前收口阶段，本功能不得插入现有上线 P0；只能在现有上线验收完成后，以独立功能分支、feature flag 和生产默认关闭方式推进。

## 2. 已有事实与约束

### 2.1 已有产品入口

`packages/shared/src/types/toolboxMicroApp.ts` 已登记 `contract-review`：

- `status: planned`
- `riskLevel: restricted`
- `productionEnabledByDefault: false`
- `retention: session_only`
- `thirdPartyDataSharing: none`
- `requiresExplicitConsent: true`
- 上线门禁包含法务评审、会话后即弃、首方模型通道、禁止第三方外传和公共屏隐私约束。

清单中的 `requiresHumanReview` 解释为“该微应用版本发布前必须经过异人法务/治理审核”，不表示每份用户合同会发送给真人查看。

因此实现时不得新增首页卡片；应把现有候选项从占位 AI intent 升级为受控站内流程。

### 2.2 已有技术底座

- `FileObject` 已支持私有对象、本人归属、敏感级别、短期签名 URL、过期清理、派生文件和删除审计。
- 百度 OCR provider 已实现真实识别、并发闸、超时、置信度、密钥隔离和“失败不造假”。
- 现有 OCR 只返回整页文字与 high / medium / low 置信度，不返回文字坐标。
- `materials/pii-scan.util.ts` 已有 PDF 文字层、扫描 PDF 逐页渲染、DOCX、图片 OCR、截断和降级语义，可作为合同提取参考，但不直接复用其业务模型。
- `LegalDocVersion` 已支持版本化 `ai_disclaimer`。
- `AuditService` 和会员资产模块已有会员动作 `actorId=null`、`payload.endUserId` 的审计模式。
- PDF 报告、派生 `FileObject` 和打印链路已存在。
- 合同提取必须新建专用 extraction service，不能直接调用简历抽取：现有简历扫描 PDF 页数和 purpose 白名单不满足合同场景，PII 扫描工具也会把带文字层 PDF 合并成 `pageNumber=null` 的文本块，无法满足逐页证据定位。

### 2.3 法律与监管基线

规则包只允许引用已冻结版本的官方来源：

- 《中华人民共和国劳动合同法》：https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html
- 《最高人民法院关于审理劳动争议案件适用法律问题的解释（二）》：https://www.court.gov.cn/zixun/xiangqing/472691.html
- 《中华人民共和国个人信息保护法》：https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_515a4b20c12f430eab54bb4f56d89f56.html
- 《生成式人工智能服务管理暂行办法》：https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm
- 《人工智能生成合成内容标识办法》：https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm

规则包必须记录来源、条款编号、版本、生效日期和适用范围。模型不得自由生成法条编号或自由引用非白名单来源。

## 3. 产品定位与名称

### 3.1 用户名称

页面主标题使用“AI 签约风险提示”，说明文字使用：

> 帮你阅读劳动合同、实习协议、竞业限制协议和 Offer 中需要重点确认的条款。

内部功能 ID 保持 `contract-review`，避免迁移既有百宝箱清单。

### 3.2 输出边界

允许输出：

- 对应原文的最短必要摘录。
- 需要优先核实、建议关注或信息不足的事项。
- 白名单官方依据和通俗解释。
- 用户可向 HR、学校或用人单位询问的问题。
- 模型无法核实的外部事实和不确定性。

禁止输出：

- “本条违法”“合同无效”“一定能胜诉”等确定性法律结论。
- 仲裁胜率、赔偿金额承诺、录用或就业结果承诺。
- 起诉状、仲裁申请书、律师函等诉讼文书。
- 面向企业的合同评分、候选人评分或用工决策。
- 把合同、报告或求职者信息发送给企业、合作机构或第三方百宝箱应用。
- 以“未识别到风险”替代“合同安全”。

### 3.3 人工法务边界

P0 不提供逐份合同的真人法务复核。人工法务只负责：

- 审核规则包、免责声明和输出禁用措辞。
- 标注脱敏评测样本。
- 对版本发布做盲审和签字。

真实用户合同默认不进入人工坐席。复杂事项只提示用户咨询当地人社部门、劳动仲裁咨询窗口或持证律师，避免为人工复核扩大内部合同可见范围。

## 4. P0 范围

### 4.1 支持文件类型

- 劳动合同。
- 实习协议。
- 竞业限制协议。
- Offer / 录用通知书。

每类文件使用独立规则包。实习协议和 Offer 不自动认定为劳动合同；系统只提示“文件性质可能受实际用工事实影响”，不作关系定性。

### 4.2 支持格式与边界

- PDF：支持带文字层 PDF 和扫描版 PDF。
- DOCX：支持正文文字提取。
- 图片：支持项目现有图片 MIME 白名单。
- 旧版 `.doc`：P0 明确提示格式不支持，建议另存为 PDF 或 DOCX。
- 带文字层 PDF：最多 50 页。
- 扫描版 PDF：最多分析前 20 页；超过时拒绝给出“完整审查”结论，并引导拆分文件。
- 现有 PII 扫描默认 OCR 页数为 5 页；合同场景的 20 页是专用上限，不修改通用默认值。20 页任务可能持续数分钟，Kiosk 必须展示真实页数进度，并通过专用队列并发、超时和灰度压测控制对现有 OCR 流量的影响。
- 扫描版 PDF 不在创建请求内同步逐页识别，而是进入合同审查专用异步队列。单任务逐页识别，实时记录已完成页数；队列只展示真实的等待、页数和阶段，不展示估算百分比。
- 单任务 OCR 总时限为 5 分钟。超过时整次分析诚实失败，不把只识别部分页面的结果送给 LLM，也不生成部分审查报告。
- 合同专用 extraction 对带文字层 PDF 按页构建 canonical text；扫描版 PDF 逐页 OCR。任一必需页面识别失败时整次提取失败，不沿用简历或 PII 工具的部分成功语义。
- 单文件上限沿用现有服务端上传限制，不由前端单独放宽。

### 4.3 首期规则目录

1. 合同主体和文件类型是否清楚。
2. 合同期限和续签表述。
3. 试用期期限、次数和试用期工资。
4. 薪资组成、支付时间、绩效条件和可变部分。
5. 岗位、工作地点、调动范围和职责变更。
6. 工时、加班、休息休假和加班费表述。
7. 社会保险和公积金相关约定。
8. 培训服务期、培训费用和服务期违约责任。
9. 普通违约金、赔偿和扣款条款。
10. 竞业人员、商业秘密接触事实、范围、地域、期限和经济补偿。
11. 扣押证件、保证金、押金和入职收费。
12. 解除、终止、通知、交接和离职限制。
13. 单方解释权、任意调岗调薪等明显失衡表述。
14. Offer 中薪资、入职条件、背景调查、撤回条件和正式合同衔接。

规则目录按可判定条件分层：

- **地域无关确定性规则**：仅在所需事实完整时计算，例如合同期限与试用期期限对应关系、竞业期限上限、扣证/收取财物、违约责任适用范围等。
- **地域相关规则**：试用期工资最低保障、竞业经济补偿是否达到当地口径等，需要 `locality + 数据版本 + 官方来源`。P0 未建立经法务确认的地域数据集前，只输出“请结合当地现行标准核实”，不得给出达标或不达标判断。
- **语义提醒**：薪资结构、调岗范围、背景调查条件等由模型识别，但必须以证据和不确定性呈现，不计入确定性规则命中指标。

Gate 0 由法务从上述目录签字冻结 P0 首发子集；未完成地域数据治理的规则不得为了凑齐 14 类而伪装成确定性判断。

## 5. AI-Native 技术设计

### 5.1 逻辑处理层与产品架构映射

```text
合同视觉提取层（产品架构映射：VisionAI）
  文件类型感知、PDF 页面渲染、OCR、置信度和页码覆盖
        ↓
合同分析层（产品架构映射：AdvisorAI.ContractReview）
  合同分类、条款切分、字段抽取、语义风险解释、沟通问题生成
        ↓
ContractRuleEngine
  试用期、违约金、竞业期限等可计算和可验证规则
        ↓
ContractReviewSafetyGate（合同领域新服务）
  引用白名单、证据一致性、禁用结论词、提示注入和隐私输出检查
        ↓
结构化风险提示报告
```

### 5.2 VisionAI

P0 必须输出：

- 每页文字。
- 页码。
- OCR 置信度。
- 实际分析页数与文档总页数。
- 是否截断。
- 文件提取模式：`text_layer | ocr | mixed`。

现有百度 OCR 使用 `accurate_basic`，不返回坐标。因此：

- P0 证据定位使用 `pageNumber + excerpt + charRange`。
- P0 不承诺像素级高亮框。
- 后续若切换到支持 `location` 的百度接口或其他 provider，再新增可选 `boundingBoxes`，不得为了界面效果伪造坐标。

### 5.3 合同分析层（AdvisorAI.ContractReview）

LLM 只负责：

- 判断四类文件中的最可能类型并给出置信度。
- 把文本切成稳定条款段。
- 抽取规则引擎需要的候选字段。
- 识别模糊、单方或语义不利表述。
- 将规则命中转成通俗解释。
- 生成中性、非对抗的核实问题。
- 明确列出未提供或无法从合同中确认的事实。

LLM 不负责最终计算试用期是否合法、法条是否存在、竞业条款是否必然有效或任何赔偿金额。

### 5.4 ContractRuleEngine

规则引擎使用版本化纯函数，不联网、不调用模型。每条规则包括：

- `ruleId`
- `rulePackVersion`
- `appliesTo`
- `effectiveFrom`
- `sourceDocumentId`
- `sourceArticle`
- `requiredFacts`
- `evaluate()`
- `outputTemplate`

只有输入事实完整且规则能够确定计算时，才输出“与规则上限不一致，建议核实”。缺少合同期限、试用期或岗位涉密事实时，输出“信息不足”，不得推断。

### 5.5 ContractReviewSafetyGate

`contract-review-safety-gate.service.ts` 是合同领域从零实现的输出闸门，不等同于项目部署门禁。它必须在结果返回用户前完成：

1. JSON Schema 严格校验。
2. `basisRef` 必须存在于规则包白名单。
3. 原文摘录必须能在本次已分析文本中定位。
4. 禁止输出确定性法律结论、诉讼承诺、招聘闭环和企业侧能力。
5. 检测已知提示注入标记并验证输出未引用其指令语义；真正的边界由“合同只作为纯数据、模型无工具权限、系统提示与数据结构隔离、输出 schema 与白名单校验”共同保证，不声称能从输出侧证明系统指令从未被改变。
6. 检查输出未包含非必要身份证号、银行卡号、手机号和住址。
7. OCR 低置信、截断或字段冲突时强制增加不确定性说明。
8. 规则引擎与 LLM 冲突时，以规则引擎和“建议核实”口径为准。

SafetyGate 无法修复的输出必须 fail closed，返回“本次无法可靠完成分析”，不能把未校验的模型文本展示给用户。

未校验的 LLM 原始输出只允许存在于当前 worker 内存中：

- `ai_analyzing` 和 `safety_reviewing` 阶段，数据库中的 `resultJson` 必须保持 `null`。
- SafetyGate 全部通过后，在同一数据库事务中一次性写入最终 `resultJson` 并把状态更新为 `completed`。
- `GET /contract-reviews/:id` 只有在状态为 `completed` 时才返回 `resultJson`。
- SafetyGate 失败时只落安全错误码和脱敏错误信息，原始模型输出不得落库、进日志或进入审计 payload。

## 6. 结构化结果契约

### 6.1 汇总

结果不使用百分制或“安全分”。汇总只显示：

- `priorityCheckCount`
- `attentionCount`
- `insufficientInfoCount`
- `coverage`
- `ocrConfidence`
- `disclaimerVersion`
- `rulePackVersion`
- `generatedByAi: true`

### 6.2 单条发现

```typescript
interface ContractReviewFinding {
  id: string
  category: ContractReviewCategory
  priority: 'priority_check' | 'attention' | 'insufficient_info'
  title: string
  evidence: {
    pageNumber: number | null
    excerpt: string
    charStart: number | null
    charEnd: number | null
  }
  explanation: string
  basisRef: string | null
  verificationQuestion: string
  uncertainty: string
  source: 'rule' | 'ai' | 'rule_and_ai'
}
```

`excerpt` 只保存理解该风险所需的最短片段。完整 OCR 文本不得写入 `resultJson`、日志或审计 payload。

`charStart` / `charEnd` 定义为当前页 canonical text 中的 UTF-16 code unit 偏移：

- canonical text 统一使用 Unicode NFC、LF 换行，不合并连续空白。
- 每页独立编号和计算偏移，不使用跨页拼接全文偏移。
- `excerpt` 必须严格等于 `canonicalPageText.slice(charStart, charEnd)`。
- mixed 模式也先按页生成唯一 canonical text，再执行条款切分、规则和 LLM。
- SafetyGate 使用同一 canonical page buffer 验证摘录；偏移不一致则拒绝该 finding。

## 7. 数据模型与状态机

### 7.1 独立领域模型

P0 使用一个聚合表 `ContractReviewTask`，同时承载任务状态和版本化结构化结果：

```text
id
endUserId?
accessTokenHash?
sourceFileId
resultFileId?
contractType
status
consentVersion
consentedAt
consentScopeHash
disclaimerVersion
rulePackVersion
schemaVersion
ocrProvider
ocrConfidence?
analyzedPages
totalPages?
truncated
professionalConsultationRecommended
aiProvider?
aiModel?
resultJson?
errorCode?
errorMessage?
expiresAt
createdAt
updatedAt
```

必须建立以下索引，并在 SQLite 与 PostgreSQL 两套 schema 中保持一致：

- `@@index([endUserId, createdAt])`
- `@@index([accessTokenHash])`
- `@@index([status, updatedAt])`
- `@@index([expiresAt])`
- `@@index([sourceFileId])`

所有 string enum 均由应用层校验，避免 SQLite / PostgreSQL enum 差异。`resultJson` 使用 `String`，与现有双库兼容模式一致。

归属约束：

- 会员会话：`endUserId` 必填，`accessTokenHash` 为空。
- 匿名会话：`endUserId` 为空，`accessTokenHash` 必填。
- 应用层强制两者恰好存在一个。
- 查询和删除统一使用“任务 ID + 本人身份或一次性 token”，不存在与无权访问统一返回 404。
- 匿名明文 token 只允许保存在当前 Kiosk 页面的易失内存中，不得写入 URL、日志、localStorage、sessionStorage、IndexedDB 或其他持久化缓存；离席、超时、刷新、返回首页和切换技能时必须与合同 store 一并销毁。

### 7.2 文件模型

新增 `FilePurpose = 'contract_upload'`：

- `sensitiveLevel = highly_sensitive`
- `visibility = private`
- `assetCategory = original`
- `retentionPolicy = system_short`
- `retentionLockedReason = contract_review_session_only`
- 默认过期时间与合同任务一致，最长两小时。
- 现有 `highly_sensitive` 全局默认 TTL 为一小时；实现必须在服务端为 `contract_upload` 增加显式、不可由客户端覆盖的两小时 purpose-specific TTL，不能直接依赖全局默认值。
- 创建任务、原件和派生报告时使用同一个服务端计算出的 `sessionExpiresAt`，避免三处各自计算导致漂移。
- 上传入口通过服务端 `expiresAtOverride=sessionExpiresAt` 写入文件；客户端不得提交或延长该值。
- 会话完成、离席退出或用户主动删除是首要删除触发；两小时 `expiresAt` 只是异常中断、浏览器崩溃或清理失败时的兜底上限，不得把公共终端数据默认保留到 TTL 才处理。

生成报告：

- `purpose = print_doc`
- `assetCategory = derived`
- `sourceFileId` 指向合同原件。
- 过期时间不得晚于任务过期时间。

### 7.3 状态机

```text
uploaded
  → queued
  → extracting
  → awaiting_confirmation
  → rule_checking
  → ai_analyzing
  → safety_reviewing
  → completed

任一处理中状态 → failed | cancelled | expired
```

状态只能按白名单转换。重试创建新的 attempt metadata，但不复制合同原文。过期和取消后的任务不可恢复。

异步 worker 必须遵守：

- 同一任务内逐页 OCR，避免单份长合同占满百度 OCR 全局并发槽位。
- `analyzedPages` 只在单页识别完成后递增，用于真实进度展示。
- 任务超时、取消或过期后停止调度后续页面。
- 进程重启后由队列重新投递未完成任务；处理逻辑以任务 ID 做幂等检查，不重复生成报告。

清理任务按 `expiresAt` 索引批量领取过期任务，先把任务标记为 `expired` 并阻止新读取，再删除原件和派生报告的对象存储内容，最后保留不含正文的删除审计。对象删除失败时记录脱敏错误码并重试，不得先删除数据库关联导致孤儿对象不可追踪。

## 8. API 边界

建议最小 API：

- `POST /api/v1/contract-reviews`：基于已上传 `sourceFileId` 创建任务。
- `GET /api/v1/contract-reviews/:id`：读取本人任务状态、真实页数进度和最终结果。
- `POST /api/v1/contract-reviews/:id/confirm`：确认合同类型、OCR 覆盖和本人相关声明后启动异步分析。
- `POST /api/v1/contract-reviews/:id/report`：生成短期 AI 标识报告。
- `DELETE /api/v1/contract-reviews/:id`：立即删除本次任务、原件和派生报告。

Kiosk 在 `confirm` 返回 `202 Accepted` 后，以 1.5 秒起步、最大 5 秒的退避间隔轮询 GET；P0 不引入 SSE。会员请求使用现有会员 Bearer token，匿名请求统一使用 `x-contract-review-access-token` 请求头，不使用 query token，避免 token 进入 URL、浏览器历史和代理日志。

P0 不提供任何 Admin 或 Partner 合同审查 API。Phase 4 如增加运营指标，只允许成功/失败数量、合同类型、耗时分位数、错误码和规则包版本，仍不允许读取合同正文、摘录或单份结果。

## 9. 27 寸竖屏交互

### 9.1 入口

- 复用百宝箱现有 `contract-review` 卡片。
- 通过法务和安全门禁后，将内部路由调整为 `/toolbox/contract-review`。
- 同一变更必须把 `contract-review.launch.entryType` 从 `ai_skill` 调整为 `internal_route`，移除 `assistantIntent: contract_review`；否则百宝箱仍会进入通用聊天页。
- 同步更新百宝箱治理快照、静态门禁和发布投影验证，确保历史已发布版本不被静默改写，只有新的审核版本使用站内流程。
- 百宝箱另一候选项 `legal-risk-check` 保持通用知识问答，不接受文件上传，也不允许粘贴整份合同绕过本工作流；识别到长合同文本时只引导进入 `/toolbox/contract-review`，不把正文发送到通用聊天 LLM。
- 保持 `productionEnabledByDefault=false`，由百宝箱治理流程按终端发布。

### 9.2 五步流程

1. **说明与同意**：选择文件类型，阅读 AI、隐私、留存和本人相关声明。
2. **上传或扫描**：本机文件、终端扫描、手机扫码上传或临时文件选择。
3. **完整性确认**：展示页数、旋转、清晰度、识别方式、置信度和截断状态。
4. **真实处理状态**：显示“正在提取文字 / 正在检查规则 / 正在生成解释 / 正在安全校验”，不展示伪造百分比。
5. **风险提示报告**：汇总卡、发现列表、原文证据、核实问题、打印和立即删除。

上传链路统一形成 `purpose=contract_upload`：

- Kiosk 本机 multipart 上传扩展受控 purpose 白名单。
- 手机扫码上传扩展 `UploadSessionsService` purpose 白名单，确认后仍归属于当前一次性合同会话。
- 终端扫描扩展 `scan-tasks` 的目标 purpose，扫描文件不得先以 `print_doc` 落库再无审计转用。
- 三条入口均由服务端推断 `highly_sensitive + private + system_short + sessionExpiresAt`，客户端不能覆盖。

### 9.3 公共屏隐私

- 结果页默认只展示风险卡，不持续铺满完整合同。
- 点击“查看对应原文”后，只展示相关页或最小局部片段。
- 原文片段 30 秒无操作自动模糊。
- 页面持续显示会话剩余时间。
- Kiosk 全局离席退出触发本地状态、Object URL、Canvas 和内存文本引用清理。
- 匿名明文 access token 与任务 ID 只保存在易失内存，并在离席、超时、刷新、返回首页或切换技能时同步销毁；任何前端持久化恢复机制都必须排除合同会话。
- 不使用浏览器不存在的 `window.gc()`；依靠解除引用、撤销 Object URL、清空 store 和组件卸载。
- PDF.js 页面离开或切换时显式执行 `pdfPage.cleanup()`、清空 Canvas、释放渲染任务和销毁文档实例；浏览器验收必须持续循环上传/查看/退出并观测内存不持续增长。
- 页面刷新、返回首页或切换百宝箱技能后不得恢复上一位用户的合同内容。
- 匿名会话刷新后因明文 token 已销毁，正在处理的任务不可恢复；页面必须在上传前和处理中明确提示“刷新将结束本次审查并需要重新开始”，这是公共终端隐私优先的既定取舍，不得静默表现为任务丢失。

### 9.4 结果卡片

每张卡固定顺序：

1. 需要核实的事项。
2. 对应原文。
3. 为什么需要关注。
4. 参考依据。
5. 建议询问的问题。
6. 仍无法确认的事实。
7. “AI 生成，仅供个人参考”标识。

## 10. 免责声明与 AI 标识

### 10.1 三层提示

- 入口：说明服务范围、文件用途、两小时留存和本人相关声明。
- 结果：顶部常驻“AI 生成，仅作风险提示，不构成正式法律意见”。
- 导出/打印：每页含显式 AI 标识、免责声明、规则包版本和生成时间。

### 10.2 文件标识

生成 PDF 除可见页眉/页脚外，还应写入符合项目评估结论的生成合成内容元数据：

- 生成合成属性。
- 服务提供者标识。
- 内容编号。
- 生成时间和规则包版本。

上线前由法务和合规人员依据届时有效的强制标准确认具体字段与编码格式。字段、编码、PDF 写入方式和验证样例属于 Gate 0 阻塞项；未形成可自动验证的显式与隐式标识方案，Phase 4 不得完成。

## 11. 隐私、安全与供应商约束

### 11.1 用户告知与同意

同意页必须明确：

- 处理者名称与联系方式。
- 处理目的和处理方式。
- 文件、OCR 文本和 AI 结果的种类。
- 百度 OCR 与 LLM provider 的受托处理角色。
- 两小时保存期限。
- 查阅、删除和撤回方式。
- 敏感个人信息处理的必要性与影响。

敏感个人信息使用独立勾选，不与一般服务条款捆绑。

版本绑定采用以下方式：

- `LegalDocVersion` 新增专用 `contract_review_disclaimer` 类型，不复用会影响其他 AI 功能的通用文案。
- `UserAiConsent` 新增 `scope=contract_review` 和独立 consent version，会员可在隐私中心撤回。
- 会员任务快照写入有效 `UserAiConsent.consentVersion`、`consentedAt`、免责声明版本和 scope 内容哈希。
- 匿名任务在创建时写入同样的 consent snapshot；未完成独立勾选不签发匿名 access token。
- 撤回同意阻止新任务并立即取消该会员仍在处理中的合同任务；已完成但未过期的会话提供立即删除入口。

### 11.2 最小化

- OCR 和模型只处理完成合同风险提示必需的页面与文字。
- PII 遮蔽仅作用于 LLM 上送文本；OCR provider 必须接收原图或原始页面才能识别，因此 OCR 环节仍会处理未遮蔽内容，必须依靠独立同意、境内 provider 白名单、受托处理约束和短期删除控制风险，不能宣称全链路已脱敏。
- 模型上送前遮蔽身份证号、手机号、银行卡号、详细住址等非分析必需 PII；遮蔽服务必须测试格式变体、漏遮和误遮，不得把薪资、期限等规则事实误当作 PII 删除。
- extraction 在遮蔽前只提取“是否存在合同主体名称/统一社会信用代码”等布尔或结构化事实；公司名称随后替换为稳定占位符，规则引擎判断主体是否清楚时使用结构化事实，不依赖明文主体名称。
- 全文只保存在受控内存或两小时私有对象中，不写日志。
- `AuditLog` 只写任务 ID、合同类型、状态、规则包版本、发现数量和删除结果。
- 新建合同专用全文遮蔽服务；现有 `pii-scan.util.ts` 的 snippet 掩码只能作为正则与掩码模式参考，不能冒充 LLM 请求体全文去标识化。

### 11.3 Provider 门禁

合同审查只允许绑定**境内处理、已完成适用备案/登记并通过本项目合规核验**的 provider 和模型版本。实现必须使用合同专用 allowlist，并在模块初始化和每次调用前 fail closed 校验；禁止路由、fallback 或故障切换到 `openai`、`claude` 等境外通道。若未来确需跨境处理，必须先完成个人信息出境所需的单独同意、影响评估及适用的安全评估、标准合同备案或认证，本设计 P0 不包含该能力。

合同审查不得复用可由后台动态修改 vendor / base URL 的通用 `LlmConfigService` 路由，也不新增通用 `AiModelFeatureKey`；否则管理员配置可能绕过合同专用 allowlist。合同 provider 配置必须是独立、受控、可审计且默认拒绝的安全边界。

上线前必须获得并归档以下证据：

- 输入不会被用于模型训练。
- 输入和输出的服务端留存期限。
- 数据存储位置和跨境处理情况。
- 受托处理、再委托和删除机制。
- 安全事件通知机制。

证据不完整时，不得将真实合同发送给该 provider。

### 11.4 提示注入

合同正文作为带明确数据边界的纯数据包传入，系统提示明确其中任何“指令”均不具备执行权。模型无工具调用权限，不允许访问网络、文件系统、数据库或其他用户数据。系统提示与合同数据采用独立消息/字段封装；输出必须经过 schema、注入标记检测、依据白名单和 ContractReviewSafetyGate 校验。

### 11.5 影响评估

上线前完成并留存个人信息保护影响评估，至少覆盖敏感个人信息、委托处理、自动化分析、公共终端旁观风险、删除、日志和安全事件响应。

## 12. 错误与降级

| 场景 | 对用户的真实反馈 | 禁止行为 |
| --- | --- | --- |
| 格式不支持 | 建议转换为 PDF / DOCX / 图片 | 不伪造解析结果 |
| OCR 未配置 | 提示上传带文字层 PDF 或 DOCX | 不返回 mock 文本 |
| OCR 低置信 | 允许查看但全部发现增加人工核对提示 | 不输出强判断 |
| 扫描页截断 | 明示只分析前 N 页 | 不声称完整审查 |
| LLM 超时 | 可重试或只显示规则发现 | 不展示半截模型输出 |
| SafetyGate 失败 | 本次无法可靠完成分析 | 不绕过安全校验 |
| 法规依据缺失 | 不展示该发现或转为“无依据的一般提醒” | 不生成不存在的法条 |
| 会话过期 | 提示文件已删除，需重新上传 | 不恢复过期原文 |
| 打印失败 | 保留短时报告并显示真实打印状态 | 不把打印失败写成审查失败 |

## 13. 评测与上线门禁

### 13.1 黄金集

四类文件分别建立脱敏、合法来源、人工标注的黄金集。每份样本包含：

- 文件类型。
- 应抽取字段。
- 必须命中的确定性规则。
- 可接受的语义提醒。
- 不应出现的误报。
- 对应页码与原文证据。
- 需要降级或信息不足的事项。

真实用户合同不得直接进入黄金集。

### 13.2 自动化指标

- 地域无关且输入事实完整的确定性规则固定样本命中率：100%；地域相关规则在没有 `locality + 已冻结数据版本` 时只验收“信息不足/建议核实”，不计入确定性命中率。
- `basisRef` 白名单有效率：100%。
- 结构化 schema 通过率：100%。
- 合同正文进入应用日志、审计 payload、AI 调用日志次数：0。
- 越权读取他人任务成功次数：0。
- OCR 截断但报告为完整分析次数：0。
- 禁用确定性法律结论命中次数：0。
- 定义好的提示注入红队样本绕过次数：0。
- 页面刷新、超时和切换用户后恢复前一用户合同次数：0。

法务标注集的语义风险召回率、精确率和证据定位率由法务在 Gate 0 确认阈值；未签字确认阈值前不得上线，不在设计文档中伪造一个看似专业但无样本依据的百分比。

### 13.3 必测类型

- 规则引擎单元测试。
- DTO、schema 和状态机单元测试。
- 文件归属、访问、删除和过期集成测试。
- SQLite 主验证与 PostgreSQL schema parity。
- OCR disabled / failure / low confidence / truncated 集成测试。
- LLM schema、禁词、法条引用和提示注入测试。
- 1080×1920 Kiosk 浏览器测试。
- Windows 真机触控、离席、断网、重启和打印验收。
- 法务盲审和隐私影响评估复核。

## 14. 实施阶段

### Gate 0：法务、隐私和供应商基线

- 冻结四类文件规则目录和非目标。
- 法务定稿免责声明、禁用措辞、规则依据和黄金集。
- 完成个人信息保护影响评估。
- 完成 OCR / LLM provider 数据处理核验。
- 固定合同专用境内 provider/model allowlist，验证配置错误、不可用和故障切换时均 fail closed，且不会 fallback 到境外通道。
- 由法务/合规确认并完成本功能适用的算法备案、生成式 AI 服务安全评估或其他上线登记；如书面认定不适用，必须归档判断依据。该结论不得以底层模型 provider 已备案替代职易达作为面向用户服务方的自身义务评估。
- 冻结生成合成内容显式/隐式标识实现及自动验证样例。
- 决定法务评测阈值并签字。

### Phase 1：领域契约与提取链

- 新增共享合同审查契约。
- 新增 `contract_upload` 文件用途和两小时锁定留存策略。
- 新增 `ContractReviewTask` 双库模型与 additive migrations。
- 建立 PDF / DOCX / 图片提取和覆盖率结果。
- 建立合同审查异步队列、worker、5 分钟总时限、取消与幂等恢复。
- 扩展 Kiosk multipart、手机 UploadSession、终端 ScanTask、object key 和“我的文档”排除规则，使三条上传路径都只能产生短期 `contract_upload`。
- 新增 `contract_review_disclaimer` 和 `UserAiConsent.scope=contract_review` 的版本化同意闭环。
- 新增合同审查 verify 骨架。

### Phase 2：规则、AI 和 SafetyGate

- 建立四类版本化规则包。
- 接入合同分析层的结构化抽取与解释。
- 接入 PII 遮蔽、引用白名单、证据校验、禁用结论词和提示注入防护。
- 定义 page-local canonical text 与 UTF-16 char range，并用同一 buffer 做证据验证。
- 建立失败、重试、取消、过期和删除闭环。

### Phase 3：Kiosk 站内流程

- 接通百宝箱已有候选项，不新增首页入口。
- 把 `contract-review` 启动策略从 `ai_skill` 更新为 `internal_route`，同步治理快照和静态门禁。
- 完成五步竖屏流程和公共屏隐私保护。
- 完成 page + excerpt + charRange 证据定位。
- 保持生产默认关闭。

### Phase 4：报告、打印与验收

- 生成带显式和隐式 AI 标识的短期报告。
- 接入既有打印链路。
- 完成全量验证、红队、法务盲审和个人信息保护复核。
- 在 1–2 台测试终端灰度，完成真机门禁后再通过百宝箱治理发布。

## 15. 实现文件预算

实施预计修改或创建 32–40 个文件。若 Gate 0 评估超过该预算，必须把“报告打印”或“匿名扫码上传”拆为后续独立计划，不得继续扩大单次实现：

### 共享契约

- `packages/shared/src/types/contractReview.ts`
- `packages/shared/src/types/file.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/types/toolboxMicroApp.ts`
- `packages/shared/src/types/legalDocs.ts`
- `packages/shared/src/types/member-privacy.ts`

### 后端

- `services/api/src/contract-review/` 下 9–12 个聚焦文件：module、controller、service、queue、worker、extraction、rule-engine、LLM、SafetyGate、PDF、DTO。
- `services/api/src/files/file.types.ts`
- `services/api/src/files/file-validation.ts`
- `services/api/src/files/retention-policy.ts`
- `services/api/src/files/dto/kiosk-upload-options.dto.ts`
- `services/api/src/upload-sessions/upload-sessions.service.ts`
- `services/api/src/upload-sessions/upload-sessions.dto.ts`
- `services/api/src/storage/object-key.ts`
- `services/api/src/scan-tasks/` 的合同扫描 purpose 契约与服务落点
- `services/api/src/member-assets/member-assets.service.ts`，明确排除 `contract_upload`
- `services/api/src/member-privacy/` 的 `contract_review` scope
- `services/api/src/legal/` 的 `contract_review_disclaimer` 类型
- `services/api/src/app.module.ts`
- `services/api/prisma/schema.prisma`、PostgreSQL 同步 schema 与 SQLite / PostgreSQL additive migrations。
- `services/api/src/contract-review/contract-review.cleanup.task.ts`
- `services/api/scripts/verify-contract-review.ts`
- 根或 API `package.json` 的 verify 命令接线。
- 百宝箱治理与发布投影 verify，锁定 `internal_route` 新版本且不改写历史版本。
- PostgreSQL schema sync check 和 CI job 接线。

### Kiosk

- `apps/kiosk/src/pages/toolbox/contract-review/` 下 3–5 个页面、组件和 hook。
- `apps/kiosk/src/services/api/contractReview.ts`
- `apps/kiosk/src/routes/index.tsx` 路由注册。
- `apps/kiosk/src/auth/kioskSensitiveSession.ts` 注册合同会话清理。
- 手机 UploadSession 与终端 ScanTask 的合同上传接线。
- 相关浏览器 verify。

普通源码文件控制在 500 行内，规则数据与规则执行器分离；不得把上传、状态机、LLM、规则、PDF 和审计堆进一个 service。

## 16. 最终决策记录

1. 使用已有百宝箱候选入口，不新增首页入口。
2. 对外名称为“AI 签约风险提示”，不宣传为律师审查。
3. 新增合同视觉提取、合同分析和 `ContractReviewSafetyGate` 三个逻辑层，并映射到产品架构中的 VisionAI / AdvisorAI；复用现有 provider 和基础设施，不假设代码中存在统一引擎注册表。
4. 新建独立 `contract-review` 领域模块和 `ContractReviewTask`，不复用 `AiResumeResult` 或通用材料任务作为主存储。
5. P0 支持会员与匿名一次性会话，但均不长期保存。
6. 合同原件、OCR 文本和结果默认最长两小时，P0 不进入“我的文档”。
7. P0 证据定位为页码、摘录和字符区间，不宣称当前 OCR 不具备的像素坐标。
8. 规则引擎负责可计算判断，LLM 负责语义理解和解释，SafetyGate 负责最终放行。
9. 不提供逐份真人法务复核；人工法务审核规则、样本和发布版本。
10. 现有上线 P0 完成前不开发、不发布；后续独立分支、feature flag、默认关闭、灰度上线。
11. 合同原件使用服务端锁定的两小时 purpose-specific TTL，不受现有 highly-sensitive 一小时默认值提前截断。
12. 未经 SafetyGate 的 LLM 输出不落库；最终结果与 `completed` 状态在同一事务中原子提交。
13. 长任务使用 BullMQ 异步 worker 和 GET 轮询；P0 不引入 SSE，也不在 HTTP 请求内同步处理 20 页扫描件。
14. 匿名访问 token 固定使用 `x-contract-review-access-token` 请求头，禁止 query token。
15. `legal-risk-check` 不接受合同全文，避免绕过合同文件、同意、留存和 SafetyGate 链路。
16. 合同任务只能使用合同专用境内 provider/model allowlist，禁止 fallback 到境外通道；服务方算法备案与生成式 AI 安全评估适用性结论属于 Gate 0 硬门禁。
17. 会话结束或离席优先立即删除，最长两小时 TTL 仅作异常兜底；匿名明文 token 只存在于前端易失内存。

## 17. 设计自检

- 无占位字段、模糊后补项或未定义状态。
- 产品范围、数据模型、API、留存和 UI 口径一致。
- 与现有百宝箱 `restricted + session_only + production disabled` 基线一致。
- 明确修正了外部评审中“当前 OCR 已支持坐标”和“浏览器可调用 `window.gc()`”两项不符合实际代码的假设。
- 未扩大为企业合同审查、法律服务平台、诉讼服务或招聘闭环。
- 实施前仍需用户对本设计文档进行书面复核；复核通过后再生成逐任务实施计划。
