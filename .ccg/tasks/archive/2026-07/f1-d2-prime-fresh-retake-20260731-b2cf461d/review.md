# D2′ fresh retake 审查记录

## 最终结论

`NO-GO / PRE-START HARD STOP`。本轮只完成执行前审查，没有执行 retake。

## Critical

1. `run.sh` 以 `trap cleanup EXIT` 执行清理；cleanup 失败时仅 `return 2`，不会覆盖脚本原本的成功退出状态。独立最小复现 `bash -c 'cleanup(){ return 2; }; trap cleanup EXIT; exit 0'` 的最终退出码仍为 `0`。因此 PM2/Nginx cleanup 失败时，脚本仍可能先输出 `D2_PRIME_PASS` 并以 `0` 退出，违反“cleanup 失败必须 NO-GO”的合同。
2. user systemd cleanup 的 `stop` / `reset-failed` 使用 `|| true`，之后没有重新查询并证明相关 unit 已 inactive；即使其他资源清理成功，也不能证明 systemd 残留为零。

## Warning

1. production secret denylist 只覆盖少量名称，且腾讯云变量使用了与项目不一致的别名；项目实际还存在 `TENCENT_COS_*`、`TENCENT_SECRET_*`、`TRTC_*`、OCR/ASR、JWT、文件签名、加密、支付和终端等凭据变量。内层 `env -i` 能减少运行时继承，但不能证明 pre-run install/build 的 caller 环境无生产凭据。
2. runbook 示例使用通用 evidence 文件名，与本次授权的精确时间戳路径不同；未来授权包必须只保留一条完全一致的唯一命令，并留存 durable call-count transcript。

## 多模型交叉复核

- Claude：复现两项 Critical 后撤回初始 GO，更正为 `NO-GO`。
- Antigravity：复现 EXIT trap 与 systemd cleanup 缺口后更正为 `NO-GO / REQUEST_CHANGES`。
- Cursor：CLI 空输出后按授权使用客户端；修正上下文后判定 `NO-GO`，确认两项 cleanup Critical。
- 独立 Codex reviewer：首先发现并复现 EXIT trap 假通过，同时指出 denylist 与执行审计缺口，结论 `NO-GO`。

## 执行边界与事实

- baseline 仅固定为 `b2cf461dcd6ea4f70adef3bb210f2fbc5572c0a5`，没有进入 guest 执行。
- 未启动 Colima、未创建 `/var/lib/d2-prime-prep/fresh-retake-20260731-b2cf461d`、未生成 nonce 或 evidence。
- `drill:d2-same-host` 调用计数为 `0`；授权窗口和固定路径随本次硬停止作废，不得在修复后复用。
- 未连接或修改 production；`productionF1` 继续 `NO-GO`，D3–D6 未获授权。
