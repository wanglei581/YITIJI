# D2′ cleanup 合同修复审查记录

## TDD 证据

- 首轮 RED：旧 `run.sh` 在新增 cleanup/systemd/production-env 合同下返回 `D2_PRIME_CLEANUP_CONTRACT_INVALID` / exit `2`。
- 首轮 GREEN：显式 cleanup、EXIT handler、严格 inactive helper 与真实凭据 denylist 落地后恢复 `D2_PRIME_CONTRACT_ALL_PASS`。
- Cursor Warning RED：合同要求当前源码已读取的 `TENCENT_TTS_SECRET_ID/KEY` 必须进入 `.env.example`，旧样板返回同一合同错误 / exit `2`。
- Cursor Warning GREEN：补无值注释占位后恢复 `D2_PRIME_CONTRACT_ALL_PASS`。

## 多模型终审

- Claude：两轮 `APPROVE`；最终 Critical 0、Warning 0。
- Antigravity：两轮 `APPROVE`；最终 Critical 0、Warning 0。
- Cursor 客户端：设计复核 `APPROVE_DESIGN`；实现复核初次 `APPROVE` 并指出 TTS 样板一致性 Warning；关闭后最终 `APPROVE`。
- Codex：确认 Bash EXIT trap 的原成功码不会被 cleanup `return 2` 覆盖；最终实现改为 handler 内显式 `exit 2`，成功标记晚于显式 cleanup。

## 最终验证

- `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`：PASS，`D2_PRIME_CONTRACT_ALL_PASS`。
- `bash -n services/api/scripts/d2-same-host/run.sh`：PASS。
- `node --check services/api/scripts/d2-same-host/verify-contract.mjs`：PASS。
- `pnpm --filter @ai-job-print/api lint`：PASS。
- `pnpm --filter @ai-job-print/api typecheck`：PASS（最终串行复跑；一次与 build 并发生成 Prisma 时出现的 `EEXIST` 已证明是同目录生成竞争）。
- `pnpm --filter @ai-job-print/api build`：PASS。
- `git diff --check`：PASS。

## 范围与裁决

- 未运行 full drill，未启动 Colima、PM2、Nginx、systemd 或 API，未连接 production，未生成 nonce/evidence，未进入 D3–D6。
- Critical：0；Warning：0。
- 裁决：本地代码候选可提交；提交、合入不等于 D2′ PASS，`productionF1` 继续 `NO-GO`。
