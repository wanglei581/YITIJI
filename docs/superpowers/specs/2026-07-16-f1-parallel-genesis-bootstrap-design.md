# F1 平行 Genesis Bootstrap 设计

> 状态：用户已确认的设计规格；仅定义未来实现和后续分阶段授权的边界。本文不授权部署、负载切流、PM2/Nginx 修改、凭据读取或任何生产写入。

## 1. 背景与结论

当前 production F1 的历史运行版本仍为 `NO-GO`：其 source → dist → PM2 来源链无法闭合，合规 archive 不可用，禁止回填。已经合入主线的 future-only provenance 机制只描述**已受管稳态**：`activateRelease` 验证 candidate，读取并验证 `current` 所指 previous，原子切换 `current`，reload stable launcher，再核验 PM2 和 health。

历史 PM2 直接运行 `dist/main.js`，不是 stable launcher。仅预设新的 `current` 不会改变历史流量；第一次把 PM2 改为 launcher 就会使其指向的版本成为首个真实受管版本。历史 root 又不能充当 verified previous，因此不能把既有 `activateRelease` 当作首次迁移器，也不能用手工 symlink、PM2 reload 或 direct `main.js` 填补这个缺口。

本设计采用**平行 Genesis 平面 + 负载层切流**：先让一条完全独立的新受管链在零业务流量下自证正确，再切流。任何 Genesis 失败都只清理新链、保持旧流量不变；旧历史进程是未被触碰的既有状态，永远不是 Genesis 或稳态激活的 rollback target。

## 2. 目标与非目标

### 目标

- 以独立、一次性的 Genesis 原语建立首条由 stable launcher 和 release guard 守护的受管链。
- 在切入任何业务流量前，用同一条新链完成 `r1 → r2` 的稳态 provenance 验证，确保 `r1` 已成为真正可验证的 previous。
- 将负载切流与进程/版本切换解耦；切流前 Genesis 或稳态激活失败都不影响旧历史流量。
- Genesis 成功后永久关闭该入口，后续发布只允许沿用既有 `activateRelease` 的 verified-previous 语义。

### 非目标

- 不修复、追认、回填或使用历史 F1 root 的 provenance。
- 不把旧 PM2 `main.js` 进程作为 rollback 或 fallback。
- 不创建第二套弱化 manifest、guard、launcher 或 artifact 校验。
- 不在本规格中给出真实路径、端口、账户、环境变量取值、负载均衡配置或可复制生产命令。
- 不修改 schema、migration、Agent、Kiosk、打印、用户/文件数据或生产配置。

## 3. 受管拓扑与信任边界

```text
历史流量 ──> legacy process（未受管、保持现状、不是 rollback target）
                    │
                    │  仅在一次成功的 traffic cutover 后退役
                    ▼
负载层 ──> parallel managed process ──> stable launcher ──> currentManaged ──> guard ──> r2
                                                  │                                  ▲
                                                  └──── manifest / tree / artifact ──┘
                                                                     │
                                                       verified previous: r1
```

`parallel managed process` 使用独立 PM2 名称、独立监听端点、独立 managed current link 和独立 deployment-control root；它不得复用或覆盖历史进程的 PM2 定义、监听端点、运行目录或 `current`。负载层在 Genesis 与 `r1 → r2` 均完成前继续将全部业务流量保留在 legacy process。

部署账户可写 release、artifact 和 deployment-control root；API 运行账户只读。运行账户环境只允许继承审批单列出的**变量名称与用途**，不得记录或传递变量取值、部署/CI/调试/管理凭据。Genesis 控制记录和脱敏证据只允许 release ID、commit、文件摘要、时间戳、状态码、已批准路径标识与 health 结果。

## 4. 状态机

Genesis 是独立于 `activateRelease` 的一次性状态机。它不接受 previous root，也不调用历史进程。

