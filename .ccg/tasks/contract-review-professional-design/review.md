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

用户已回复“可以，继续”，据此仅进入实施计划编制，尚未进入编码。

## 实施计划交叉评审

评审对象：`docs/superpowers/plans/2026-08-01-ai-contract-review.md`。

### 首轮

- Antigravity：`APPROVE`，无 Critical；建议把 PostgreSQL schema 改为由 SQLite SSOT 运行 `db:pg:sync` 生成、强化三波文件预算，并为文字层 PDF 增加 50 页硬上限测试。三项均已修订。
- Claude：`APPROVE`，七项核心闭环全部成立；唯一 Warning 是 `legal-risk-check` 长合同文本可能绕过合同专用入口，另建议补证据片段 30 秒自动模糊门禁。两项均已写入 Task 13 的 API 前拦截、E2E 和计时验证。

### 修订回归

- Antigravity：`APPROVE`，无阻断项，确认 SQLite SSOT、50 页整份拒绝、聊天旁路拦截和 30 秒模糊均闭环。
- Claude：`APPROVE`，无阻断项，确认相应 RED 测试、实现片段和门禁命令自洽。
- Cursor：未重复调用实施计划复审；正式设计阶段已完成 Cursor 首轮审查，其提出的仓库落点问题已纳入设计和本计划。此前最终复审调用无输出的事实继续保留，不虚构通过状态。

## 当前结论

正式设计和 14 个任务的逐步实施计划均已完成，无已知阻断项。当前仅等待用户选择执行方式；在用户明确选择前不进入业务代码、数据库或页面实现。

## Wave A Task 1：Gate 0 发布门禁实施审查

审查范围：`d77bf144..62621535`，仅包含：

- `docs/compliance/contract-review-release-gate.md`
- `services/api/scripts/verify-contract-review-gate0.ts`
- `services/api/package.json`

实施采用 RED→GREEN：先证明缺失门禁记录会失败，再建立默认 `blocked`、`production_default: false`、`fail_closed: true` 的记录与 package verifier。后续针对审查发现的重复键、错误 YAML 类型、非法状态、伪批准人、自动化代签、批准生命周期和正文状态漂移逐项补充回归 fixture。

### 本地双阶段审查

- 规格符合性：`APPROVE`。
- 代码质量：`APPROVE`，无 Critical、Important、Minor。
- 实测覆盖：当前 blocked、六种部分批准、最终 approved 生命周期；重复/未知键；错误布尔值；非法 RFC3339；三角色独立 stable ID；占位与自动化身份；正文动态状态镜像；ES2021 严格 TypeScript；ESLint；`git diff --check`。

### 外部双模型交叉审查

- Antigravity：最终 `APPROVE`，无 Critical、无 Warning。
- Claude：最终 `APPROVE`。其两轮 Warning 已处理：bare `ci` 合法身份误报，以及 `office-ci-agent` 一类中段组合漏检。
- Claude 保留一项可接受的 fail-closed 取舍：极少数自然人姓名在移除分隔符后可能偶然形成 `ci+automation-term`，从而被拒绝。该情况不会放行自动化代签，只要求批准人改用另一稳定目录 ID，因此不阻断 P0。

### 结论

Task 1 已封板。Gate 0 静态验证通过只代表记录格式和状态一致性有效，不代表 Gate 已获批准，也不构成生产上线授权；当前正式记录仍为 `blocked`，真实合同 AI 调用和生产入口保持关闭。
