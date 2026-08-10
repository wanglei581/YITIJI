# AI 签约风险提示预生产验收执行包

> STATIC READINESS CHECK ONLY
>
> 当前状态：验收步骤、证据标准、停止条件与启用顺序已经定义；不代表预生产真实服务、公共终端或 Windows 奔图真机已经验收。
>
> 本执行包不能作为部署授权或功能开关授权。执行任何远程写入、进程重启、环境变量修改、数据库 migration、真实模型调用或 Windows 真机操作前，必须取得对应范围的单独明确授权。

## 一、验收目标与边界

本执行包只验证已经合入主线的「AI 简历服务 → 签约与权益 → AI 签约风险提示」真实闭环，不新增入口、页面、模型、队列、存储或打印链。

验收对象：

- PostgreSQL 中唯一有效的合同免责声明、会员/匿名同意记录与合同任务状态。
- 真实 Redis / BullMQ 的入队、处理、幂等、重试、超时与失败收敛。
- Gate 0 批准范围内的境内 provider、base URL 和 model 精确身份。
- 当前生产私有对象存储中的原合同、风险提示报告及删除/TTL 策略。
- 公共终端会员与匿名会话在刷新、离席、硬隐私截止、BFCache 和切换用户时的隔离。
- 既有报价、支付门禁、`PrintTask`、Terminal Agent 和奔图打印机上的风险提示报告出纸。

不在本轮范围：

- 不把本功能放回百宝箱、岗位信息或首页，不新增同义入口。
- 不打印合同原件；只允许打印服务端生成的 `contract_review_report`。
- 不提供法律意见、律师结论、胜诉预测或合同自动签署。
- 不读取、复制或提交真实用户合同作为验收材料。
- 不用 mock、SQLite、本地文件存储或 inline 队列冒充预生产真实通过。

## 二、冻结候选与默认关闭规则

每次执行必须先记录：

- 候选 Git SHA、分支/标签、API 与 Kiosk 构建来源。
- 预生产 API、Kiosk、Worker、Terminal Agent 的版本摘要。
- PostgreSQL、Redis、对象存储和模型 provider 的非敏感身份摘要。
- 现场 Windows、浏览器、Agent、打印机驱动和 `printerName` 配置摘要。

在 CR-G0 至 CR-G7 全部通过并形成具名批准前，以下三个开关必须保持 `false`：

```text
VITE_ENABLE_CONTRACT_REVIEW=false
VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT=false
CONTRACT_REVIEW_REPORT_PRINT_ENABLED=false
```

验收中的后端真实服务接线不等于允许用户访问。不得为了方便验收把生产 Kiosk 入口提前打开。

## 三、证据与隐私规则

证据保存在仓库外的私有目录，Git 只记录脱敏摘要和证据 ID：

```bash
export CONTRACT_EVIDENCE_ROOT="/srv/ai-job-print-evidence/contract-review-<UTC_TIMESTAMP>"
mkdir -p "$CONTRACT_EVIDENCE_ROOT"/{CR-G0,CR-G1,CR-G2,CR-G3,CR-G4,CR-G5,CR-G6,CR-G7,CR-R1}
chmod 700 "$CONTRACT_EVIDENCE_ROOT"
```

证据中禁止出现：

- 数据库/Redis 连接串、API key、JWT、Cookie、短信验证码或签名 URL。
- 真实合同正文、姓名、手机号、身份证号、银行卡号、住址或用户文件。
- 完整模型请求/响应、原合同 OCR 文本、未脱敏日志或对象存储密钥。

所有 canary 必须使用法务认可的合成文本，不含真实个人信息、企业秘密或真实合同编号。日志只保留请求 ID、任务 ID 摘要、状态、耗时、错误码和队列指标。

## 四、CR-G0 本地冻结候选门禁

目标：证明候选代码、默认关闭状态、合同契约、报告打印边界与浏览器回归可重复执行。

