# 打印链路上线部署矩阵

## 当前已验证

- Kiosk upload returns internal HMAC content URL.
- `/print/jobs` rejects external COS URLs.
- Preprod real `/print/jobs` probe returned HTTP 201.
- `ptask_kiosk_d984636a0f04a23a` was claimed by `t_ksk_001` and patched `completed`.
- Windows Agent local DB/logs prove system chain completion.
- 2026-07-06 field evidence confirms physical paper output by printer counter + PrintService: `TotalPagesPrinted` 27→28 direct smoke, 28→29 Kiosk `/files/kiosk-upload -> /print/jobs`; PrintService Event ID 307 / 842 on `Pantum CM2800ADN Series` / `USB001`.

## 当前决策状态

- Physical paper output: confirmed by counter + PrintService. No visual photo/video was attached; if site staff did not actually see paper, mark the field result failed.
- Commercial rollout mode: not decided.
- Recommended first terminal mode: `FREE_MODE` only.
- Runtime blocker: earlier preprod probes observed `PRINT_REQUIRE_PAID_BEFORE_CLAIM` unset, so unpaid completion remains non-commercial evidence only.

## 安全部署组合

| 模式 | 价格配置 | 支付配置 | 出纸门禁 | 用户路径 | 部署判断 |
| --- | --- | --- | --- | --- | --- |
| 免费试运营 | `PriceConfig.unitCents=0` | `PAYMENT_PROVIDER` unset/disabled | `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true` | does not enter cashier | recommended |
| 有人值守线下收款 | `unitCents>0` | payment disabled | gate true | cashier waits for Admin mark-paid | supervised only |
| Live 支付后出纸 | `unitCents>0` | live provider | gate true | cashier paid then progress | C5-6 only |

## 禁止部署组合

| 组合 | 风险 | 处理结论 |
| --- | --- | --- |
| 正价 + 无 live 支付 + 无线下 mark-paid SOP | cashier stuck | 禁止用于首台终端试运营；必须先补齐 live 支付或线下 mark-paid 值守 SOP。 |
| 正价 + gate false | unpaid may print | 禁止上线；正价模式必须保持 claim 前已支付门禁。 |
| production + sandbox | runtime should reject startup | 禁止混用；生产运行时不应以 sandbox 支付配置启动。 |
| Missing PriceConfig treated as free | wrong, it fail-closes | 禁止按免费处理；缺少有效价格配置时应 fail-close，不进入打印。 |

## 当前推荐

首台终端试运营使用免费模式：

- 明确写入并启用 active zero prices，确保相关 `PriceConfig.unitCents=0`。
- `PAYMENT_PROVIDER` unset/disabled，不进入 live 支付或 sandbox 支付路径。
- `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`，保持 claim 前门禁开启。
- 现场只观察上传、建单、终端 claim、状态回传和纸张输出，不在首轮试运营中验证 C5-6 live payment。

## FREE_MODE 运行时复验门禁

以下四项必须同时成立，才允许把首台终端按免费试运营口径开放给真实用户。任何一项不满足，都不得开始试运营。

| Gate | 必须满足 | 不满足时处理 |
| --- | --- | --- |
| F1 价格 | `print_bw_page` 与 `print_color_page` 均存在 active `PriceConfig`，且 `unitCents=0` | 停止；不得把缺失价格当免费 |
| F2 支付 | `PAYMENT_PROVIDER` unset/disabled，且 `NODE_ENV=production` 下不使用 sandbox | 停止；不得让用户进入不可完成支付路径 |
| F3 出纸门禁 | `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true` | 停止；不得延续 unpaid 可 claim 的非商用验收口径 |
| F4 端点链路 | Kiosk 仍通过同源 `/api/v1`，`/print/jobs` 仍只接受内部 HMAC content URL | 停止；不得为 split-origin 放宽 SSRF 防线 |

只读复核建议：

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
ORDER BY "serviceKey", "updatedAt" DESC;
```

环境复核只记录 key 的状态，不记录真实密钥值：

```text
NODE_ENV=production
PAYMENT_PROVIDER unset/disabled
PRINT_REQUIRE_PAID_BEFORE_CLAIM=true
FILE_SIGNING_SECRET configured
PAYMENT_SESSION_SECRET configured
VITE_TERMINAL_ID=<target terminal id>
```

复验任务要求：

- 用 0 元价目创建一单无个人信息测试打印任务。
- 建单响应必须是 `amountCents=0`、`payStatus=paid`、`paymentSource=free` 或等效免费口径。
- Agent claim 后必须真实出纸，并回传 `completed`。
- 证据只保存脱敏摘要；不保存签名 URL、token、cookie、真实用户文件或原始日志到 Git。

禁止把此前 `payStatus=unpaid` 的预生产探针当作 FREE_MODE 复验通过。那些探针只证明 URL 契约、Agent claim、Windows PrintService 和物理出纸链路，不证明商用/试运营配置安全。

## 部署拓扑要求

- Kiosk 上传响应会把 `signedUrl` 重签为同源内部 HMAC content URL（`/api/v1/files/:id/content?expires&sig`），供预览与打印建单共用。
- 生产 / 预生产 Kiosk 必须通过同源反向代理暴露 `/api/v1`；如果 Kiosk 静态站与 API 拆成不同 origin，前端预览会按 Kiosk origin 解析相对 URL 而失败。
- `/print/jobs` 仍只接受内部 HMAC URL；禁止为了兼容 split-origin 预览而放宽为接受 COS 外部 URL。

## 执行前只读检查

以下检查只读，不修改数据库、环境变量或运行时配置。

### PriceConfig

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

重点确认：

- 首台免费试运营场景存在显式 active zero prices。
- 不把缺失 `PriceConfig` 解释为免费；缺失或无 active 价格应 fail-close。
- 正价试运营前，确认是否已有 live 支付或线下 mark-paid SOP。

### 环境键

只查看以下 key 的存在和值来源，不在检查步骤中写入或覆盖：

```text
NODE_ENV
PAYMENT_PROVIDER
PRINT_REQUIRE_PAID_BEFORE_CLAIM
FILE_SIGNING_SECRET
VITE_TERMINAL_ID
```

重点确认：

- 生产环境不得使用 sandbox 支付配置。
- 免费试运营时 `PAYMENT_PROVIDER` 应 unset/disabled。
- `PRINT_REQUIRE_PAID_BEFORE_CLAIM` 应为 `true`。
- HMAC content URL 所需密钥已由受控密钥系统注入，不在文档、脚本或命令行中明文传递。

## 证据边界

系统链路完成的证据包括：Kiosk upload 返回内部 HMAC content URL、`/print/jobs` 接受内部 URL 并返回 HTTP 201、终端 `t_ksk_001` claim 到 `ptask_kiosk_d984636a0f04a23a`、Windows Agent 本地 DB/logs 记录任务完成并回传 `completed`。

物理出纸最小硬证据已由 2026-07-06 现场计数器 + PrintService 补齐；该结论不等同于 FREE_MODE 运行时配置已通过，也不等同于试运营授权。首次终端 rollout 前仍需按本文件完成运行时配置复验，并现场确认纸张方向、份数、色彩/黑白策略、失败重试和异常提示。
