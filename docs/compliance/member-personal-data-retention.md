# 会员个人数据留存矩阵

> 适用范围：Kiosk C 端会员手机号登录后的个人数据、本人资产、浏览/外部跳转记录和 AI 服务结果。

本系统是 AI 求职打印服务终端，不是招聘平台。会员数据只用于本人登录、本人资产查看、本人 AI/打印服务记录和服务质量闭环；不记录投递结果、预约结果、企业筛选、面试邀约、Offer 或候选人处理状态。

## 留存矩阵

| 数据类别 | 存储位置 | 默认留存 | 清理 / 删除 | 边界 |
| --- | --- | --- | --- | --- |
| 短信验证码 | Redis `member:sms:code:*` | 5 分钟 | 验证成功、超限或 TTL 到期删除 | 不返回前端；生产环境禁止日志短信通道 |
| 会员会话 | Redis `member:session:*` + JWT `jti` | 30 分钟 | 登出、账号禁用、Redis TTL 到期删除 | token 只存 Kiosk React 内存，不写浏览器存储 |
| 手机号身份 | PostgreSQL / SQLite `EndUser.phoneHash`、`phoneEnc` | 账号存在期间 | 账号治理流程处理；页面只展示脱敏手机号 | 不保存手机号明文字段 |
| 我的简历 / 文档文件 | 私有对象存储 + `FileObject` | normal 24 小时、sensitive 6 小时、高敏文件 1 小时 | 文件 TTL 清理；本人可删除；删除动作留审计 | 签名 URL 访问，不暴露对象存储真实地址 |
| 签名 URL | HMAC / COS 预签名 URL | 不超过 30 分钟 | URL 到期失效 | 仅本人 token 换取，不在列表接口直接返回长期链接 |
| AI 简历结果 | `AiResumeResult` | 默认 24 小时 | 到期 cron 硬删；本人可删除关联记录 | 不长期保存简历派生文本 |
| 模拟面试记录 | `MockInterviewSession` / `MockInterviewReport` | 匿名 2 小时；会员模拟面试 7 天 | 到期 cron 硬删；本人可删除 | 报告原文不写日志，不进入审计 payload |
| 浏览记录 | `BrowseLog` | 默认 30 天 | 到期 cron 硬删；本人可删除 | 只记录本人浏览了哪个已发布目标 |
| 外部跳转记录 | `ExternalJumpLog` | 默认 30 天 | 到期 cron 硬删；本人可删除 | 只记录打开来源平台入口，不记录投递/预约结果 |
| 收藏记录 | `Favorite` | 账号存在期间 | 本人取消收藏即删除 | 收藏目标必须已审核已发布，标题由服务端派生 |
| 打印订单元数据 | `PrintTask` 本人关联字段 | 业务留痕期，当前只返回安全元数据 | 后续生产策略按财务/审计要求收口 | 不在“我的打印订单”返回文件 URL、哈希、支付敏感字段 |
| 反馈与通知 | `FeedbackTicket` / `MemberNotification` | 服务处理期 | 本人可查看；处理完成后按运营规则归档 | 只用于设备、打印、文件处理和一般建议反馈 |

## 当前验证门禁

- `verify:member-auth`：验证码、手机号脱敏、会话 logout、禁用账号旧 session fail-closed。
- `verify:member-assets` / `verify:member-assets-c2d`：本人资产隔离、列表不返回 payload / 原文 / 存储 key。
- `verify:member-favorites-benefits`：收藏跨用户隔离、已发布目标校验、服务端派生标题。
- `verify:activity-logs`：浏览 / 外部跳转只记本人、目标必须已发布、TTL 清理。
- `verify:member-print-orders`：我的打印订单只返回安全元数据。
- `verify:member-data-retention`：本矩阵与关键 TTL 常量保持一致。
