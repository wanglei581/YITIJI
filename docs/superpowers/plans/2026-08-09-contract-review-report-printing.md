# AI 签约风险提示报告与打印实施计划

> 状态：技术契约已冻结；Slice A/B/C 已完成本地代码候选，Slice D 真机/生产验收未完成；未部署、默认关闭
> 日期：2026-08-09
> 产品位置：AI简历服务 → 签约与权益
> 覆盖关系：本计划覆盖 `2026-08-01-ai-contract-review.md` 的 Task 14 中“使用普通 `print_doc` 并直接接打印”的旧方案；旧计划其余已完成任务不受影响。

## 1. 目标与边界

交付“打印风险提示报告”，复用现有打印确认、服务端报价、支付、`PrintTask`、Terminal Agent、进度和订单闭环。打印对象是 AI 生成的最小化风险提示 PDF，不是合同原件。

本阶段明确不做：

- 不新增首页、岗位信息或百宝箱入口。
- 不提供“打印合同”“法律审查报告”或合同全文下载。
- 不新增第二套计价、订单、支付、打印任务或 Windows Agent 实现。
- 不把合同、OCR 全文、结构化结果或报告加入“我的文档”、AI 历史、Admin 单份详情或 Partner。
- 不把匿名合同访问令牌传入打印路由、URL、`localStorage`、`sessionStorage`、日志或订单。
- 不改变合同审查主能力默认关闭和生产 fail-closed 边界。

## 2. 现有能力与缺口

| 环节 | 已有能力 | 本计划补充 |
| --- | --- | --- |
| 任务 | `ContractReviewTask.resultJson`、`resultFileId`、两小时 `expiresAt` | 报告幂等生成、交接状态判断 |
| 文件 | 私有 `FileObject`、短签名 URL、物理删除、过期任务 | `contract_review_report` 专用 purpose 与锁定短期策略 |
| PDF | 项目已有 PDFKit 报告服务模式 | 合同专用渲染器、每页 AI 标识与元数据 |
| 打印 | 报价、支付、`PrintTask.fileId`、Agent、进度、订单 | 合同报告来源、禁止会话持久化、终态清理 |
| 用户资产 | “我的文档”“我的打印订单” | 仅订单保留页数、金额、状态等履约元数据 |

当前 `POST /contract-reviews/:id/report` 完成归属校验后固定返回 `REPORT_NOT_AVAILABLE`。当前 `DELETE /contract-reviews/:id` 会同时清理 `sourceFileId` 与 `resultFileId`。因此在报告交给打印任务前后直接复用“结束并删除”会造成竞态：Agent 尚未下载，报告已被删除。

## 3. 冻结决策

### 3.1 文件类型与留存

新增 `FilePurpose = 'contract_review_report'`，策略固定为：

- MIME：仅 `application/pdf`。
- 仅服务端生成，Kiosk multipart、upload intent、手机上传和扫描入口全部拒绝该 purpose。
- `sensitiveLevel = highly_sensitive`、`visibility = private`、`assetCategory = derived`。
- `retentionPolicy = system_short`、`retentionSetBy = system`。
- `retentionLockedReason = contract_review_session_only`，禁止会员延长保存。
- `expiresAt` 不晚于对应 `ContractReviewTask.expiresAt`。
- 明确排除“我的文档”、会员数据导出中的文件内容以及普通文件恢复流程。

不能复用普通 `print_doc`：普通打印材料允许进入通用会话和资产逻辑，无法证明合同报告不会被长期展示或延长保存。

### 3.2 报告内容

报告固定包含：

- 标题“AI 签约风险提示”。
- 优先核查、建议关注、信息不足三类计数。
- 每项标题、风险级别、最短必要证据摘录、说明、官方依据、建议核实问题和不确定性。
- 识别覆盖范围、OCR 可信度、规则包版本、免责声明版本、生成时间。
- 每页可见“AI 生成，仅作风险提示，不构成正式法律意见”。
- PDF metadata 中的 AI 生成标识、服务提供者标识、内容 ID、生成时间和规则包版本；字段格式以法务/合规冻结的 Gate 0 真值为准。

