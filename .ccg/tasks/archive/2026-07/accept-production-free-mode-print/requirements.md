# 生产 FREE_MODE 单笔验收边界

## 已授权

- 使用生产现有 `sample-visible.pdf` 一页最小样张；已只读检查为 1 页、866 bytes，正文仅含通用链路测试说明，不含个人信息。
- 通过生产正式 Kiosk/API 链路创建且仅创建 1 笔零元打印订单。
- 允许 KSK-001 Agent claim 并真实打印 1 页。

## 必须满足

- F1-F4 全部通过。
- KSK-001 enabled、online、printer ready。
- 活动任务 0；现场 Windows 打印队列为空。
- 现场人员在 KSK-001 旁观察并确认真实出纸。
- 建单必须返回 `amountCents=0`、`payStatus=paid`、`paymentSource=free` 或等效语义。
- 建单原始响应包含短期 `paymentSessionToken`；只能字段级提取安全证据，禁止输出或持久化原始响应。
- 最终任务 `completed`，打印队列恢复为空。
- 后台 `completed` 不等于物理出纸；必须由现场人员目视确认真实出纸。

## 禁止

- 不使用真实用户文件或个人信息。
- 不读取、输出 token、cookie、密码、密钥、签名 URL 或完整原始日志。
- 不直改数据库，不创建账号，不改价格、支付或 env，不重启服务。
- 不创建第二单；任一停止条件命中立即停止。

## 停止条件

- 现场人员未确认在位。
- F1-F4 漂移、活动任务非 0、Windows 队列非空、Agent 或打印机非 ready。
- 上传/建单响应不满足内部 HMAC URL 与零元免费语义。
- Agent 未在安全时间窗内 claim，或出现 failed/error/队列残留。
- 免费单为 `paid/free`，不适用 `close-unpaid`；失败后保留唯一一单证据，不重试、不建第二单、不直改状态。
