# F1 D3 managed 拓扑与治理解阻审批包

> 状态：**空模板，不是生产批准，当前 F1 仍为 NO-GO。**
>
> 本文只定义下一次 D3 只读预检所需的非秘密输入、签批角色和硬停止条件。
> 不得在本仓库模板中填入密钥、token、密码、环境变量值、连接串、日志正文或业务数据。
> 完整签批记录应保存在受限的机构运维/审批系统中；仓库只记非秘密的审批单编号、状态、
> 批准角色、时间和审批件摘要。

## 1. 使用边界

- 本审批包仅解决 [F1 D3 只读预检](../reviews/f1-d3-production-readonly-precheck-2026-07-30.md) 中 B1–B9 缺少可核验输入的问题。
- 完成模板不等于 D3 PASS；D3 PASS 也不自动授权 D4 Genesis、D5 切流或 D6 activation。
- 任一必填项、证据引用或具名签批缺失时，结论必须是 **NO-GO**。
- managed 必须使用独立主机或等价隔离实例独占 `127.0.0.1:3010`；禁止在 legacy 主机临时换端口、复用 legacy PM2 名称或将 legacy 健康状态写成 managed 证据。

## 2. 角色与职责分离

| 角色 | 必须完成 | 禁止事项 |
| --- | --- | --- |
| 申请人 | 填写字段、提供脱敏证据引用，确认候选 commit 与拓扑 | 自行批准；填写秘密值；猜测主机/路径/摘要 |
| 机构负责人 | 批准业务窗口、资产归属和责任人 | 替代运维或安全负责人做技术签批 |
| 运维负责人 | 批准 managed 拓扑、PM2、路径、调用方和零流量核验方法 | 以现网 `online` / HTTP 200 代替来源与隔离证据 |
| 安全负责人 | 批准账户/ACL、control root 留存、锁恢复和审计方式 | 让执行账户同时拥有 control 记录删除与审批权 |
| D3 只读核验人 | 只按已批准字段核验节点类型、权限、摘要、进程字段和零流量证据 | 触发生成/激活/重启/切流；读取 env 值、日志或业务数据 |
| D4–D6 执行人 | 仅在后续独立授权中按锁定命令执行 | 把 D3 或本审批包当成 D4–D6 执行授权 |

## 3. 审批记录索引

| 字段 | 申请人填写 | 判定规则 |
| --- | --- | --- |
| 审批单编号 | `<APPROVAL_RECORD_ID>` | 在受限审批系统内唯一、可追溯 |
| 审批件 SHA-256 | `<APPROVAL_RECORD_SHA256>` | 完整签批件的 64 位小写 hex；不是 launcher/contract 摘要 |
| 候选 Git commit | `<FULL_40_HEX_COMMIT>` | 与候选 CI 及 source archive 一致 |
| 候选 CI 证据 | `<CI_RUN_ID_OR_APPROVED_EVIDENCE_REF>` | 只记引用和结果，不复制日志正文 |
| 申请时间窗口 | `<RFC3339_START>` / `<RFC3339_END>` | 未在窗口内不得执行 D3 |

## 4. managed 拓扑与命名

| 字段 | 申请人填写 | 只读验收口径 |
| --- | --- | --- |
| Legacy 资产标识 | `<LEGACY_ASSET_ID>` | 仅用于隔离对照，不读取其秘密/日志 |
| Managed 资产标识 | `<MANAGED_ASSET_ID>` | 必须与 legacy 为独立主机或可证明的等价隔离实例 |
| 隔离类型 | `<DEDICATED_HOST_OR_EQUIVALENT_ISOLATION>` | 能独占 loopback `127.0.0.1:3010`，不修改代码固定 health URL |
| Legacy PM2 名称 | `<LEGACY_PM2_NAME>` | 仅做不同名比对 |
| Managed PM2 名称 | `<MANAGED_PM2_NAME>` | 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，且不等于 legacy 名称 |
| Health URL | `http://127.0.0.1:3010/api/v1/health` | 必须精确相等，健康回应必须是 PostgreSQL |

## 5. 受控路径与摘要

下列值必须来自已签批记录，不得把占位符、示例或本地 build 摘要写成生产已批准值。

