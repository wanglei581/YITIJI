# F1 D3 Managed Topology 只读输入清单

> **状态：输入模板 · 非审批单 · 非 D4 授权。**
>
> 本文件只登记下一次 D3 生产只读预检所需的非秘密 managed 拓扑输入。字段全部关闭前，F1
> production 保持 **NO-GO**。即使 D3 最终 PASS，也不自动授权 D4 Genesis、D5 切流或 D6 稳态
> activation；每层仍须独立、限时、具名授权。

## 1. 使用边界

允许使用本文件：

- 固定非秘密主机/实例标识、PM2 应用名称和绝对路径标识；
- 记录文件 SHA-256、账户角色、权限/保留证明引用、零流量证明引用和锁恢复 SOP 引用；
- 登记 runtime-env contract 的变量名称与用途，但不得登记变量值；
- 汇总 D3 B1–B9 的只读核验状态。

禁止使用本文件：

- 作为 SSH、部署、`release:genesis`、`release:activate`、PM2/Nginx 修改、数据库迁移或切流授权；
- 保存环境变量值、密码、API Key、token、连接串、Cookie、OTP、私钥、`.env` 内容；
- 保存 `pm2 env`、PM2 dump、全量环境、日志正文、请求头、用户 IP、业务数据或个人信息；
- 用 legacy 主机、legacy PM2 `online`、HTTP 200、本地 build/fixture 摘要、D2 演练或 CI 全绿代替
  任一 D3 生产证据。

## 2. 状态词法与总体判定

| 状态 | 含义 |
| --- | --- |
| `UNSET` | 尚未提交批准的非秘密输入。 |
| `NOT_VERIFIED` | 已有候选输入，但尚未以 D3 只读证据核验。 |
| `VERIFIED_READ_ONLY` | 已在具名 D3 只读窗口核验，并有脱敏证据引用。 |
| `BLOCKED` | 输入冲突、不满足隔离/保留/权限要求，或无法安全核验。 |

判定规则：任一必填项为 `UNSET`、`NOT_VERIFIED` 或 `BLOCKED`，D3 总体结论必须为 **NO-GO**。
只有所有 B1–B9 必填项均为 `VERIFIED_READ_ONLY`，才可形成新的 D3 审查报告；清单本身不能把状态
改成 GO，也不能授权连接或操作生产环境。

## 3. 预检元数据

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 关闭条件 |
| --- | --- | --- | --- | --- |
| `M1` | 目标 40 位 commit | `<UNSET>` | `UNSET` | 与待审候选及独立审批记录一致。 |
| `M2` | D3 只读窗口/审批引用 | `<UNSET>` | `UNSET` | 具名、限时，且明确仅允许只读核验。 |
| `M3` | 证据包引用 | `<UNSET>` | `UNSET` | 仓库外脱敏证据位置和留存责任人已固定。 |
| `M4` | 只读核验执行角色 | `<UNSET>` | `UNSET` | 只记录角色名称，不记录账号凭据。 |

## 4. B1–B9 Managed 门槛输入

### B1 同机 managed 角色与固定双端口

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B1.1` | 同一 production host 的 managed 角色标识 | `<UNSET>` | `UNSET` | 正式资料能唯一定位现有主机上的 managed 角色；`<UNSET>` 不表示需要新增主机。 |
| `B1.2` | managed health 端点 | `http://127.0.0.1:3011/api/v1/health` | `NOT_VERIFIED` | 代码固定值已知；仍须证明只由 managed API 占用并且 loopback-only。 |
| `B1.3` | 同机双端口隔离证明引用 | `<UNSET>` | `UNSET` | 证明 legacy `3010` 与 managed `3011` 同机并存、仅 loopback 监听，并引用 fresh D2′ evidence；D2′ 不替代 D3。 |

### B2 独立 managed PM2 控制面

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B2.1` | managed PM2 应用名称 | `<UNSET>` | `UNSET` | 审批固定，且不是 legacy 字面名称 `api`。 |
| `B2.2` | PM2 运行账户角色 | `<UNSET>` | `UNSET` | 只登记角色；权限与 B9 矩阵一致。 |
| `B2.3` | PM2 launcher 配置证据引用 | `<UNSET>` | `UNSET` | 只读证明 cwd、script、3 项 script args 与批准值一致，不附 dump 全文。 |
| `B2.4` | managed `PM2_HOME` / daemon / dump / log 隔离证据引用 | `<UNSET>` | `UNSET` | 证明均与 legacy 不同；只记录摘要、权限和状态，不附 dump 或日志正文。 |

### B3 Managed current 链接

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B3.1` | managed current 绝对路径 | `<UNSET>` | `UNSET` | 审批固定，且与 legacy current 隔离。 |
| `B3.2` | 初始类型/目标核验引用 | `<UNSET>` | `UNSET` | 只读判定 absent、符号链接类型及目标；不得猜测或回填。 |

### B4 Deployment control root

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B4.1` | control root 绝对路径 | `<UNSET>` | `UNSET` | 审批固定，且不是符号链接。 |
| `B4.2` | 初始目录/残留状态引用 | `<UNSET>` | `UNSET` | 只读证明目录状态和预期 `GENESIS.*` / lock 之外无残留。 |

### B5 Control root 长期保留

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B5.1` | control root 所有者角色 | `<UNSET>` | `UNSET` | 与部署/运行账户权限矩阵一致。 |
| `B5.2` | 长期保留机制引用 | `<UNSET>` | `UNSET` | 具备独立审计、不可变留存或带外备份，单纯 `wx` 写入不算。 |
| `B5.3` | 防整体抹除证明引用 | `<UNSET>` | `UNSET` | 证明 Genesis 执行者不能删除全部原始记录与带外证据。 |

