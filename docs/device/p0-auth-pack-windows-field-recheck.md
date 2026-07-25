# 上线前 P0 授权包 — `WINDOWS_FIELD_RECHECK`

> 最后更新：2026-07-25  
> 对应 `docs/progress/next-tasks.md` 当前执行 §7c。  
> 现场逐步清单见 [windows-field-recheck-phase-f-runbook.md](./windows-field-recheck-phase-f-runbook.md)；换机操作细则见 [windows-host-acceptance-runbook.md](./windows-host-acceptance-runbook.md)；验收勾选项见 checklist §五。

## 边界

| Phase | 允许 | 禁止 |
|-------|------|------|
| **R 远程旁证**（已做，2026-07-25） | 只读查终端心跳 / printer-status / Capability 行数 | 伪造现场出纸或扫描通过 |
| **F 现场复验**（2026-07-25 回执：部分通过） | 到场核对 Agent 服务、驱动、真机出纸/扫描、断网恢复；脱敏写证据 | 未授权新建生产打印单；密钥/token 进聊天或仓库；F4 未出纸不得标整包完成 |

与本包无关：7b 密钥控制台轮换举证、G5 退款冒烟、F1 Genesis、close-unpaid Phase B、切 live 支付。

## Phase R 已记事实（不替代 F）

- 终端 `t_ksk_001`：`printerStatus=ready`、`isOnline=true`；近期心跳存在
- `TerminalCapability` 对 `t_ksk_001` 为 **0 行**（`PRINT_SCAN_CAPABILITY_MODE=managed` 下空表 ≠ 现场能力已验）
- 历史曾有真实出纸样本（见 `next-tasks` Windows 真机条）；**断网/重启恢复、扫描/U 盘整机收口仍待现场**

## Phase F 现场最小清单（到场执行）

1. Windows：`AIJobPrintAgent` Running + Automatic；`Get-Printer` 记录真实名 → Agent `printerName` 一致（禁止硬编码型号）— **✅ 2026-07-25**
2. 本机队列清空；Admin/API 确认该终端无 active `pending/claimed/printing`（避免抢旧单）— **✅ 队列最终 0**
3. 受控样张：无个人信息 PDF **或** 用户明确授权的试运营单 → 真机出纸；记录 `taskId` / 页数 — **⏭ 跳过**（文件选择器未接收 PDF；未建单）。**待补**
4. 断网：拔线后终端应变离线/不可伪造成功；恢复后心跳与 claim 恢复 — **✅ WLAN 75s，恢复无需重启 Agent**
5. 扫描或 U 盘：若本期宣称可用则真机走通；否则诚实记录「未验收 / 能力关闭」— **未做**

详细步骤与回执表：`windows-field-recheck-phase-f-runbook.md`；勾选映射：checklist §5.3–§5.7（仅勾已举证项）。

## 授权回复模板

```text
授权 WINDOWS_FIELD_RECHECK
环境：生产一体机 / 预生产一体机（二选一写明）
终端：t_ksk_001（或实际 terminalId）
范围：Phase F——Agent 服务 + 奔图驱动 + 受控出纸 + 断网恢复（扫描/U盘：做 / 不做）
窗口：2026-07-25 起
说明：证据脱敏；不贴密钥/token；不默认宣称整机商用通过
```

若仅允许远程复读旁证、不到场：

```text
授权 WINDOWS_FIELD_RECHECK（仅 Phase R 复读）
环境：预生产
说明：只读 printer-status / heartbeat；不建打印单；不宣称现场通过
```
