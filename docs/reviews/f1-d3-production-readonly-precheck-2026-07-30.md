# F1 D3 生产只读预检（2026-07-30）

> 结论：**NO-GO，停止在 D3，未连接生产主机。**
> 本轮授权仅包含候选冻结与 D3 只读预检；不包含 D4 Genesis、D5 切流、D6 稳态发布、部署、进程操作或生产写入。

## 1. 执行基线与边界

- 源码候选：`origin/main@bdafe6046943e4f990052de86c398023f65b6fc9`。
- 来源：PR [#436](https://github.com/wanglei581/YITIJI/pull/436) 合并提交；PR head 为 `26ec888509d00cc9c5e07b5cfa911d5b91ef3840`。
- 精确候选 CI：[GitHub Actions 30509880309](https://github.com/wanglei581/YITIJI/actions/runs/30509880309) 的 `build-and-verify`、`postgres-readiness`、`kiosk-browser-smoke` 全部成功。
- 隔离位置：从合并后的 `origin/main` 创建独立 worktree 和 `codex/p0-2-f1-d3-precheck-20260730` 分支；未触碰原工作区未提交内容。
- 生产边界：没有执行 SSH、部署、构建上传、`release:genesis`、`release:activate`、PM2/Nginx 操作、迁移、数据库/Redis/COS/日志/环境变量读取或硬件动作。

## 2. 本地候选冻结与 A1–A6

| 门槛 | 结果 | 证据 |
| --- | --- | --- |
| A1 精确 commit | PASS | `HEAD`、`origin/main` 与 PR #436 merge commit 均为 `bdafe6046943e4f990052de86c398023f65b6fc9` |
| A2 精确 commit CI | PASS | run `30509880309` 三项 job 全绿 |
| A3 frozen install | PASS | `pnpm install --frozen-lockfile`，805 packages，pnpm `11.2.2` |
| A4 provenance / Genesis | PASS | `verify:release-provenance` 24 项全 PASS；`verify:release-genesis` 9 场景全 PASS |
| A5 API 质量门禁 | PASS | API typecheck、lint、build 全部退出 0 |
| A6 CLI fail-closed | PASS | 无参 Genesis CLI 只返回 `RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID`，退出 1，无目录/进程/网络动作 |

### 2.1 Source tree 固定值

这些值只冻结候选源码，不代表已生成或已批准 production release：

| 范围 | Git tree |
| --- | --- |
| repository | `2fc037e7a4cde23539c4cdcd426614b442e7da18` |
| `apps/kiosk` | `002da05fb2e78680668b9651e3aac42b88b62fe3` |
| `apps/admin` | `67a8d83c9431d3e652292e94f6e855a1d3f00119` |
| `apps/partner` | `b2e9a9a08815f32313f88a1515c08a098e063b52` |
| `apps/terminal-agent` | `1ae9d2d8d35e15136f15bcd4dd5b6b7b4549f248` |
| `services/api` | `0a4122271543fa9de4e7b828784e25af0c8b922a` |
| `services/worker` | `98123cc21877915f13d5779a34ee6bf3b4bd6d0e` |

### 2.2 本地 API build 摘要

这些摘要来自干净 worktree 的本地 build，只证明可再生候选产物；没有上传生产，也没有形成 D4 的 `r1` / `r2` release manifest：

| 产物 | SHA-256 |
| --- | --- |
| `release-current-launcher.js` | `1e1f13035ed1940ef936632b1c281e0a7a10fc8412c2d724a6693d79a7ea5e71` |
| `release-guard.js` | `54e64bdd08ff7cc6d6dbd27a577f6e346ad5c743194b9ed0d73d3cd7e3ba0170` |
| `release-genesis-cli.js` | `036c8ae307fe000dff57bcd20d87ad16ced892c401b9b6484c6a2a5835c3f26c` |
| `release-activation.js` | `f469fa56ccb19dfd8934770899f3ba65afd68d048a76159945e8f0b00e11f8b1` |
| `release-runtime-contract.js` | `9d1f8b562ee009531c41c0be8dc707c34d01d29fbd0cf6e48c72f0c62454ae9b` |

## 3. D3 生产九类门槛

| 门槛 | 状态 | 只读结论 |
| --- | --- | --- |
| B1 独立 managed 主机 / 端点 | BLOCKED | 正式文档只记录 legacy 主机与单实例 `127.0.0.1:3010`；没有具名 managed 主机或等价隔离实例。代码只允许固定 loopback `:3010`，不得在 legacy 主机临时换第二端口。 |
| B2 独立 managed PM2 名称 | BLOCKED | 无审批附件固定 managed PM2 名称；禁止用 legacy PM2 名称代替。 |
| B3 managed current | BLOCKED | 无批准的绝对路径，无法安全核验 absent/type/与 legacy 隔离。 |
| B4 deployment-control root | BLOCKED | 无批准的绝对路径，无法核验非链接目录、空态或残留 lock/control record。 |
| B5 control root 长期保留 | BLOCKED | 无账户/ACL/immutable/独立审计或备份证明；代码的 `wx` 语义不能防止有删除权的执行者抹除全部记录。 |
| B6 launcher 路径与预期摘要 | BLOCKED | 只有本地 build 摘要；无批准的生产 launcher 路径和预期 SHA，不能做生产对照。 |
| B7 runtime-env contract | BLOCKED | 无批准的生产 contract 路径、结构清单与预期 SHA，也没有 D4/D6 调用方盘点证据。 |
| B8 零流量条件 | BLOCKED | 没有 managed target，无法对照负载层证明其零挂载/零业务流量；legacy 可达或 HTTP 200 不构成 managed 零流量证据。 |
| B9 权限分离与残留锁恢复 SOP | BLOCKED | 无具名部署账户/运行账户权限矩阵，也无残留 `GENESIS.lock` / activation lock 的只读判定与独立授权处置流程。 |

### 3.1 为什么没有连接生产

任务计划在多模型分析后预先固定了硬停止条件：正式资料不能唯一确定 managed 主机、PM2 名称、批准路径和预期摘要时，禁止以 legacy 主机或猜测值代替。当前九类门槛全部依赖尚不存在的审批输入；继续 SSH 只能重复确认 legacy 仍在线，不能产生 D3 有效证据，反而可能诱发过度宣称。因此本轮在远端连接前安全停止。

## 4. 多模型交叉分析

- Claude：确认 control root 长期保留是最高优先级带外门槛；指出现行 production runbook 的 `release:activate` 示例仍是旧参数面，缺少 runtime-env contract path/SHA；另确认 contract 收窄的是 PM2 编排命令环境，不能表述为整个 API 进程环境已被完全收窄。
- antigravity：把固定 `127.0.0.1:3010` 与现有 legacy 单实例拓扑的冲突提升为 Critical，并要求在 D3 显式证明独立主机/等价隔离、零流量和独立 PM2 名称。
- Cursor Agent CLI：独立确认必须过滤 PM2 输出字段，禁止 `pm2 env`、全量 env/log；无具名审批附件时必须停止，不能用 legacy `online`、HTTP 200 或 D2 fixture 冒充 D3 PASS。
- Codex：合并三路意见后更新计划，再执行本地 A1–A6；三路工具均成功形成有效报告，没有使用 Cursor 客户端兜底。

## 5. 附加 Warning

1. `docs/device/production-deployment-runbook.md` 的未来 `release:activate` 示例仍只含旧 16 参数；当前代码要求 20 参数，并必须包含 `--runtime-env-contract-path` 与 `--runtime-env-contract-sha256`。本任务文件预算不允许顺手改 runbook，因此只登记阻塞，后续应在独立文档修正任务中处理。
2. Genesis CLI 使用 `--runtime-env-contract`，activation CLI 使用 `--runtime-env-contract-path`；两套命令模板不能混用。
3. 本地 build 摘要不是 production release manifest；不得据此申请 D4。

## 6. 解除 D3 NO-GO 的最小输入

下一次 D3 只读预检前，必须在正式现有文档体系中固定以下非秘密信息：

1. managed 独立主机或等价隔离实例标识，并证明其独占固定 `127.0.0.1:3010`。
2. managed PM2 名称，以及 current、artifact、control root、launcher、launcher cwd、runtime-env contract 的批准绝对路径标识。
3. launcher 与 runtime-env contract 的预期 SHA-256；contract 只列变量名称/用途，不含值。
4. 部署账户与 API 运行账户权限矩阵、control root 长期保留机制。
5. 残留 Genesis/activation lock 的“只读判定 → 具名授权 → 证据复核”SOP。
6. 负载层当前 100% legacy、managed 零挂载的只读验证方式，以及 D4/D6 调用方的当前参数契约。

补齐后仍只重新申请 D3；D3 PASS 不自动授权 D4。当前 production F1 继续 **NO-GO**。
