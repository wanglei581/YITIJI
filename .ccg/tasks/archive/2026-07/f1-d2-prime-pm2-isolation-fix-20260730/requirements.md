# F1 D2′ PM2 隔离修复范围

## 真实功能闭环 / 上线阻塞

修复 D2′ 非生产 Linux 演练器在仓库深路径下生成超长 PM2 Unix socket、PM2 CLI/daemon 挂起且
异常清理不完整的问题，使下一次独立授权的 full drill 能在安全、可终止、可清理的控制面上运行。
本任务只修复和验证演练器，不执行新的 full drill，不改变 production F1 NO-GO。

## 允许修改

- `services/api/scripts/d2-same-host/` 内与 PM2 路径、timeout、cleanup 直接相关的脚本和 offline contract。
- `services/api/package.json`（仅当需要新增现有脚本入口；优先不改）。
- `.ccg/spec/guides/index.md`（仅在形成新的可复用规则时）。
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 本 CCG task 记录。

## 禁止修改

- `legacy-miaoda/`、业务 API、数据库 schema/migration、worker、Kiosk/Admin/Partner/Terminal Agent。
- production 配置、凭据、PM2/Nginx、数据库、Redis、对象存储或 Windows 设备。
- D3–D6、Genesis/activation/cutover 生产流程。

## 测试驱动验收

1. RED：自动化测试能稳定证明深路径 PM2 socket 超限，并证明现有预检缺少有界终止/清理合同。
2. GREEN：所有 PM2 socket 绝对路径保持在安全预算内；预检/kill 有 bounded timeout；nonce-owned daemon
   和 socket 在失败路径被精确清理，禁止广域 kill/rm。
3. 回归：`verify:d2-same-host-contract`、API typecheck/lint/build、相关 shell/Node 合同全绿。
4. Claude、Antigravity、Cursor 双向复核无未关闭 Critical/High。
5. 不执行 full drill；修复通过不等于 D2′ PASS，retake 仍需单独授权。
