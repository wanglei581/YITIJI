# 招聘信息内容域 Wave 2 生产只读盘点与恢复库规划 Runbook

状态：完整生产只读盘点已于 2026-08-10 执行，结果为稳定快照下存在业务 blocker（`exit 2`）；未恢复生产备份、未写任何业务数据、未切换 reader/writer、未部署。

本执行包包含三件严格分离的只读能力：廉价的 production legacy backfill 子集 probe、冻结方案第 6 节完整 production inventory + 公开 API ID 差集，以及受控恢复库上的 manifest-aware dry-run。子集 probe 仍不能产生 GO；完整盘点同时区分现网 `currentReader` 与冻结目标 `targetSafe`，不会把尚未切换的 Profile/Directory 接口伪装成空集合。执行包不包含 backfill writer，不识别 `--apply`、`--execute`、`--write` 或 `--fix`，也不授权备份下载、恢复、生产写入、数据库销毁、schema 收紧、reader 切换或发布。

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

当前生产完整盘点为 `exit 2`：可以按受限内部 ID 整理 Organization/JobSource/域策略/ReviewDecision、无源 Job、JobFair、legacy 机构/岗位和负向审计候选的治理证据包，但它不是现有 `agencies[]/jobs[]` planner manifest。在恢复库依赖事实仍为空时，现有 dry-run 应继续 `exit 2`；要验证拟议治理事实，必须另开代码批次扩展零写入纯内存 planner，或为隔离恢复库 fixture/applier 另立专项授权和清理门禁。

只有冻结方案第 6 节完整 production inventory 与公开 API ID 差集通过、恢复库 dry-run 全绿、人工映射清单获批后，才可另开独立 PR 设计真正的 shadow backfill writer：每条 Job、legacy 映射、migration checksum 和追加写 AuditLog 同事务/CAS，失败不删 legacy，所有新 Job 仍不可见。任何生产执行还必须再次取得具名写授权；重复组归零后，`(sourceId, externalId)` unique 仍须作为 SQLite/PostgreSQL 独立 additive migration 验证，不能夹带在 writer 或 dual-write 中。
