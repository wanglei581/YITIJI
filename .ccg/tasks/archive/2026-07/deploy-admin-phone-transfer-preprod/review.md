# 阶段审查

## 已通过

- 候选严格来自 `origin/main@3c5b5a55`，Admin 专项 verifier、18/18 状态机覆盖率门禁、typecheck、lint、HTTP production build 全部通过。
- 只替换预生产 Admin dist；未重启 API、未迁移数据库、未修改 Redis / SMS / Kiosk / Partner / Terminal Agent。
- 旧 dist 同时保留压缩备份和回滚目录；错误探针两次触发自动恢复，最终按实际 Admin 域名完成切换。
- 公网 Admin HTML / JS 200，health `ok/postgres`，PM2 pid 与 restart count 不变。
- 公网真实静态包的受控浏览器 mock 走查确认安全转移提示、最后启用账号禁删、账号设置跳转与转移表单，控制台 0 error。

## 未执行

- `admin` 已通过正式接口从强随机临时密码自助改为强随机长期密码，`passwordProofState=owner_managed`，真实重新登录通过；长期密码仅存本机钥匙串。
- 已在用户明确授权下向 `183****1921` 发送 `transfer_phone` 真实验证码；start 返回的唯一来源为已停用机构账号 `wa***ei` / 机构「的撒的」，ticket 与 JWT 仅存本机钥匙串。
- 尚待用户在 5 分钟内提供 OTP；未执行 verify，手机号归属尚未改变。

## 真实转移验收

- 用户明确授权手机号 `183****1921`、管理员账号 `admin`、真实短信与真实转移。
- `admin` 已通过正式自助改密接口从随机临时密码改为随机长期密码，`passwordProofState=owner_managed`，转移 start 使用长期密码。
- 腾讯短信真实下发；用户提供 OTP 后 `auth.phone_transfer_complete` 成功。
- `admin` 已绑定并验证目标手机号；原 Partner 已清空手机身份字段且继续停用。
- Admin / Partner 会话状态缓存版本与数据库一致；审计不含密码、OTP、ticket、token 或手机号明文。
- 转移 ticket/JWT 本机钥匙串上下文已删除；转移后重新登录、`/auth/me`、health `ok/postgres` 通过。
- 首次 verify 在本机解析十六进制钥匙串上下文时失败，未请求服务器；错误输出曾包含十六进制编码的临时上下文。正式 verify 后 ticket 已消费，Admin 会话版本已递增，相关 JWT/ticket 已失效并清理。

## 结论

Admin-only 预生产部署与真实手机号安全转移 E2E 均通过。Antigravity 94/100 APPROVE、Claude APPROVE，均无 Critical；两者确认十六进制历史上下文所含 ticket 已消费、JWT 已因 `tokenVersion` 递增失效，不阻塞交付。当前 Codex 任务历史属于应用托管记录，未擅自篡改或删除；后续受控运维脚本必须避免把钥匙串长数据直接送入 JSON 解析错误输出。
