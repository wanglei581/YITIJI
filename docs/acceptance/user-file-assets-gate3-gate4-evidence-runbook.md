# 用户文件与简历资产 Gate 3/Gate 4 证据执行模板

> 状态：模板 + 当前执行口径；Gate 3 自动命令门禁已通过（含 G3-06 COS live），Gate 4 受控账号/API 级验收已通过，完整浏览器截图证据待补。
> 适用基线：Gate 2 预生产刷新完成后，以部署候选 `2187f6a7` 或后续用户确认的替代候选为准。
> 口径：本文只定义证据编号、日志命名、脱敏规则和停止条件；不得据此宣称生产验收、试运营或 Windows 真机验收完成。

## 一、执行边界

执行前必须再次确认：

- **目标**：在预生产环境验证用户文件与简历资产的自动命令门禁、会员账号浏览器链路、COS 私有桶、PostgreSQL 状态、保存期限、删除三态和 Admin 生命周期视图。
- **非目标**：正式生产、正式域名、正式试运营扩大、Windows 真机、打印扫描、短信/OCR/TRTC/ASR/TTS 配置变更、COS 生命周期规则变更。
- **允许写入**：受控测试会员账号、受控测试文件、受控 COS 对象、保存期限变更、删除/清理审计记录、命令日志和截图证据。
- **禁止写入**：真实用户简历正文、未脱敏手机号、生产密钥、完整签名 URL、非测试账号文件、Bucket 级生命周期配置。
- **2026-06-22 B 方案记录**：腾讯短信审核未完成，用户确认临时切 `SMS_PROVIDER=log` 执行 Gate 4；执行后已回滚 `SMS_PROVIDER=tencent`。后续短信审核通过后，仍需真实腾讯短信手机号登录 E2E。

## 二、证据命名规范

| 证据 ID | 类型 | 命名格式 | 内容 |
| --- | --- | --- | --- |
| G3-01 | 命令日志 | `G3-01-runtime-gates-<timestamp>.log` | `verify:production-runtime-gates` 输出 |
| G3-02 | 命令日志 | `G3-02-db-guard-<timestamp>.log` | `verify:production-db-guard` 输出 |
| G3-03 | 本地命令日志 | `G3-03-cos-lifecycle-policy-<timestamp>.log` | COS 生命周期静态策略检查；依赖完整仓库 `docs/`，不得在裁剪运行时包内执行 |
| G3-04 | 命令日志 | `G3-04-file-retention-<timestamp>.log` | 保存期限策略检查 |
| G3-05 | 命令日志 | `G3-05-file-lifecycle-summary-<timestamp>.log` | Admin 生命周期聚合检查 |
| G3-06 | 命令日志 | `G3-06-cos-live-<timestamp>.log` | COS live put/head/get/signed-url/delete，日志脱敏 |
| G3-07 | 命令日志 | `G3-07-member-assets-c2d-<timestamp>.log` | 会员资产 HTTP E2E；不得替代 COS live 验收 |
| G0-01 | 本地命令日志 | `G0-01-trial-acceptance-static-<timestamp>.log` | 仓库侧静态证据包防回退检查；必须在本地完整仓库运行，不在裁剪后的预生产运行时包内执行 |
| G3-08 | 不适用 | 已移至 `G0-01-trial-acceptance-static-<timestamp>.log` | 原静态证据包防回退检查已移出远端 Gate 3；不得为了远端执行该脚本把 `docs/` 或 `.ccg/` 加回裁剪包 |
| G3-09 | 命令日志 | `G3-09-audit-logs-<timestamp>.log` | AuditLog 基础审计服务门禁；文件级保存期限变更、删除、过期清理仍需 Gate 4 按测试文件 ID 抽样 |
| G4-01 | 浏览器截图 | `G4-01-login-member-a-<timestamp>.png` | 会员 A 登录后页面，手机号脱敏 |
| G4-02 | 浏览器截图 + API 摘要 | `G4-02-upload-raw-file-<timestamp>.md` | 原始文件上传、文件 ID 脱敏、sha256 前 8 位 |
| G4-03 | DB 摘要 | `G4-03-default-retention-<timestamp>.md` | 默认 90 天保存期限 |
| G4-04 | DB + 审计摘要 | `G4-04-extend-180-days-<timestamp>.md` | 180 天保存期限和 consent 证据 |
| G4-05 | 浏览器截图 + DB 摘要 | `G4-05-output-long-term-<timestamp>.md` | 优化后/修改后成果物长期保存 |
| G4-06 | 浏览器截图 + 日志摘要 | `G4-06-signed-url-preview-<timestamp>.md` | 签名 URL TTL、过期验证、查询串脱敏；TTL 以预生产实际配置为准且不得超过 30 分钟 |
| G4-07 | API 摘要 | `G4-07-cross-account-deny-<timestamp>.md` | 会员 B 访问会员 A 文件 403/404 |
| G4-08 | DB + COS + UI 摘要 | `G4-08-delete-three-state-<timestamp>.md` | UI 不可见、DB deleted、COS 404、AuditLog |
| G4-09 | DB + COS + 审计摘要 | `G4-09-expired-cleanup-<timestamp>.md` | 过期清理命中测试文件，long_term 对照不被删 |
| G4-10 | Admin 截图 | `G4-10-admin-lifecycle-view-<timestamp>.png` | Admin 文件生命周期视图截图 |

