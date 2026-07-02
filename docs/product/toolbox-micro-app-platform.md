# 百宝箱微应用平台方案

> 状态：规划、第一阶段安全底座、Phase 2 最小治理规则底座、Phase 2B 后端审核发布工作流、Phase 2C Admin 审核发布 UI、首批低风险 AI skill intent 接线
> 最后更新：2026-07-02
> 关联：`docs/superpowers/plans/2026-07-01-toolbox-micro-app-platform.md`、`packages/shared/src/types/toolboxMicroApp.ts`

## 一、结论

这个方向是对的，但百宝箱不能做成“第三方代码运行市场”。正确定位是：

**百宝箱 = 受控微应用中心 + 场景化服务入口编排 + 首方 AI 技能入口。**

它可以承载站内官方微应用、受控网页能力、二维码 / 小程序码入口、首方 AI 技能包，也可以后续支持合作方提交应用信息。但第一阶段不能允许第三方上传 JS、WASM、插件包或任意 skill 代码在一体机、API 服务或 Terminal Agent 内执行。

## 二、最终实现效果

用户在 Kiosk 首页进入百宝箱后，看到按当前终端、场景和运营配置展示的一组微应用，例如：

- 试卷打印
- 英语模拟练习
- 合同审查
- Offer 对比
- 法律风险审查
- 薪资谈判话术
- HR 知识问答

每个微应用都有明确的打开方式：

- 站内微应用：进入系统已有页面或新建的首方页面。
- 网页微应用：进入离场提示后打开白名单 H5，第三方不拿用户 token、简历和设备能力。
- 二维码 / 小程序码：用户用个人手机继续办理，一体机只展示入口和提示。
- AI 技能包：进入小青 AI 助手或首方 AI 流程，按受控 intent 执行。

管理端最终会有“应用目录、审核发布、终端投放、host 白名单、熔断下架、使用统计”能力。运营人员可以配置不同点位的百宝箱内容；审核人员确认合规和安全后发布；出现风险时可以按应用、域名或厂商一键停用。

## 三、有什么用

对用户：

- 把求职、打印、学习、合同、薪资、HR 问答等高频小工具集中在一个入口。
- 不需要理解系统复杂菜单，按场景直接点开微应用。
- 第三方服务、敏感文件、法律类内容都有清晰风险提示。

对运营：

- 不用每次为某个学校、招聘会、人社大厅单独发版。
- 可以按终端投放差异化服务，提高设备利用率。
- 可统计哪些服务被打开、取消、扫码，辅助运营决策。

对商业化：

- 支持合作方服务入口、增值 AI 工具、打印服务、校园服务和公共就业服务组合。
- 形成“硬件终端 + AI 服务 + 场景应用 + 运营后台”的可宣传能力。
- 但仍保持合规边界，不变成招聘平台或第三方插件市场。

## 四、微应用导入格式

第一阶段采用 manifest 描述，不导入代码包。

推荐格式：

```json
{
  "id": "offer-compare",
  "title": "Offer 对比",
  "entryType": "internal_route",
  "category": "career",
  "riskLevel": "medium",
  "permissions": ["ai_chat", "session_only_storage", "salary_advice"],
  "launch": {
    "internalRoute": "/assistant?intent=offer_compare",
    "requiresHostAllowlist": false,
    "requiresHumanReview": true
  },
  "dataPolicy": {
    "retention": "session_only",
    "thirdPartyDataSharing": "none",
    "sensitiveDataAllowed": false,
    "requiresExplicitConsent": true
  },
  "disclaimers": [
    "对比结果仅供个人决策参考，不构成入职、涨薪或录用承诺。"
  ]
}
```

支持的 `entryType`：

| 类型 | 用途 | 是否执行第三方代码 |
| --- | --- | --- |
| `internal_route` | 官方站内页面或已有功能包装 | 否 |
| `web_app` | 白名单 H5，离场提示后打开 | 否 |
| `qr_code` | 展示二维码，引导手机办理 | 否 |
| `mini_program_qr` | 展示微信 / 支付宝等小程序码 | 否 |
| `ai_skill` | 首方 AI 助手 intent 或工作流 | 否 |

