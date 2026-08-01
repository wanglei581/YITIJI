---
status: blocked
production_default: false
fail_closed: true
provider_allowlist: pending
algorithm_filing: pending
generative_ai_security_assessment: pending
aigc_visible_label: pending
aigc_metadata_label: pending
legal_gold_set: pending
approved_by: []
approved_at: null
---

# AI 合同审查 Gate 0 发布门禁

## 门禁解释

前置 frontmatter 的 `status` 是本门禁状态的唯一机器可读来源。正文只说明检查项、状态约束和默认关闭策略，不复述可能随批准流程变化的当前状态；verifier 通过也不代表任何检查项已获批准或构成上线授权。

任何一项未签字 approved，真实合同 AI 调用和生产入口都必须保持关闭。

## Gate 0 检查项

| 检查项 | 批准责任 | 所需证据 |
| --- | --- | --- |
| `provider_allowlist` | 合规、安全 | 合同专用境内 provider/model allowlist 已签字，且不存在通用配置或境外 fallback |
| `algorithm_filing` | 法务、合规 | 服务方算法备案适用性与备案状态已签字确认 |
| `generative_ai_security_assessment` | 法务、合规、安全 | 生成式 AI 服务安全评估适用性及所需结论已签字确认 |
| `aigc_visible_label` | 法务、合规、安全 | 用户可见的生成内容标识方案及不可绕过性已验收 |
| `aigc_metadata_label` | 法务、合规、安全 | 生成内容元数据规范、写入与完整性机制已验收 |
| `legal_gold_set` | 法务、安全 | 法务黄金集、风险分级与拒答边界已通过验收 |

其中，`aigc_visible_label` 由法务确认披露文案、合规确认标识规则、安全责任人确认不可绕过性后联合签字；`aigc_metadata_label` 由合规确认元数据规范、安全责任人确认写入与完整性机制、法务确认适用边界后联合签字。每项批准必须保留对应证据和具名责任人。

## 状态与变更规则

- `status` 只允许为 `blocked` 或 `approved`。
- `production_default` 必须始终为 `false`；生产能力只能通过独立、显式且可审计的发布授权开启。
- `fail_closed` 必须始终为布尔值 `true`；verifier 直接校验此字段，不依赖正文文案判断关闭策略。
- 只有全部 Gate 0 检查项均为 `approved`，且 `approved_by` 非空时，才允许将 `status` 改为 `approved`。
- `approved_by` 是 Gate 0 最终联合批准人的身份标识数组，并非各检查项证据或责任人签字的替代；仅在最终 `approved` 时填写，且必须唯一覆盖 `legal`、`compliance`、`security` 三个角色各一人（或一个稳定组织责任身份）。
- 每个批准人使用 `<role>:<stable-id>` 格式，例如 `legal:contract-governance-counsel`、`compliance:ai-compliance-office`、`security:ai-security-office`。`stable-id` 长度为 1–64 个字符，首字符必须是小写字母或数字，其余字符只允许小写字母、数字、点、下划线和连字符；不得包含空白，也不得使用 `test`、`demo`、`example`、`placeholder`、`sample`、`todo`、`tbd`、`fake`、`dummy` 等占位词作为独立段。
- 三个角色的 `stable-id` 必须彼此不同，身份与角色也不得重复。批准人必须是具名、可追责的人类或组织责任身份；自动化任务不得代签。`bot`、`automation`、`automated`、`runner`、`workflow`、`actions`、`github-actions` 的大小写、点、下划线、连字符及无分隔首尾复合变体均禁止；`ci` 在与 `agent`、`bot`、`runner`、`workflow`、`actions`、`automation`、`automated` 等自动化语义组合时禁止，不因普通身份中偶然出现字母 `ci` 而拒绝。
- `approved_at` 使用有效 RFC3339 时间记录最终联合批准时间。`blocked` 时 `approved_by` 必须为 `[]` 且 `approved_at` 必须为 `null`。
- 任一批准被撤销、过期或证据无法复核时，必须立即将 `status` 恢复为 `blocked`，并保持真实调用与生产入口关闭。

## 验证边界

`verify:contract-review:gate0` 只验证本记录的字段完整性和状态一致性。验证通过仅说明记录格式有效；只有 frontmatter 中 `status: approved` 且所有批准条件同时满足，才表示 Gate 0 已获批准。