证据文件不提交到 Git，最终只在运行环境或私有归档位置保存脱敏版本。仓库内只能记录证据 ID、执行结果和脱敏摘要。

## 三、统一脱敏规则

进入证据包前必须处理：

- 手机号：保留前 3 后 2，例如 `139****01`。
- 文件 ID / 任务 ID / 用户 ID：仅保留前 8 位或使用 `FILE_A_RAW`、`FILE_A_OUTPUT` 这类别名。
- COS bucket：只记录 region、用途和 sha256 指纹前 10 位，不记录完整 bucket 名。
- COS objectKey：保留业务前缀类别和 hash 前 8 位，不记录完整路径。
- 签名 URL：只记录 host、path hash、TTL；删除 `sign`、`q-signature`、token、credential 等查询串。
- 简历正文：不得进入日志、截图说明或报告；只记录文件大小、mimeType、sha256 前 8 位。
- token / cookie / secret：不得截图、不得复制到证据摘要；如出现，停止验收并轮换。

## 四、Gate 3 自动命令门禁

执行前置条件：

- Gate 2 已通过，并记录预生产 health `db=postgres`。
- 环境变量指向预生产 PostgreSQL、Redis、COS 私有桶；只记录脱敏指纹。
- G3-06 执行前必须正向证明当前 COS bucket 为预生产用途；只记录用途 hint、region 和 bucket 指纹，不记录完整 bucket 名。仅有项目名或业务名标签不够，需能证明 `preprod` / `staging` / `test` / `dev` / `uat` 等非生产隔离语义，或由用户提供云控制台/命名/权限隔离证明。
- 2026-06-22 当前预生产 COS bucket 已完成切换并通过 G3-06：bucket 脱敏指纹 `d855f7e900`、`strict_nonprod=true`、`prod_label=false`、region `ap-guangzhou`。后续如 bucket/env 发生变化，必须重新执行隔离证明和 G3-06。
- 命令输出通过 `tee` 写入证据日志，执行后人工脱敏再归档。
- `verify:file-assets-trial-acceptance` 和 `verify:cos-lifecycle-policy` 是仓库侧静态文档门禁，依赖 `docs/`；Gate 2 裁剪运行时包不包含这些目录，因此必须在 Gate 0 / G3-03 本地完整仓库中运行，不得为了远端执行把 `docs/` 或 `.ccg/` 加回裁剪运行时包。

```bash
set -euo pipefail
TS=$(date +%Y%m%d%H%M%S)
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy | tee "G3-03-cos-lifecycle-policy-$TS.log"
```

预生产裁剪运行时包执行：

```bash
set -euo pipefail
TS=$(date +%Y%m%d%H%M%S)
pnpm --filter @ai-job-print/api verify:production-runtime-gates | tee "G3-01-runtime-gates-$TS.log"
pnpm --filter @ai-job-print/api verify:production-db-guard | tee "G3-02-db-guard-$TS.log"
pnpm --filter @ai-job-print/api verify:file-retention | tee "G3-04-file-retention-$TS.log"
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary | tee "G3-05-file-lifecycle-summary-$TS.log"
if [ "${COS_BUCKET_PREPROD_PROOF_CONFIRMED:-}" = "true" ]; then
  pnpm --filter @ai-job-print/api verify:cos:live | tee "G3-06-cos-live-$TS.log"
else
  echo "G3-06 BLOCKED: set COS_BUCKET_PREPROD_PROOF_CONFIRMED=true only after positive preproduction/non-production bucket proof"
fi
pnpm --filter @ai-job-print/api verify:member-assets-c2d | tee "G3-07-member-assets-c2d-$TS.log"
pnpm --filter @ai-job-print/api verify:audit-logs | tee "G3-09-audit-logs-$TS.log"
```

