# 生产数据治理只读复核（2026-08-07）

> 状态：只读审计，未执行任何生产写入
> 基线：`main@35d53d6a`；生产 `DEPLOY_SOURCE` / PM2 `COMMIT` 均为 `389f37ff`
> 关联：[生产内容数据替换清单](../operations/production-content-data-replacement-list-2026-08.md)（#528）、#533

## 1. 结论

内容治理第一步已生效：公网当前没有任何已发布岗位/招聘会/线下机构；两个腾讯样本来源已停用。数据库仍保留可恢复的演示/样本记录（均未发布），符合“下架保留记录、待真实来源替换”口径。另确认 `_prisma_migrations` 中 network diagnostics 迁移存在两条记录，判定为“一次失败回滚 + 一次成功重跑”的正常残留，不构成数据损坏。

## 2. 只读证据（psql 只读查询，2026-08-07）

### 2.1 岗位（Job）

- 总数 219；状态矩阵：`approved|unpublished=217`、`approved|draft=1`、`pending|draft=1`；**published=0**。
- 来源分布：预生产腾讯公开岗位样本 100、腾讯招聘公开来源样本（预生产验证）100、市人社公共就业平台（演示）6、市人才网 6、高校就业信息网 7。

### 2.2 招聘会 / 线下机构 / 政策

- JobFair 3 场：全部 `approved|unpublished`（均为 2026-06 已结束场次）。
- OfflineAgency 1 个：“职易达就业服务大厅（演示机构）” `approved|unpublished`。
- OfflineJob 1 个：“前台接待（演示岗位）” `status=inactive`。
- PolicyPost：0。

### 2.3 JobSource

| id | 名称 | sourceKind | accessMode | enabled | lastSyncAt |
|---|---|---|---|---|---|
| src-hr-api | 市人才网 API | aggregator | api | true | 空 |
| preprod-tencent-real-source-0701162419 | 腾讯招聘公开来源样本 | job_platform | excel | false | 空 |
| src-tencent-real-excel-20260701 | 腾讯招聘公开来源样本（预生产验证） | aggregator | excel | false | 2026-07-01 08:35 |
| src-uni-excel | 高校就业信息 Excel | school | excel | true | 空 |

### 2.4 重复迁移记录

`_prisma_migrations` 共 50 行 / 49 个唯一名。`20260730100000_add_terminal_network_diagnostics` 两条记录 checksum 相同：

- 第一条：`started 2026-08-05 13:19:44+08`、`finished` 为空、`rolled_back_at 2026-08-05 13:20:00+08`（失败后回滚残留）；
- 第二条：`started/finished 2026-08-05 13:20:00+08`、`rolled_back_at` 为空（成功应用）。

结论：首次执行失败被回滚，随后重跑成功；Prisma 保留失败行是正常行为，`migrate deploy` 已按 49 个迁移目录判定无 pending。

## 3. 风险与决策项（仅建议，未执行）

- [ ] 决定是否清理仍留在生产库的演示/样本行。推荐保持下架、待真实来源接入后经 Admin/Partner 审核发布闭环替换；删除需单独授权并先备份。
- [ ] 核实 `src-hr-api`（市人才网 API）与 `src-uni-excel`（高校就业信息 Excel）是否为已授权真实来源。当前 `enabled=true` 但 `lastSyncAt` 为空；建议数据负责人确认授权前保持停用或仅做受控手动导入。
- [ ] network diagnostics 重复迁移记录：无需处理；如需清理 `rolled_back_at` 非空行，须先备份并取得 DBA/数据负责人授权。
- [ ] 建立独立预生产环境，避免样本/演示数据再次进入生产库。

## 4. 边界

本复核仅执行只读 `psql` 查询与公网 200 探测；未连接业务写库、未删改数据、未执行 seed、未触发发布。
