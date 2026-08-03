# F1 D2′ Fresh Retake 审查记录

## 结论

- retake verdict：`NO-GO`。
- full drill：唯一一次调用，exit `2`，输出 `D2_PRIME_NO_GO_ENVIRONMENT`。
- evidence：授权的精确文件未生成；独立 verifier 因 evidence absent 记 exit `2`。
- production：`productionF1=NO-GO`；未进入 D3–D6。
- 重跑：本窗口未重跑，后续也不得在没有新授权时重跑。

## 前置事实

- 现有本地非生产 Colima；未新增云主机或第二个虚拟机。
- guest fresh clone 的 `HEAD` 与 `origin/main` 均为 `e721f87a866525726ab83add248631b5940a0f34`，Git clean，无实际 `.env`。
- `pnpm install --frozen-lockfile`、API fresh build、`verify:d2-same-host-contract` 均通过。
- 最终前置检查时间 `2026-07-30T23:04:25+08:00`；证据/工作目录 mode `0700`、owner `wanglei`，精确 evidence 文件不存在；保留端口、D2 unit/进程/runtime root 均为空。

## 根因

在外层 `env -i` 仅保留 `PATH`、`HOME` 与 D2 精确路径时，候选 `run.sh` 在生成 nonce 与创建 D2 资源前调用 `systemctl --user show-environment`。同一 guest 的只读差分为：

- 未传 `XDG_RUNTIME_DIR`：exit `1`。
- 传 `XDG_RUNTIME_DIR=/run/user/501`：exit `0`。
- 正常 guest 环境的 `XDG_RUNTIME_DIR=/run/user/501`，`DBUS_SESSION_BUS_ADDRESS` 为空，user systemd 仍正常。

源码还显示第二层缺口：`run.sh` 启动 `drill.mjs` 的内层 `env -i` 未传 XDG，`drill.mjs` 给 `systemctl --user` 的 `systemEnvironment` 也只有 `PATH` / `HOME`。因此只改下一次调用命令只能通过入口闸门，仍会在资源创建后的内层 systemctl 测量失败。正确后续是独立代码任务自派生、校验并端到端传递 `/run/user/<uid>`，补 RED→GREEN 合同；本任务不实施该修复。

## 清理与安全

- `3010`、`3011`、`18080`：FREE。
- D2 / preflight user units：0。
- D2 processes、PM2 daemons、default PM2 pidfile/pub.sock/rpc.sock：0 / absent。
- `/run/user/501/d2p-*`：0；work entries：0。
- fresh guest clone：clean。
- 未连接 production、未 SSH、未访问生产数据库/Redis/对象存储/密钥、未部署、未 migration/DDL/seed、未启动第二 worker/cron/consumer。
- 旧 NO-GO evidence 未读取、复用或改写。

## 多模型复审

- Antigravity：确认 NO-GO、零残留与 `productionF1=NO-GO`；初步建议只修执行调用。
- Claude：确认 NO-GO 与根因证据，进一步指出内层 `env -i` / `drill.mjs` 也缺 XDG，因此必须代码修复后再申请新授权；`APPROVE` 本次 NO-GO 处理，不批准未来重跑。
- Cursor 客户端：逐行复核后同意 Claude 的两层缺口，给出 `REQUEST_CHANGES`（针对未来候选），确认本次 NO-GO 不可翻案且 `productionF1=NO-GO`。
- Codex 综合：源码支持 Claude/Cursor；Antigravity 的 caller-only 修法不足。复审期间外部模型违反只读要求向 host worktree 写入未提交草案；该草案不属于 exact candidate 且包含不适用于 Colima 的 `/run/user/<uid>/bus` 假设，已用 `apply_patch` 完全撤销，并以 `git hash-object` 复核三个候选文件恢复到 HEAD blob。未将该草案计入交付。
