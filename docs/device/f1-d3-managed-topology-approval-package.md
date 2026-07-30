# F1 D3 managed 拓扑审批治理包

> 状态：**空模板，不是生产批准，当前 F1 仍为 NO-GO。**
>
> B1–B9 技术输入、状态词法和关闭条件的唯一 SSOT 是
> [f1-d3-managed-topology-inputs.md](./f1-d3-managed-topology-inputs.md)。本文不重复保存主机、路径、
> 摘要或权限字段，只定义审批职责、签批索引和证据输出边界。

完整签批记录必须保存在受限的机构运维/审批系统中。仓库只允许记录非秘密的审批单编号、状态、
批准角色、时间和审批件摘要；不得记录密钥、token、密码、环境变量值、连接串、日志正文或业务数据。

## 1. 使用边界

- 本模板只治理下一次 D3 只读预检的申请和签批，不授权 SSH、D4 Genesis、D5 切流或 D6 activation。
- 技术值只能填写到受限审批系统，并按 B1–B9 字段 ID 引用；不得在本文复制第二套字段或状态。
- 所有 B1–B9 必填项均为 `VERIFIED_READ_ONLY` 前，D3 总体结论必须是 **NO-GO**。
- D3 PASS 不自动授权 D4、D5 或 D6；每层仍须独立、限时、具名授权。

## 2. 角色与职责分离

| 角色 | 必须完成 | 禁止事项 |
| --- | --- | --- |
| 申请人 | 提交审批索引和 B1–B9 受限记录引用 | 自行批准；填写秘密值；猜测技术输入 |
| 机构负责人 | 批准业务窗口、资产归属和责任人 | 替代运维或安全负责人做技术签批 |
| 运维负责人 | 批准 managed 拓扑、PM2、路径和零流量核验方法 | 以 legacy `online` 或 HTTP 200 代替 managed 证据 |
| 安全负责人 | 批准账户/ACL、control root 留存、锁恢复和审计方式 | 让执行账户同时拥有记录删除与审批权 |
| D3 只读核验人 | 按已批准 B1–B9 引用核验并登记状态 | 触发生成、激活、重启、删锁或切流 |
| D4–D6 执行人 | 仅在后续独立授权中执行 | 把 D3 PASS 当作后续操作授权 |

## 3. 审批记录索引

| 字段 | 申请人填写 | 判定规则 |
| --- | --- | --- |
| 审批单编号 | `<APPROVAL_RECORD_ID>` | 在受限审批系统内唯一、可追溯 |
| 审批件 SHA-256 | `<APPROVAL_RECORD_SHA256>` | 完整签批件的 64 位小写 hex |
| 候选 Git commit | `<FULL_40_HEX_COMMIT>` | 与候选 CI 和 source archive 一致 |
| 候选 CI 证据 | `<CI_RUN_ID_OR_APPROVED_EVIDENCE_REF>` | 只记引用和结果，不复制日志正文 |
| B1–B9 记录引用 | `<RESTRICTED_B1_B9_RECORD_REF>` | 指向受限系统内的完整非秘密输入记录 |
| D3 只读窗口 | `<RFC3339_START>` / `<RFC3339_END>` | 未在窗口内不得执行 D3 |

## 4. B1–B9 签批映射

签批人只对 [managed 输入清单](./f1-d3-managed-topology-inputs.md) 的字段 ID 作批准或拒绝：

| 范围 | 主责批准人 | 必须联合复核 |
| --- | --- | --- |
| B1–B4：主机、PM2、current、control root | 运维负责人 | 机构负责人、安全负责人 |
| B5、B9：长期留存、权限、残留锁 SOP | 安全负责人 | 运维负责人 |
| B6–B7：launcher 与 runtime contract | 运维负责人 | 安全负责人 |
| B8：零流量证明 | 运维负责人 | D3 只读核验人 |

任一字段缺失、拒绝、为占位符，或状态仍为 `UNSET`、`NOT_VERIFIED`、`BLOCKED`，均不得签出 D3 PASS。

## 5. 两类残留锁的独立处置

| 锁 | 固定位置 | 默认结论 |
| --- | --- | --- |
| Genesis lock | `<DEPLOYMENT_CONTROL_ROOT>/GENESIS.lock` | 存在即 D3/D4 NO-GO，不得擅自删除 |
| Activation lock | `<MANAGED_CURRENT_LINK>.activation.lock` | 存在即 D3/D6 NO-GO，不得擅自删除 |

每把锁都必须执行“只读判定 → 单独具名授权 → 处置后证据复核”。D3 审批包本身不授权删除，
本文也不提供删除命令。任何 intent/success/failure 记录缺失或疑似被篡改时，必须升级为 control root
事故并保持 **NO-GO**，不得重新 Genesis 覆盖事实。

## 6. 签批与结论

| 签批角色 | 姓名/工号 | 结论 | 时间 | 审批系统记录引用 |
| --- | --- | --- | --- | --- |
| 申请人 | `<APPLICANT>` | 已提交 | `<RFC3339>` | `<REFERENCE>` |
| 机构负责人 | `<INSTITUTION_OWNER>` | 批准 / 拒绝 | `<RFC3339>` | `<REFERENCE>` |
| 运维负责人 | `<OPS_OWNER>` | 批准 / 拒绝 | `<RFC3339>` | `<REFERENCE>` |
| 安全负责人 | `<SECURITY_OWNER>` | 批准 / 拒绝 | `<RFC3339>` | `<REFERENCE>` |
| D3 只读核验人 | `<AUDITOR>` | PASS / NO-GO | `<RFC3339>` | `<EVIDENCE_REFERENCE>` |

仅当三位负责人全部具名批准、审批件摘要可比对、B1–B9 全部为 `VERIFIED_READ_ONLY` 时，D3 核验人
才可形成新的只读审查报告。审批模板本身不会改变 production F1 的 **NO-GO** 状态。

## 7. D3 输出白名单

只允许留存以下脱敏结论：候选 commit/CI 引用、B1–B9 字段状态、节点类型与权限结论、文件
SHA-256 比对结论、PM2 的 name/status/cwd/script/args 白名单字段、`100% legacy / managed 0%`
结论，以及两把锁和 control 记录的组合状态。

禁止输出 `pm2 env`、全量 `pm2 describe/jlist`、环境值、`.env`、连接串、日志正文、用户文件或业务数据。

## 8. 硬停止条件

出现任一情况必须停止并记录 **NO-GO**：

1. 空模板、占位符、未签批文件或猜测值被当作生产批准。
2. 本审批包与 B1–B9 输入清单、runbook 或当前源码不一致。
3. 任一 B1–B9 字段未达到 `VERIFIED_READ_ONLY`，或三方签批不完整。
4. 无法证明 managed 与 legacy 隔离、managed 零流量、权限分离或 control root 长期留存。
5. 审批记录或证据中出现秘密、环境值、日志正文或业务数据。
6. 任一残留锁/control 状态未知，或处置缺少独立具名授权。
7. 只读预检需要扩大为 Genesis、activation、reload/restart、删锁、切流或其他写操作。

满足本文只能产生“可以另行申请 D3”的输入，不会自动授权 D4–D6。
