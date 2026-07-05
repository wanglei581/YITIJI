# 打印链路上线部署矩阵

## 当前已验证

- Kiosk upload returns internal HMAC content URL.
- `/print/jobs` rejects external COS URLs.
- Preprod real `/print/jobs` probe returned HTTP 201.
- `ptask_kiosk_d984636a0f04a23a` was claimed by `t_ksk_001` and patched `completed`.
- Windows Agent local DB/logs prove system chain completion.
- Physical paper output is not confirmed.

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

上述证据只能证明系统链路已跑通到状态完成，不等同于物理纸张已经输出。首次终端 rollout 前仍需现场确认真实打印机出纸、纸张方向、份数、色彩/黑白策略、失败重试和异常提示。