```bash
git rev-parse HEAD
git status --short --branch

pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api verify:bos
pnpm --filter @ai-job-print/api verify:contract-review:gate0
pnpm --filter @ai-job-print/api verify:contract-review:preprod-readiness
pnpm --filter @ai-job-print/api verify:contract-review:contract
pnpm --filter @ai-job-print/api verify:contract-review:file-policy
pnpm --filter @ai-job-print/api verify:contract-review:report
pnpm --filter @ai-job-print/api verify:contract-review:print-lifecycle
pnpm --filter @ai-job-print/api verify:contract-review:schema
pnpm --filter @ai-job-print/api verify:contract-review:consent
pnpm --filter @ai-job-print/api verify:contract-review:http
pnpm --filter @ai-job-print/api verify:print-jobs
pnpm --filter @ai-job-print/kiosk verify:contract-review-session
pnpm --filter @ai-job-print/kiosk verify:contract-review-report-print
pnpm --filter @ai-job-print/kiosk test:browser:contract-review
git diff --check
```

通过标准：所有命令退出码为 0；`.env.example` 中三个开关均为 `false`；通用打印接口拒绝 `contract_upload`；报告打印使用数据库中的服务端 SHA-256；浏览器测试不把 access token 或合同上下文写入 history。

## 五、CR-G1 预生产只读就绪检查

目标：确认部署来源和真实依赖“存在且身份正确”，但不修改环境、不重启服务、不调用模型。

只允许输出以下脱敏状态：

```text
NODE_ENV=production
DATABASE_URL=set scheme=postgresql
REDIS_URL=set
FILE_STORAGE_DRIVER=bos
FILE_STORAGE_LEGACY_DRIVER=cos
BAIDU_BOS_ENDPOINT=set official_bcebos_host=true
TENCENT_COS_BUCKET=set historical_compatibility=true
CONTRACT_REVIEW_PROVIDER=<approved-id>
CONTRACT_REVIEW_BASE_URL=<approved-origin-only>
CONTRACT_REVIEW_MODEL=<approved-model-id>
CONTRACT_REVIEW_API_KEY=set length_ok=true
CONTRACT_REVIEW_REPORT_PRINT_ENABLED=false
```

检查项：

- API health 返回 PostgreSQL，部署来源 SHA 与冻结候选一致。
- BOS 主存储与 COS 历史兼容配置同时存在；缺少 legacy 路由或 COS 凭证时生产启动必须 fail-closed。
- `docs/compliance/contract-review-release-gate.md` 的机器可读状态仍为 `approved`，批准未撤销、未过期且证据可复核。
- provider 三元组严格等于批准白名单之一，不允许自定义代理、通用 fallback 或境外 endpoint。
- Redis、PostgreSQL 与对象存储不暴露公网管理端口。
- 日志采集、APM、错误上报和反向代理访问日志均不记录请求正文、合同文本、签名 URL 或凭据。

任何身份漂移、候选 SHA 不一致或 Gate 0 证据不可复核，立即停止。

## 六、CR-G2 PostgreSQL 与法务正文

执行前置：已取得预生产数据库只读/写入授权；如需要 `migrate deploy`，须另有 migration 授权和可恢复备份。不得在本执行包授权范围内自行执行。

验证内容：

1. PostgreSQL migration/drift 状态与候选一致，没有未解释漂移。
2. 只存在一份当前有效、完整发布的合同免责声明；版本、正文 hash、scope hash 和发布时间可追溯。
3. 会员与匿名创建任务均绑定同一当前 `consentVersion` 与 `scopeHash`。
4. 旧版、撤销或不完整正文不能创建新任务；撤销同意会原子取消处理中任务。
5. 跨会员、跨匿名 token、过期 token 和重放请求均 fail-closed。

证据只保留版本号、hash、计数、错误码与脱敏任务 ID，不保存正文或身份数据。

## 七、CR-G3 Redis / BullMQ 真实队列

使用一个不含个人信息的合成 canary，验证：