| 状态 | 允许的事实 | 进入条件 | 退出条件 | 失败语义 |
| --- | --- | --- | --- | --- |
| `UNINITIALIZED` | 没有 managed current、没有 managed PM2 进程、没有成功 Genesis 记录 | deployment-control root 已由部署账户建立 | 获得独占 genesis lock 后进入 `PREPARING` | lock 冲突或残留状态一律 `NO-GO` |
| `PREPARING` | 仅准备 candidate `r1` 的受控文件与 manifest/artifact 证据 | `r1` 的 source archive、manifest、tree、entrypoint、artifact 副本全部可验证 | launcher 自校验和 `r1` guard 均成功后进入 `PARALLEL_SERVING_R1` | 任一校验失败：不创建 managed PM2、不触碰 legacy、写脱敏失败状态 |
| `PARALLEL_SERVING_R1` | 新进程仅在独立端点由 launcher → guard → `r1` 提供健康响应；无业务流量 | managed current 解析为 `r1`，PM2 cwd/script/fixed args 与 launcher 摘要匹配，health 成功 | `r2` 经既有稳态激活器成功后进入 `PARALLEL_SERVING_R2` | 停止并清理新进程和 managed current；legacy 流量不变 |
| `PARALLEL_SERVING_R2` | `r1` 是 managed current 的 verified previous，`r2` 是健康 current；无业务流量 | 既有 `activateRelease(r2)` 同时验证 `r2` 与 `r1`、PM2/health 成功 | traffic cutover 独立原子成功后进入 `CUTOVER_CONFIRMED` | `activateRelease` 只可回 `r1`；legacy 不参与 rollback |
| `CUTOVER_CONFIRMED` | 业务流量已进入 managed `r2`，legacy 只可按另一份明确退役授权处理 | 负载层切流的原子性、目标、health 和证据均确认 | 后续发布只走稳态 `activateRelease` | 任何后续发布失败仅回 verified managed previous，绝不切回 legacy |
| `FAILED_CLOSED` | 记录失败阶段和脱敏证据；没有未批准的自动恢复 | 任一 hard gate 失败 | 仅能由新的一次性只读恢复授权判定状态；Genesis 不自我重试 | 不启动或恢复历史 root，不自动抢锁，不自动切流 |

`CUTOVER_CONFIRMED` 一经写入，Genesis 原语必须永久拒绝再次运行；已有 managed current、managed PM2 进程或成功 Genesis 记录任一存在时，调用 Genesis 都必须失败关闭。`PREPARING` 的残留记录、未知 lock、进程路径不匹配或状态文件不一致也必须失败关闭，不能用删除文件或重启绕过。

## 5. Genesis 原语的最小语义

未来实现只增加一个受限的 Genesis 原语，名称和 CLI 表面由实施计划决定。其最小职责如下：

1. 校验所有路径为审批过的绝对非链接目录或固定 launcher 文件，获得 deployment-control root 的独占 genesis lock。
2. 拒绝已受管状态、任何 legacy root 输入、任何 previous 参数、任何动态 PM2 script/args，或任何含秘密的输入表面。
3. 对 `r1` 执行与 `activateRelease` 相同的 `verifyReleaseProvenance`；不允许 Genesis 自有较弱 verifier。
4. 仅在 `r1` 验证成功后，原子建立独立 managed current link，启动独立 PM2 进程到固定 stable launcher，并核验 PM2 cwd/script/fixed args、launcher SHA-256、guard 和独立 health。
5. 将成功状态写为不可混淆的脱敏 Genesis 记录。此记录不把 `r1` 宣称为历史 F1 的 previous；它只证明平行受管链已建立。
6. 若新链任一环失败，只停止/清理本原语创建的 managed process 和 managed current，记录 `FAILED_CLOSED`。它不得读取、启动、修改、重载或恢复 legacy process。

Genesis 不执行业务流量切换，也不依赖负载层配置细节。负载层是单独的受控动作：只有 `PARALLEL_SERVING_R2` 已得到证据，且负载层具备批准的全量原子切换或不切换能力时，才可进入独立切流审批。

## 6. 首次稳态证明与回滚边界

Genesis 只建立 `r1` 的平行受管运行态。它本身没有 previous，因此不得把 Genesis 失败称为“回滚”；正确语义是“新链不服务、旧流量未切换”。

要证明稳态回滚边界，必须在仍未切业务流量的平行平面上使用既有 `activateRelease` 激活第二个受控 release `r2`：

1. `r1` 先作为 managed current 通过 guard、PM2 和 health。
2. `r2` 以同一 artifact 契约通过 candidate guard；`activateRelease` 再验证 `r1` 为 verified previous。
3. `r2` 成功后，managed current 指向 `r2`；若激活后检查失败，既有激活器只允许回到 `r1`。
4. 所有这些验证发生在零业务流量的新链。legacy 不会被用来验证、回退或恢复。

对于真实生产，故意制造一次会损害健康的故障不是本规格允许的验证方式。完整 post-switch rollback 分支必须先在镜像拓扑的非生产演练中完成；生产切流前只接受 `r1`、`r2` 的成功证据、既有离线失败测试和明确的切流授权。切流后任何正常发布失败仍仅回到 managed verified previous。

## 7. 负载层切流契约

