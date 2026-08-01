# F1 D2 invocation uniqueness 审查记录

## 结论

- Antigravity：APPROVED，Critical 0，Warning 0。
- Claude：APPROVED，Critical 0，Warning 0。
- 分阶段独立规格审查：RED contract、governance module、run.sh wiring、runbook 均最终 SPEC COMPLIANT。
- 分阶段独立质量审查：所有 Critical / Important 已按 TDD 修复后复审关闭。

## 主要审查修复

1. 将 durable mutation 标记提前到 `mkdirSync` / `O_EXCL openSync` 成功瞬间，覆盖部分写入与 fsync 失败后的 busy tombstone。
2. 统一 canonical target 检查并在临界区内重确认 parent；拒绝可写 parent、FIFO、硬链接与超限 ledger。
3. 把 repository 探测改为懒求值且 fail closed；收紧 branch 前导 `-`。
4. `run.sh` 从 approved PATH 解析绝对 `env` / Node 后才 consume，并三次复核 baseline、symbolic branch、clone realpath 与 tracked/index clean。
5. runbook 固定 source preflight、pre-clone reserve、`git clone --no-local`、唯一 branch 与唯一 full drill；所有有副作用的多步 block 使用 `&&` 短路链。
6. verifier 拒绝注释诱饵、`if false`、heredoc、后置覆盖、尾随 `|| true` / 注释的重复 reserve/clone/switch。

## 新鲜验证

- `bash -n services/api/scripts/d2-same-host/run.sh`：exit 0。
- 三份 `.mjs` `node --check`：exit 0。
- `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`：exit 0，`D2_PRIME_CONTRACT_ALL_PASS`。
- API lint / typecheck / build：exit 0。
- `pnpm audit --audit-level=critical`：exit 0；3 high / 1 moderate / 3 low，无 critical。
- `git diff --check`：exit 0。
- `verify-contract.mjs`：997 行。

## 非阻塞 Info / 后续治理

- `verify-invocation-governance.mjs` 为 1324 行，已进入强制拆分清单；下一次实质扩展前拆为 behavior / shell wiring / runbook contract。
- 可随拆分补 consume 并发 barrier；当前 consume 与 reserve 共用同一全局锁和 `O_EXCL` marker，终审未发现正确性缺陷。
- 离线 verifier 使用系统 `mkfifo`，应在工具依赖说明中显式记录。
- consume 后任何平台或身份复核失败都会永久烧毁 invocation；这是已记录的安全优先 fail-closed 设计。

## 边界

未运行 reserve/full drill，未启动 Colima，未生成 nonce/evidence，未 SSH、未连接 production、未部署、未进入 D3–D6；本任务不构成 D2′ PASS，`productionF1` 保持 NO-GO。
