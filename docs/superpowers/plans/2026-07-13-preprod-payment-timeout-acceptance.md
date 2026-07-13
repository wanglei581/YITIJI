# 预发布未付款超时与出纸门控验收方案

**目标**：在不触碰生产订单、打印任务、真实支付凭证或 Windows Agent 的前提下，验证已部署生产版本 `2723d4f5194906005b88558423d17f698c00c99f` 的付费打印订单在无人付款时会正确过期，并且不能被终端领取、不会出纸。

**范围与边界**：

- 仅在服务器 `120.48.13.190` 上创建短生命周期预发布实例；生产 PM2 进程、`ai_job_print` 数据库、Nginx 和真实终端 `KSK-001` 不修改。
- 使用 `PAYMENT_PROVIDER=sandbox`、临时随机会话/签名密钥、独立文件目录；不读取、复制、输出或使用微信/支付宝的生产密钥。
- 使用新建的 `KSK-PREPROD-TIMEOUT-20260713` 测试终端和伪造 Agent token，但绝不启动 Terminal Agent、绝不连接打印机。
- 运行代码从生产已验收提交 `2723d4f5` 构建，避免把尚未部署的 `main` 代码误当作生产验收对象。
- 临时 API 监听 `3011`；由于当前 Nest 启动代码默认监听所有网卡，启动前添加两条精确的临时规则：仅允许 `lo` 到 `3011`，拒绝其余进入 `3011` 的流量。停止后按相反顺序删除，且要验证规则已不存在。

## 已核实的事实

1. `OnlinePaymentService.applyLazyExpiry` 会把过期的 `PaymentAttempt(created|pending)` 改成 `expired`；订单过期时将 `Order.payStatus` 改成 `closed`。它不取消 `PrintTask`。
2. `PrintJobsService.create` 会在创建付费订单前先写入 `PrintTask.status=pending`，因此禁止在生产环境制造未付款订单。
3. `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true` 时，`TerminalsService.claimTasks` 只允许领取无订单任务或关联订单 `payStatus=paid` 的 pending 任务。
4. 2026-07-13 预检：Redis DB 15 为零键；端口 3011 未监听；`/srv` 可用空间约 20 GB；应用数据库角色无建库权限。因此用本机 PostgreSQL 管理角色建独立库，再交给应用角色使用。

## 执行步骤

### 1. 只读前置断言

在服务器上记录而不修改以下值：

- 生产 PM2 应用的 `pm_cwd`、`exec_path`、生产 `DEPLOY_SOURCE.txt`；必须仍指向当前生产发布目录和 `2723d4f5`。
- 生产库的活跃打印任务清单（ID、状态、终端、订单状态）必须先留档，且测试库不存在。若存在 `claimed` 或 `printing` 任务则停止；孤立的 `pending + unpaid` 任务允许作为只读基线，但整个过程中不得改变它，也不得对其发起领取、取消、支付或任何写操作。
- Redis DB 15 仍为空、3011 仍无人监听、没有现存的同名防火墙规则。

任一隔离断言失败即停止，不复用已有库、端口、Redis 库或规则。生产基线任务在收尾时必须逐字段保持不变；不满足则按生产事件处理，不继续测试。

### 2. 创建完全隔离的运行面

创建下列短生命周期资源（名字必须完全匹配，便于精确回收）：

- PostgreSQL 数据库：`ai_job_print_preprod_timeout_20260713`，所有者为应用数据库角色。
- 发布目录：`/srv/ai-job-print-preprod-timeout-20260713`，内容由 `git archive 2723d4f5` 解包。
- 本地文件目录：`/srv/ai-job-print-preprod-timeout-20260713/storage`。
- Redis DB：15（仅在确认 `DBSIZE=0` 后使用）。
- PM2 应用：`ai-job-print-preprod-timeout-20260713`，端口 3011。

在发布目录构建 API，使用 PostgreSQL schema 迁移，并写入仅含以下类别配置的 `services/api/.env`：隔离 `DATABASE_URL` / Redis DB 15、`NODE_ENV=staging`、`PORT=3011`、`FILE_STORAGE_DRIVER=local`、独立 `FILE_STORAGE_DIR`、随机 JWT/文件签名/终端/会话密钥、`SMS_PROVIDER=log`、`AI_PROVIDER=mock`、`OCR_PROVIDER=disabled`、`PAYMENT_PROVIDER=sandbox`、`SANDBOX_PAYMENT_SECRET`、`PAYMENT_QR_TTL_SECONDS=30`、`PAYMENT_ORDER_TTL_SECONDS=30`、`PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`。二维码 TTL 的代码下限为 30 秒，较小值会安全回退到默认 300 秒，不能用于本验收。

配置文件权限必须为 `0600`，命令输出不得回显连接串或任何秘密。真实支付、COS、OCR、LLM 与短信凭证一律不写入此文件。

### 3. 最小业务夹具与启动检查

仅向独立数据库写入：

