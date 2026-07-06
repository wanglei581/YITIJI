# 支付上线生产环境变量逐项清单（W-D ④）

> **草案，未经真机/真实商户验证。** 2026-07-06 起草。
> 事实来源（代码为准）：`services/api/.env.example` 支付段、`services/api/src/config/production-runtime-gates.ts`、`services/api/src/payment/payment-provider.factory.ts`、`services/api/src/payment/providers/{wechat-pay,alipay}.provider.ts`、`services/api/src/payment/payment-session-token.ts`。
> 需求来源：`docs/product/payment-commercial-adaptation-plan-2026-07.md` §四 W-D ④。
> 密钥口径沿用 `docs/device/secret-rotation-runbook.md`：新值**只出现在生产服务器 `services/api/.env`**，不进仓库/聊天/本文件/日志。本文件**不写任何示例密钥值**。

---

## 0. 适用范围与前提

- 生产服务器：百度云 120.48.13.190，API 为 PM2 单实例监听 127.0.0.1:3010，`NODE_ENV=production`。
- 本清单只覆盖**支付域（C5-6 真实渠道）新增/变更**的变量，并列出启动门禁牵连的全局变量（§3）。全局变量的完整口径见 `docs/device/production-deployment-and-windows-host-checklist.md`。
- 启动门禁是 fail-closed：任何一项不满足，API **拒绝启动**（不是降级）。改完 env 后 `pm2 restart` 并看启动日志，无报错才算注入成功。

---

## 1. 支付域变量逐项清单

图例：注入责任人「王」= 只能由你在服务器控制台/编辑器操作；Claude/Codex 无法代做，也不得经聊天传递值。

### 1.1 通道总开关与公共配置

| 变量名 | 用途 | 取值来源 | 校验方式 | 注入责任人 |
|---|---|---|---|---|
| `PAYMENT_PROVIDER` | 启用哪些线上支付通道；逗号分隔可多通道 | 部署决策：`wechat` / `alipay` / `wechat,alipay`；未上线支付时留空或 `disabled` | 启动日志无 `PAYMENT_PROVIDER_INVALID` / `*_SANDBOX_*` 报错；`GET` 收银页可见对应通道 | 王 |
| `PAYMENT_NOTIFY_BASE_URL` | 渠道回调可达的公网 base；回调 URL = `{base}/api/v1/payment/callback/{wechat\|alipay}` | https 域名（见 nginx 草案）；生产**必须** `https://` 开头，不带尾斜线 | 启动无 `PAYMENT_NOTIFY_BASE_URL_*` 报错；`curl -i https://<域名>/api/v1/payment/callback/wechat`（POST 空体应返回 4xx 业务拒绝而非 502/超时） | 王 |
| `PAYMENT_SESSION_SECRET` | 打印建单后签发短期支付会话 token 的签名密钥 | 服务器上 `openssl rand -base64 48` 生成（T2 类，≥ 32 字符） | 启动无 `PRODUCTION_PAYMENT_SESSION_SECRET_INVALID`；收银页可正常出码 | 王 |
| `PRINT_REQUIRE_PAID_BEFORE_CLAIM` | 未支付订单能否被 Agent claim 出纸（先付后印门禁） | 部署决策，生产**必须显式写** `true` 或 `false`；启用 wechat/alipay 时**必须 `true`** | 启动无 `PRODUCTION_PAID_BEFORE_CLAIM_*` 报错；真机验证未支付单不出纸 | 王 |
| `PAYMENT_QR_TTL_SECONDS`（可选） | 动态码有效期，默认 300，范围 30–86400 | 留空用默认；调整须与收银页倒计时体验联动 | 收银页二维码过期倒计时符合预期 | 王 |
| `PAYMENT_ORDER_TTL_SECONDS`（可选） | 订单超时关单时限，默认 900，范围 30–86400 | 留空用默认 | 超时单自动 closed；可重新发起 | 王 |
| `SANDBOX_PAYMENT_SECRET` | 沙箱通道验签密钥 | **生产不需要、不应配置**（生产禁 sandbox） | 生产 `.env` 中确认此行不存在或留空 | 王 |

