# F1 D2 cleanup reconciliation 审查记录

## 结论

- Antigravity 终审：APPROVE，Critical 0，Warning 0。
- Claude 终审：APPROVE，Critical 0，Warning 0。
- 上一轮 Claude 指出的 evidence 防删断言缺 mutation 自证、fixture 旧 helper/单属性死分支已修复。
- 终审期间 `origin/main` 前进到 `0244165f`（PR #465）；候选已 rebase，并集保留 systemd 版本固定及三项 cleanup 存活证明 backlog。

## RED → GREEN

- RED：PR #464 的 helper 在 stop 成功后对 `masked+inactive` 返回 0；严格合同期望返回 1。
- GREEN：单次 `systemctl show -p LoadState -p ActiveState` 按键解析，只接受 `loaded+inactive` / `not-found+inactive`。
- 真实 Bash fixture 直接抽取并执行生产 helper，覆盖 4 类成功和 10 类失败边界。

## 保留与新增防线

- 保留 PR #464 的 `RUN_DIR` / `PM2_CONTROL_ROOT` 逐目录 forensic retention guard。
- 保留每条 mutation 必须真实改写源码的 no-op 防线。
- 新增 cleanup 不得删除 evidence 的断言与自证 mutation。
- 主 verifier 1065 → 883 行，拆出 251 行 cleanup verifier。

## 新鲜门禁

- `bash -n services/api/scripts/d2-same-host/run.sh`：exit 0。
- 两份 Node verifier `node --check`：exit 0。
- `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`：11 PASS，`D2_PRIME_CONTRACT_ALL_PASS`。
- API lint / typecheck / build：exit 0。
- `pnpm audit --audit-level=critical`：exit 0；既有 3 high / 1 moderate / 3 low，无 critical。
- `git diff --check` 与 staged diff check：exit 0。

## 执行边界

本任务没有执行 reserve、consume 或 full drill；没有启动 Colima/systemd/PM2/Nginx/API；没有生成 nonce/evidence；没有 SSH、production 连接、部署或 D3–D6。`productionF1` 继续 NO-GO。