- 一个启用的测试终端 `KSK-PREPROD-TIMEOUT-20260713`，唯一随机 token，且不写任何真实打印机信息。
- 两条 active 价目：`print_bw_page` 与 `print_color_page`，金额均大于零，确保测试走真实付费订单而不是免费单。

启动前插入精确防火墙规则，启动预发布 PM2 应用后仅用 `curl http://127.0.0.1:3011/api/v1/payment/channels` 做健康检查。断言只返回 `sandbox` 渠道；若出现 `wechat` 或 `alipay`，立即停止并执行清理。

### 4. 无支付超时用例

1. 从预发布自身 `GET /api/v1/test/sample-visible.pdf` 取得一页测试 PDF，再通过 `POST /api/v1/files/kiosk-upload` 上传；文件内容不包含个人信息。
2. 用该接口返回的 `signedUrl`、测试终端 header 和黑白单页参数调用 `POST /api/v1/print/jobs`；保存返回的测试 `taskId`、`orderId`、会话 token（仅保存在进程内/受限临时文件，绝不输出）。
3. 调用 `POST /api/v1/orders/:id/pay` 创建 sandbox 二维码。**不得**扫描二维码、不得调用 `payment/sandbox/simulate`、不得调用回调或人工核实接口。
4. 等待超过 30 秒，再调用 `GET /api/v1/orders/:id/pay-status` 触发惰性过期。
5. 用测试终端的 Bearer token 调用 `POST /api/v1/terminals/:id/tasks/claim`，`maxTasks=1`。

验收断言全部成立才通过：

- `PaymentAttempt.status=expired`；
- `Order.payStatus=closed`；
- `PrintTask.status=pending`（已知当前模型的未取消语义）；
- 领取响应为 `[]`，并复查任务没有 `claimedAt`；
- 预发布服务器没有启动 Terminal Agent、没有调用任何真实支付网关、没有任何物理打印行为。

### 5. 收尾、回滚与生产不变性复核

无论通过、失败或中断，均按以下顺序清理：

1. 停止并删除预发布 PM2 应用；确认 3011 不再监听。
2. 删除两条临时 3011 防火墙规则，重新列出规则确认不存在。
3. 删除预发布发布目录和本地 storage 目录（只允许精确路径）。
4. 在无连接后删除 `ai_job_print_preprod_timeout_20260713` 数据库。
5. 再次确认 Redis DB 15 只含本测试数据后执行 `FLUSHDB`，并确认 `DBSIZE=0`。
6. 复查生产 PM2、生产 `DEPLOY_SOURCE.txt`、生产数据库基线任务清单和 `KSK-001` 最近状态均未变化。

若任一步失败，保留隔离实例和最小日志证据，停止继续操作；不得用生产库、生产 Redis DB 0 或真实终端作为替代。

## 交付证据

- 生产不变性前后快照（不含连接串或密钥）。
- 预发布发布提交、健康检查渠道、测试订单/尝试/任务状态和空领取响应。
- 清理证明：PM2 不存在、端口未监听、Redis DB 15 为零键、测试库和目录已删除、临时防火墙规则不存在。
- 结论必须明确区分：本次证明“无人付款超时 + paid-before-claim 阻断”；不重做已完成的真实微信支付/自动跳转/物理出纸验收。

## 2026-07-13 执行记录

- 隔离前记录生产发布身份与活跃任务基线；当时有一条既有 `pending + unpaid` 任务，但无 `claimed` / `printing` 任务，因此按本方案只读保留该基线，未对其执行领取、取消、支付或任何写操作。
- 使用生产已验收提交 `2723d4f5` 建立独立 PostgreSQL 库、Redis DB 15、端口 3011、PM2 与本地 storage；健康检查仅返回 `sandbox`。API 冷启动超过初始 2 秒探针后恢复正常，后续改为条件轮询，不把冷启动误判为失败。
- 首次夹具请求因缺少完整 `PrintJobParamsDto` 必填打印参数返回 400；修正测试请求后才建单。首次 TTL 使用 `20`，发现低于代码下限而安全回退到 300 秒；已将两个 TTL 改为 30 秒、重启隔离实例并重新完整执行。以上两次尝试均只存在于随后删除的测试库中。
- 最终无支付用例在不扫码、不调用模拟支付、回调或人工核实、且未启动 Agent 的条件下得到：`PaymentAttempt.status=expired`、`Order.payStatus=closed`、`PrintTask.status=pending` / `claimedAt=null`。领取接口需要终端主键而非终端编码；用正确测试终端主键调用后响应为 `[]`。
- 收尾已删除同名 PM2、3011 监听与两条临时防火墙规则、发布 / storage 目录、独立数据库，并确认 Redis DB 15 为零键。随后复核生产仍为 `2723d4f5`，且先前记录的生产基线任务未变化。

**结论**：本次只验证“无人付款超时 + paid-before-claim 阻断”，不验证未支付 `PrintTask` 的自动关闭，也不构成生产超时、真实支付、物理出纸或运营模式验收。
