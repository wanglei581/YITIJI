# F1 同机双端口 Managed 发布拓扑设计

> 状态：用户于 2026-07-30 分三部分确认的设计规格；等待用户审阅仓库版本后，才可编写 D1′ 实施计划。
>
> 本文只修订 future-only managed 拓扑，不授权 SSH、部署、Genesis、activation、PM2/Nginx 修改、数据库/Redis/对象存储操作、迁移、seed、切流或 legacy 退役。production F1 继续 **NO-GO**。

## 1. 背景与修订范围

既有 [F1 平行 Genesis Bootstrap 设计](./2026-07-16-f1-parallel-genesis-bootstrap-design.md) 已确定以下不变量：

- 历史 F1 root 不可回填为 verified previous；
- future-only managed 链先在零业务流量下建立 `r1`，再以既有 activation 完成 `r1 → r2`；
- traffic cutover 与 release activation 分离；
- `CUTOVER_CONFIRMED` 后只允许回到 verified managed previous，legacy 永远不是 rollback target；
- D3–D6 必须分别取得独立、限时、具名授权。

旧实施计划基于“新增独立主机或等价隔离实例”的假设，让 managed 在自己的 loopback 独占 `127.0.0.1:3010`，因此明确禁止在 legacy 主机私增第二端口。现在用户确认的真实约束是：

- 只有一台 production Linux 服务器；
- production 没有 Docker，当前不新增容器运行时；
- 不新增云主机；
- 现有 PostgreSQL、Redis 和对象存储继续作为唯一数据平面。

本文只修订上述**拓扑假设**：同一台服务器上保留 legacy API `127.0.0.1:3010`，新增 future-only managed API `127.0.0.1:3011`。既有 provenance、Genesis、verified previous、fail-closed、分层授权和切流后 managed-only rollback 语义全部保留。

本文是拓扑修订的控制规格。旧设计、旧实施计划、当前 runbook 或 D3 输入模板中与“managed 必须独占另一实例的 `:3010`、不得同机第二端口”冲突的内容，在后续 D1′ 实施计划范围内按本文修订；在代码、测试、runbook 和 D3 输入模板全部完成修订并复审前，仍维持 **NO-GO**。

## 2. 方案比较与决定

| 方案                                             | 适配现实约束 | 隔离强度                                      | 需要的变化                        | 结论       |
| ------------------------------------------------ | ------------ | --------------------------------------------- | --------------------------------- | ---------- |
| 新增独立主机                                     | 否           | 强                                            | 新云资源、网络和运维              | 当前不可用 |
| 同机容器 / network namespace，容器内仍用 `:3010` | 否           | 中到强                                        | 安装和治理 production 容器运行时  | 当前不采用 |
| 同机裸机双端口：legacy `:3010`、managed `:3011`  | 是           | 弱于独立主机，可用账户/进程/目录/资源门禁收窄 | 新设计、health 契约和 D2′–D3 门禁 | **采用**   |

该决定解决的是“同机并行建链和原子切流”，不是高可用、容灾或主机故障隔离。Linux 内核、CPU、内存、磁盘、文件句柄、Nginx 和网络仍属于同一失败域；任何文档和验收不得将其表述为 HA。

## 3. 目标拓扑

```text
业务请求 ──> 单机 Nginx ──> legacy API    127.0.0.1:3010   （D5 前 100% 流量）
                         └─> managed API   127.0.0.1:3011   （D5 前零业务流量）

legacy API  ─┐
managed API ─┼─> 既有 PostgreSQL / Redis / 对象存储
worker      ─┘
```

本拓扑只覆盖 F1 API 发布链。现有 worker 保持既有运行状态；D4 不得启动第二套 worker、队列消费者、cron、scheduler 或对象清理任务。未来若要把 worker 纳入 managed provenance，必须另写设计并独立授权。

### 3.1 D5 前的流量关系

- Nginx 有效业务配置只把用户流量路由到 legacy `127.0.0.1:3010`。
- managed `127.0.0.1:3011` 只接受同机、具名发布流程的精确 health probe。
- `3011` 只绑定 `127.0.0.1`，不得监听 `0.0.0.0`、公网地址或外部网卡。
- managed 可以建立健康检查所必需的数据连接，但不得因启动或后台任务产生业务写入。

### 3.2 D5 后的流量关系

