# 用户文件与简历资产生产/试运营验收证据包

> 状态：STATIC DOC CHECK ONLY，尚未执行生产验收。
> 结论口径：本证据包就绪不等于生产/试运营已完成；不得声称生产已完成。
> 适用范围：登录会员原始文件、原始简历、优化后或修改后文件、AI 派生成果物、我的文档、Admin 文件生命周期视图。
> 关联文档：[生产部署与 Windows 本地主机换机验收清单](../device/production-deployment-and-windows-host-checklist.md) | [COS 生命周期与文件保存合规边界](../compliance/file-retention-and-cos-lifecycle.md)

本文件只定义生产/预生产试运营时必须留存的证据字段和执行顺序。默认不连接生产 PostgreSQL、Redis 或 COS；`verify:file-assets-trial-acceptance` 只检查本文档和清单口径完整，不证明真实链路已经跑通。

## 一、验收目标与非目标

目标：

- 用 PostgreSQL + COS 私有桶 + 会员账号完成用户文件与简历资产全链路验收。
- 分别验收上传原始文件、上传优化后或修改后文件、设置保存期限、重登查看、删除、过期清理和审计查询。
- 证明 90 天、180 天、长期保存的数据库状态、COS 对象状态、用户可见状态和审计状态一致。
- 证明 `long_term` 长期保存文件使用 `expiresAt = null`，不会被过期清理误删。
- 留存命令日志、控制台截图、浏览器截图和审计查询结果，且不泄露手机号、token、签名 URL、密钥或简历正文。

非目标：

- 不在本分支执行真实生产部署。
- 不新增业务功能、API、数据库 schema 或 COS 生命周期规则。
- 不修改 `services/api/src/files/*`、`services/api/src/storage/*`、`services/api/prisma/*` 或 Kiosk/Admin 运行时代码。
- 不以本地 SQLite、local storage 或 mock verify 替代 PostgreSQL + COS + 会员账号真实验收。

## 二、前置条件

| 项目 | 证据要求 | 状态 |
| --- | --- | --- |
| 待部署提交 | 记录 commit、分支、构建时间、部署人 | [ ] PENDING REAL-EVIDENCE |
| 生产运行时门禁 | `verify:production-runtime-gates` PASS 日志；确认 `NODE_ENV=production`、`FILE_STORAGE_DRIVER=cos`、SQLite 禁止 | [ ] PENDING REAL-EVIDENCE |
| PostgreSQL | `verify:production-db-guard` PASS 日志；`GET /api/v1/health` 显示 PostgreSQL；schema drift 检查无异常 | [ ] PENDING REAL-EVIDENCE |
| Redis | 队列/缓存进程配置、内网访问、日志无连接错误 | [ ] PENDING REAL-EVIDENCE |
| COS 私有桶 | 腾讯云控制台显示私有读写；CAM 最小权限；`verify:cos:live` 真实 put/head/get/signed-url/delete 日志 | [ ] PENDING REAL-EVIDENCE |
| COS 生命周期 | 腾讯云控制台生命周期规则截图；禁止配置 Bucket 全局过期规则；`users/` 和会员简历/AI 成果物前缀不得覆盖长期保存对象；仅允许 `tmp/` 临时前缀配置兜底清理 | [ ] PENDING REAL-EVIDENCE |
| 法务文本 | 用户协议/隐私政策已包含短期、90 天、180 天、长期保存和保存条款版本口径 | [ ] PENDING REAL-EVIDENCE |
| 测试账号 | 会员 A、会员 B、管理员账号准备完成；手机号脱敏记录 | [ ] PENDING REAL-EVIDENCE |

## 三、自动命令门禁

这些命令用于上线前证据收集，但每条都必须记录执行环境、时间、commit 和完整日志路径。

```bash
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:production-db-guard
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary
pnpm --filter @ai-job-print/api verify:cos:live
pnpm --filter @ai-job-print/api verify:member-assets-c2d
pnpm --filter @ai-job-print/api verify:audit-logs
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
```

记录规则：

- `verify:cos:live` 是 COS live 冒烟，必须在生产或预生产 COS 凭据下单独执行；若 SKIPPED，必须写明缺少哪项配置。
- `verify:member-assets-c2d` 只能证明会员资产 API 逻辑和本地存储路径，不能替代 COS 私有桶验收。
- `verify:audit-logs` 必须作为 AuditLog 基础审计服务命令证据；通过后仍不能替代 Gate 4 针对本轮测试文件 ID 的保存期限变更、删除和过期清理审计抽样。
- `verify:file-assets-trial-acceptance` 是 STATIC DOC CHECK ONLY；通过后只代表本文档结构和部署清单引用没有遗漏，不代表生产/试运营验收完成。
- 命令日志不得包含密钥、完整手机号、access token、签名 URL 查询串或简历正文。

