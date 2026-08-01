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

## 当前结论

AI 合同审查当前处于 `blocked`。本记录仅用于冻结 Gate 0 的检查项、状态约束和默认关闭策略，不代表任何检查项已获批准，也不构成上线授权。

任何一项未签字 approved，真实合同 AI 调用和生产入口都必须保持关闭。

## Gate 0 检查项

| 字段 | 当前状态 | 放行证据 |
| --- | --- | --- |
| `provider_allowlist` | `pending` | 合同专用境内 provider/model allowlist 已由安全与合规责任人签字，且不存在通用配置或境外 fallback |
| `algorithm_filing` | `pending` | 服务方算法备案适用性与备案状态已由法务签字确认 |
| `generative_ai_security_assessment` | `pending` | 生成式 AI 服务安全评估适用性及所需结论已由法务与安全责任人签字确认 |
| `aigc_visible_label` | `pending` | 用户可见的生成内容标识方案已验收并签字 |
| `aigc_metadata_label` | `pending` | 生成内容元数据标识方案已由合规、安全责任人联合验收并签字 |
| `legal_gold_set` | `pending` | 法务黄金集、风险分级与拒答边界已通过验收并由法务签字 |

其中，`aigc_visible_label` 由法务确认披露文案、合规确认标识规则、安全责任人确认不可绕过性后联合签字；`aigc_metadata_label` 由合规确认元数据规范、安全责任人确认写入与完整性机制、法务确认适用边界后联合签字。每项批准必须保留对应证据和具名责任人。

## 状态与变更规则

- `status` 只允许为 `blocked` 或 `approved`。
- `production_default` 必须始终为 `false`；生产能力只能通过独立、显式且可审计的发布授权开启。
- `fail_closed` 必须始终为布尔值 `true`；verifier 直接校验此字段，不依赖正文文案判断关闭策略。
- 只有全部 Gate 0 检查项均为 `approved`，且 `approved_by` 非空时，才允许将 `status` 改为 `approved`。
- `approved_by` 是 Gate 0 最终联合批准人的身份标识数组，并非各检查项证据或责任人签字的替代；仅在最终 `approved` 时填写，且必须唯一覆盖 `legal`、`compliance`、`security` 三个角色各一人（或一个稳定组织责任身份）。
- 每个批准人使用 `<role>:<stable-id>` 格式，例如 `legal:contract-governance-counsel`、`compliance:ai-compliance-office`、`security:ai-security-office`。`stable-id` 只允许小写字母、数字、点、下划线和连字符，不得包含空白，也不得使用 `test`、`demo`、`example`、`placeholder`、`sample`、`todo`、`tbd`、`fake`、`dummy` 等占位词作为点、下划线或连字符分隔的独立段；不得重复身份或角色。
- `approved_at` 使用有效 RFC3339 时间记录最终联合批准时间。`blocked` 时 `approved_by` 必须为 `[]` 且 `approved_at` 必须为 `null`。
- 任一批准被撤销、过期或证据无法复核时，必须立即将 `status` 恢复为 `blocked`，并保持真实调用与生产入口关闭。

## 验证边界

`verify:contract-review:gate0` 只验证本记录的字段完整性和状态一致性。验证通过仅说明记录格式有效；在当前 `status: blocked` 下，门禁仍未获批准。