第三方小程序不能直接在浏览器里“安装运行”。最兼容、最实用的方式是保存小程序名称、AppID / path 说明和小程序码，由用户手机扫码打开。网页能力可以作为 H5 微应用接入，但必须 HTTPS、host 白名单、离场提示、无 token 注入、无本地 Agent bridge。

## 五、首批 7 个微应用规划

| 微应用 | 推荐形态 | 优先级 | 风险 | 上线前置 |
| --- | --- | --- | --- | --- |
| Offer 对比 | 站内微应用 / AI intent | 高 | 中 | 不回传企业、不做 Offer 管理 |
| 薪资谈判话术 | AI 技能包 | 高 | 低 | 不承诺涨薪、录用 |
| HR 知识问答 | AI 技能包 | 高 | 中 | 官方口径提示，不输出个案法律结论 |
| 法律风险审查 | AI 技能包 | 中 | 高 | 法务评审、仅风险提示 |
| 合同审查 | 首方 AI 技能，后续可接站内流程 | 中 | 受限 | 合同原文会话后即弃，不外传第三方 |
| 试卷打印 | 二维码 / 后续站内打印流程 | 低 | 高 | 版权授权、真实打印链路 |
| 英语模拟练习 | 小程序码 / H5 合作入口 | 低 | 高 | 商标和题库授权，手机端优先 |

## 六、后端和管理端设计

### P0：现有百宝箱安全补强

- 增加生产外链硬开关：`TOOLBOX_ALLOW_EXTERNAL_URL=false` 时，`external_url` 读取侧 fail-closed。
- 增加合规词拦截：禁止一键投递、立即投递、企业直收简历、候选人推荐、在线筛选候选人等。
- 二维码目标地址必须可验证；长期方案是服务端根据已审核 `qrTargetUrl` 生成二维码。
- 公开事件只作为匿名运营统计，不能作为用户同意证据。

### P1：最小治理模型

建议最小数据模型：

- `ToolboxApp`：应用主体、风险等级、分类、启动方式、当前状态。
- `ToolboxAppVersion`：提交、审核、驳回、发布的快照。
- `ToolboxAllowedHost`：host、用途、owner、原因、到期时间、状态、审核人。
- `ToolboxDeployment` 或沿用现有 `TerminalToolboxConfig.itemsJson` 做发布投影。

状态机：

`draft -> submitted -> approved -> published`

负向状态：

`rejected`、`suspended`、`archived`

关键规则：

- 提交人不能审批自己的应用。
- 未审核、已熔断、host 过期、命中红线文案的应用不得进入 Kiosk 公开配置。
- Admin 必须能看到“配置存在但前台被拦截”的 blocked reason。

### P2：首方 AI 技能包

AI 技能包不能让大模型自由生成 URL 或任意外部操作。大模型只能返回已审核的 `appKey` 或受控 intent：

- `offer_compare`
- `salary_negotiation`
- `hr_qa`
- `legal_risk_check`
- `contract_review`

禁止工具：

- 向第三方发送简历
- 平台内投递
- 调用打印机 / 扫描仪直连
- 自由打开外部 URL
- 保存合同全文或法律争议原文到审计日志

### P3：第三方声明式 skill 网关

冻结到后续单独立项。必须先做威胁模型、出站 host 白名单、私网 IP 拒绝、JSON schema 强校验、限流、费用控制、kill switch 和安全审查。

## 七、合规红线

百宝箱微应用不得新增以下能力：

- 平台内一键投递
- 平台内收取求职者简历给企业
- 企业端候选人筛选
- 企业端面试邀约
- 企业端 Offer 管理
- 候选人推荐给企业
- 第三方代码执行
- 第三方获取会员 token、简历正文、文件签名 URL、打印 / 扫描 / 本地 Agent 能力

法律类与合同类必须使用免责声明：

“仅作风险提示，不构成正式法律意见；重大争议请咨询律师或官方窗口。”

## 八、为什么要分阶段

不是因为做不了，而是因为风险不同：

- 官方站内微应用可以先做，风险可控。
- H5 / 小程序码可以做，但必须先有白名单、离场提示和统计边界。
- 合同审查、法律风险、试卷打印涉及法律、版权、敏感文件和责任边界，必须先有免责声明、文件留存策略和审核门。
- 第三方 skill 网关相当于允许外部系统被 AI 调用，安全面扩大很多，必须单独威胁建模。

