# AI 合同审查设计交叉评审记录

## 评审范围

- 正式设计：`docs/superpowers/specs/2026-08-01-ai-contract-review-design.md`
- 评审方式：Codex 主审；Claude、Antigravity、Cursor 只读交叉评审。
- 本轮只审方案，不修改业务代码、数据库、页面或生产配置。

## 首轮结论与修订

### Antigravity

首轮结论为 `REQUEST_CHANGES`。主要问题及处理：

- 全局 highly-sensitive 一小时 TTL 与方案两小时会话冲突：改为服务端锁定的 `contract_upload` purpose-specific 两小时上限，并明确会话结束优先删除、TTL 只作兜底。
- 现有百宝箱 `ai_skill` 与站内工作流冲突：明确同时迁移为 `internal_route`，移除 assistant intent，并同步治理快照。
- 未校验模型结果可能先落库：改为 SafetyGate 通过后与 `completed` 状态同事务原子提交。
- 补充 20 页 OCR 队列影响、PDF.js 资源清理和数据库索引。

### Cursor

首轮结论为 `REQUEST_CHANGES`。主要问题及处理：

- 补齐 Kiosk multipart、UploadSession、ScanTask、object key 和“我的文档”排除链路。
- 明确合同专用 extraction、BullMQ worker、GET 轮询、匿名 token 请求头和 page-local UTF-16 char range。
- 补齐 consent snapshot、全文 PII 遮蔽服务、`legal-risk-check` 边界、生成内容标识 Gate 0、文件预算和双库 CI。

### Claude

首轮结论为 `REQUEST_CHANGES`。主要问题及处理：

- 合同敏感信息可能路由到境外模型：新增合同专用境内 provider/model allowlist，初始化与每次调用均 fail closed，禁止 `openai`、`claude` 等境外 fallback。
- 遗漏服务方自身算法备案/生成式 AI 安全评估：纳入 Gate 0，要求完成适用义务或归档“不适用”的书面依据。
- 将规则分为地域无关确定性、地域相关和语义提醒；未建立地域数据集前只提示核实。
- 匿名明文 token 只留在易失内存；刷新、离席和切换技能立即销毁。
- 澄清 VisionAI / AdvisorAI 是产品架构映射，不是假设仓库已存在统一引擎注册框架。
- 将提示注入防线改为结构隔离、无工具权限、schema 和白名单验证，不声称输出侧能证明系统指令未改变。
- 明确 PII 遮蔽仅覆盖 LLM 上送，OCR 仍处理原始页面，并使主体存在性判断与主体明文解耦。

## 修订版复审

- Antigravity：`APPROVE`，无 Critical、无 Warning。
- Claude：`APPROVE`，无 Critical、无 Warning；额外核验 BullMQ、`expiresAtOverride`、`UserAiConsent.scope`、UploadSession purpose 白名单和百度 OCR 能力均与仓库一致。
- Cursor：应用内置 CLI 最终复审连续两次无输出并人工中止，未把该调用记为通过；其首轮提出的全部仓库落点问题已逐项修订，并由 Claude、Antigravity 复审通过。

## 剩余非阻断说明

- 匿名会话刷新即失是公共终端隐私优先的明确取舍，实施时必须有前置提示。
- 合同审查不得接入后台可动态改 vendor/base URL 的通用 `LlmConfigService`。
- canonical text 与 UTF-16 char range 必须有独立边界测试。
- 法务、隐私、供应商、算法备案/安全评估和生成内容标识 Gate 0 未完成前，生产保持关闭。

## 结论

设计已无已知阻断实施计划的架构问题，但仍处于“待用户书面复核”状态。用户确认前不生成逐任务实施计划，也不进入编码。