| 字段 | 申请人填写 | 约束 |
| --- | --- | --- |
| Candidate release root | `<CANDIDATE_RELEASE_ROOT>` | 绝对路径；release 根不得包含 `.env`、日志、storage、uploads 或运行缓存 |
| Artifact root | `<ARTIFACT_ROOT>` | 绝对路径，与 release 根边界清晰 |
| Managed current link | `<MANAGED_CURRENT_LINK>` | 绝对路径，不得复用 legacy current |
| Deployment control root | `<DEPLOYMENT_CONTROL_ROOT>` | 绝对路径、非符号链接目录，不得位于易被 release 清理的路径内 |
| Launcher CWD | `<LAUNCHER_CWD>` | 绝对路径、非符号链接目录 |
| Launcher path | `<LAUNCHER_PATH>` | 绝对路径、非符号链接普通文件、不大于 1 MiB |
| Launcher SHA-256 | `<RECORDED_LAUNCHER_SHA256>` | 64 位小写 hex，与生产 launcher 文件只读比对 |
| Runtime contract path | `<RUNTIME_ENV_CONTRACT_PATH>` | 绝对路径、无空白；非符号链接普通文件，不大于 64 KiB |
| Runtime contract SHA-256 | `<RUNTIME_ENV_CONTRACT_SHA256>` | 64 位小写 hex，与 contract 文件只读比对 |
| Contract 变量名/用途清单 | `<APPROVED_NAME_PURPOSE_LIST>` | 必须包含 `PATH`；仅 `name` / `purpose`，禁止值、默认值或样例秘密 |

runtime contract 摘要只覆盖“变量名/用途清单文件”，不覆盖环境变量值。运行值的注入、保存和轮换仍属于带外秘密流程。

## 6. 账户、ACL 与 control root 长期留存

| 对象 | 部署账户 | API 运行账户 | 独立安全/审计角色 | D3 核验人 |
| --- | --- | --- | --- | --- |
| release / artifact / launcher | 经授权读写 | 只读 | 审批边界 | 只读 |
| managed current | 仅在 D4–D6 独立授权中切换 | 只读/解析 | 审批边界 | 只读 |
| deployment control root | 仅追加，禁止删除历史记录 | 只读 | 保有独立处置审批权 | 只读 |
| control 记录/锁删除 | 禁止 | 禁止 | 仅在单次具名授权中处置 | 禁止 |
| 环境变量值 | 仅带外注入所需范围 | 运行时所需范围 | 批准管理方式 | 禁止读取 |

审批记录还必须填写：

- 部署账户标识：`<DEPLOYER_ACCOUNT_ID>`
- API 运行账户标识：`<RUNNER_ACCOUNT_ID>`
- control root 属主/属组与 ACL 证据引用：`<CONTROL_ROOT_ACL_EVIDENCE_REF>`
- 长期留存方式（append-only / immutable / WORM / 独立审计备份）：`<RETENTION_MECHANISM>`
- 留存机制证据引用与责任人：`<RETENTION_EVIDENCE_REF>` / `<RETENTION_OWNER>`

代码的 `wx` 创建语义只能防覆盖，不能防止拥有删除权的账户抹除 control root；因此长期留存必须有带外机制和独立责任人。

## 7. 零流量证明

审批记录必须固定：

| 字段 | 必填内容 |
| --- | --- |
| 负载层证据时间 | `<RFC3339_TIMESTAMP>` |
| 当前流量结论 | `100% legacy / managed 0%` |
| 只读核验方法 | `<APPROVED_FILTERED_LB_OR_NGINX_CHECK>` |
| 脱敏证据引用 | `<ZERO_TRAFFIC_EVIDENCE_REF>` |
| 核验负责人 | `<OPS_OWNER>` |

只能取证已批准的 upstream/路由字段和权重结论。禁止用 legacy 可达、PM2 `online`、单次 HTTP 200、本地 fixture 或 D2 容器演练代替 managed 零挂载证据。

## 8. 两类残留锁恢复 SOP

两把锁必须分开申请、分开判定：

| 锁 | 固定位置 | 默认结论 |
| --- | --- | --- |
| Genesis lock | `<DEPLOYMENT_CONTROL_ROOT>/GENESIS.lock` | 存在即 D3/D4 NO-GO，不得擅自删除 |
| Activation lock | `<MANAGED_CURRENT_LINK>.activation.lock` | 存在即 D3/D6 NO-GO，不得擅自删除 |

每把锁均执行以下流程：