- Nginx 原子地把完整业务 upstream 从 legacy `3010` 切到 managed `3011`。
- 只有负载层目标、managed health、关键浏览器闭环与脱敏证据全部确认后，才写入 `CUTOVER_CONFIRMED`。
- `CUTOVER_CONFIRMED` 后，legacy 即使暂时仍运行，也只是待独立授权处理的历史进程，不是 fallback、previous 或 rollback target。

## 4. Health URL 安全契约

### 4.1 唯一允许值

future-only Genesis 和 activation 只管理 managed 链，因此 health URL 必须继续使用精确字符串等值校验，但唯一合法值修订为：

```text
http://127.0.0.1:3011/api/v1/health
```

不得保留 `3010/3011` 两值白名单。legacy 永远不通过 future-only CLI 发布，把 `3010` 留在合法集合会扩大误操作面，使验证层无法断言“本次发布绝不探测 legacy”。

### 4.2 禁止动态参数化

不得把 health URL 放宽为任意 URL、端口范围、host 正则或运行时可配置模板。health probe 会真实发起 HTTP 请求；允许动态目标会扩大 SSRF 和内网探测面。现有不跟随重定向、精确 loopback、精确 path 和 fail-closed 语义必须保留。

### 4.3 D1′ 必须覆盖的测试

下列负例用于证明单一字符串全等契约的拒绝面，不要求、也不得为了分类错误原因而新增 URL 解析器或逐项放宽校验：

- 正例：精确 `http://127.0.0.1:3011/api/v1/health`。
- 负例：legacy `:3010`、其他端口、`localhost`、`0.0.0.0`、`[::1]`、DNS 名、HTTPS、错误 path、尾斜杠、userinfo、query、fragment、`169.254.169.254`。
- Genesis 与 activation 两条路径都必须证明 `3011` 通过、`3010` 在切换或 PM2 动作前 fail-closed。
- 重定向响应不得被跟随；health body 仍须满足现有 PostgreSQL 判定契约。

## 5. 同机隔离不变量

### 5.1 账户与权限

- managed 使用独立的非登录 Linux 运行账户；不得复用 legacy 运行账户。
- 部署账户与 managed 运行账户职责分离：部署账户只可写批准的 release、artifact、current、control、launcher 和 contract 目标；managed 运行账户对这些目标只读。
- legacy 的账户、目录、PM2 定义和运行文件不因 D1′–D4 改变。
- runtime environment contract 继续只记录变量**名称与用途**；变量值从批准的生产环境在运行时读取，不写入 contract、Git、审批附件、证据或日志。

### 5.2 PM2 与进程状态

- managed 使用独立 `PM2_HOME`、独立 PM2 daemon、独立应用名称、独立 dump 和日志目录。
- managed PM2 名称不得等于 legacy 字面名称，也不得由 Genesis 动态决定。
- managed current、artifact、control、launcher、runtime contract 和日志路径不得位于 legacy release 树内。
- `PM2_HOME`、cwd、script、固定 launcher args、interpreter 和 dump 权限必须在 D3 只读核验中形成脱敏证据。

### 5.3 路径与控制记录

- `<MANAGED_CURRENT_LINK>`、`<ARTIFACT_ROOT>`、`<DEPLOYMENT_CONTROL_ROOT>`、`<LAUNCHER_CWD>`、`<LAUNCHER_PATH>`、`<RUNTIME_ENV_CONTRACT_PATH>` 均须使用审批固定的绝对路径标识。
- control root 位于 release 清理范围之外，并具备长期留存、独立审计或带外备份；单纯 `wx` 写入不能证明可对抗整体抹除。
- Genesis 执行者不能在没有“只读判定 → 具名处置授权 → 证据复核”的情况下删除残留 lock 或控制记录。

### 5.4 端口与网络

- legacy 独占 `127.0.0.1:3010`；managed 独占 `127.0.0.1:3011`。
- D3 必须只读证明 `3011` 未被其他进程占用、只监听 loopback、未被防火墙或 Nginx 暴露为公网直连端口。
- 禁止为了让 managed 启动而停止、reload、改端口或重命名 legacy。

## 6. 共享数据平面边界

同机双进程复用既有 PostgreSQL、Redis 和对象存储，不创建或迁移第二套数据平面。共享数据平面保证切流前后会话和业务状态连续，但也意味着“零 HTTP 业务流量”不自动等于“零副作用”。

D4 前必须证明：

