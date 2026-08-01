# D2′ Full Drill Invocation Audit

- authorizedCommit: `5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`
- authorizedWindow: `2026-08-01T00:45:00+08:00` — `2026-08-01T02:15:00+08:00`
- exactClone: `/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f`
- exactEvidenceDir: `/var/lib/d2-prime-prep/evidence`
- exactEvidenceOut: `/var/lib/d2-prime-prep/evidence/fresh-retake-20260801-5b251e5f.json`
- fullDrillInvocationCount: `1`（于 `2026-08-01T00:59:00+08:00` 在命令发起前保守计数；无论进程结果均不得第二次调用）
- nonce: 仅由 `run.sh` 自动生成，不在记录中保存真实值。
- invocationResult: `D2_PRIME_NO_GO_ENVIRONMENT`，内部 exit `2`；失败发生在 nonce 生成前。
- evidenceResult: 精确文件未生成；独立 verifier 为 `D2_PRIME_EVIDENCE_REJECTED`，内部 exit `2`。
- rootCause: operator 把 clone 路径误传给实际用于覆盖 executable `PATH` 的 `D2_APPROVED_PATH`；必需命令缺失 `20/20`，脚本默认批准 PATH 缺失 `0/20`。
- cleanup: `3010/3011/18080`、D2 unit、runtime root、PM2/Nginx、`.work`、Git 差异均为 `0`；Colima stopped。