所以“都能做”，但不能用同一种方式、同一套权限、同一个上线门槛做。

## 九、当前第一阶段已落地范围

- 新增共享类型：`packages/shared/src/types/toolboxMicroApp.ts`
- 定义 5 类入口模式、7 类应用分类、权限、风险等级、数据策略。
- 定义首批 7 个内置候选微应用。
- 明确禁止能力清单。
- 新增静态门禁：`verify:toolbox-micro-app-platform`

这一阶段不代表百宝箱微应用平台已商用上线；它代表产品边界、清单模型和防回退口径已进入仓库，可以作为后续后端 / 管理端 / Kiosk 实现的基线。

## 十、Phase 2 最小治理规则底座已落地范围

Phase 2 先落“规则底座”，不直接建表、不新增 Admin / Kiosk 页面、不开放第三方代码或外部 skill 运行。

已进入代码的治理能力：

- 共享契约补齐：`ToolboxAppVersion`、`ToolboxAllowedHost`、host 状态、发布阻断原因、审批元数据。
- 状态机规则：`planned -> draft -> submitted -> approved -> published`，禁止 `draft -> published` 和 `archived -> published` 等跳审 / 复活路径。
- 双人审核规则：提交人和审核人不能相同。
- Host 治理规则：host 必须处于 `active`，不能过期、熔断、待审核或归档；本机 / 私网 IP host 直接拒绝。
- 发布 gate：未审核、熔断、归档、红线文案、高风险缺免责声明、外部 H5 开关关闭、host 不可用都不得发布。
- 验证门禁：`verify:toolbox-micro-app-platform` 已覆盖状态机、自审批、host 过期 / 熔断、本机 IP、红线文案、高风险免责声明和外部 H5 开关关闭等负向用例。

仍未完成、不得误宣称：

- 未新增 Admin 应用目录 / 审核发布 UI。
- 未开放第三方 JS / WASM / 任意 skill 包。

## 十一、Phase 2B 后端审核发布工作流已落地范围

Phase 2B 已把规则底座接入真实后端工作流，但仍不代表生产商用验收完成。

已进入代码的能力：

- 双数据库持久化：SQLite / PostgreSQL schema 和 migration 同步新增 `ToolboxApp`、`ToolboxAppVersion`、`ToolboxAllowedHost`。
- Admin 后端接口：创建应用、创建版本、提交审核、异人审批、驳回、发布、熔断应用、允许域名 upsert / 审核。
- 发布投影：已审核版本通过发布 gate 后，转换为 `KioskToolboxItemView` 并写入现有 `TerminalToolboxConfig.itemsJson`，投影 key 统一为 `app:${appKey}`，避免覆盖手工配置项。
- Fail-closed 顺序：发布前先跑 `evaluateToolboxPublishGate`，再对投影项做 `normalizeToolboxItemsForConfig(..., { strict: true })` dry-run，全部通过后才在事务内更新版本 / 应用状态和终端配置。
- itemsJson 写入保护：发布、熔断和手工保存终端百宝箱配置共用同进程串行化锁，避免这些路径在单实例内读改写互相覆盖。
- 熔断移除：应用熔断时从所有终端配置中移除对应 `app:${appKey}` 投影项。
- Host 双人复核：允许域名 upsert 只能进入 `pending_review`，激活必须走 review 接口，且最近提交人与审核人不能相同；旧数据缺少最近提交人时 fail-closed 拒绝审核。
- Host 双白名单口径：外部 H5 / 二维码目标域名必须同时进入数据库 `ToolboxAllowedHost(active)` 和运行环境白名单 `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS` / `KIOSK_QR_TARGET_ALLOWED_HOSTS`；任一侧缺失都会 fail-closed 拒绝发布。
- 免责声明投影：高风险 / 受限应用发布时会保留 `riskLevel` 与 `disclaimers` 元数据，供后续 Kiosk 详情 / 弹窗展示使用。
- 审计留痕：应用创建、版本创建、提交、审批、驳回、发布、熔断、允许域名 upsert / review 均写 `AuditLog` 摘要，不写合同、简历、法律争议原文或第三方办理结果。
- 验证门禁：新增 `verify:toolbox-review-workflow`，覆盖 schema/migration、防重复规则、投影映射、严格校验和 AuditLog 动作。

