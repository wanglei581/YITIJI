# 招聘信息内容域 Wave 2 生产只读盘点与恢复库规划 Runbook

状态：完整生产只读盘点已于 2026-08-10 执行，结果为稳定快照下存在业务 blocker（`exit 2`）；未恢复生产备份、未写任何业务数据、未切换 reader/writer、未部署。

本执行包包含四件严格分离的只读能力：廉价的 production legacy backfill 子集 probe、冻结方案第 6 节完整 production inventory + 公开 API ID 差集、受控恢复库上的 manifest-aware dry-run，以及五类治理证据的纯内存 proposed-governance 校验。子集 probe 仍不能产生 GO；完整盘点同时区分现网 `currentReader` 与冻结目标 `targetSafe`，不会把尚未切换的 Profile/Directory 接口伪装成空集合。执行包不包含 backfill writer，不识别 `--apply`、`--execute`、`--write`、`--fix`、`--seed` 或 `--commit`，也不授权备份下载、恢复、生产写入、数据库销毁、schema 收紧、reader 切换或发布。

当前按 `single-owner` 执行：同一位业主可兼任业务、数据和运维责任人，不需虚构多个员工；但只读授权、证据形成、manifest 确认、写入授权和发布授权必须保留为不同时点的可追溯动作。Codex 可执行技术检查和自动化，不能把一次普通“继续”自动扩张为生产写入或部署授权。

## 1. 固定边界

- 岗位仍是第三方/官方来源信息入口，不新增申请、候选人、简历接收、面试、Offer 或投递结果。
- 生产盘点只输出聚合计数、枚举分组、查询计划摘要、迁移版本和执行时间，不读取或输出用户、简历、行为、凭证、岗位正文、联系方式或 URL 路径。
- 恢复库 planner 在内存中读取迁移所需内容，但输出只含内部 ID、reason code、计数和 SHA-256 摘要。
- `OfflineJob.status=active`、父机构已发布或旧 `externalId` 都不继承审核发布；候选 canonical Job 的目标状态固定为 `pending + draft`。
- `company`、结构化 city、Branch、Organization、JobSource、HTTPS 来源 URL 和最终跳转 URL 必须来自经批准的显式 manifest，禁止从机构名、地址、district、sourceOrgId 或“第一个数据源”推断。
- `archived_skip` 只能来自具名人工处置授权；inactive、rejected 或 unpublished 不能自动等同已归档。
- Profile/Branch 的 approve/publish、Organization/JobSource 信任与来源审批、Qualification 核验必须存在绑定当前 target/version/hash 的不可变 `ReviewDecision`；同一决定族以快照时点前最后一条为准，后续 reject/unpublish/suspend/revoke/expire 会使旧正向决定失效。

## 2. 运行目标守卫

工具不读取通用 `DATABASE_URL`。必须由受控执行环境注入以下专用变量：

| 变量 | 生产聚合盘点 | 恢复库 dry-run |
| --- | --- | --- |
| `RECRUITMENT_WAVE2_TARGET` | `authorized-readonly` | `restored-isolated` |
| `RECRUITMENT_WAVE2_AUTHORIZATION_REF` | 具名只读授权编号 | 恢复演练授权编号 |
| `RECRUITMENT_WAVE2_AUTHORIZED_UNTIL` | 当前时间后 4 小时内 | 当前时间后 4 小时内 |
| `RECRUITMENT_WAVE2_EXPECTED_DATABASE` | 精确生产库名 | 精确恢复库名 |
| `RECRUITMENT_WAVE2_PRODUCTION_READONLY_URL` | 专用只读角色 URL | 不设置 |
| `RECRUITMENT_WAVE2_RESTORED_READONLY_URL` | 不设置 | 恢复库专用只读角色 URL |
| `RECRUITMENT_WAVE2_RESTORE_NONCE` | 不设置 | 恢复任务 nonce |
| `RECRUITMENT_WAVE2_SNAPSHOT_SHA256` | 不设置 | 加密快照 SHA-256 |

完整 production inventory 另要求：

- `RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL=https://<已批准主机>/api/v1`
- `RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN=https://<同一已批准主机>`
- `RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA=true|false`，必须与被盘点部署的真实运行策略一致，禁止猜测。

生产公开 API 仅允许 HTTPS 443、固定 `/api/v1`、无认证头、无 Cookie、无重定向；DNS 所有地址先通过公网地址校验，实际 TLS 连接固定到已核验地址且仍按原 hostname 校验证书。CI 只在 `target=ci-fixture` 时允许 loopback HTTP。

数据库内还会二次核验：目标库名、`public` schema、`REPEATABLE READ READ ONLY`、角色非 superuser/createdb/createrole/replication/bypassrls、无 database/schema CREATE 权限、对 `public` 所有现有表均无 INSERT/UPDATE/DELETE/TRUNCATE 权限。恢复库另须存在 `_RecruitmentWave2RestoreMarker`，至少包含 `restore_nonce / snapshot_sha256 / snapshot_as_of / expires_at`；nonce、快照摘要和有效期必须与执行环境一致。规划事务提交后及最终输出序列化完成后，工具都会用新的只读事务重新读取 marker 并复核授权/marker 有效期，旧 `REPEATABLE READ` 快照不能替代撤销检查。