1. API 启动不会自动执行 migration、DDL、seed、数据回填或 schema 同步。
2. managed 不启动 worker、BullMQ consumer、cron、scheduler、重试扫描或对象生命周期清理。
3. health probe 之外没有用户请求；health 路径不会写业务表、Redis 业务键、队列或对象存储。
4. managed 的预切流连接池上限不会挤占 legacy 的 PostgreSQL / Redis 连接预算。
5. 现有 Redis key/session 语义在切流前后保持兼容；不得为了“看起来隔离”私自更换 Redis DB 或 key prefix，导致登录态、锁或缓存不连续。
6. D4/D5 不执行 migration、seed，不修改数据库、Redis 或对象存储配置；若候选需要数据结构变化，必须退出本流程并另立迁移设计。

任何自动写入、后台消费者重复运行、连接预算不明或数据契约不兼容，均为 **NO-GO**。

## 7. 主机容量与资源抑制

同机方案共享主机失败域，必须增加容量门禁：

- D3 只读记录 legacy 的 CPU、内存、磁盘、文件句柄和重启基线，以及主机剩余量；实际阈值保存在批准的生产证据中，不在本设计猜测数值。
- managed 使用 systemd/cgroup 或经批准的等价机制限制 CPU、内存、文件句柄和重启风暴；仅配置 PM2 自动重启不算充分。
- managed 日志必须独立，并受容量和轮转策略约束，不能填满 legacy 所在磁盘。
- 如果不能证明 legacy 峰值与 managed 并行时仍有安全余量，D4 保持 **NO-GO**。

资源限制只能降低 managed 拖垮 legacy 的概率，不能把同机方案变成 HA。

## 8. D1′→D6 分层执行循环

每一层都执行“规划允许范围 → 执行本层动作 → 验证门禁/证据 → 仅修正本层 → 重验”的 Loop；上一层 PASS 不自动授权下一层。

| 阶段                     | 允许范围                                                                  | 必须证据                                                 | 失败语义                                                  |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| D1′ 设计与本地代码修订   | 精确 managed `3011` 契约、fixture、CI、runbook/D3 文档                    | typecheck、provenance/Genesis verify、负例、三模型复审   | 不连接生产；失败只修本地候选                              |
| D2′ 非生产同机双端口演练 | 模拟 legacy `3010` / managed `3011`、独立 PM2_HOME/路径、Nginx 全切或不切 | r1 Genesis、r1→r2、managed-only rollback、3010 零调用    | 不连接 production 数据平面；失败不进入 D3                 |
| D3 production 只读预检   | 账户、PM2、路径、端口、Nginx、容量、权限、后台任务和数据平面只读检查      | 修订后的 B1–B9 全部 `VERIFIED_READ_ONLY`                 | 不创建、不 reload、不写入；任一缺失即 NO-GO               |
| D4 零流量 Genesis        | 在 `3011` 建立 managed r1，再完成 managed r1→r2                           | `PARALLEL_SERVING_R2`、零业务流量、无后台副作用          | 只停止/清理本次 managed 链；legacy 不动                   |
| D5 原子切流              | Nginx 候选配置校验、原子 reload、外部 health 与关键浏览器闭环             | 完整 managed 或完整 legacy、随后 `CUTOVER_CONFIRMED`     | 确认前保持/恢复批准的 legacy 配置；确认后禁止 legacy 回退 |
| D6 managed 稳态发布      | 既有 activation 在 verified managed previous 间发布                       | candidate/previous provenance、PM2、health、contract SHA | 只回 verified managed previous                            |

D2 既有 Docker 演练仍是 provenance/rollback 的有效基础证据，但不能替代 D2′ 的同机 `3010/3011` 拓扑、独立 `PM2_HOME`、Nginx 和资源争用演练。

## 9. D5 切流提交点与回滚语义

D5 必须区分“切流未提交”和“切流后发布回滚”：

1. D3 先只读固定当前有效 legacy Nginx 配置的脱敏摘要，作为唯一批准的“切流未提交”恢复目标；D5 再生成候选配置并执行语法/引用校验，失败时不 reload，业务保持 legacy。
2. reload 必须具备全量原子语义：新连接完整进入 managed，或旧配置完整保持 legacy；部分分流、端点不确定或无法证明时为 NO-GO。
3. 在写入 `CUTOVER_CONFIRMED` 前，若 reload 或 managed 外部验证失败，只允许恢复事前批准且已验证的 legacy Nginx 配置，并将本次记为“切流未提交”。这不是把 legacy 作为 managed previous。
4. 只有 managed endpoint、provenance 摘要、关键浏览器闭环和负载层目标都确认后，才写入 `CUTOVER_CONFIRMED`。
5. `CUTOVER_CONFIRMED` 一经写入，任何自动或手工切回 legacy 都被禁止；后续失败只允许 activation 回到 verified managed previous。
6. legacy 的保留、停止、删除和目录清理属于新的独立授权，不包含在 D5/D6 中。