1. 创建任务只产生真实 BullMQ job，不走 inline 或 mock。
2. `contract-review.extract` 以稳定 job ID 入队；重复提交不产生并发重复处理。
3. 提取完成后进入 `awaiting_confirmation`，未经用户确认不得进入分析。
4. 确认后 `contract-review.analyze` 只执行一次；响应丢失后的重试返回同一任务状态。
5. 提取任务按既有策略重试并指数退避；分析任务不进行危险的自动多次模型调用。
6. Worker 停止、超时、Redis 短断与坏 job 数据均收敛为可解释失败，不伪造完成。
7. completed/failed job 的保留时间符合代码约束，队列无持续积压。

证据：队列名、job name、job ID 摘要、attempts、状态时间线、失败错误码和队列深度。禁止导出 job data 中的合同内容。

## 八、CR-G4 获准境内模型与日志净化

前置：CR-G1 至 CR-G3 已通过，且已取得一次无个人信息 canary 的真实模型调用授权。

验证内容：

- 实际 provider、origin 和 model 与 Gate 0 白名单完全一致，TLS 有效且无重定向到未批准域名。
- provider 只接收脱敏页面与最小事实，不接收原文件、原合同全文或高置信 PII。
- 输出必须通过结构校验、安全门、证据定位与风险等级约束；越权法律结论、无证据断言和异常 schema 被拒绝。
- 用户可见报告保留 AI 生成提示、非法律意见说明和人工复核建议。
- API、Worker、PM2、nginx、APM 和 provider SDK 日志中不出现 canary 独特敏感标记或凭据。
- provider 超时、429、5xx、非法 JSON 和连接失败时任务诚实失败，不回退到 mock 或其他模型。

## 九、CR-G5 私有对象存储与敏感文件生命周期

必须使用隔离的合成 canary 文件和当前预生产私有存储 driver，验证：

1. 原合同上传对象为私有、短签名读取，不能公开匿名访问。
2. 报告由服务端生成，purpose 为 `contract_review_report`，不进入“我的文档”或 Admin 普通文件列表。
3. 报告生成成功后优先删除原合同；删除失败有重试/清理证据。
4. 未建打印单时可通过短期 capability 放弃并删除报告。
5. 建单后 `PrintTask.fileId` 保护报告；打印终态立即清理，reconciler 与 TTL 兜底。
6. 通用 `/print/jobs` 对 `contract_upload` 返回拒绝；客户端提供的 hash 不能覆盖数据库 SHA-256。
7. 验收结束后 canary 原件、报告、签名 URL 和临时本地文件均不可再访问，删除日志仍可审计。
8. 新 canary 的 `storageProvider=bos` 且 bucket/region 正确；读取一份批准的合成 COS 历史 canary 时仍按 `storageProvider=cos` 路由，任一路径均不得静默回退本地。
9. BOS 预览和服务端读回通过后，单独核对浏览器下载文件名/附件行为；官方 BOS 域名不能用动态 `responseContentDisposition` 作为已通过证据，若业务必须强制附件下载则停止切换并先增加受控 API 下载代理。

## 十、CR-G6 公共终端会员/匿名隐私

在 1080×1920 Kiosk 和目标现场浏览器分别覆盖会员与匿名两套流程：

- 上传、处理中、待确认、结果页、删除失败和报告已打印状态。
- 刷新、后退/前进、直接打开结果路由、标签页恢复和 BFCache。
- 普通离席、硬隐私截止、屏保、浏览器重启和切换下一位用户。
- Storage/Cookie/网络失败下仍先同步清除本地敏感状态，再尽力服务端删除/登出。
- 清场不取消已经提交的后台打印任务，但不得恢复上一位用户的合同或报告上下文。

通过标准：地址栏、history state、local/session storage、日志、页面缓存和下一位用户页面中均无 access token、合同文本、文件 URL、任务详情或报告内容。

## 十一、CR-G7 Windows 奔图风险提示报告出纸