### 1.2 微信支付 Native（APIv3 公钥模式）

全部只存服务端；PEM 类变量二选一（`*_PEM` 内联需 `\n` 转义，或 `*_PATH` 指向服务器本地文件，文件权限建议 `600`、属主为 API 运行用户）。

| 变量名 | 用途 | 取值来源 | 校验方式 | 注入责任人 |
|---|---|---|---|---|
| `WECHAT_PAY_MCHID` | 商户号 | 微信支付商户平台（开户完成后分配） | 启动无 `WECHAT_PAY_CONFIG_INVALID: … mchid` | 王 |
| `WECHAT_PAY_APPID` | 与商户号绑定的 appid | 商户平台「APPID 账号管理」中已绑定的 appid（见商户开通清单） | 同上（appid 项）；1 分钱冒烟下单成功 | 王 |
| `WECHAT_PAY_MCH_SERIAL_NO` | 商户 API 证书序列号（请求签名 Authorization 用） | 商户平台「API 安全 → 申请 API 证书」后展示 | 同上（mchSerialNo 项）；冒烟请求不报签名错 | 王 |
| `WECHAT_PAY_PRIVATE_KEY_PEM` 或 `WECHAT_PAY_PRIVATE_KEY_PATH` | 商户 API 私钥（PKCS8 PEM，请求签名） | 申请 API 证书时下载的 `apiclient_key.pem` | PEM 内容必须含 `PRIVATE KEY` 字样，否则启动报缺；PATH 不可读报 `WECHAT_PAY_PRIVATE_KEY_PATH_UNREADABLE` | 王 |
| `WECHAT_PAY_APIV3_KEY` | APIv3 密钥（回调 resource AES-256-GCM 解密） | 商户平台「API 安全 → 设置 APIv3 密钥」自设 | **必须恰好 32 字节**（按 UTF-8 字节数校验），否则启动报 `apiV3Key(须 32 字节)` | 王 |
| `WECHAT_PAY_PUBLIC_KEY_PEM` 或 `WECHAT_PAY_PUBLIC_KEY_PATH` | 微信支付公钥（回调验签，公钥模式） | 商户平台「API 安全」下载微信支付公钥 | PEM 须含 `PUBLIC KEY`；回调验签通过（冒烟） | 王 |
| `WECHAT_PAY_PUBLIC_KEY_ID` | 微信支付公钥 ID（回调 `Wechatpay-Serial` 必须命中） | 商户平台公钥页展示（`PUB_KEY_ID_` 开头） | 冒烟回调不报 serial 不匹配 | 王 |
| `WECHAT_PAY_API_BASE`（可选） | 渠道网关 base | 默认官方 `https://api.mch.weixin.qq.com`，**生产不要改**（改动仅供 verify 脚本指向本地假网关） | 生产 `.env` 中确认未设置或为官方值 | 王 |

### 1.3 支付宝当面付（RSA2）

| 变量名 | 用途 | 取值来源 | 校验方式 | 注入责任人 |
|---|---|---|---|---|
| `ALIPAY_APP_ID` | 开放平台应用 APPID | 支付宝开放平台创建应用后分配 | 启动无 `ALIPAY_CONFIG_INVALID: … appId` | 王 |
| `ALIPAY_APP_PRIVATE_KEY_PEM` 或 `ALIPAY_APP_PRIVATE_KEY_PATH` | 应用私钥（PKCS8 PEM，请求签名） | 支付宝密钥工具本地生成（私钥**从不上传**） | PEM 须含 `PRIVATE KEY`；PATH 不可读报 `ALIPAY_APP_PRIVATE_KEY_PATH_UNREADABLE` | 王 |
| `ALIPAY_PUBLIC_KEY_PEM` 或 `ALIPAY_PUBLIC_KEY_PATH` | **支付宝公钥**（响应/notify 验签；不是应用公钥） | 开放平台应用「接口加签方式」页，上传应用公钥后展示的支付宝公钥（须选**公钥模式**，见待确认项） | PEM 须含 `PUBLIC KEY`；冒烟 notify 验签通过 | 王 |
| `ALIPAY_GATEWAY_URL`（可选） | 网关地址 | 默认官方 `https://openapi.alipay.com/gateway.do`，生产不要改 | 生产 `.env` 中确认未设置或为官方值 | 王 |