报告不得包含：合同全文、姓名/手机号/证件号等未被最小化的身份字段、模型原始响应、内部提示词、匿名 token、对象存储路径或供应商密钥。

### 3.3 接口契约

`POST /api/v1/contract-reviews/:id/report`：

- 仍使用会员 Bearer 或匿名 `x-contract-review-access-token` 做当前任务归属校验。
- 只有 `completed`、结果通过现有 mapper/SafetyGate 校验、任务未过期且报告打印服务端开关开启时可执行。
- 使用 `resultFileId` 做幂等：已有有效报告时返回同一文件，不重复渲染或上传。
- 并发生成通过 compare-and-set 只允许一个 `resultFileId` 获胜；落败的孤立文件必须补偿删除。
- 返回报告文件 ID、文件名、MIME、真实字节数、服务端页数、到期时间和仅供现有打印 API 使用的 HMAC `printFileUrl`。
- 不返回云存储长期 URL，不返回合同原文，不返回新的合同读取凭证。
- 功能关闭、文件服务不可用、结果不合法、剩余有效期不足时 fail closed；不能返回虚构 fileId。

建议响应结构：

```ts
interface ContractReviewReportView {
  fileId: string
  filename: string
  mimeType: 'application/pdf'
  sizeBytes: number
  pages: number
  expiresAt: string
  printFileUrl: string
  abandonToken: string
  abandonTokenExpiresAt: string
}
```

### 3.4 打印交接

用户点击“打印风险提示报告”后的顺序固定为：

1. Kiosk 展示确认弹窗，说明只打印风险提示、会收费、纸张含敏感信息、报告短期存在。
2. 调用报告接口并获得 `ContractReviewReportView`。
3. 报告持久化成功后，服务端优先物理删除合同原件；删除失败则整体 fail closed，不进入打印页。
4. 清空 Kiosk 合同易失会话，不再把合同 token 带到后续页面。
5. 仅通过 React route state 跳转现有 `/print/confirm`；合同报告不得写入 `printMaterialSession` 的 `sessionStorage`。
6. 现有打印服务重新验签、服务端计算页数、报价、支付并创建 `PrintTask.fileId`。
7. 创建 `PrintTask` 后，报告内容由打印生命周期保护；合同任务普通删除不得提前删除该文件。
8. 打印 `completed`、`failed`、`cancelled` 后触发报告物理清理；清理失败由短期 TTL 和清理任务重试兜底。

如果用户在创建 `PrintTask` 前取消，Kiosk 调用报告放弃接口立即删除；浏览器崩溃时由报告 TTL 兜底。不得为了方便把原匿名合同 token继续保存到打印页面，放弃清理应使用只具备报告删除权限的一次性能力，或由服务端“生成并关闭会话”事务返回的短期撤销凭证。

### 3.5 开关

- Kiosk：`VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT === 'true'`。
- API：`CONTRACT_REVIEW_REPORT_PRINT_ENABLED === 'true'`。
- 两端任一未开启都保持当前“报告打印暂未开放”。
- API 开关不能被前端开关替代；报告接口在服务端配置不足时必须 fail closed。

## 4. 分片实施

### Slice A：生产真值和易失会话收口（已完成本地候选）

目标：不开放打印，先确保合同审查主流程符合公共终端隐私承诺。

允许修改：

- `apps/kiosk/src/auth/kioskSensitiveSession.ts`
- 新建一个聚焦的合同易失会话文件或 context
- 三个现有合同页面和合同 API service
- 合同 UI/browser verifier

要求：

- `taskId`、匿名 access token、结果只存在 React 内存。
- 刷新、BFCache、返回首页、离席、切换会员和隐私硬截止后不可恢复上一位用户数据。
- 显示真实剩余时间与刷新会结束会话的提示。
- 删除失败不离场，不冒充已经删除。

2026-08-09 实现结果：新增模块级 `contractReviewSession`，只在内存保存任务 ID、匿名访问令牌、合同类型、到期时间和结构化结果；三屏不再读写 React Router history state。统一 `clearKioskSensitiveSession` 与登录切换均清除此会话，现有公共终端安全根继续负责硬超时、离席与 BFCache fail-closed。处理中和结果页显示真实到期时间倒计时及刷新不可恢复提示。Node 22.23.2 下 typecheck、lint（0 error / 6 个既有 warning）、静态门禁、HTTP 模式生产 build、visible-actions truth 与 1080×1920 mock 浏览器 2/2 通过；未开启报告打印。

