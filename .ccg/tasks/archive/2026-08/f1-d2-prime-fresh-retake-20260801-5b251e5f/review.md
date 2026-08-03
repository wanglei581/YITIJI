# F1 D2′ Fresh Retake 执行审查

## 结论

本轮永久锁定为 `PRE-NONCE NO-GO`。full drill 命令只发起一次，不得在授权窗口内重跑；`productionF1=NO-GO`，D3–D6 未获授权。

## 执行事实

- baseline：`5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`。
- fresh clone：mode `0700`、detached HEAD/`origin/main` 精确一致、工作树干净、真实 `.env` 为 0。
- frozen install、API build、Bash/Node 语法与 offline contract 全绿；最终 pre-nonce gate 为 0 failures。
- 唯一调用输出 `D2_PRIME_NO_GO_ENVIRONMENT`，内部 exit `2`；外层 `colima ssh` exit `1`。
- nonce 与 evidence 均未生成；独立 verifier 的 offline contract 仍全绿，随后返回 `D2_PRIME_EVIDENCE_REJECTED` / 内部 exit `2`。
- cleanup audit 全零，Colima stopped。

## 授权边界解释风险

用户原文写有“不 SSH”；执行时将其解释为“不对任何外部或 production 主机 SSH”，但 guest 命令实际通过本机 `colima ssh` transport 执行。未连接任何外部或 production 主机，也未使用远端 SSH。若原意是禁止任何基于 SSH 的 transport，则这构成授权边界偏差；本记录不以“未 SSH”掩盖该事实。

## 根因证据

operator 在唯一命令中传入：

```text
D2_APPROVED_PATH=/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f
```

`run.sh:16-23` 将 `D2_APPROVED_PATH` 解析为冒号分隔的 executable `PATH` 并执行 `export PATH="$APPROVED_PATH"`，它不是仓库路径字段。随后 `run.sh:25-28` 检查包含 20 项的 `required_commands`；只读探针证明错误 PATH 下缺失 `20/20`，脚本默认 `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` 下缺失 `0/20`。因此失败发生在 `run.sh:27`，早于 XDG preflight、nonce、workspace 与 evidence。

## 边界

- 不把本轮写成代码回归或 D2′ PASS。
- 不在当前任务修脚本，不在当前窗口重跑。
- 下一步另立 TDD 任务收紧执行包/命令合同，再申请全新基线、路径与窗口。

## 双模型终审

- Antigravity：`APPROVE`，Critical / Warning 均为 0；确认事实链自洽、无 secret/nonce 泄露、下一步顺序正确。
- Claude：`FINAL REVIEW: GO`，Critical 为 0；建议后续合同任务校验批准 PATH 能解析全部 required commands，并将复用的 `D2_PRIME_NO_GO_ENVIRONMENT` 失败点收紧为可独立定位的固定错误码。两项已写入正式 next-tasks。
- 终审仅批准结果文档提交，不改变演练结论：本轮仍为 `PRE-NONCE NO-GO`，`productionF1=NO-GO`。

## 完成前验证

- `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`：exit `0`，`D2_PRIME_CONTRACT_ALL_PASS`。
- `git diff --check`：exit `0`。
- 结果文档与 CCG 记录敏感值扫描：PASS。
- `colima status`：明确返回 `colima is not running`。

## 授权边界补充终审

- 首轮补充审查发现不能追溯改窄归档 plan 的原始“不 SSH”硬停止条件；已恢复原文，并采用追加式审计附注交叉引用 transport 披露。
- 修正后 Antigravity 为 `DOCUMENTATION GO`、Critical / Warning 均为 0；Claude 为 `DOCUMENTATION GO`、Critical 为 0，并建议 plan 增加交叉引用，该 Warning 已落实。
- 此终审只确认披露文档忠实、没有替用户消除歧义；是否将本机 `colima ssh` 视为原授权明确禁止的 SSH，保留由用户裁定。本轮无论如何继续 `PRE-NONCE NO-GO`。
