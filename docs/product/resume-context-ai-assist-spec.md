# 简历智能上下文与 AI 辅助填写契约

> 状态：Gate 0 契约已批准，功能未开发、未部署
> 日期：2026-08-06
> 适用端：Kiosk；后续可复用到微信小程序，但必须复用同一服务端契约和隐私边界
> 审查依据：[双模型审查报告](../reviews/kiosk-resume-context-ai-assist-audit-2026-08-06.md)

## 一、目标与归位

本能力用于减少求职者在已有页面里重复填写简历事实和重复选择岗位方向。产品名称固定为“简历智能上下文”，页面动作统一使用“用简历建议填写”。

它是既有简历、岗位、招聘会、面试和政策页面的横向辅助能力，不是新的业务中心，不新增首页磁贴、底部 Tab、同义入口或“AI 填表中心”。

标准交互：

```text
选择本人简历
→ 生成字段级建议
→ 查看来源和可信等级
→ 逐项采用或拒绝
→ 应用到当前页面
→ 可修改、可撤销
```

本能力只生成建议，不提交业务动作。自动投递、预约、签到、支付、打印提交、退款、签名盖章、录音开始、外部跳转和官方申报永远不属于辅助填写。

## 二、本轮范围声明

Gate 0 对应的真实闭环是：把字段、权限、留存、页面映射和验收规则固定为后续实现的唯一输入，防止不同页面各自调用模型、静默覆盖或扩大数据用途。

本轮允许修改：

- `docs/product/resume-context-ai-assist-spec.md`
- `docs/product/feature-scope.md`
- `docs/compliance/compliance-boundary.md`
- `docs/compliance/member-personal-data-retention.md`
- `docs/progress/next-tasks.md`
- `docs/progress/current-progress.md`

本轮禁止修改：

- `apps/`、`services/`、`packages/`、Prisma schema 和 migration。
- 路由、页面、API、生产配置、数据库、密钥、支付和打印扫描硬件链路。
- 任何首页入口、业务入口、外部平台接入或第三方数据回传。

本轮不新增页面、数据模型、服务或依赖。Gate 0 完成不代表试点功能可用。

## 三、字段分层与白名单

### 3.1 原文事实

只有能回指简历原文或用户明确输入的内容才能作为事实建议：

| 字段组 | 允许字段 | 规则 |
|---|---|---|
| 基本信息 | 姓名、手机、邮箱 | 只用于简历生成；其他页面不得获取联系方式 |
| 教育经历 | 学校、专业、学历、开始/结束时间 | 必须有原文证据；学校和学历不得由模型补全 |
| 工作经历 | 公司、岗位、开始/结束时间、职责原文摘要 | 不得新增公司、岗位、年限或成果数字 |
| 项目经历 | 项目名、角色、开始/结束时间、项目原文摘要 | 不得把技能推断成做过的项目 |
| 技能 | 原文明确列出的技能、工具、语言 | 标准化别名必须标注为“标准化” |
| 证书 | 证书名称、取得时间 | 无原文不得生成；不得推断证书等级 |

### 3.2 标准化事实

日期格式、学历枚举、技能别名等可以标准化，但必须同时保留原值、标准化值和规则版本。标准化不能改变事实含义，例如不能把“了解 Java”改成“熟练 Java”。

### 3.3 派生建议

以下内容只能作为候选建议，不能显示为简历事实：

- 经验段候选。
- 行业候选。
- 目标岗位候选。
- 岗位或招聘会筛选关键词。
- 技能归类和同义词。

派生建议默认需要核对；模型自报置信度不能把它升级为事实。

### 3.4 用户偏好

目标岗位、目标城市、工作类型、期望薪资、面试官类型、训练难度、训练时长以及是否携带简历，必须来自用户本次选择或此前明确确认。简历内容不能证明这些偏好。

### 3.5 禁止生成或使用

不得提取、推断、保存或用于推荐：性别、民族、婚育、健康、残障、宗教、政治面貌、户籍性质、低保、失业登记、社保状态等敏感或政策资格属性。政策页面需要这些条件时必须逐项询问，并仅用于当次“申请条件核对参考”。

## 四、建议对象契约

后续实现必须在 `packages/shared` 定义受控类型，禁止模型返回任意 JSONPath。目标语义如下：