前置：CR-G0 至 CR-G6 全部通过；取得目标 Windows 主机、Terminal Agent、真实打印机和一笔受控测试订单授权。`printerName` 必须来自现场配置，代码不得硬编码型号；未知彩色 mode 不得假设。

按顺序验证：

1. 只开启后端 `CONTRACT_REVIEW_REPORT_PRINT_ENABLED` 与前端报告打印开关的受控验收构建，合同主入口仍不对普通用户开放。
2. 合成 canary 完成报告生成、报价、份数/单双面参数确认和支付门禁。
3. 未支付任务不能被 Agent 领取；支付后只创建一个 `PrintTask`。
4. Agent 使用短签名 URL 下载，并以数据库 SHA-256 校验；篡改文件、过期 URL 或 hash 不一致必须拒绝出纸。
5. 实际出纸内容、页数、方向、黑白/彩色和单双面按现场已验证能力执行；不假设未确认的驱动参数。
6. completed/failed 状态回流到 Kiosk 与打印订单；Agent 重启、断网和重试不重复出纸。
7. 终态后报告云端对象和 Windows 临时文件按策略清理，任务与删除审计仍可查。

证据：脱敏订单 ID、PrintTask ID、Agent 版本、Windows/浏览器版本、驱动名、配置的 `printerName`、状态时间线、纸质报告照片（必须遮蔽 canary 以外信息）和清理结果。

## 十二、停止条件

出现任一情况立即停止，保持或恢复三个开关为 `false`：

- Gate 0 身份、provider 白名单、法务正文版本或候选 SHA 无法复核。
- 使用了真实用户合同、日志出现合同正文/PII/凭据、对象可公开访问。
- 真实队列缺失、回退 inline/mock、重复模型调用或任务状态伪造成功。
- provider 重定向到未批准域、使用 fallback、返回越权法律结论且未被安全门拒绝。
- 会员/匿名越权、刷新/离席/BFCache 后恢复上一位用户上下文。
- 合同原件可通过通用打印入口建单，或报告未校验服务端 SHA-256。
- 未支付可领取、重复出纸、状态不回流、终态敏感文件不清理。
- 需要修改生产环境、部署、migration 或真机配置但没有对应单独授权。

## 十三、启用顺序与回滚

全部 Gate 通过后仍需独立发布批准，按以下顺序启用：

1. 保持所有前端开关关闭，先确认后端真实依赖和可观测性稳定。
2. 单独开启 `VITE_ENABLE_CONTRACT_REVIEW`，小范围验证非打印合同风险提示。
3. 非打印链稳定后，再同时开启服务端与前端报告打印开关。
4. 先限定 1 台终端、1 台打印机和受控时段；观察队列、模型错误、文件清理和打印状态。

回滚优先关闭前端入口和报告打印开关；后端继续 fail-closed，保留任务/删除审计，不延长敏感文件寿命，不用 mock 维持可用。任何已经支付但未履约的订单按既有核查/退款流程处理，不自动重打。

## 十四、验收结果矩阵

| Gate | 结果 | 证据 ID | 责任人 | 时间 | 备注 |
| --- | --- | --- | --- | --- | --- |
| CR-G0 本地冻结候选 | PENDING |  |  |  |  |
| CR-G1 预生产只读就绪 | PENDING |  |  |  |  |
| CR-G2 PostgreSQL/法务正文 | PENDING |  |  |  |  |
| CR-G3 Redis/BullMQ | PENDING |  |  |  |  |
| CR-G4 境内模型/日志净化 | PENDING |  |  |  |  |
| CR-G5 私有存储/生命周期 | PENDING |  |  |  |  |
| CR-G6 公共终端隐私 | PENDING |  |  |  |  |
| CR-G7 Windows 报告出纸 | PENDING |  |  |  |  |

只有 CR-G0 至 CR-G7 全部为 PASS，且具名负责人确认对应证据仍有效，才能称“合同审查预生产验收通过”；否则统一结论为 NO-GO，并保持默认关闭。