任何目标/权限守卫失败均在查询或规划前停止；运行中授权或 marker 失效则在输出前停止。错误输出只返回稳定错误码，不回显连接串或数据库异常正文。

## 3. 生产 legacy backfill 预盘点 Probe

前置条件：数据负责人和运维负责人已批准具名、限时、只读窗口；专用角色已经过最小权限复核。执行命令：

```bash
cd services/api
pnpm probe:recruitment-wave2
```

退出码：

- `0`：当前子集 probe 未发现已定义信号；这不是完整 production inventory，也不是 Wave 2 backfill GO。
- `2`：发现数据 blocker 或需要显式 manifest 补充的 legacy 行；按分类整理人工清单。
- `1`：目标、权限、事务、超时、schema 或执行失败；不得据此推断数据状态。

生产输出必须作为受限证据保存。不得把本 probe、旧 `verify:recruitment-p1-preflight` 的 `readyForWave2Backfill` 或历史文档计数当作本批退出门禁；在冻结方案第 6 节完整 production inventory 和公开 API 差集另行落地并通过前，不得仅凭本 probe 推进生产 manifest。

## 3.1 完整 production inventory 与公开 API 差集

前置条件除专用只读数据库授权外，还必须有精确生产 API origin、对应部署提交/主机侧运行配置证据，并用 `umask 077` 把输出重定向到受限证据目录；不得在普通 CI、聊天或公开日志中展开生产报告。

```bash
cd services/api
umask 077
node -r @swc-node/register scripts/recruitment-wave2-full-inventory.ts \
  > /approved/restricted/recruitment-wave2-full-inventory.json
```

机器证据必须直接调用 Node 入口；禁止用 `pnpm <script> > report.json` 包裹，因为业务阻塞按约定返回 `exit 2`，包管理器的生命周期提示可能污染 JSON stdout。交互式本地探查仍可使用 package script，但不得把其重定向结果当作证据。

工具执行 `DB(A) → API pass A → API pass B → DB(B)`：两次数据库报告摘要或两次 API ID 摘要任一漂移均以 `exit 1` 停止，不输出可被误解的差集。Job、JobFair、PolicyPost、legacy OfflineAgency/OfflineJob 均按当前公开 reader 的真实谓词计算 `currentReader`，再与无认证公开 API 全分页 ID 集合做双向差集；Job 的冻结目标安全证据单列，JobFair/PolicyPost 尚未冻结版本化 target-safe 模型，Directory/Profile 尚无公开 endpoint，均明确标为 unsupported/endpoint absent，不伪造结论。

退出码：

- `0`：稳定、可完整枚举、已定义 blocker 为 0、current-reader 双向差集为 0，且已支持的 target-safe 泄漏为 0；这仍不是 writer、发布或部署授权。
- `2`：稳定快照下存在数据治理 blocker、current-reader/API 差集或可证明的 target-safe 泄漏。
- `1`：授权、只读角色、API origin/DNS/TLS/health、分页、响应上限、快照漂移或执行失败。

输出只保留状态聚合、招聘内容内部 ID（每类最多 100 条样例并附全量集合摘要）、规则/查询摘要和 API origin 摘要；不输出完整 URL、标题、公司、正文、地址、电话、邮箱、证照号/证据文件、Audit payload、数据库连接串、用户或行为数据。

## 4. 恢复库与 manifest

备份获取、完整性校验、同等级访问控制的隔离恢复、只读角色创建、marker 写入和演练后销毁均由单独获批的数据库操作执行；本工具不会执行这些动作。原始 dump、manifest 和 planner 输出不得进入 Git 或普通开发目录。

manifest 顶层必须包含：

- `schemaVersion=1`、固定 `ruleVersion`、恢复 marker 对应的 `snapshotSha256`、规范 UTC `asOf`，以及整份映射清单的 `approvalRef/approvedAt`；`asOf` 必须精确等于 marker 的 `snapshot_as_of`，快照距执行时刻不得超过 24 小时，`approvedAt` 必须位于 `snapshot_as_of` 与实际执行时刻之间；
- `agencies[]` 和 `jobs[]`，每个恢复快照中的 legacy ID 恰好一项；多余 ID 直接拒绝；
- 每项 disposition 只能是 `map`、`blocker` 或 `archived_skip`。

岗位 `map` 必须显式提供 `organizationId`、`jobSourceId`、`offlineBranchId`、真实用工企业、城市名称及 6 位 city code、初始/最终 HTTPS URL 和链接核验引用。planner 同时校验旧 `(sourceOrgId, externalId)` 与目标 `(sourceId, externalId)` 冲突；缺失或冲突时只允许稳定 fallback `offline-job:<legacyId>`，fallback 再冲突则成为 blocker，不自动关联现有 Job。

恢复库执行命令：