```ts
type ResumeAssistSurface =
  | 'resume_generate'
  | 'interview_setup'
  | 'resume_diagnosis'
  | 'job_filters'
  | 'fair_filters'
  | 'policy_checklist'

type SuggestionProvenance =
  | 'exact_text'
  | 'normalized_text'
  | 'derived'
  | 'user_confirmed'

interface ResumeProfileFieldSuggestion {
  id: string
  field: AllowedResumeProfileField
  value: unknown
  originalValue?: unknown
  confidence: 'high' | 'medium' | 'low'
  provenance: SuggestionProvenance
  state: 'suggested' | 'confirmed' | 'edited' | 'rejected'
  sourceSection?:
    | 'basic'
    | 'education'
    | 'experience'
    | 'project'
    | 'skills'
    | 'certificates'
  sourcePage?: number
  evidenceRef?: string
}
```

约束：

1. `field` 必须来自编译期白名单，不能接收前端传入的任意字段路径。
2. `evidenceRef` 只引用本人可见证据；审计和普通日志不得记录证据原文。
3. 字段可信等级不得高于源 OCR/提取可信等级。
4. 百分比“准确率”不得展示给用户。
5. 低可信和 `derived` 建议默认不勾选。
6. 用户确认或编辑后的值优先于任何新建议。

## 五、页面消费矩阵

| 服务域 | 可消费数据 | 只能建议 | 永久禁止代操作 | 阶段 |
|---|---|---|---|---|
| AI 简历服务 | 本人简历事实、已确认偏好 | 诊断方向、生成表单空字段、关键词 | 编造学校/公司/证书/时间/成果；自动导出或打印 | 首批试点 `/resume/generate` |
| AI 面试训练 | 已确认岗位、行业、经验段 | 设置页预选候选、薄弱点训练方向 | 自动开始、自动录音、预生成面试答案、回传企业 | 首批试点 `/interview/setup` |
| 岗位信息 | 已确认岗位/城市/行业、技能关键词 | 列表筛选 chips、现有三档匹配参考 | 自动选岗、收藏、外跳、投递或记录结果 | 后续逐域 |
| 招聘会 | 已确认城市/行业/岗位关键词 | 列表筛选、现有参会准备单 | 预约、报名、签到、外跳、向主办方传画像 | 后续逐域 |
| 政策服务 | 用户当次确认的地区、毕业时间、学历、就业状态 | 官方政策筛选、材料核对清单 | 资格结论、代办、申报、承诺到账 | 后续逐域，风险最高 |
| 打印扫描 | 文件页数、方向、清晰度等确定性元数据 | 气泡式参数提示 | 预置选中、支付、打印提交、签章 | 不接简历画像 |
| 百宝箱 | 当前明确任务名称 | 推荐已审核工具入口 | 向动态第三方工具传简历、画像或联系方式 | 默认不接画像 |
| 智慧校园 | 公开服务目录和公开指引 | 公开导航 | 读取简历画像、采集或填写个人信息 | 当前不接画像 |

首期 `surface` 只允许 `resume_generate` 和 `interview_setup`。新增其他值必须单独完成产品、隐私、合规和验证审查。

## 六、填写与覆盖规则

1. 默认只填空字段，不静默覆盖已有值。
2. 优先级固定为：用户当前手填值 > 用户曾确认值 > 原文事实建议 > 标准化建议 > 派生建议。
3. 覆盖已有值前必须展示当前值、建议值和差异，并由用户单项确认。
4. 应用后提供“撤销本次填写”；用户手动修改后标记为本人修改，AI 不再覆盖。
5. 简历源文件、内容哈希、schema 版本或模型配置变化后，旧建议失效。
6. AI 失败、超时、配额耗尽或证据不足时，保留原表单并允许继续手填。
7. 建议应用只改变页面草稿，不触发保存、导出、付费、打印或外部动作。

## 七、访问、同意与留存

### 7.1 会话级试点

- 用户每次主动选择本人简历，并确认“用于生成当前页面建议”。
- 建议值只保存在 React 内存，不写 `localStorage`、`sessionStorage`、IndexedDB、URL、埋点或错误日志。
- 现有匿名 `taskId + accessToken` 会话机制可以继续用于本人访问，但不得在其中新增画像字段。
- 退出、切换账号、进入待机、硬隐私超时、BFCache 恢复失败或来源简历删除时立即清空。
- 会话试点不提供“以后继续使用”，不新增数据库模型。

### 7.2 生产长期复用候选

只有跨会话需求通过独立隐私评审后，才允许新增 `ResumeProfileSnapshot`：