### Slice B：报告生成与专用文件策略

目标：实现并测试报告文件，但保持 Kiosk 打印按钮关闭。

2026-08-09 实现结果：新增合同专用 PDF 渲染器、专用高敏文件服务和报告编排服务；报告只允许服务端生成，使用 `resultFileId` 做幂等与并发 CAS，落败候选会补偿删除。PDF 每页带可见 AI/非法律意见提示，并写入 AI、服务提供者、内容 ID、生成时间、规则包和免责声明版本元数据；文件固定为私有、`highly_sensitive`、`system_short`、`contract_review_session_only`，到期不晚于任务，并从普通下载、Admin 文件列表、会员读取和“我的文档”排除。报告挂接成功后优先物理删除原合同；删除失败返回可重试 503，已挂接报告保留供下一次幂等重试。服务端仅在 `CONTRACT_REVIEW_REPORT_PRINT_ENABLED === 'true'` 时启用，示例配置和生产默认均为 false；Kiosk 按钮继续关闭。Node 22.23.2 下报告专项 6/6、文件策略 15/15、lifecycle 18/18、HTTP verifier、合同审查全量 287 通过（另 1 个 PostgreSQL 环境 skip）、API typecheck/lint/build 与 shared typecheck 均通过；未接报价/支付/PrintTask，未部署或真机出纸。

建议新增文件：

- `services/api/src/contract-review/contract-review-report.service.ts`
- `services/api/src/contract-review/contract-review-pdf.service.ts`
- 对应聚焦测试文件

建议修改文件：

- `packages/shared/src/types/contractReview.ts`
- `packages/shared/src/types/file.ts`
- `services/api/src/files/file.types.ts`
- `services/api/src/files/file-validation.ts`
- `services/api/src/files/retention-policy.ts`
- `services/api/src/files/files.service.ts`（只增加受控服务端生成能力；该文件已超过 800 行，不得继续塞报告业务）
- `services/api/src/member-assets/member-assets.service.ts`
- 合同 module、lifecycle、controller、cleanup 与测试/verifier

不新增业务表或外部依赖。复用现有 `resultFileId` 和 PDFKit。

### Slice C：打印交接与清理

目标：复用现有履约闭环，解决报告在 Agent 下载前后的生命周期。

2026-08-09 实现结果：结果页生成报告后清空合同易失会话和通用打印材料会话，以现有 route state 进入 `/print/confirm`；不传合同 task/access token，也不写 `printMaterialSession`。确认页使用既有服务端报价/建单/收银/进度链，合同报告固定黑白、A4、单面、1 份并隐藏附加自评。新增短期 HMAC 放弃 capability：无 `PrintTask` 时立即删，有任务后拒绝提前删。通用 TTL 与合同 task cleanup 都会保护 active `PrintTask.fileId`；Terminal Agent 终态回传和过期 claim 收口后触发专用删除，十分钟 reconciler 补偿失败；报价/建单拒绝剩余寿命不足 30 分钟的报告，active PrintTask 的短签名读取可跨原会话到期完成本次履约。实现按“C1 Kiosk 易失交接”和“C2 后端打印生命周期”两个聚焦批次推进，未扩展计价、支付、Agent 打印协议或数据库模型。迁入最新主线的干净候选后，Node 22 下 shared/kiosk/api typecheck、报告 8/8、文件策略 16/16、专用生命周期 4/4、合同全量 295 通过（另 1 个 PostgreSQL 环境 skip）、HTTP/file-retention/静态门禁、fresh SQLite 78 migrations、`verify:print-jobs`、`verify:order` 及 1080×1920 浏览器 3/3 均通过；Windows 真机仍待 Slice D，双端开关保持 false。

建议修改：