### B6 Stable launcher 路径与摘要

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B6.1` | launcher cwd 绝对路径 | `<UNSET>` | `UNSET` | 生产批准值已固定。 |
| `B6.2` | launcher 文件绝对路径 | `<UNSET>` | `UNSET` | 位于 release 根外，运行账户不可写。 |
| `B6.3` | launcher 预期 SHA-256 | `<UNSET>` | `UNSET` | 生产批准摘要与只读重算一致；本地 build 摘要不得代替。 |

### B7 Runtime environment contract

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B7.1` | contract 绝对路径 | `<UNSET>` | `UNSET` | 生产批准值已固定。 |
| `B7.2` | contract 预期 SHA-256 | `<UNSET>` | `UNSET` | 生产批准摘要与只读重算一致。 |
| `B7.3` | 变量名称/用途清单引用 | `<UNSET>` | `UNSET` | 只含唯一的 `name` + `purpose`，包含 `PATH`，绝不含值。 |
| `B7.4` | D4/D6 调用方参数盘点引用 | `<UNSET>` | `UNSET` | 只读证明调用方使用各自正确的 contract path/SHA flag。 |

contract 收窄的是发布工具传给 PM2 编排命令的环境副本，不等同于“整个 API 进程环境完全收窄”。

### B8 Managed 零流量

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B8.1` | 负载层路由目标结论 | `<UNSET>` | `UNSET` | 只读证明业务流量仍为 100% legacy。 |
| `B8.2` | managed 零挂载/零流量证据引用 | `<UNSET>` | `UNSET` | 只记录脱敏结论和证据引用，不附访问日志正文。 |
| `B8.3` | approved legacy Nginx 配置 SHA-256 | `<UNSET>` | `UNSET` | D3 只读重算一致；它只用于 D5 确认前的全量 legacy 恢复，不得在确认后作为 fallback。 |
| `B8.4` | shared data side-effect / connection budget 引用 | `<UNSET>` | `UNSET` | 覆盖 PostgreSQL、Redis、对象存储和后台任务；managed 零流量时不得产生未批准副作用。 |
| `B8.5` | 同机 capacity / cgroup 方案引用 | `<UNSET>` | `UNSET` | 记录生产批准的 CPU、内存、tasks、NOFILE 与连接预算；不得复用 D2′ 演练参数冒充生产值。 |

### B9 权限分离与残留锁恢复 SOP

| 字段 ID | 非秘密输入 | 当前值 | 状态 | 只读关闭条件 |
| --- | --- | --- | --- | --- |
| `B9.1` | 部署账户角色 | `<UNSET>` | `UNSET` | 可写批准的 release/artifact/control/launcher 目标，不作为 legacy 或 managed API 运行账户。 |
| `B9.2` | managed API 运行账户角色 | `<UNSET>` | `UNSET` | 对上述目标只读，且与部署角色、legacy API 运行角色分离。 |
| `B9.3` | 权限矩阵/ACL 证明引用 | `<UNSET>` | `UNSET` | 覆盖 current、control、artifact、launcher、runtime contract 与 PM2 dump。 |
| `B9.4` | 残留锁恢复 SOP 引用 | `<UNSET>` | `UNSET` | 必须包含“只读判定 → 具名授权 → 证据复核”；禁止并发或擅删锁。 |
| `B9.5` | legacy API 运行账户角色 | `<UNSET>` | `UNSET` | 只读登记现役角色，证明它不能写 managed control/release/PM2 控制面。 |

## 5. CLI 参数对照（非执行说明）

本表只用于防止运维文档混用接口，不提供 D4/D5/D6 执行授权或可直接运行的生产命令。

| 契约 | 参数数量 | current flag | runtime contract flag | control root flag |
| --- | --- | --- | --- | --- |
| D4 `release:genesis` | 11 flag / 22 参数 | `--managed-current-link` | `--runtime-env-contract` + `--runtime-env-contract-sha256` | `--deployment-control-root` |
| D6 `release:activate` | 10 flag / 20 参数 | `--current-link` | `--runtime-env-contract-path` + `--runtime-env-contract-sha256` | 无 |

共同 flag 仍须使用各自代码定义的顺序与名称。PM2 launcher 的 3 项固定 script args 不属于 activation
CLI 的 10 个 flag。完整 future-only activation 占位模板见
[`production-deployment-runbook.md` §6.2](./production-deployment-runbook.md#62-未来受控-released3d6-分层授权)。

## 6. 总体判定

| 门槛 | 当前状态 |
| --- | --- |
| B1 同机 managed 角色/双端口 | `NO-GO / UNSET` |
| B2 独立 managed PM2 控制面 | `NO-GO / UNSET` |
| B3 managed current | `NO-GO / UNSET` |
| B4 deployment control root | `NO-GO / UNSET` |
| B5 control root 长期保留 | `NO-GO / UNSET` |
| B6 launcher 路径/SHA | `NO-GO / UNSET` |
| B7 runtime-env contract | `NO-GO / UNSET` |
| B8 零流量 | `NO-GO / UNSET` |
| B9 权限与锁恢复 SOP | `NO-GO / UNSET` |

**当前 D3 总体结论：NO-GO。** 正式资料尚未提供并只读核验上述 managed 输入。补齐本表只允许
重新申请 D3 只读预检；D3 PASS 仍不构成 D4、D5 或 D6 授权。

## 7. 正式参考

- [F1 D3 生产只读预检（2026-07-30）](../reviews/f1-d3-production-readonly-precheck-2026-07-30.md)
- [F1 平行 Genesis bootstrap 设计](../superpowers/specs/2026-07-16-f1-parallel-genesis-bootstrap-design.md)
- [生产部署 Runbook](./production-deployment-runbook.md)