## 四、人工全链路验收矩阵

### 4.1 会员原始文件

| 步骤 | 操作 | 必留证据 | 状态 |
| --- | --- | --- | --- |
| 登录 | 会员 A 在生产/预生产域名登录 | 登录时间、账号脱敏、终端编号、浏览器截图 | [ ] PENDING REAL-EVIDENCE |
| 上传原始文件 | 上传原始简历或求职材料 | 文件 ID 脱敏、文件类型、size、sha256 前 8 位、COS 对象前缀脱敏 | [ ] PENDING REAL-EVIDENCE |
| 我的文档 | `/me/documents` 展示文件 | 页面截图、API 请求 ID、不得展示他人文件 | [ ] PENDING REAL-EVIDENCE |
| 默认保存期限 | 确认默认 90 天 | DB 查询中 `retentionPolicy`、`expiresAt`、`retentionSetBy` | [ ] PENDING REAL-EVIDENCE |
| 延长到 180 天 | 用户确认保存条款后设置 180 天 | `retentionConsentVersion`、`retentionConsentAt`、expiresAt 更新、审计记录 | [ ] PENDING REAL-EVIDENCE |
| 重登查看 | 退出后重新登录 | 同一文件仍可见；API 只返回本人 active 文件 | [ ] PENDING REAL-EVIDENCE |
| 跨账号越权否定测试 | 会员 B 尝试读/删会员 A 文件 | 403/404 结果、请求 ID、无 COS URL 泄露 | [ ] PENDING REAL-EVIDENCE |

### 4.2 优化后或修改后文件

| 步骤 | 操作 | 必留证据 | 状态 |
| --- | --- | --- | --- |
| 生成成果物 | 完成 AI 简历优化或修改后 PDF | 任务 ID、文件 ID、我的文档截图 | [ ] PENDING REAL-EVIDENCE |
| 设置长期保存 | 用户确认保存条款后设置长期保存 | `retentionPolicy=long_term`、`expiresAt = null`、`retentionConsentVersion`、`retentionConsentAt` | [ ] PENDING REAL-EVIDENCE |
| 签名 URL 预览 | 点击查看/下载 | 签名 URL TTL <= 30min；截图中签名 URL 脱敏；过期后不可访问 | [ ] PENDING REAL-EVIDENCE |
| long_term 防误删 | 执行过期清理前后检查 | 清理前后 DB + COS 记录；long_term 文件仍存在且仍可见 | [ ] PENDING REAL-EVIDENCE |
| 重登查看 | 会员 A 重新登录 | 长期保存文件仍可见；`expiresAt = null` 不被过滤 | [ ] PENDING REAL-EVIDENCE |

### 4.3 删除三态一致

删除三态一致必须同时满足：用户界面不可见、PostgreSQL 行状态正确、COS 对象物理删除。

| 步骤 | 必留证据 | 状态 |
| --- | --- | --- |
| 用户主动删除 | 两步确认截图、删除请求 ID、操作人脱敏 | [ ] PENDING REAL-EVIDENCE |
| DB 状态 | `status=deleted`、`deletedAt`、`deletedBy`、`deleteReason` | [ ] PENDING REAL-EVIDENCE |
| COS 状态 | COS HEAD 404 或控制台对象不存在截图；对象 key 脱敏 | [ ] PENDING REAL-EVIDENCE |
| AuditLog | `AuditLog` 中存在删除审计，含 actor、target、requestId 或时间窗口 | [ ] PENDING REAL-EVIDENCE |
| 用户界面 | `/me/documents` 不再展示该文件；Admin 生命周期视图可看到删除/清理结果 | [ ] PENDING REAL-EVIDENCE |

### 4.4 过期清理

过期清理由 `FilesCleanupTask` 每小时 cron 或 `POST /files/cleanup-expired` 手动触发。生产验收必须证明目标环境实际挂载 `ScheduleModule.forRoot()` 和 `FilesCleanupTask`，且清理只命中 `deletedAt=null` 且 `expiresAt < now` 的文件。手动接口会写入一条 `file.cleanup_expired` 的管理员操作 AuditLog；cron 路径会额外写入包含 `triggeredBy`、`deletedCount`、`bySensitiveLevel`、`byPurpose` 和 `fileIdDigest` 的系统 AuditLog。生命周期聚合取证优先等待整点 cron 或在预生产中让 cron 触发，手动接口只作为立即清理结果和管理员操作记录核对。

