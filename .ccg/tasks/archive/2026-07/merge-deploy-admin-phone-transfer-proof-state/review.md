# 合并与部署审查

## 结果

- PR #393 已 squash 合入 `main@50cbca15`。
- 预生产 API-only overlay 已部署并保持运行。
- Antigravity 终审：99/100，`KEEP DEPLOYED`，无 Critical/High。
- Claude 终审：`KEEP DEPLOYED`，无 Critical/High。

## 产物与来源

- 基础 API：`83f2117f`；目标 overlay：`50cbca15`。
- 当前与候选 dist 均为 1959 文件；逐文件 SHA-256 仅 `admin-phone-transfer.service.js` 与 `.js.map` 不同。
- artifact SHA-256：`a8c7f59dbb038e1c4f7556725f6bde11342d2c1f50c7b8a8ec1ab57331ad4f16`。
- 回滚点：`/srv/ai-job-print-api-backups/admin-phone-transfer-50cbca15-20260726T161733+0800`。

## 验证

- 候选行为级手机号转移 verifier：通过。
- API build：通过。
- PM2：online，restart `23→24` 后稳定。
- 本机与公网 health：`ok/postgres`。
- Admin / Kiosk / Partner：HTTP 200，bundle 名未变化。
- 运行 JS/map SHA 与候选一致；`node_modules` 未替换。
- 预生产只读 schema：`User.passwordProofState` 存在，为 `text NOT NULL DEFAULT legacy`。
- 远端隔离 verifier 因系统缺少 `sqlite3` CLI 在测试前 ENOENT；未安装系统包，由同字节本地 verifier 与 GitHub SQLite/真实 PostgreSQL CI 覆盖。

## 未执行

- 未运行 migration、seed、DP-GATE。
- 未修改 `.env`、数据库、Redis、短信配置、前端 dist、账号或手机号。
- 未调用真实认证/转移接口，未发送短信。
