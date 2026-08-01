# AI 合同审查专业方案需求

## 真实功能闭环

在现有百宝箱候选项 `contract-review` 下，为求职者本人提供劳动合同、实习协议、竞业限制协议和 Offer 的 AI 条款风险提示；能力以首方站内流程交付，不形成律师服务、企业合同管理或招聘闭环。

## 本轮范围

- 只输出正式设计文档，不写实现代码、不迁移数据库、不改页面入口。
- 新增合同视觉提取、合同分析和合同安全闸三个逻辑处理层，映射到产品架构中的 VisionAI / AdvisorAI，复用现有 FileObject、OCR provider、AI provider、AuditLog、百宝箱治理和打印链路；不假设代码中已有统一引擎注册框架。
- 明确法律边界、AI 技术链、状态机、数据契约、隐私留存、27 寸终端 UX、评测和上线门禁。
- 综合 Codex、Claude、Antigravity、Cursor 的只读评审结论，以实际代码为最终依据。

## 明确不做

- 不新增首页入口或同义卡片。
- 不把合同审查接成普通自由聊天。
- 不提供确定性法律结论、仲裁胜率、赔偿金额承诺或诉讼文书。
- 不允许企业、合作机构或管理员默认读取合同正文。
- 不把合同原文长期保存进“我的文档”。
- 不修改 `legacy-miaoda/`、生产配置、硬件链路或现有未提交业务文件。

## 本轮允许修改

- `docs/superpowers/specs/2026-08-01-ai-contract-review-design.md`
- `.ccg/tasks/contract-review-professional-design/`

## 本轮禁止修改

- `apps/`
- `services/`
- `packages/`
- Prisma schema 和 migrations
- 生产环境、密钥、数据库、终端配置
- 用户当前工作树中的其他未提交文件

## 设计验收

- 与现有百宝箱 `contract-review` 受限候选项一致。
- 不新增并列顶层产品引擎，合同审查作为 AdvisorAI 领域能力并配套专用安全闸。
- 明确视觉提取、确定性规则、LLM、ContractReviewSafetyGate 的职责分界。
- 合同专用 provider/model allowlist 仅允许境内合规通道并 fail closed，禁止通用配置或境外 fallback。
- 将服务方算法备案、生成式 AI 安全评估适用性和生成内容标识列为 Gate 0 硬门禁。
- 明确 P0 会话级留存、本人隔离、短期签名 URL、删除和审计策略。
- 明确 SQLite / PostgreSQL 双 schema 兼容方向和文件预算。
- 明确法务黄金集、红队、安全和真机上线门禁。