若切流状态无法确定，必须停止继续操作、保存脱敏证据并人工复核；不得靠重启、手工改 upstream、删除 lock 或修改数据库“恢复”。

## 10. D3 零流量与证据要求

修订后的 D3 至少需要关闭：

- 同一主机标识，以及 legacy `3010` / managed `3011` 的唯一监听证明；
- managed Linux 账户、部署账户、`PM2_HOME`、PM2 名称和权限矩阵；
- current、artifact、control、launcher、runtime contract、日志的批准路径与摘要；
- control root 长期保留和两个 release lock 的恢复 SOP；
- Nginx 有效配置证明 D5 前 100% legacy、managed 零业务挂载，并固定事前批准的 legacy 恢复目标配置摘要；
- managed health 访问只有具名 loopback 探针的脱敏汇总结论，不保存原始访问日志；
- PostgreSQL/Redis 连接预算、API 启动无 migration/seed、无重复 worker/cron/scheduler 的证明；
- 主机容量和 managed 资源限制方案。

证据只能保存角色、路径标识、SHA-256、状态、时间、计数和结论，不保存 `.env`、变量值、连接串、PM2 dump 全文、日志正文、请求头、用户数据或个人信息。

## 11. D1′ 预期影响范围

用户审阅本文后，实施计划应至少盘点下列文件；本文不直接授权修改它们：

### 代码与本地验证

- `services/api/src/release-provenance/release-runtime-contract.ts`
- `services/api/src/release-provenance/release-genesis.ts`
- `services/api/src/release-provenance/release-activation.ts`
- `services/api/src/release-provenance/release-genesis-cli.ts`
- `services/api/scripts/verify-release-genesis.ts`
- `services/api/scripts/verify-release-provenance.ts`
- 共享 release fixture 与 `.github/workflows/ci.yml`（仅在新增命令或门禁接线确有必要时）

### 正式文档

- `docs/device/f1-d3-managed-topology-inputs.md`
- `docs/device/f1-d3-managed-topology-approval-package.md`（只更新引用/签批口径，不复制 B1–B9）
- `docs/device/production-deployment-runbook.md`
- 既有 D2 runbook 与新 D2′ 演练说明的关系
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`

D1′ 不修改 Prisma/schema/migration、业务 API、Kiosk/Admin/Partner、Terminal Agent、打印扫描、支付、文件资产或 production 配置。

## 12. 硬停止条件

任一条件成立即保持 **NO-GO**：

1. 本文尚未由用户审阅，或 D1′ 实施计划尚未另行批准。
2. health URL 仍接受 legacy `3010`、动态 URL 或非精确 managed `3011`。
3. managed 与 legacy 共用运行账户、`PM2_HOME`、PM2 名称、current、control、launcher、日志或 release 路径。
4. `3011` 被占用、监听非 loopback 或可被公网直接访问。
5. managed 启动会 migration、DDL、seed、启动第二套 worker/cron/consumer 或产生未批准写入。
6. 主机容量、连接预算、日志轮转或资源限制无法证明安全。
7. Nginx 无法证明“完整切 managed 或完整保持 legacy”。
8. runtime contract、证据或日志包含真实环境值、密钥、连接串或业务数据。
9. D3 任一修订门槛不是 `VERIFIED_READ_ONLY`，或缺少对应层的独立授权。
10. 任何动作需要先停止、reload、改端口或修改 legacy 才能让 managed 通过。

## 13. 交付判定

本文完成只代表用户确认的同机双端口方案已形成仓库设计规格。它不表示：

- health URL 代码已经改为 `3011`；
- D2′ 已完成；
- D3 输入已经核验或 production 已连接；
- managed 进程、目录、账户、Nginx 配置或资源限制已经创建；
- D4 Genesis、D5 切流、D6 activation 已获批或执行；
- legacy 已退役；
- production F1 已解除 **NO-GO**。

进入 D1′ 实施计划前，必须先由用户审阅本文仓库版本。进入 D3–D6 前，仍须分别取得独立、限时、具名授权。
