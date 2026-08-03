# F1 D2′ XDG user-systemd 执行契约复审

## 最终结论

- Critical：0
- Warning：0
- Info：不阻断
- Verdict：APPROVE / NO FINDINGS

## 已关闭的问题

1. 外层 `run.sh` 依赖 caller 的 `XDG_RUNTIME_DIR`。
2. 内层 `env -i` 启动 `drill.mjs` 时丢失 XDG。
3. `drill.mjs` 的 `systemEnvironment` 只有 `PATH` / `HOME`。
4. 初版静态合同可被注释诱饵、校验后移或错误 environment 数据流绕过。
5. 初版 bus 禁止规则遗漏动态 UID 路径与命令分隔空白变体。

## 最终门禁

- `run.sh` 自派生并校验 exact `/run/user/$(id -u)`，在首个 user-systemd 前导出。
- PM2 runtime root 复用受信 XDG。
- inner `env -i` 显式传 XDG。
- `drill.mjs` 再校验 owned / exact UID / mode，并让 5 个 `systemdValue` 调用全部使用 `systemEnvironment`。
- 禁止 `DBUS_SESSION_BUS_ADDRESS`、`/run/user/<uid>/bus` 和特定 socket 拓扑。
- 恶意变体覆盖注释诱饵、校验后移、提前 systemd（缩进/单空格/双空格/Tab）、漏 inner XDG、错误 environment、固定/动态 UID bus。

## 验证

- offline contract：PASS
- Bash / Node syntax：PASS
- API lint：PASS
- API typecheck：PASS
- API build：PASS
- `git diff --check`：PASS
- D2′ full drill：未运行
- Colima：未启动
- production：未连接

## 模型复审

- Claude：最终 NO FINDINGS
- Antigravity：最终 NO FINDINGS / APPROVE
- Cursor：最终 NO FINDINGS
- Codex independent reviewer：最终 NO FINDINGS