判定规则：

- `verify:cos:live` 如果输出 `SKIPPED`，Gate 3 不通过；必须记录缺少的配置项名称，不记录值。
- `verify:cos:live` 执行前如无法证明当前 bucket 为预生产/非生产用途，必须停止，不能用项目名标签替代隔离证明。
- 如果只读取证据显示 bucket `prod_label=true` 或与历史生产私有桶指纹一致，禁止设置 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true`，必须先切换到明确隔离的预生产 bucket。
- 当前 Gate 3 自动命令门禁已经通过；Gate 4 仍未执行，不能把 G3-06 PASS 写成 Gate 4、正式生产、试运营或 Windows 真机完成。
- `verify:member-assets-c2d` 强制本地存储，不能替代 COS live 或浏览器账号验收。
- Gate 0 本地 `verify:file-assets-trial-acceptance` 只证明证据包结构防回退，不证明远端运行时可用；不得为了远端执行该命令把 `docs/` 或 `.ccg/` 加回 Gate 2 裁剪运行时归档。
- `verify:audit-logs` 是 AuditLog 基础审计服务门禁，只证明审计写入、查询、分页、payload 封顶和 best-effort 行为；Gate 4 仍必须针对本轮测试文件 ID 抽样确认保存期限变更、删除、过期清理审计记录。
- 任一日志出现密钥、token、完整手机号、签名 URL 查询串或简历正文，立即停止并轮换相关凭据。

## 五、Gate 4 浏览器和账号验收

2026-06-22 已完成受控账号/API 级验收：

- MEMBER_A 登录成功，脱敏手机号 `139****7032`，会员 ID digest `bf165f504d98`。
- MEMBER_B 越权否定测试成功，脱敏手机号 `138****7032`；跨账号预览和删除均为 403。
- 原始文件 digest `2b44f637ef7b`：默认 `months_3`，可设置 `months_6`，设置 `long_term` 被 400 拒绝，删除后不可预览。
- 优化成果夹具 digest `6c4869d21445`：受控上传后通过 DB 夹具标记 `assetCategory=optimized`，再走保存期限 API 设置 `long_term` 成功；这证明规则与资产中心管理能力，不等于真实 AI 优化产物生成链路已完整验收。
- 过期清理测试文件 digest `9e14136ea1ee`：清理前确认没有非本轮 active expired 文件，手动 cleanup 删除 1 个测试文件，`long_term` 对照未被删除。
- Admin 生命周期 API：清理前 `totalActive=3`、`longTermCount=1`、`expiredPendingCleanup=1`；清理后 `totalActive=2`、`longTermCount=1`、`expiredPendingCleanup=0`。临时 Admin 已禁用。

仍待补齐：

- 浏览器截图证据 G4-01 / G4-02 / G4-05 / G4-10。
- 签名 URL 过期后不可访问的等待窗口证据。
- COS 控制台或对象 HEAD 脱敏证据，补强删除三态。
- SSH `SMS_PROVIDER=tencent` 只读复核已补齐：`SMS_PROVIDER=tencent`、`FILE_STORAGE_DRIVER=cos`、`DATABASE_URL=postgres`、`REDIS_URL=set`。

测试账号：

| 别名 | 用途 | 记录方式 |
| --- | --- | --- |
| MEMBER_A | 主验收会员 | 仅记录脱敏手机号、账号 ID 前 8 位 |
| MEMBER_B | 越权否定测试会员 | 仅记录脱敏手机号、账号 ID 前 8 位 |
| ADMIN_A | 后台验收管理员 | 仅记录角色和账号 ID 前 8 位 |

### 5.1 原始文件链路

| 步骤 | 操作 | 证据 ID | 通过标准 |
| --- | --- | --- | --- |
| 登录会员 A | 使用预生产域名登录 | G4-01 | 登录成功，页面不展示 token/cookie |
| 上传原始文件 | 上传受控测试 PDF 或图片 | G4-02 | 生成 `FILE_A_RAW`，COS object 存在，sha256 前 8 位记录 |
| 默认保存期限 | 打开我的文档并查询 DB | G4-03 | `retentionPolicy=months_3`、`retentionSetBy=system`、`expiresAt` 约 90 天 |
| 设置 180 天 | 用户确认保存条款后更新 | G4-04 | `retentionPolicy=months_6`、`retentionConsentVersion=file-retention-v1`、AuditLog 存在 |
| 重登查看 | 退出再登录会员 A | G4-04 | `FILE_A_RAW` 仍可见，API 只返回本人 active 文件 |

### 5.2 优化后或修改后文件链路

| 步骤 | 操作 | 证据 ID | 通过标准 |
| --- | --- | --- | --- |
| 生成成果物 | 完成简历优化/修改后文件 | G4-05 | 生成 `FILE_A_OUTPUT`，我的文档可见 |
| 设置长期保存 | 用户确认保存条款后设置长期保存 | G4-05 | `retentionPolicy=long_term`、`expiresAt=null`、consent 字段存在 |
| 签名 URL 预览 | 预览或下载成果物 | G4-06 | TTL 以预生产实际配置为准且不得超过 30min，过期后不可访问，证据中查询串已脱敏 |

### 5.3 安全与生命周期

| 步骤 | 操作 | 证据 ID | 通过标准 |
| --- | --- | --- | --- |
| 跨账号否定测试 | 会员 B 访问会员 A 文件详情/下载/删除 | G4-07 | 403/404，无签名 URL 泄露 |
| 用户主动删除 | 删除 `FILE_A_RAW` | G4-08 | UI 不可见、DB `status=deleted`、COS HEAD 404、AuditLog 存在 |
| 过期清理 | 准备一个过期测试文件和一个 long_term 对照 | G4-09 | 仅允许把本轮受控测试文件的 `expiresAt` 回拨到过去来模拟过期；执行前确认清理窗口内除本轮测试文件外无其它会被误清理的文件；过期文件被清理，long_term 对照 DB active/COS 200/用户可见；生命周期聚合审计优先走整点 cron 路径；如使用手动接口，也需核对管理员操作 AuditLog、返回值、DB 与 COS 状态 |
| Admin 生命周期视图 | 管理员查看文件生命周期 | G4-10 | 展示统计、状态、长期保存、删除/清理结果；不得提供 Admin 修改用户保存期限入口 |

## 六、PostgreSQL 查询摘要模板

实际执行时只复制脱敏后的结果摘要，不提交原始查询输出。

```sql
-- 文件状态抽样，只查本轮测试文件 ID
select id, purpose, status, "retentionPolicy", "retentionSetBy",
       "retentionConsentVersion", "retentionConsentAt",
       "expiresAt", "deletedAt", "deletedBy", "deleteReason"
