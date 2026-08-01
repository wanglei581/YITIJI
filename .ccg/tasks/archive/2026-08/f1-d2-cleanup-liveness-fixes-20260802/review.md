# 最终审查记录

## 结果

- Claude：APPROVE；Critical 0，Warning 0。Info：`kill -TERM` 自身失败分支可在后续补专门行为夹具。
- Antigravity：APPROVE；Critical 0，Warning 0。
- Cursor：APPROVE；Critical 0，Warning 0；复核并更正了其早先对 Bash `return 1` 语义的误读。

## RED → GREEN

- RED：只加入四项新合同后，在旧实现上得到 `D2_PRIME_CLEANUP_CONTRACT_INVALID`（exit 2）。
- GREEN：实现 systemctl stop timeout、PM2 captured-PID 复验、keeper 悲观置位、Nginx attempt/identity/有限停止证明后，离线总合同恢复 `D2_PRIME_CONTRACT_ALL_PASS`。
- 终审修正：Nginx 在 post-TERM 身份复验期间恰好退出时不再误报失败；清理前重新证明 `RUN_DIR` 位于 `WORK_DIR` 子目录、属于当前用户且不是符号链接。

## 验证

- `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`：通过，11 组 PASS。
- invocation governance：60/60；coverage lines 97.82%、branches 89.64%、functions 97.79%。
- API lint、typecheck、build：通过。
- `bash -n`、Node `--check`、`git diff --check`：通过。

## 边界

没有运行 `run.sh`、reserve/invoke/full drill、Colima、systemd、PM2、Nginx 或 API 服务；没有生成 nonce/evidence，没有连接或部署 production。本任务不构成 D2′ PASS 或 fresh-retake 授权，`productionF1` 保持 NO-GO。