- Kiosk 结果页、合同 API、打印 route state 类型
- `printMaterialSession.ts` 增加显式“不持久化合同报告”的来源策略，而不是把报告写入 sessionStorage
- `PrintConfirmPage.tsx` 及其 verifier，禁止合同报告进入材料检查/附加自评等不相关能力
- 打印建单服务增加合同报告剩余寿命和来源校验
- Agent 状态回传后的报告终态清理协调器
- 合同清理任务：发现有效打印任务时不得提前删报告，打印终态后可清理

不修改 Terminal Agent 打印实现、打印机型号配置、计价模型或支付状态机。

### Slice D：灰度验收

完成 Node 22、PostgreSQL、Redis、当前生产私有对象存储、真实境内模型和 Windows 真机验证后，只在 1–2 台终端单独开启报告打印开关。审查主能力和报告打印分别给出 GO/NO-GO，不捆绑发布。

### 后续视觉页面替换约定

Claude 或其他模型后续更新合同审查结果页时，只替换页面结构、样式和交互呈现；报告打印必须继续调用 `contractReviewReportPrintFlow.prepareContractReviewReportPrint`，并把返回值原样作为 `/print/confirm` 的 route state。新页面不得复制固定打印参数、报告 API 调用、合同/打印会话清理、匿名凭证裁剪或放弃报告逻辑，也不得新建第二套打印确认、报价、订单、支付或进度页。页面替换后必须重跑合同报告静态门禁和既有 Playwright 合同流程；若视觉稿改变按钮文案，先同步无障碍可访问名称与浏览器断言，功能契约不随视觉稿变化。

## 5. 验证矩阵

### API 与文件

- 只有本人或持正确匿名 token 可生成；跨会员、错 token、缺 token继续同形 404。
- 非 `completed`、过期、畸形 `resultJson`、关闭开关、存储失败均不生成文件。
- 20 次并发请求只有一个有效 `resultFileId`，其余临时对象全部补偿清理。
- 报告 `expiresAt <= task.expiresAt`，签名 URL 也不得越过文件寿命。
- `contract_review_report` 不能从任何外部上传入口创建，不能延期，不能出现在“我的文档”。
- 报告每页可见标识和 metadata 自动验证；PDF 不包含合同全文、token 或模型原始响应。
- 报告生成失败不改变已完成审查结果；打印失败不改写为审查失败。

### 打印生命周期

- 报告生成后源合同已物理删除，打印仍可成功。
- 建单前取消立即删除报告；崩溃后 TTL 清理。
- 建单后调用合同任务删除不会使 Agent 下载 404。
- `completed`、`failed`、`cancelled` 后报告内容清理，`PrintTask` 与订单元数据仍可查询。
- HMAC 过期、文件剩余寿命不足、文件已删、页数识别失败全部拒绝报价/建单。
- 不进行 PII 原件扫描，不提供附加自我探索，不把报告重新纳入通用材料加工。

### Kiosk 与真机

- 1080×1920：确认弹窗、生成中、失败、打印确认、收银、进度、完成和返回路径。
- 375/425px：无横向溢出；主要操作 48px 以上。
- 刷新、后退、BFCache、离席、切换账号后无法恢复合同或 token。
- Windows Agent 实际下载一次、校验一次、出纸一次；失败不自动重复出纸。
- 打印件逐页 AI 标识清晰，用户结束后页面与浏览器历史无报告预览。

## 6. 发布判定

以下任一项未完成，按钮继续显示“报告打印暂未开放”：

- 合同审查生产验收未通过。
- 报告专用文件策略、幂等、补偿删除或打印交接未通过自动化测试。
- Gate 0 的 PDF 显式/隐式 AI 标识格式未冻结。
- PostgreSQL、目标私有对象存储、真实模型或 Windows 真机打印未验证。
- 报告可能进入“我的文档”、浏览器持久化或 Admin/Partner 单份内容视图。
- 打印任务可能在 Agent 下载前被合同清理任务删除文件。

## 7. 本轮文件预算

本轮只冻结设计，不改生产代码。后续每个 Slice 独立立项、独立分支：

- Slice A：6–9 个文件。
- Slice B：12–16 个文件。
- Slice C：10–14 个文件。
- Slice D：只补验证与正式进度记录，不扩大业务范围。

若任一 Slice 超预算，必须先拆分或回到方案审查；不得借报告打印重构整个文件系统或打印系统。
