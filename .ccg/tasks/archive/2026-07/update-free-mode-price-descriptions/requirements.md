# 生产 FREE_MODE 价目说明文案诚实化

## 已授权

- 仅通过生产 Admin「计费与对账」合法路径修改 `print_bw_page` 与 `print_color_page` 的说明文案。
- 黑白说明目标：`免费试运营：黑白打印 0 元/页`。
- 彩色说明目标：`免费试运营：彩色打印 0 元/页`。
- 先在当前独立 worktree 补齐 Admin 价目说明编辑能力、验证和本地提交；暂不部署、不改生产。

## 必须保持

- 两项 `unitCents=0`、`active=true`。
- `PAYMENT_PROVIDER=disabled`，支付渠道为空。
- `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`。
- KSK-001 `enabled/online/ready`、活动任务为 0、health 正常。

## 禁止

- 不建单、不打印、不改金额、支付、env、账号或数据库。
- 不重启或 reload 服务。
- 不读取或输出密码、token、cookie、密钥、签名 URL 或完整原始日志。
- 任一写前门禁漂移，或 Admin 表单不能只修改说明时，立即停止。

## 写前发现

- 生产 Admin `/billing` 当前只暴露单价输入与启停按钮，没有 description 编辑控件。
- 后端 DTO / 服务与 Admin API client 已支持 `description`，缺口仅在 Admin 页面交互层。
- 因页面不能只修改说明，本轮按停止条件未提交任何生产写操作。
- 用户已批准采用“每行内联说明输入 + 独立保存说明按钮”方案；说明编辑状态与单价编辑状态隔离，请求体只含 `description`。
