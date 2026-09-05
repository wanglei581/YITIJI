# Release Plan

> **本文档基本为空，这是如实状态**：小程序尚未上传、尚未配置发布、
> 微信平台材料未做，因此不存在真实的部署、回滚、观测与外部就绪计划。
> 没有的东西保留 TBD，不编。

## Release Identity

- Revision/artifact: `0c04cec15ee92debc5d47f178b5bac52a4478bd0`（分支 `claude/miniapp-lane`）
  —— 注意该分支正被并发提交，引用前先 `git rev-parse HEAD` 比对（EV-031）。
  该分支**不在任何远端**（`git branch -r --contains HEAD` 为空），
  这个修订目前只存在于本地 worktree，不构成任何可分发的发布物
- Build provenance/checksum: TBD —— 小程序无构建产物；发布物是微信开发者工具上传的代码包，从未上传过
- Configuration schema: `apps/miniapp/utils/config.js`（`USE_MOCK` 正式源码默认关闭，由静态门禁断言）
- Migration set: 无 —— 本批两个后端端点均为 additive，未涉及 Prisma 迁移

## Deployment

- Preconditions: TBD
- Steps: TBD
- Verification: TBD
- Owner/window: TBD

## Rollout And Abort

- Initial population: TBD
- Feature controls: TBD
- Success signals: TBD
- Abort thresholds and authority: TBD

## Observability And Support

- Logs/traces/metrics: TBD
- Business dashboard: TBD
- Alerts and on-call: TBD
- User communication: TBD

## Rollback And Recovery

- Application rollback: TBD
- Data compatibility/restore: TBD
- RTO/RPO or recovery target: TBD
- Last rehearsal evidence: TBD

## External Readiness

- Domains/certificates: TBD
- Secrets and rotation owner: TBD
- Providers/payment/devices: TBD
- Legal/privacy/licensing: TBD