1. **只读判定**：仅核验锁路径的存在性、节点类型、元数据和摘要；核验是否有在途 Genesis/activation；对照 `current` 和过滤后的 PM2 name/status/cwd/script/args。不输出全量 PM2 JSON、env 或日志。
2. **具名授权**：单独建立一次性处置单，由运维与安全负责人共同批准精确锁路径和处置窗口。D3 审批包本身不授权删除。
3. **证据复核**：处置后再次只读核验锁、`current`、PM2 和 control 记录组合；任何 intent/success/failure 记录缺失或疑似被篡改时，升级为 control root 事故，禁止重新 Genesis 覆盖事实。

本文不提供锁删除命令，防止未经核验的复制粘贴操作。

## 9. D4 / D6 调用方契约盘点

本节只是防混用摘要。执行命令的文档 SSOT 是 [production-deployment-runbook.md](./production-deployment-runbook.md) 第 6.2 节，参数验证的代码 SSOT 是当前候选 commit 内的 `release-genesis-cli.ts` 与 `release-activation.ts`。审批包、runbook 与当前源码任一不一致时立即 **NO-GO**，必须先在新的文档任务中对齐，不得由现场执行人自行选择或修改参数。

| 阶段 | 契约 | 关键差异 |
| --- | --- | --- |
| D4 Genesis | 11 个 flag / 22 个 CLI 参数 | `--managed-current-link`、`--deployment-control-root`、`--runtime-env-contract` |
| D6 activation | 10 个 flag / 20 个 CLI 参数 | `--current-link`、`--runtime-env-contract-path`；无 control-root 参数 |

审批人和 D3 核验人必须确认两套命名没有混用。activation 不写 Genesis control root；不得宣称 activation 会自动产生 Genesis 的 control 记录。

## 10. 签批与结论

| 签批角色 | 姓名/工号 | 结论 | 时间 | 审批系统记录引用 |
| --- | --- | --- | --- | --- |
| 申请人 | `<APPLICANT>` | 已提交 | `<RFC3339>` | `<REFERENCE>` |
| 机构负责人 | `<INSTITUTION_OWNER>` | 批准 / 拒绝 | `<RFC3339>` | `<REFERENCE>` |
| 运维负责人 | `<OPS_OWNER>` | 批准 / 拒绝 | `<RFC3339>` | `<REFERENCE>` |
| 安全负责人 | `<SECURITY_OWNER>` | 批准 / 拒绝 | `<RFC3339>` | `<REFERENCE>` |
| D3 只读核验人 | `<AUDITOR>` | PASS / NO-GO | `<RFC3339>` | `<EVIDENCE_REFERENCE>` |

仅当所有必填字段完整、三位负责人全部具名批准、审批件摘要可比对时，才能另行申请 D3 只读预检。任一人拒绝或未签即 **NO-GO**。

## 11. D3 只读输出白名单

只允许留存以下脱敏结果：

- 候选 commit / CI 引用及状态。
- 主机资产标识、隔离结论、固定 health URL 匹配结果。
- 文件节点类型、属主/属组/权限结论、路径标识与 SHA-256 比对结果。
- PM2 的 name/status/cwd/script/args 白名单字段，以及与审批值一致/不一致的结论。
- 负载层 `100% legacy / managed 0%` 结论与证据引用。
- Genesis / activation 锁与 control 记录组合的状态结论。

禁止 `pm2 env`、全量 `pm2 describe/jlist` 输出、环境值、`.env`、连接串、日志正文、用户文件和业务数据进入审批包或仓库证据。

## 12. 硬停止条件

出现任一情况必须停止并记录 **NO-GO**：

1. 空模板、占位符、示例值、未签批文件或猜测值被当作生产批准。
2. managed 与 legacy 不是独立主机/等价隔离，或试图修改固定 `127.0.0.1:3010`。
3. Managed PM2 名称缺失、非法或与 legacy 重复。
4. 任一受控路径、launcher/contract 摘要、ACL、留存机制、零流量证据或三方签批缺失。
5. contract 或审批包中出现环境变量值、密钥、token、密码、连接串或日志正文。
6. 无法证明 `100% legacy / managed 0%`，或 managed 已挂载业务流量。
7. 任一残留锁/control 状态未知，或处置缺少独立具名授权。
8. activation 不是 10 flag / 20 参数，或 Genesis 与 activation 的 current/contract flag 被混用。
9. 只读预检需要扩大为 Genesis、activation、reload/restart、删锁、切流或其他写操作。

满足本文只能产生“可以另行申请 D3”的输入，不会自动改变当前 production F1 **NO-GO** 状态。