负载层切流在 Genesis 之外，且必须满足以下契约：

- 有独立于 Genesis 的、一次性且限时的 traffic cutover 授权；该授权不包含 release 构建、PM2 修改或 legacy 恢复权限。
- 在切流前，管理平面已确认 managed `r2` health、launcher/guard/provenance、PM2 契约与最小环境变量名称/用途均符合审批记录。
- 切流机制必须能证明“完整切至 managed endpoint”或“保持全部 legacy 流量”的原子结果；无法证明原子性、发生部分分流或端点不确定时为 `NO-GO`。
- 切流后再次核验 managed endpoint 的 health 与 provenance 摘要；不得把负载层可达、PM2 `online` 或 HTTP 200 单独当作 provenance 成功。
- 一旦 `CUTOVER_CONFIRMED`，任何回滚设计只针对 managed 链中的 verified previous；不允许自动或手工把流量切回 legacy。legacy 退役、保留和最终停止属于新的独立授权。

没有满足此契约的现有负载层能力时，本设计只能停在 `PARALLEL_SERVING_R2`，不得把就地 PM2 切换降级为替代方案。

## 8. 实现边界与测试要求

未来实现应保持文件职责单一，并新增专门的 Genesis 模块、CLI 外壳和离线 verification 场景；不得扩大或削弱现有 `release-activation.ts` 的 previous 验证、rollback 和 lock 语义。

实施前必须 RED→GREEN 覆盖下列断言：

1. 存在 managed current、managed PM2 或成功 Genesis 记录时，Genesis 拒绝并且不调用 PM2。
2. `r1` manifest/tree/archive/entrypoint/artifact 任一校验失败时，不创建 managed current、不启动 managed PM2，legacy spy 零调用。
3. launcher SHA、PM2 cwd/script/fixed args 或 health 不匹配时，只清理 Genesis 自建资源，legacy spy 零调用，状态为 `FAILED_CLOSED`。
4. 不完整或冲突的 genesis lock/state 记录不能被自动删除、覆盖或重试。
5. Genesis 成功后的 `r1 → r2` 必须复用既有 `activateRelease`，并证明它实际验证 `r1` 为 previous；任何 `r2` post-switch 失败只切回 `r1`。
6. 无论 Genesis 输入怎样构造，都不能把 legacy root 传入 verifier、launcher、PM2 或 rollback 分支。
7. 静态门禁拒绝 Genesis 读取 `.env`、数据库、Redis、日志、用户文件、业务数据或输出环境变量取值。
8. 平行链与 traffic cutover 的集成模拟证明：新链失败时 traffic controller 保持 legacy endpoint；未达到 `PARALLEL_SERVING_R2` 时不得请求切流；切流后稳态发布不允许指向 legacy。

本规格只要求本地 fixture、类型检查、lint、build、现有 provenance verify 和双模型审查。任何镜像环境演练、生产只读预检、Genesis、PM2 新进程、负载层切流、legacy 退役或回滚演练均必须另有明确授权。

## 9. 分层授权

| 层级 | 可批准的范围 | 明确不包含 |
| --- | --- | --- |
| D0：当前设计 | 本规格、实现计划和离线审查 | 代码、环境、生产访问 |
| D1：本地实现 | Genesis 模块、离线 tests、CI 门禁 | 生产构建、PM2、负载层 |
| D2：镜像演练 | 复现 legacy/parallel 拓扑的非生产演练 | 真实生产流量、凭据、切流 |
| D3：生产新链预检 | 仅验证已批准的路径/账户角色/非秘密摘要 | Genesis 写入、进程或流量变化 |
| D4：生产 Genesis | 一次性建立零流量 managed `r1`、再完成 managed `r1 → r2` | 负载切流、legacy 退役、后续发布 |
| D5：traffic cutover | 一次性、原子切入已验证 managed `r2` | 切回 legacy、额外部署、凭据变更 |
| D6：稳态发布 | 既有 `activateRelease` 的 managed 链发布 | Genesis 重入、legacy 作为 previous |

每层需要独立、限时、具名的授权和脱敏证据；上一层通过不自动授予下一层。任何字段缺失、越权、秘密泄露、路径/进程不一致、健康/provenance 失败或历史 root 混入，均保持 `NO-GO`。

## 10. 交付判定

本文档完成只代表设计已明确。它不表示 Genesis 已实现、parallel managed process 已启动、负载层具备切流能力、production provenance 已修复，或 F1 已解除 `NO-GO`。进入实施计划前必须由用户审阅本文档；进入任一生产阶段前必须取得对应 D3–D6 的独立授权。