仍未完成、不得误宣称：

- 未做 Admin 审核发布 UI。
- 未执行预生产 / 生产 PostgreSQL migration。
- 未对真实终端做发布投影验收。
- 未开放第三方 JS / WASM / 任意 skill 包。
- 未完成首批微应用的法务、版权、文件留存、支付或真机打印验收。

## 十二、Phase 2C Admin 审核发布 UI 已落地范围

Phase 2C 已把 Phase 2B 的后端审核发布能力接入 Admin 可视化工作台，但仍不代表生产验收完成。

已进入代码的能力：

- Admin 只读列表接口：`GET /admin/toolbox/apps`、`GET /admin/toolbox/apps/:appKey/versions`、`GET /admin/toolbox/allowed-hosts`，用于审核台真实读取应用、版本和允许域名状态。
- Admin `/toolbox` 单入口拆分为“微应用审核发布 / 域名白名单 / 终端投放配置”，不新增重复菜单或并列路由。
- Admin service 补齐创建应用、创建版本、提交审核、通过、驳回、发布、熔断、允许域名提交和审核方法，并透出 `TOOLBOX_PUBLISH_BLOCKED` 的 `reason`。
- 发布门禁失败在 UI 中映射为中文 blocked reason，覆盖 `app_not_approved`、`host_not_allowed`、`missing_disclaimer`、`forbidden_capability` 等全部原因。
- UI 常驻展示“不执行第三方代码、不桥接第三方设备”边界；高风险 / 受限应用创建版本时要求填写免责声明。
- 允许域名面板明确区分 DB 审核表和环境白名单：`TOOLBOX_ALLOW_EXTERNAL_URL`、`KIOSK_EXTERNAL_APP_ALLOWED_HOSTS`、`KIOSK_QR_TARGET_ALLOWED_HOSTS` 仍是服务端只读配置口径。
- 终端配置页对 `app:${appKey}` 治理投影项显示“治理发布”标识并设为只读，避免绕过审核台手工修改或删除。
- 新增 `verify:toolbox-review-ui`，并扩展 `verify:toolbox-review-workflow` 检查列表接口，防止审核发布 UI 与后端读取契约回退。

仍未完成、不得误宣称：

- 未执行预生产 / 生产 PostgreSQL migration。
- 未用真实管理员账号完成异人审批、发布、熔断和允许域名激活验收。
- 未在 Windows 一体机和真实终端验证 `app:${appKey}` 投影展示与熔断移除。
- 未完成首批微应用的法务、版权、隐私、文件留存和真机打印验收。
- 未开放第三方 JS / WASM / 任意外部 skill 包执行。

## 十四、首批低风险 AI skill intent 接线已落地范围

本阶段先接入低风险、无文件上传、无第三方代码执行、无企业闭环的三类首方 AI 技能：

- Offer 对比：`/assistant?intent=offer_compare`
- 薪资谈判话术：`/assistant?intent=salary_negotiation`
- HR 知识问答：`/assistant?intent=hr_qa`

已进入代码的能力：

- Kiosk `/assistant` 读取 URL `intent`，展示对应欢迎语、输入提示和免责声明。
- 前台 `chatWithAssistant` 请求透传受控 `intent`，并标记 `context.source=toolbox_ai_skill`。
- 共享类型、后端 DTO、AI provider interface 已包含三类受控 intent，后端 DTO 对 intent 做白名单校验。
- `LlmChatService` 优先使用入口 intent，未传 intent 时继续按用户文本分类；三类技能均注入场景化 system prompt。
- 前后端 mock 模式已具备场景化回复，便于本地演示和断网联调。
- 新增 `verify:toolbox-ai-skill-intents`，检查三类 intent、Kiosk 透传、后端 prompt、防回退文案和禁止招聘闭环文案。

合规边界：

- Offer 对比只做个人决策参考，不构成录用、入职或法律意见。
- 薪资谈判话术只做沟通准备参考，不承诺涨薪或录用结果。
- HR 知识问答只做常识解释，不构成正式法律意见或官方政策承诺。
- 预生产与真实模型联调仍需后续单独验收；本阶段不代表微应用商用上线完成。
