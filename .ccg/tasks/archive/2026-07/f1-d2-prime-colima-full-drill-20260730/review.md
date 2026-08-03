# F1 D2′ Colima Full Drill 多模型审查

## 执行前结论

Claude、Antigravity 与 Cursor 均给出 `GO`，Critical 0。该 GO 只表示允许在现有非生产 Colima
执行演练；最终 D2′ 状态仍由 fresh drill exit code 与落盘 evidence verifier 决定。

## Claude

- fail-closed 顺序正确，生产变量检查发生在任何进程启动前。
- Genesis → r2 activation → 不健康 r3 → managed r2 rollback 使用真实构建产物。
- evidence exact-key schema、raw measurement 重算、exclusive write 与 nonce cleanup 可防伪造和误清理。
- 执行前必须确认 evidence 文件不存在、目录 owner/mode 正确、production 变量全空。

## Antigravity

- Linux/systemd/cgroup v2、双 PM2 控制面、真实 Nginx invalid/valid candidate 与 all-or-none 观测链路可执行。
- Critical 0；Warning 为固定 evidence 路径冲突与 user systemd 持久性，均纳入 preflight。

## Cursor

- 当前宿主记录分支 HEAD 为 `4311683b`，其中相对 `313d358d` 仅增加 PREP progress/CCG 归档；
  D2′ scripts/runbook 零漂移。真正执行演练的 guest ext4 clone 必须继续精确为 `313d358d`。
- run.sh 内已在最小 `env -i` 环境调用 verifier；runbook 要求的外部调用会再次独立 parse/validate
  同一磁盘 JSON，属于有意的双重复核。
- 演练前重跑 build/offline contract，并检查 `DIRECT_URL` 在内的完整 production denylist、
  `XDG_RUNTIME_DIR`、linger、端口和 evidence 路径。

## 硬停止条件

首次 full drill 任何非零退出、任何 `D2_PRIME_NO_GO`、缺 PASS 标识、evidence verifier 失败或 cleanup
残留，均记录为 D2′ NO-GO；不 retake、不修改 evidence、不借用 production。

## 执行结果

- Fresh build 与 offline contract 通过；guest detached HEAD 为 `313d358d50563491892dcbcc6bc65ed82167c15f`，仓库干净。
- 唯一一次 full drill 在 PM2 控制面失败，输出 `D2_PRIME_MANAGED_READY_TIMEOUT`、
  `D2_PRIME_RUNTIME_FAILURE`，内部退出码 2。
- 预期 PM2 `pub.sock` 路径 127 字节；PM2 `6.0.13` 报 `ENOENT` 并挂起。失败后发现一个
  被截到 108 字节的 nonce socket，说明路径长度根因成立；run.sh 预检未给 daemon 完整 timeout，
  cleanup 无法自动覆盖该残留。
- 独立 `env -i` verifier 输出 `D2_PRIME_CONTRACT_ALL_PASS`、`D2_PRIME_EVIDENCE_NO_GO`、
  `evidenceVerdict=D2_PRIME_NO_GO`、`productionF1=NO-GO`，退出码 2。
- Evidence mode `0600`，SHA-256
  `1b8f05f3082d7dd3319fb39e9546bb6e15b64de3debc0f65fedc36c92db88c04`；`dataSafety`
  七项均证明未触碰生产数据平面或启动额外后台消费者。
- 精确核对 socket 无 `/proc/net/unix` 绑定且无 nonce 进程后，仅 unlink 该路径；最终端口
  `3010/3011/18080` 空闲，无 D2 user unit / nonce 进程，`.work` 为空，evidence 完整。

## 执行后多模型复核

- **Claude**：首演必须锁定 NO-GO；根因方向成立。Critical 为 socket 路径和 PM2 daemon 泄漏，
  Warning 为预检 timeout 与根因机器证据应在修复测试中固化。
- **Antigravity**：`REQUEST_CHANGES`；Critical 为 PM2 socket 路径超限和预检缺 timeout，Warning 为
  early cleanup 不能终止派生 daemon。必须先 TDD 修复，再申请新授权。
- **Cursor**：对 NO-GO 判定给 `APPROVE`，Critical 0；要求用长/短 `PM2_HOME` 参数化测试锁定根因，
  同步修正短路径断言、启动 timeout 和 cleanup，禁止把修复代码等同于 D2′ PASS。

## 最终结论

本次任务目标“执行唯一一次 full drill 并判定结果”已经完成，结果为 **D2′ NO-GO**。不在本任务中
修改演练脚本或 retake；后续另起 TDD 修复任务，修复通过后仍需用户对新窗口独立授权。