```bash
cd services/api
pnpm plan:recruitment-wave2 --manifest /approved/secure/manifest.json --batch-size 100
```

只允许 `--manifest` 和 `--batch-size`（1–1000）。对同一快照和 manifest，批次 1、100、1000 的 `manifestChecksum`、`planChecksum` 和分类计数必须一致。

退出码：

- `0`：每条均为 candidate 或经授权 archived skip，且守恒成立；仍不代表允许写入。
- `2`：至少一条 blocker；修订 manifest 或依赖事实后重新 dry-run。
- `1`：守卫、manifest、数据库或执行失败。

## 4.1 五类治理提案的零写入校验

生产完整盘点为 `exit 2` 时，先在受限目录形成五类 draft evidence pack：Organization/JobSource 与内容域、无源 canonical Job、JobFair、legacy 机构/岗位、负向审计理由候选。提案必须绑定生产报告原始字节 SHA、数据库快照摘要、恢复快照 SHA 与全量 ID count/digest；报告中每类最多 100 个 ID 的样例不能代替恢复库重算的全量集合。

三个输入文件必须是非 symlink 的普通文件、精确 `0600`、不超过 2 MiB。机器证据直接调用 Node：

```bash
cd services/api
umask 077
node -r @swc-node/register scripts/recruitment-wave2-proposed-governance-dry-run.ts \
  --inventory-report /approved/restricted/recruitment-wave2-full-inventory.json \
  --evidence-pack /approved/restricted/recruitment-wave2-proposed-governance.json \
  --legacy-manifest /approved/secure/recruitment-wave2-legacy-manifest.json \
  > /approved/restricted/recruitment-wave2-proposed-plan.json
```

工具只允许 `restored-isolated` 或 CI 专库，以一个 `REPEATABLE READ READ ONLY` 快照重算完整 inventory，并自动用 batch 1/100/1000 加载基线、证据文件最小状态、招聘会和受限 Audit payload 摘要。三批覆盖集合、快照摘要与计划校验和必须一致；序列化后仍须用新只读事务复核授权和 restore marker。

`proposedAction` 只是拟议动作序列，不写入、不合成也不冒充 `ReviewDecision`，不能让现有 legacy planner 变绿。Profile/Branch/Qualification 使用各自固定 canonical hash；Audit payload 仅在内存计算 SHA 后丢弃；输出只保留聚合、内部 ID 最多 100 条样例和摘要，不回显 URL、企业/地址/电话、证照、证据引用、Audit payload 或连接信息。JobFair 的冻结 target-safe 仍为 `unsupported`。

退出码：

- `0`：五类提案与恢复基线内部一致，可进入同一业主后续的独立批准动作；这不是事实已落库、现有 dry-run 全绿、writer、发布或部署授权。
- `2`：结构有效但仍有业务 blocker；补事实或改处置后重跑。
- `1`：文件、摘要、守恒、目标、只读角色、marker、批次一致性或执行失败。

## 5. 必停条件

出现以下任一情况立即停止，不进入 writer 设计或生产执行：

- 专用只读角色仍有任意表写权限，目标库/marker/快照摘要不一致，或授权窗口过期；
- 任一 legacy 行没有唯一 disposition，或计数不守恒；
- 依赖主体、来源、Profile、Branch、必需资质、私有有效证据、内容 hash 或域名策略不满足 fail-closed 门禁；
- 真实 employer、结构化 city、HTTPS 来源证据或最终跳转核验缺失；
- externalId 在任一现有/目标唯一键上冲突，或 legacy 已存在不一致的 canonicalJobId/checksum/影子内容；
- 输出出现岗位正文、公司名、完整 URL、电话、邮箱、证照号/证照 URL、凭证、ImportRecord 原始行或个人数据；
- 需要修改 schema、恢复库数据、生产数据、Redis、密钥、API reader/writer 或页面才能“让结果通过”。

## 6. 后续批次

当前生产完整盘点为 `exit 2`：可以按受限内部 ID 整理 Organization/JobSource/域策略/拟议决定、无源 Job、JobFair、legacy 机构/岗位和负向审计候选的治理证据包，但它不是现有 `agencies[]/jobs[]` planner manifest。零写入 proposed-governance 校验器已形成代码候选；它只验证 draft evidence pack 与恢复基线的一致性。在恢复库依赖事实仍为空时，现有 dry-run 应继续 `exit 2`，模拟 `exit 0` 也只允许形成后续独立批准记录，不能解释为治理事实已存在。

只有冻结方案第 6 节完整 production inventory 与公开 API ID 差集通过、恢复库 dry-run 全绿、人工映射清单获批后，才可另开独立 PR 设计真正的 shadow backfill writer：每条 Job、legacy 映射、migration checksum 和追加写 AuditLog 同事务/CAS，失败不删 legacy，所有新 Job 仍不可见。任何生产执行还必须再次取得具名写授权；重复组归零后，`(sourceId, externalId)` unique 仍须作为 SQLite/PostgreSQL 独立 additive migration 验证，不能夹带在 writer 或 dual-write 中。
