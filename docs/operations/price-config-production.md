# 生产 / 预生产 PriceConfig 落库与防覆盖

> 关联：`docs/operations/print-rollout-deployment-matrix.md`、P0-4（2026-07-25）
> 目的：明确**如何显式写入运营价**，以及**为何绝对不能对生产库跑开发 seed**。

## 硬约束

1. **运行期价目真相源**只有数据库表 `PriceConfig`（`serviceKey` + `unitCents` + `active`）。
2. **`seedDevDefaultPriceConfig` 禁止在 `NODE_ENV=production` 执行**。其 `update` 分支会覆盖 `unitCents`；若误连生产库，会把运营价静默改回开发默认（黑白 20 分 / 彩色 50 分）。
3. **`PriceConfig.effectiveFrom` 当前是假能力字段**。`PricingService` 只查 `active`，从不按生效时间切换价目。排期改价不要依赖该列；改价 = 直接改 `unitCents` / `active` 并记审计。
4. **缺少 active 价目 ≠ 免费**。计价 fail-closed（`PRICE_CONFIG_UNAVAILABLE`），不会默认为 0 元。
5. 本文件只给运维 SQL / 记录模板。**仓库内脚本不得默认连生产库写价**；写价须人工确认目标库与金额。

## 禁止事项

| 动作 | 原因 |
| --- | --- |
| 在生产 / 预生产对真实库跑 `verify:pricing` / `verify:print-jobs` 等会调用 `seedDevDefaultPriceConfig` 的脚本 | seed 会 upsert 覆盖 `unitCents`（生产已有 NODE_ENV 守卫，但仍禁止拿生产 `DATABASE_URL` 跑开发 verify） |
| 把 `PRINT_UNIT_PRICE_CENTS`（20/50）当正式对外价 | 仅开发 seed 源；Kiosk 已走 `POST /orders/quote` |
| 依赖 `effectiveFrom` 做定时改价 | PricingService 不读该字段 |
| 缺价时当免费放行 | 违反 fail-closed |

## 写入前只读核对

```sql
SELECT
  "serviceKey",
  "unitCents",
  "unit",
  "active",
  "effectiveFrom",
  "description",
  "updatedAt"
FROM "PriceConfig"
WHERE "serviceKey" IN ('print_bw_page', 'print_color_page')
ORDER BY "serviceKey";
```

确认当前模式（见部署矩阵）：

| 模式 | 期望 `unitCents` | 支付 / 门禁 |
| --- | --- | --- |
| FREE_MODE 免费试运营 | 黑白 / 彩色均为 `0` | 支付 disabled；`PRINT_REQUIRE_PAID_BEFORE_CLAIM=true` |
| 有人值守线下收款 | `>0`（运营拍板金额） | 支付 disabled；门禁 true；Admin mark-paid |
| Live 支付后出纸 | `>0`（运营拍板金额） | live provider；门禁 true |

金额以**分**计（整数）。例：1.00 元/页 = `100`。

## 显式 upsert（人工执行）

将下列金额换成运营拍板值（单位：分。例：1.00 元/页 = `100`）。PostgreSQL：

```sql
-- FREE_MODE：两行 unitCents 均写 0
-- 有人值守 / live：写运营拍板正价（勿用开发默认 20/50，除非运营明确采用）

INSERT INTO "PriceConfig" (
  "id", "serviceKey", "unitCents", "unit", "active", "effectiveFrom", "description", "createdAt", "updatedAt"
) VALUES (
  'pc_ops_print_bw_page',
  'print_bw_page',
  0,  -- ← 换成拍板分价
  'page',
  true,
  NOW(),
  '黑白打印每页（运营价）',
  NOW(),
  NOW()
)
ON CONFLICT ("serviceKey") DO UPDATE SET
  "unitCents" = EXCLUDED."unitCents",
  "unit" = 'page',
  "active" = true,
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();

INSERT INTO "PriceConfig" (
  "id", "serviceKey", "unitCents", "unit", "active", "effectiveFrom", "description", "createdAt", "updatedAt"
) VALUES (
  'pc_ops_print_color_page',
  'print_color_page',
  0,  -- ← 换成拍板分价
  'page',
  true,
  NOW(),
  '彩色打印每页（运营价）',
  NOW(),
  NOW()
)
ON CONFLICT ("serviceKey") DO UPDATE SET
  "unitCents" = EXCLUDED."unitCents",
  "unit" = 'page',
  "active" = true,
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
```

说明：`id` 仅在**首次插入**时使用；若行已存在，`ON CONFLICT` 只更新价目字段，不会改已有 `id`。`effectiveFrom` 写入 `NOW()` 仅作审计备注，**计价逻辑不读它**。

写入后立刻再跑一遍「写入前只读核对」SQL，确认 `unitCents` / `active` 与拍板一致。

## 报价冒烟（只读金额，不强制出纸）

1. 用已知页数的本系统签名 `fileUrl` 调 `POST /api/v1/orders/quote`。
2. 核对 `amountCents == unitCents × billablePages × copies`（自定义 `pageRange` 时 `billablePages` 为选中页数）。
3. 可选：建一单无个人信息测试任务，核对建单响应 `amountCents` 与报价一致；是否出纸另按部署矩阵。

## 变更记录模板（写入私有证据目录，勿把密钥/连接串提交 Git）

```text
date:
operator:
target_env: production | preprod
mode: FREE_MODE | offline_staffed | live_wechat
before:
  print_bw_page.unitCents=
  print_color_page.unitCents=
after:
  print_bw_page.unitCents=
  print_color_page.unitCents=
quote_smoke: amountCents= / billablePages= / copies= / orderNo(optional)=
notes:
```

## 代码侧防回退

- `services/api/src/payment/price-config.seed.ts`：`assertDevPriceSeedAllowed` + `DEV_PRICE_SEED_FORBIDDEN_IN_PRODUCTION`
- `verify:pricing`：运行时断言 `NODE_ENV=production` 时 seed 抛错
- `verify:print-rollout-config`：静态断言 seed 含生产禁跑，且 `PricingService` 不读 `effectiveFrom`