- 匿名用户不得长期保存；服务端临时快照最长 24 小时，且不得晚于来源简历或 AI 结果到期时间。
- 登录会员未给予专用持久化同意时，同样最长 24 小时。
- 登录会员主动同意 `resume_profile_assist` 后，最长 90 天，且不得晚于来源原始简历到期时间；不提供无限期保存。
- 撤回同意、删除来源简历、删除相关 AI 记录、账号删除或 TTL 到期时必须级联失效并硬删画像内容。
- 持久化 JSON 必须使用可轮换 envelope encryption；密钥只在服务端，行/任务/用户标识进入 AAD。

岗位 AI 授权、文件保存授权和 `resume_profile_assist` 是不同目的，不能互相继承。

## 八、接口与权限边界

后续接口候选：

1. `POST /api/v1/resume/records/:taskId/profile-draft`：按源文件哈希、schema 版本和模型配置幂等生成。
2. `POST /api/v1/resume/records/:taskId/assist`：只接受受控 `surface` 和画像版本，返回该页面白名单内的建议，不提交表单。
3. `PATCH /api/v1/resume/records/:taskId/profile-decisions`：长期复用阶段记录采用、编辑、拒绝及版本冲突。
4. `DELETE /api/v1/resume/records/:taskId/profile-draft`：删除本人建议档案。

所有接口沿用现有会员 `endUserId` 或匿名访问令牌门禁。无凭证、错凭证、过期、来源已删和跨用户访问统一不可见。Admin、Partner、企业、校方和第三方工具不得获得读取接口。

页面当前值在前端本地合并，不把整张表单回传给通用“自动填写”接口。服务端不得接收任意 `surface`、任意字段路径或执行动作名称。

## 九、模型、安全与成本

- 新增独立能力键和日志 operation：`resume_profile_extract`，不借用 `resume_optimize`。
- 同一 `sourceHash + schemaVersion + modelConfig` 只做一次结构化提取；各页面使用确定性 mapper，不重复调用 LLM。
- 模型输出必须经过严格 schema、长度、枚举、证据存在性、禁止字段和 prompt injection 校验。
- 简历里的指令性文字一律作为不可信文档内容，不能改变 system policy、字段白名单或调用工具。
- 限流、超时、熔断、日预算和失败降级必须在试点前完成。
- 普通日志与审计只记录 surface、profileVersion、建议/采用/拒绝数量、可信等级分布、provider、耗时、token 和估算成本；不得记录字段值、证据原文、姓名、电话、学校、公司或文件 URL。
- `AiServiceLog` 只做运维观测，不作为收费账本。

## 十、实施顺序与文件预算

当前上线 P0 完成前不启动功能编码。后续每一波从干净 `main` 新建独立分支：

### Wave 1：共享契约与服务端画像草稿

- `packages/shared/src/types/`：1–2 个文件。
- `services/api/src/ai/resume/`：最多 6 个聚焦文件，分别承载 extractor、validator、mapper、service/DTO。
- `services/api/src/ai/`：现有 controller/module/config/log 最小接线，最多 4 个既有文件。
- `services/api/scripts/`：1 个专项 verify；优先扩展现有 AI 安全门禁。
- 默认不改 Prisma；只有长期复用获批后才单独做 SQLite/PostgreSQL 双 migration。

### Wave 2：两页试点

- 只接 `/resume/generate` 与 `/interview/setup`。
- Kiosk 新增 1 个场景 hook、1 个纯 mapper、1 组建议核对组件；页面文件只做接线。
- 不新增路由、首页入口、服务中心卡片或外部依赖。
- 不在接近或超过 500 行的页面中继续内联复杂状态。

### Wave 3：逐域扩展

一次只开放一个 `surface`：简历诊断方向 → 岗位真实筛选 → 招聘会准备单 → 政策条件核对。每域独立审查、验证和发布，不一次覆盖 8 域。

## 十一、Go / No-Go 门禁

试点上线前必须满足：

- 未经确认覆盖字段数 = 0。
- 无来源的事实字段写入数 = 0。
- 自动投递/预约/签到/外跳/支付/打印/录音/签章次数 = 0。
- 跨用户读取或公共终端残留数 = 0。
- Admin、Partner、企业、校方或第三方工具获得画像字段数 = 0。
- 删除或撤回后仍可读取的画像数 = 0。
- 同一简历跨页面重复模型提取次数 = 0。
- AI 失败时不可继续手填的页面数 = 0。
- 1080×1920、390×844 和 425px 宽度无溢出，触控与焦点恢复通过。

任一项不满足即 No-Go。浏览器 fixture 通过不能替代真实 OCR/LLM、公共终端清场、生产数据隔离或 Windows 真机验收。