---

## 2. 启动门禁「错误配置对照表」（配错会怎样）

以下每一行都是**启动即拒**（`NODE_ENV=production` 下），错误码可在 `pm2 logs` 启动段直接 grep。

| 错误配置 | 门禁错误码 | 正确做法 |
|---|---|---|
| `PRINT_REQUIRE_PAID_BEFORE_CLAIM` 缺省/留空/写成 `1`、`yes` | `PRODUCTION_PAID_BEFORE_CLAIM_UNDECLARED` | 显式写 `true` 或 `false`（小写） |
| 启用 wechat/alipay 但 `PRINT_REQUIRE_PAID_BEFORE_CLAIM=false` | `PRODUCTION_PAID_BEFORE_CLAIM_REQUIRED` | 收真钱必须 `true`（先付后印，无豁免） |
| `PAYMENT_PROVIDER` 含 `sandbox`（生产） | `PRODUCTION_PAYMENT_PROVIDER_SANDBOX_FORBIDDEN`（gates 层）/ `PAYMENT_PROVIDER_SANDBOX_FORBIDDEN_IN_PRODUCTION`（工厂层） | 生产只允许 空/`disabled`/`wechat`/`alipay` |
| `PAYMENT_PROVIDER=sandbox,wechat` 之类混配（任何环境） | `PAYMENT_PROVIDER_SANDBOX_EXCLUSIVE` | 测试通道与真实资金通道绝不混跑 |
| `PAYMENT_PROVIDER` 写了未知值（如 `weixin`、`wxpay`） | `PAYMENT_PROVIDER_INVALID` | 仅 `sandbox`/`wechat`/`alipay` 三个合法通道名 |
| 启用真实通道但 `PAYMENT_NOTIFY_BASE_URL` 缺失 | `PAYMENT_NOTIFY_BASE_URL_MISSING` | 先完成 https 域名（见 nginx 草案）再启用通道 |
| `PAYMENT_NOTIFY_BASE_URL=http://…`（生产） | `PAYMENT_NOTIFY_BASE_URL_INSECURE` | 生产回调 base 必须 `https://` |
| `PAYMENT_NOTIFY_BASE_URL` 不是 http(s) URL | `PAYMENT_NOTIFY_BASE_URL_INVALID` | 填完整 `https://域名`（可含端口） |
| 微信任一关键项缺失（mchid/appid/序列号/私钥/公钥/公钥ID/notify base） | `WECHAT_PAY_CONFIG_INVALID: 缺失/非法配置项 …`（列出缺项名） | 按 §1.2 逐项补齐 |
| `WECHAT_PAY_APIV3_KEY` 不是恰好 32 字节 | `WECHAT_PAY_CONFIG_INVALID: … apiV3Key(须 32 字节)` | 商户平台设置的 APIv3 密钥原样粘贴（32 个 ASCII 字符） |
| 私钥/公钥 PEM 内容不含 `PRIVATE KEY`/`PUBLIC KEY` 标记（贴错文件、贴成证书 .pem 之外的内容） | 计入 `*_CONFIG_INVALID` 缺项 | 确认贴的是密钥 PEM 本体，内联时 `\n` 转义完整 |
| `*_PATH` 指向的文件不存在/无读权限 | `WECHAT_PAY_PRIVATE_KEY_PATH_UNREADABLE` 等 `${前缀}_PATH_UNREADABLE`（不回显路径内容） | 核对路径、属主与 `600` 权限 |
| 支付宝任一关键项缺失 | `ALIPAY_CONFIG_INVALID: 缺失/非法配置项 …` | 按 §1.3 逐项补齐 |
| `PAYMENT_SESSION_SECRET` 缺失或 < 32 字符 | `PRODUCTION_PAYMENT_SESSION_SECRET_INVALID` | `openssl rand -base64 48` 生成后填入；不得复用 `JWT_SECRET`/`FILE_SIGNING_SECRET` |