| 步骤 | 必留证据 | 状态 |
| --- | --- | --- |
| 准备过期文件 | 受控测试文件 `expiresAt < now`，COS 对象存在，非长期保存 | [ ] PENDING REAL-EVIDENCE |
| 准备长期保存对照 | 受控测试文件 `retentionPolicy=long_term`、`expiresAt = null`，COS 对象存在 | [ ] PENDING REAL-EVIDENCE |
| 触发清理 | cron 日志或管理员手动接口日志，记录 triggeredBy、请求 ID、执行时间 | [ ] PENDING REAL-EVIDENCE |
| 被清理文件 | COS HEAD 404、DB `status=deleted`、`deletedAt`、`deleteReason` | [ ] PENDING REAL-EVIDENCE |
| long_term 防误删 | 长期保存对照文件 DB active、COS HEAD 200、用户仍可见 | [ ] PENDING REAL-EVIDENCE |
| AuditLog | cron 路径下 `file.cleanup_expired` 系统审计存在，deletedCount 与抽样文件一致；如使用手动接口，也需核对管理员操作 AuditLog、返回值、DB 与 COS 状态 | [ ] PENDING REAL-EVIDENCE |

## 五、COS 与隐私专项证据

| 项目 | 必留证据 | 状态 |
| --- | --- | --- |
| 私有读写 | COS Bucket ACL 为 Private，公网匿名访问对象失败 | [ ] PENDING REAL-EVIDENCE |
| 短期签名 URL | 预览/下载只走短期签名 URL；TTL <= 30min；过期后访问失败 | [ ] PENDING REAL-EVIDENCE |
| 生命周期规则 | 腾讯云控制台生命周期规则截图；禁止配置 Bucket 全局过期规则；`users/` 不配置 Expiration；`tmp/` 规则单独截图 | [ ] PENDING REAL-EVIDENCE |
| 日志脱敏 | API、nginx、Agent 日志不含简历正文、手机号明文、token、完整签名 URL、COS secret | [ ] PENDING REAL-EVIDENCE |
| 证据脱敏 | 截图与报告中手机号脱敏、token 脱敏、签名 URL 脱敏、对象 key 前缀脱敏 | [ ] PENDING REAL-EVIDENCE |

## 六、审计查询模板

以下查询只作为生产 DBA/运维执行参考，实际表名和字段以当前 schema 为准。所有输出进入证据包前必须脱敏。

```sql
-- 文件保存期限与删除状态抽样
select id, "ownerType", "ownerId", purpose, status, "retentionPolicy",
       "retentionSetBy", "retentionConsentVersion", "retentionConsentAt",
       "expiresAt", "deletedAt", "deletedBy", "deleteReason"
from "FileObject"
where id in ('REDACTED_FILE_ID');

-- 删除与清理审计抽样
select action, "actorRole", "actorId", "targetType", "targetId",
       payload, "createdAt"
from "AuditLog"
where action in ('file.delete', 'file.retention_update', 'file.cleanup_expired')
order by "createdAt" desc
limit 50;
```

## 七、失败门禁与停止/回滚

出现任一情况，停止试运营扩大范围：

- PostgreSQL 与 COS 状态不一致，或删除后 COS 对象仍存在。
- 长期保存文件在过期清理后消失，或 `long_term` 未保持 `expiresAt = null`。
- 会员 B 可读、可下载或可删除会员 A 文件。
- 签名 URL 超过 TTL、永久可访问，或日志/截图泄露 token、签名 URL、手机号、简历正文。
- COS 生命周期存在 Bucket 全局过期规则，或 `users/`、会员简历、AI 成果物前缀被 Expiration 覆盖。
- AuditLog 缺失删除、保存期限变更或过期清理记录。

回滚方式：

- 暂停试运营终端，切回人工服务。
- 保留 API/nginx/COS/Admin 截图和日志，停止继续上传真实用户文件。
- 删除受控测试文件，确认 COS 与 DB 状态一致。
- 如发生密钥、token、签名 URL 泄露，立即轮换相关密钥并清理已公开证据。
- 如为代码回归，回滚到上一部署版本；如为 COS/DB 配置问题，只回滚配置，不改动历史用户文件。

## 八、验收结论模板

验收报告只能使用以下口径：

```text
用户文件与简历资产证据包：已准备 / 已执行 / 未通过 / 需复验
执行环境：生产 / 预生产
执行时间：
部署 commit：
执行人：
阻塞项：
结论：
```

禁止使用“生产验收已完成”“试运营已完成”“已正式上线”“生产就绪已通过”等没有证据 ID 支撑的结论。
