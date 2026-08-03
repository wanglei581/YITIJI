# F1 D2′ XDG user-systemd 执行契约修复

## 真实目标

修复 `main@7b33447d` 中 D2′ 演练器在净化 `env -i` 环境下无法连接 user systemd 的两层缺口，使脚本自行派生、校验并贯穿可信 `/run/user/<uid>`，且离线合同能阻止 caller-only 假修复回归。

## 允许修改

- `services/api/scripts/d2-same-host/run.sh`
- `services/api/scripts/d2-same-host/drill.mjs`
- `services/api/scripts/d2-same-host/verify-contract.mjs`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本任务的 `.ccg/tasks/` 记录

## 禁止

- 不执行 D2′ full drill，不生成新 nonce/evidence，不启动 Colima。
- 不连接 production，不 SSH，不访问数据库、Redis、对象存储、密钥或业务数据。
- 不部署，不进入 D3–D6，不修改 PM2/Nginx/production systemd。
- 不接受 caller-only 的 `XDG_RUNTIME_DIR` 透传作为完整修复。
- 不引入对 Colima 中不存在的 `/run/user/<uid>/bus` 的错误强依赖；只使用已验证可工作的 user-systemd 连接语义。
- 不扩大到 cgroup、rollback、stage marker 或其他无关重构。

## 验收标准

- RED：现有候选的离线合同新增断言后明确失败，证明入口与内层 XDG 传播均缺失。
- GREEN：`run.sh` 自派生并严格校验 `/run/user/$(id -u)`，在入口 systemctl、内层 `env -i` 和 `drill.mjs` systemctl 环境中一致传递。
- 安全：不信任 caller 提供的任意 XDG 路径；不要求 `DBUS_SESSION_BUS_ADDRESS`；不读取或输出秘密。
- 验证：offline contract、Shell/Node 语法、API typecheck/lint/build、`git diff --check` 全部通过。
- Claude、Antigravity、Cursor 完成修复后复审；Critical/High 关闭。
- 只证明代码与离线门禁完成，`D2′` 和 `productionF1` 继续 `NO-GO`，新的 retake 必须另行授权。
