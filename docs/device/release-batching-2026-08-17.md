# 积压发布分批方案（2026-08-17）

> 生产停在 **`497722091`**（8/14）。到 `4bcb394a4` 共 **70 个提交**。
> 分批由 DeepSeek 全量归类产出，Claude 复核时发现一处**必须订正的批次边界**。

---

## 一、⚠️ 最重要的订正：B1 与 B2 不能拆

DeepSeek 原方案切三批，B1 终点 `36ff8438a`。复核时逐提交查证发现：

```
36ff8438a（B1 终点）时 packages/shared/src/types/memberFeedback.ts:
    endUserId: string     ← 不可空
    phoneMasked: string   ← 不可空
    （无 submitterType）

修复它的是 57d03bd32（#640），属于 B2
```

**B1 单独发会造成一个已知断裂：**

| B1 发上去后 | 状态 |
|---|---|
| `POST /kiosk/feedback` 能写 `endUserId=null` | ✅ 已存在，**且是无鉴权公开路由** |
| Admin 查询 `include: { endUser }` | 会拿到 null |
| **shared 类型声明 `endUserId: string`** | ❌ **类型撒谎** |
| Admin 前端按不可空渲染 | **匿名工单显示空白或抛错** |

⇒ **`57d03bd32` 必须与 B1 同批。** 实际方案：

| 批 | 范围 | 提交数 | 迁移 |
|---|---|---|---|
| **B1+B2 合并** | `497722091..1556d4d04` | 66 | 全部 4 组 |
| **B3** | `1556d4d04..4bcb394a4` | 4 | 无 |

---

## 二、唯一的单向门

4 组迁移里 3 组纯 additive。唯一需要单列的是 `anonymous_kiosk_feedback`：

- **PostgreSQL**：`ALTER COLUMN "endUserId" DROP NOT NULL` —— **约束放松，不破坏数据**
- **SQLite**：因不支持 `DROP NOT NULL`，用 `DROP TABLE → CREATE new → RENAME` 重建

生产跑 PostgreSQL，**不构成数据破坏**；但 schema 变更整体是 forward-only。

### 门什么时候真的打开

`POST /kiosk/feedback` 是**无鉴权公开路由**（`kiosk-feedback.controller.ts:24-31`），
建单处 `kiosk-feedback.service.ts:119` 写 `endUserId: null`。

Kiosk 前端在 B1 范围内**零调用**（`git grep "kiosk/feedback"` 在 `36ff8438a` 上零命中，
`PrintDonePage.tsx:59-60` 仍跳 `/me/feedback`）。

⚠️ **但「前端没接」不等于「不会产生」** —— 端点公开，任何人直接调用即可写入。

**回滚窗口以「出现第一条 null 行」为止，不能按「零前端调用」长期假设。**

### 旧版读到 null 会怎样（两种确定的死法）

旧版 `497722091`：
- 查询不按 `endUserId` 过滤，且 `include: { endUser }`（`member-feedback.service.ts:110-113`）
- 旧 schema 关系必填（`postgres/schema.prisma:2201-2202`）
- mapper 直接解引用 `row.endUser.phoneEnc`（`:265`）

⇒ 要么 Prisma include 阶段因 required relation 失败，要么 mapper 抛 TypeError。
**只影响 Admin**；会员侧查询都带 `endUserId` 过滤，不受影响。

### 回滚顺序（顺序反了会立刻炸）

```bash
# 1. 先兜底数据 —— 必须在切代码之前
sudo -u postgres psql -d <db> -c \
  'UPDATE "FeedbackTicket" SET "endUserId" = <系统用户ID> WHERE "endUserId" IS NULL;'

# 2. 再还原代码
cp -r /srv/ai-job-print-backups/pre-<sha>.runtime/* /srv/ai-job-print/
pm2 restart <name> --update-env

# 3. 验证
curl -fsS http://127.0.0.1:3010/health
```

**先切代码再补数据 = 旧后台立刻读到它处理不了的行。**

---

## 三、跨端契约（5 处，两处强同步）

| 提交 | 影响 | 能否拆 |
|---|---|---|
| `c46c65f05` | `ContractReviewTaskView` 加 `estimatedSeconds`/`failureCode`/`failureReason` | **强同步，不可拆** |
| `57d03bd32` | `FeedbackSubmitterType`、Admin 工单可空化 | **强同步，不可拆** |
| `1a4ceed61` | `AssistantChatResponse` 可选字段 | 风险低 |
| `ffe8b3259` | 新端点，前端未接 | 风险低 |
| `3a7457d27` | `ORDER_PAY_STATUSES` 运行时白名单 | 风险低 |

---

## 四、发布前置硬线

| 条件 | 阈值 | 2026-08-17 实测 |
|---|---|---|
| 磁盘可用 | **≥ 10GB 才发** | 清理前 5GB ❌ |
| Redis | `PING` 必须 PONG | `REDIS_REACHABLE=yes` ✅ |
| main CI | 目标提交必须实际绿 | `541099ffe` success ✅ |

### ⚠️ `mv` 不释放空间

execute 把 7319MB `mv` 到 `/srv/.cleanup-trash/` 之后，
`ROOT_USED_PCT` **仍是 88**、可用**仍是 5GB** —— 与 mv 前完全一致。

**同分区 `mv` 只改目录项。空间只有 `rm` 才回来。**
用 `cleanup-stale-releases.yml` 的 `purge_trash_path` 模式真删。

---

## 五、发布后立即要做的一件事

```sql
SELECT count(*) FROM "FeedbackTicket" WHERE "endUserId" IS NULL;
```

- **= 0** → 回滚窗口仍然干净，可简单回滚
- **> 0** → 回滚前必须先跑上面的兜底 UPDATE

验收清单见 [docs/acceptance/release-acceptance-2026-08-17.md](../acceptance/release-acceptance-2026-08-17.md)。