from "FileObject"
where id in ('FILE_A_RAW', 'FILE_A_OUTPUT', 'FILE_A_EXPIRED', 'FILE_A_LONG_TERM_CONTROL');

-- 审计抽样，只查本轮测试文件 ID 和时间窗口
select action, "actorRole", "actorId", "targetType", "targetId",
       payload, "createdAt"
from "AuditLog"
where action in ('file.delete', 'file.retention_update', 'file.cleanup_expired')
  and "createdAt" >= 'REDACTED_GATE4_START_AT'
order by "createdAt" desc
limit 100;
```

## 七、停止条件

出现任一情况必须停止 Gate 4，不扩大试运营：

- G4-01 前无法证明测试账号开通方式不会修改短信、OCR、AI、TRTC、ASR/TTS 配置。
- 会员 B 能读、下载或删除会员 A 文件。
- `long_term` 对照在过期清理后消失。
- G4-09 前无法证明过期清理只会命中本轮测试文件 ID。
- 删除后 PostgreSQL、COS、用户界面三态不一致。
- 签名 URL 超过 30 分钟或过期后仍可访问。
- 日志或截图出现密钥、token、完整手机号、完整签名 URL、简历正文。
- COS 生命周期规则覆盖 `users/`、会员简历、AI 成果物或长期保存对象。
- AuditLog 缺失保存期限变更、删除或过期清理记录。

## 八、结论模板

```text
用户文件与简历资产 Gate 3/Gate 4：未执行 / 已执行未通过 / 已执行待复验 / 已执行通过
执行环境：预生产 / 生产
部署 commit：
证据包编号：
通过证据 ID：
失败证据 ID：
阻塞项：
结论口径：
```

只有所有 Gate 3 命令 PASS、Gate 4 证据 ID 完整、停止条件未触发，才能写“Gate 3/Gate 4 完整浏览器验收通过”。当前只能写“Gate 4 账号/API 级验收通过，浏览器截图与部分人工证据待补”。这仍不等于正式小范围试运营完成；试运营还需结合 Windows 真机、打印扫描、短信/OCR/AI live 和法务材料验收。