---

## 3. 同批启动门禁牵连的全局变量（复核，不属支付域新增）

生产启动门禁是一次性全量断言，支付上线重启时以下项同样必须满足（任一不满足同样拒启）：

| 变量 | 生产要求 |
|---|---|
| `JWT_SECRET` | 存在且 ≥ 16 字符（建议 ≥ 64） |
| `FILE_STORAGE_DRIVER` | 必须 `cos`（含 `TENCENT_COS_*` 四项） |
| `DATABASE_URL` | PostgreSQL 连接串；`file:` SQLite 硬拒 |
| `REDIS_URL` | 必须配置 |
| `SMS_PROVIDER` | 必须 `tencent`，且 `TENCENT_SMS_SECRET_ID/_KEY/_SDK_APP_ID/_SIGN_NAME/_TEMPLATE_ID` 五项齐全 |
| `OCR_PROVIDER` | 必须 `baidu`，且 `BAIDU_OCR_API_KEY/_SECRET_KEY` 齐全 |
| `AI_PROVIDER` | 必须 `llm`，且 `AI_LLM_API_KEY` 或 `TRTC_LLM_API_KEY` 至少一个 |

---

## 4. 密钥只进服务器 env 的操作口径（沿用 secret-rotation-runbook）

1. 执行者是王本人：在**渠道商户后台**获取/生成密钥材料 → 在**生产服务器** `services/api/.env` 填值 → `pm2 restart <api>`。Claude/Codex 均无法代做，也不得经聊天中转任何值。
2. 新值只出现在服务器：不进仓库、不进聊天、不进本文件、不进日志/审计（代码侧错误信息已保证不回显密钥与路径内容）。
3. `.env` 权限确认 `600`；PEM 走 `*_PATH` 方式时密钥文件同样 `600`，建议放 API 运行用户主目录下专用目录。
4. 配置过程不回显：编辑用 `vi`/`nano` 直接粘贴；避免 `echo "xxx" >> .env` 这类会进 shell history 的写法（或临时 `set +o history`）。
5. 类型归档（对齐 runbook §0）：微信/支付宝商户密钥与证书 = **T1 外部凭据**（渠道后台可重置/重新申请，重置后改 env 重启即可）；`PAYMENT_SESSION_SECRET` = **T2 本应用签名密钥**（换新导致已签发的短期支付会话 token 失效，用户重新进入收银页即可，可接受）。
6. 每次变更后按顺序验证：启动日志无 fail-closed 报错 → `pnpm --filter @ai-job-print/api verify:production-runtime-gates` → 1 分钱 live 冒烟（W-F，另见商户开通清单 §5）。
7. 回写 `docs/progress/current-progress.md`：只记录「已配置的变量名清单 + 日期 + 决策」，**不写任何值**。

---

## 5. 待确认项

| # | 事项 | 影响 |
|---|---|---|
| 1 | `PAYMENT_SESSION_SECRET` 在 `services/api/.env.example` 中**没有对应条目**（门禁与 `payment-session-token.ts` 均强制要求）——是文档缺口还是刻意省略，待确认；建议后续波次补进 `.env.example` | 部署者照 `.env.example` 逐项抄会漏配，启动被拒才发现 |
| 2 | 生产是否同时启用双通道（`wechat,alipay`）还是先单通道灰度，属部署决策，待确认 | 影响商户开通排期与冒烟范围 |
| 3 | `PAYMENT_QR_TTL_SECONDS` / `PAYMENT_ORDER_TTL_SECONDS` 生产取值是否沿用默认 300/900，待确认 | 体验/关单口径 |
| 4 | 微信商户号若为**老商户「平台证书模式」**，当前代码只支持公钥模式，需按方案文档 §六在 W-D 增补实现——商户开通时必须先确认模式 | 模式不符则回调验签全挂 |
